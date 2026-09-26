import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { oauthContextAuth, buildJwt, initClient, initClientWithAuth, resetClientForTests } from "./auth.js";
import { resetRateLimiterForTests } from "./rate-limit.js";
import { apiRequest } from "./transport.js";
import { oauthContext } from "../oauth.js";
import { DEFAULT_BASE_URL } from "../../constants.js";

describe("initClient", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars
    delete process.env.BOOND_API_TOKEN;
    delete process.env.BOOND_USER;
    delete process.env.BOOND_PASSWORD;
    delete process.env.BOOND_USER_TOKEN;
    delete process.env.BOOND_CLIENT_TOKEN;
    delete process.env.BOOND_CLIENT_KEY;
    delete process.env.BOOND_BASE_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should throw when no credentials are set", () => {
    expect(() => initClient()).toThrow("Authentication required");
  });

  it("should not throw when BOOND_API_TOKEN is set", () => {
    process.env.BOOND_API_TOKEN = "test-token";
    expect(() => initClient()).not.toThrow();
  });

  it("should not throw when BOOND_USER and BOOND_PASSWORD are set", () => {
    process.env.BOOND_USER = "user";
    process.env.BOOND_PASSWORD = "pass";
    expect(() => initClient()).not.toThrow();
  });

  it("should not throw when JWT components are set", () => {
    process.env.BOOND_USER_TOKEN = "user-token";
    process.env.BOOND_CLIENT_TOKEN = "client-token";
    process.env.BOOND_CLIENT_KEY = "client-key";
    expect(() => initClient()).not.toThrow();
  });

  it("should ignore unresolved template variables and fall back to BasicAuth", () => {
    process.env.BOOND_USER_TOKEN = "${user_config.user_token}";
    process.env.BOOND_CLIENT_TOKEN = "${user_config.client_token}";
    process.env.BOOND_CLIENT_KEY = "${user_config.client_key}";
    process.env.BOOND_API_TOKEN = "${user_config.api_token}";
    process.env.BOOND_USER = "user";
    process.env.BOOND_PASSWORD = "pass";
    expect(() => initClient()).not.toThrow();
  });

  it("should throw when all values are unresolved templates", () => {
    process.env.BOOND_USER_TOKEN = "${user_config.user_token}";
    process.env.BOOND_API_TOKEN = "${user_config.api_token}";
    process.env.BOOND_USER = "${user_config.user}";
    expect(() => initClient()).toThrow("Authentication required");
  });
});

/**
 * `BOOND_BASE_URL` is the one env var where a bad fallback is silent: an empty
 * or blank value would make every request target a relative path instead of
 * BoondManager, and the failure surfaces as an opaque fetch error rather than
 * "you left the URL blank".
 *
 * Both packaged install channels — the MCPB extension and the Claude Code plugin
 * — substitute `${user_config.base_url}` into the var unconditionally, so it is
 * always *defined*, even when the user cleared the field. Three shapes must all
 * fall back to `DEFAULT_BASE_URL`.
 */

describe("initClient: base URL resolution", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetClientForTests();
    process.env.BOOND_API_TOKEN = "test-token";
    process.env.BOOND_HTTP_MAX_RETRIES = "0";
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "0";
    resetRateLimiterForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    resetClientForTests();
    resetRateLimiterForTests();
  });

  /** Resolve the effective base URL by looking at the URL `apiRequest` fetches. */
  async function requestedUrl(): Promise<string> {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": "2" }),
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal("fetch", fetchMock);
    initClient();
    await apiRequest("/candidates/1");
    return String(fetchMock.mock.calls[0][0]);
  }

  it.each([
    ["empty string", ""],
    ["whitespace only", "   "],
    ["unsubstituted placeholder", "${user_config.base_url}"],
  ])("falls back to the default base URL when BOOND_BASE_URL is %s", async (_label, raw) => {
    process.env.BOOND_BASE_URL = raw;
    expect(await requestedUrl()).toBe(`${DEFAULT_BASE_URL}/candidates/1`);
  });

  it("honours a real custom base URL (dedicated instance)", async () => {
    process.env.BOOND_BASE_URL = "https://acme.boondmanager.com/api";
    expect(await requestedUrl()).toBe("https://acme.boondmanager.com/api/candidates/1");
  });
});

describe("buildJwt", () => {
  it("should produce a valid 3-part JWT", () => {
    const jwt = buildJwt("user-tok", "client-tok", "secret");
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
  });

  it("should encode the correct header", () => {
    const jwt = buildJwt("u", "c", "k");
    const header = JSON.parse(Buffer.from(jwt.split(".")[0], "base64url").toString());
    expect(header).toEqual({ alg: "HS256", typ: "JWT" });
  });

  it("should encode userToken and clientToken in payload", () => {
    const jwt = buildJwt("my-user", "my-client", "key");
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    expect(payload).toEqual({ userToken: "my-user", clientToken: "my-client" });
  });

  it("should produce deterministic output for same inputs", () => {
    const a = buildJwt("u", "c", "k");
    const b = buildJwt("u", "c", "k");
    expect(a).toBe(b);
  });

  it("should produce different output for different keys", () => {
    const a = buildJwt("u", "c", "key1");
    const b = buildJwt("u", "c", "key2");
    expect(a).not.toBe(b);
  });

  it("omits iat/exp by default (legacy payload shape)", () => {
    const payload = JSON.parse(Buffer.from(buildJwt("u", "c", "k").split(".")[1], "base64url").toString());
    expect(payload).toEqual({ userToken: "u", clientToken: "c" });
  });

  it("adds iat/exp when expiresInSeconds is set", () => {
    const jwt = buildJwt("u", "c", "k", { expiresInSeconds: 3600, nowSeconds: 1000 });
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    expect(payload).toEqual({ userToken: "u", clientToken: "c", iat: 1000, exp: 4600 });
  });
});

describe("apiRequest auth header routing", () => {
  // BoondManager rejects JWT auth carried in `Authorization: Bearer …` with
  // `422 Signature verification failed`. The token must travel in
  // `X-Jwt-Client-Boondmanager`. BasicAuth, by contrast, is plain HTTP and
  // belongs in `Authorization`. These tests pin that contract so we don't
  // regress.
  const successResponse = () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-length": "10" }),
    json: () => Promise.resolve({ data: [] }),
  });

  beforeEach(() => {
    delete process.env.BOOND_API_TOKEN;
    delete process.env.BOOND_USER;
    delete process.env.BOOND_PASSWORD;
    delete process.env.BOOND_USER_TOKEN;
    delete process.env.BOOND_CLIENT_TOKEN;
    delete process.env.BOOND_CLIENT_KEY;
    process.env.BOOND_HTTP_MAX_RETRIES = "0";
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "0";
    resetRateLimiterForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BOOND_API_TOKEN;
    delete process.env.BOOND_USER;
    delete process.env.BOOND_PASSWORD;
    delete process.env.BOOND_USER_TOKEN;
    delete process.env.BOOND_CLIENT_TOKEN;
    delete process.env.BOOND_CLIENT_KEY;
    delete process.env.BOOND_HTTP_MAX_RETRIES;
    delete process.env.BOOND_HTTP_RATE_LIMIT_RPS;
    resetRateLimiterForTests();
  });

  it("sends auto-built JWT in X-Jwt-Client-Boondmanager (not Authorization)", async () => {
    process.env.BOOND_USER_TOKEN = "user-tok";
    process.env.BOOND_CLIENT_TOKEN = "client-tok";
    process.env.BOOND_CLIENT_KEY = "secret";
    initClient();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successResponse()));

    await apiRequest("/application/current-user");
    const options = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const headers = options.headers as Record<string, string>;
    expect(headers["X-Jwt-Client-Boondmanager"]).toBeDefined();
    expect(headers["X-Jwt-Client-Boondmanager"].split(".")).toHaveLength(3);
    expect(headers.Authorization).toBeUndefined();
  });

  it("sends pre-built BOOND_API_TOKEN in X-Jwt-Client-Boondmanager (not Authorization)", async () => {
    process.env.BOOND_API_TOKEN = "pre-built.jwt.value";
    initClient();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successResponse()));

    await apiRequest("/application/current-user");
    const options = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const headers = options.headers as Record<string, string>;
    expect(headers["X-Jwt-Client-Boondmanager"]).toBe("pre-built.jwt.value");
    expect(headers.Authorization).toBeUndefined();
  });

  it("sends BasicAuth credentials in Authorization header", async () => {
    process.env.BOOND_USER = "alice";
    process.env.BOOND_PASSWORD = "s3cret";
    initClient();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successResponse()));

    await apiRequest("/application/current-user");
    const options = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const headers = options.headers as Record<string, string>;
    const expected = `Basic ${Buffer.from("alice:s3cret").toString("base64")}`;
    expect(headers.Authorization).toBe(expected);
    expect(headers["X-Jwt-Client-Boondmanager"]).toBeUndefined();
  });
});

describe("initClientWithAuth (dynamic auth provider)", () => {
  // Used by the HTTP transport to plug in OAuth — the access token is
  // resolved per request so it can refresh transparently between calls.
  const successResponse = () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-length": "10" }),
    json: () => Promise.resolve({ data: [] }),
  });

  beforeEach(() => {
    delete process.env.BOOND_API_TOKEN;
    delete process.env.BOOND_USER;
    delete process.env.BOOND_PASSWORD;
    delete process.env.BOOND_USER_TOKEN;
    delete process.env.BOOND_CLIENT_TOKEN;
    delete process.env.BOOND_CLIENT_KEY;
    process.env.BOOND_HTTP_MAX_RETRIES = "0";
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "0";
    resetRateLimiterForTests();
    resetClientForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BOOND_HTTP_MAX_RETRIES;
    delete process.env.BOOND_HTTP_RATE_LIMIT_RPS;
    resetRateLimiterForTests();
    resetClientForTests();
  });

  it("sends the provider-supplied header on each request", async () => {
    initClientWithAuth(async () => ({ name: "Authorization", value: "Bearer AT-1" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successResponse()));

    await apiRequest("/application/current-user");
    const options = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const headers = options.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer AT-1");
    expect(headers["X-Jwt-Client-Boondmanager"]).toBeUndefined();
  });

  it("re-invokes the provider on every request so the token can rotate", async () => {
    let n = 0;
    initClientWithAuth(async () => ({ name: "Authorization", value: `Bearer AT-${++n}` }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successResponse()));

    await apiRequest("/application/current-user");
    await apiRequest("/application/current-user");
    const headersFirst = (vi.mocked(fetch).mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    const headersSecond = (vi.mocked(fetch).mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(headersFirst.Authorization).toBe("Bearer AT-1");
    expect(headersSecond.Authorization).toBe("Bearer AT-2");
  });

  it("respects a custom baseUrl override", async () => {
    initClientWithAuth(async () => ({ name: "Authorization", value: "Bearer X" }), "https://example.test/api");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successResponse()));

    await apiRequest("/application/current-user");
    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toBe("https://example.test/api/application/current-user");
  });
});

describe("oauthContextAuth", () => {
  // Bridge between the HTTP transport (which fills the AsyncLocalStorage
  // context) and the boond-client (which forwards the Bearer to Boond).
  const successResponse = () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-length": "10" }),
    json: () => Promise.resolve({ data: [] }),
  });

  beforeEach(() => {
    process.env.BOOND_HTTP_MAX_RETRIES = "0";
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "0";
    resetRateLimiterForTests();
    resetClientForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BOOND_HTTP_MAX_RETRIES;
    delete process.env.BOOND_HTTP_RATE_LIMIT_RPS;
    resetRateLimiterForTests();
    resetClientForTests();
  });

  it("forwards the per-request access token from AsyncLocalStorage as a Bearer", async () => {
    initClientWithAuth(oauthContextAuth);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successResponse()));

    await oauthContext.run({ accessToken: "user-AT" }, async () => {
      await apiRequest("/application/current-user");
    });
    const options = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const headers = options.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer user-AT");
  });

  it("uses a different Bearer per concurrent request (multi-tenant isolation)", async () => {
    initClientWithAuth(oauthContextAuth);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successResponse()));

    await Promise.all([
      oauthContext.run({ accessToken: "tenant-A" }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        await apiRequest("/application/current-user");
      }),
      oauthContext.run({ accessToken: "tenant-B" }, async () => {
        await new Promise((r) => setTimeout(r, 1));
        await apiRequest("/application/current-user");
      }),
    ]);
    const tokens = vi
      .mocked(fetch)
      .mock.calls.map((c) => ((c[1] as RequestInit).headers as Record<string, string>).Authorization);
    expect(tokens.sort()).toEqual(["Bearer tenant-A", "Bearer tenant-B"]);
  });

  it("throws a clear error when called outside a request context", async () => {
    initClientWithAuth(oauthContextAuth);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successResponse()));
    await expect(apiRequest("/application/current-user")).rejects.toThrow(/Bearer/);
  });
});
