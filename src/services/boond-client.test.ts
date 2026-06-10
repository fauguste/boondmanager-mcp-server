import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildSearchQuery,
  formatEntitySummary,
  formatListResponse,
  formatDetailResponse,
  initClient,
  buildJwt,
  apiRequest,
  parseBoondErrorBody,
  formatApiError,
  resolveTimeoutMs,
  resolveRetryConfig,
  isRetryable,
  parseRetryAfter,
  computeBackoffMs,
  resolveRateLimitConfig,
  resetRateLimiterForTests,
  initClientWithAuth,
  resetClientForTests,
  oauthContextAuth,
  assertSafeApiPath,
} from "./boond-client.js";
import { oauthContext } from "./oauth.js";
import {
  CHARACTER_LIMIT,
  DEFAULT_HTTP_TIMEOUT_MS,
  DEFAULT_HTTP_MAX_RETRIES,
  DEFAULT_HTTP_RETRY_BASE_MS,
  DEFAULT_HTTP_RETRY_MAX_MS,
} from "../constants.js";

describe("buildSearchQuery", () => {
  it("should map keywords, page, and pageSize correctly", () => {
    const result = buildSearchQuery({ keywords: "react", page: 2, pageSize: 10 });
    expect(result).toEqual({ keywords: "react", page: 2, maxResults: 10 });
  });

  it("should omit undefined values", () => {
    const result = buildSearchQuery({});
    expect(result).toEqual({});
  });

  it("should forward additional filter params as strings", () => {
    const result = buildSearchQuery({ keywords: "test", customFilter: "value" });
    expect(result.keywords).toBe("test");
    expect(result.customFilter).toBe("value");
  });

  it("should not include undefined extra params", () => {
    const result = buildSearchQuery({ keywords: "test", extra: undefined });
    expect(result).not.toHaveProperty("extra");
  });
});

describe("formatEntitySummary", () => {
  it("should format entity with firstName and lastName", () => {
    const result = formatEntitySummary({
      id: "1",
      type: "candidate",
      attributes: { firstName: "Jean", lastName: "Dupont" },
    });
    expect(result).toContain("[candidate #1]");
    expect(result).toContain("Jean Dupont");
  });

  it("should format entity with name field", () => {
    const result = formatEntitySummary({
      id: "2",
      type: "company",
      attributes: { name: "Acme Corp" },
    });
    expect(result).toContain("Acme Corp");
  });

  it("should include email, phone, city, state, title when present", () => {
    const result = formatEntitySummary({
      id: "3",
      type: "resource",
      attributes: {
        firstName: "Marie",
        lastName: "Martin",
        email1: "marie@test.com",
        phone1: "0612345678",
        city: "Paris",
        state: 1,
        title: "Dev Senior",
      },
    });
    expect(result).toContain("Email: marie@test.com");
    expect(result).toContain("Tel: 0612345678");
    expect(result).toContain("Ville: Paris");
    expect(result).toContain("Statut: 1");
    expect(result).toContain("Titre: Dev Senior");
  });

  it("should handle entity with no known attributes", () => {
    const result = formatEntitySummary({
      id: "4",
      type: "unknown",
      attributes: {},
    });
    expect(result).toBe("[unknown #4]");
  });

  it("should handle firstName only (no lastName)", () => {
    const result = formatEntitySummary({
      id: "5",
      type: "candidate",
      attributes: { firstName: "Jean" },
    });
    expect(result).toContain("Jean");
  });

  it("does not crash when the entity lacks a JSON:API attributes wrapper", () => {
    // /calendars returns flat items shaped like { iso, value, subCalendars }
    // — no `attributes`. Treat the object itself as the attribute bag.
    const result = formatEntitySummary({ iso: "FR", value: "France" });
    expect(result).toContain("France");
    expect(result).toContain("ISO: FR");
  });
});

describe("formatListResponse", () => {
  it("should return message when no data", () => {
    const result = formatListResponse({ data: [] }, "candidat");
    expect(result).toBe("Aucun(e) candidat trouvé(e).");
  });

  it("should format single item", () => {
    const result = formatListResponse(
      {
        data: [{ id: "1", type: "candidate", attributes: { firstName: "Jean", lastName: "Dupont" } }],
      },
      "candidat"
    );
    expect(result).toContain("Jean Dupont");
  });

  it("should format multiple items", () => {
    const result = formatListResponse(
      {
        data: [
          { id: "1", type: "candidate", attributes: { firstName: "Jean", lastName: "Dupont" } },
          { id: "2", type: "candidate", attributes: { firstName: "Marie", lastName: "Martin" } },
        ],
      },
      "candidat"
    );
    expect(result).toContain("Jean Dupont");
    expect(result).toContain("Marie Martin");
  });

  it("should include total count when available", () => {
    const result = formatListResponse(
      {
        data: [{ id: "1", type: "candidate", attributes: { firstName: "Jean", lastName: "Dupont" } }],
        meta: { totals: { rows: 42 } },
      },
      "candidat"
    );
    expect(result).toContain("Total: 42");
  });

  it("should truncate when exceeding CHARACTER_LIMIT", () => {
    const longData = Array.from({ length: 5000 }, (_, i) => ({
      id: String(i),
      type: "candidate",
      attributes: { firstName: "Name".repeat(50), lastName: "Last".repeat(50) },
    }));
    const result = formatListResponse({ data: longData }, "candidat");
    expect(result.length).toBeLessThanOrEqual(CHARACTER_LIMIT + 50); // allow for truncation message
    expect(result).toContain("[Résultats tronqués...]");
  });

  it("should handle non-array data (single object)", () => {
    const result = formatListResponse(
      {
        data: { id: "1", type: "candidate", attributes: { firstName: "Jean", lastName: "Dupont" } },
      },
      "candidat"
    );
    expect(result).toContain("Jean Dupont");
  });
});

describe("formatDetailResponse", () => {
  it("should return JSON with id, type, attributes, relationships", () => {
    const result = formatDetailResponse({
      data: {
        id: "1",
        type: "candidate",
        attributes: { firstName: "Jean" },
        relationships: { company: { data: { id: "10", type: "company" } } },
      },
    });
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe("1");
    expect(parsed.type).toBe("candidate");
    expect(parsed.attributes.firstName).toBe("Jean");
    expect(parsed.relationships.company.data.id).toBe("10");
  });

  it("should return message when entity is not found", () => {
    const result = formatDetailResponse({ data: [] });
    expect(result).toBe("Entité non trouvée.");
  });

  it("should handle data as single object (not array)", () => {
    const result = formatDetailResponse({
      data: { id: "1", type: "resource", attributes: { firstName: "Marie" } },
    });
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe("1");
  });

  it("should truncate when exceeding CHARACTER_LIMIT", () => {
    const largeAttrs: Record<string, string> = {};
    for (let i = 0; i < 5000; i++) {
      largeAttrs[`field${i}`] = "x".repeat(50);
    }
    const result = formatDetailResponse({
      data: { id: "1", type: "test", attributes: largeAttrs },
    });
    expect(result).toContain("[Résultat tronqué...]");
  });
});

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

describe("assertSafeApiPath", () => {
  it("accepts well-formed paths with numeric ids and tab segments", () => {
    expect(() => assertSafeApiPath("/candidates/123")).not.toThrow();
    expect(() => assertSafeApiPath("/resources/42/technical-data")).not.toThrow();
    expect(() => assertSafeApiPath("/application/current-user")).not.toThrow();
  });

  it("rejects path traversal", () => {
    expect(() => assertSafeApiPath("/candidates/../invoices/5")).toThrow(/Unsafe API path/);
    expect(() => assertSafeApiPath("/candidates/../../admin/1")).toThrow(/Unsafe API path/);
  });

  it("rejects query/fragment injection in the path", () => {
    expect(() => assertSafeApiPath("/candidates/1?maxResults=99999")).toThrow(/Unsafe API path/);
    expect(() => assertSafeApiPath("/candidates/1#x")).toThrow(/Unsafe API path/);
  });

  it("rejects percent-encoding and backslashes (encoded traversal)", () => {
    expect(() => assertSafeApiPath("/candidates/%2e%2e/invoices/5")).toThrow(/Unsafe API path/);
    expect(() => assertSafeApiPath("/candidates/1\\..\\x")).toThrow(/Unsafe API path/);
  });

  it("rejects paths not starting with /", () => {
    expect(() => assertSafeApiPath("candidates/1")).toThrow(/must start with/);
  });
});

describe("apiRequest", () => {
  beforeEach(() => {
    process.env.BOOND_API_TOKEN = "test-token";
    // Disable retries for the legacy apiRequest tests so a single mock value
    // produces a single fetch call, keeping assertions deterministic.
    process.env.BOOND_HTTP_MAX_RETRIES = "0";
    // Disable rate limiting so the legacy fast-path tests don't accidentally
    // wait on a token bucket between iterations.
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "0";
    resetRateLimiterForTests();
    initClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BOOND_API_TOKEN;
    delete process.env.BOOND_HTTP_MAX_RETRIES;
    delete process.env.BOOND_HTTP_RATE_LIMIT_RPS;
    resetRateLimiterForTests();
  });

  it("should make a GET request and return JSON", async () => {
    const mockData = { data: { id: "1", type: "candidate", attributes: { firstName: "Jean" } } };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "100" }),
        json: () => Promise.resolve(mockData),
      })
    );

    const result = await apiRequest("/candidates/1");
    expect(result).toEqual(mockData);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("should send body for POST requests", async () => {
    const body = { data: { type: "candidate", attributes: { firstName: "Jean" } } };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ "content-length": "100" }),
        json: () => Promise.resolve({ data: { id: "1", type: "candidate", attributes: {} } }),
      })
    );

    await apiRequest("/candidates", "POST", body);
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const options = fetchCall[1] as RequestInit;
    expect(options.method).toBe("POST");
    expect(options.body).toBe(JSON.stringify(body));
  });

  it("should handle 204 No Content (DELETE)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Headers(),
      })
    );

    const result = await apiRequest("/candidates/1", "DELETE");
    expect(result).toEqual({ data: [] });
  });

  it("should throw on error response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve("Resource not found"),
      })
    );

    await expect(apiRequest("/candidates/999")).rejects.toThrow("BoondManager API 404");
  });

  it("should surface Boond errors[].detail when present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        text: () =>
          Promise.resolve(
            JSON.stringify({
              errors: [{ status: "422", code: "422", detail: "422 - password mismatch" }],
            })
          ),
      })
    );

    await expect(apiRequest("/resources")).rejects.toThrow("422 - password mismatch");
  });

  it("should include query params in URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "10" }),
        json: () => Promise.resolve({ data: [] }),
      })
    );

    await apiRequest("/candidates", "GET", undefined, { keywords: "react", page: 2 });
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain("keywords=react");
    expect(url).toContain("page=2");
  });

  it("should skip undefined query params", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "10" }),
        json: () => Promise.resolve({ data: [] }),
      })
    );

    await apiRequest("/candidates", "GET", undefined, { keywords: "react", empty: undefined });
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).not.toContain("empty");
  });

  it("should pass an AbortSignal with a timeout to fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "10" }),
        json: () => Promise.resolve({ data: [] }),
      })
    );

    await apiRequest("/candidates");
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const options = fetchCall[1] as RequestInit;
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("should surface a clear timeout error when the request is aborted", async () => {
    process.env.BOOND_HTTP_TIMEOUT_MS = "1234";
    const abortErr = new Error("The operation was aborted due to timeout");
    abortErr.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortErr));

    await expect(apiRequest("/candidates")).rejects.toThrow(/timed out after 1234ms/);
    await expect(apiRequest("/candidates")).rejects.toThrow(/BOOND_HTTP_TIMEOUT_MS/);

    delete process.env.BOOND_HTTP_TIMEOUT_MS;
  });

  it("should rethrow unrelated fetch errors as-is", async () => {
    const networkErr = new Error("ECONNREFUSED");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkErr));

    await expect(apiRequest("/candidates")).rejects.toThrow("ECONNREFUSED");
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

describe("resolveTimeoutMs", () => {
  afterEach(() => {
    delete process.env.BOOND_HTTP_TIMEOUT_MS;
  });

  it("returns the default when the env var is unset", () => {
    expect(resolveTimeoutMs()).toBe(DEFAULT_HTTP_TIMEOUT_MS);
  });

  it("honours a positive integer override", () => {
    process.env.BOOND_HTTP_TIMEOUT_MS = "5000";
    expect(resolveTimeoutMs()).toBe(5000);
  });

  it("falls back to the default on non-numeric values", () => {
    process.env.BOOND_HTTP_TIMEOUT_MS = "not-a-number";
    expect(resolveTimeoutMs()).toBe(DEFAULT_HTTP_TIMEOUT_MS);
  });

  it("falls back to the default on zero or negative values", () => {
    process.env.BOOND_HTTP_TIMEOUT_MS = "0";
    expect(resolveTimeoutMs()).toBe(DEFAULT_HTTP_TIMEOUT_MS);
    process.env.BOOND_HTTP_TIMEOUT_MS = "-100";
    expect(resolveTimeoutMs()).toBe(DEFAULT_HTTP_TIMEOUT_MS);
  });

  it("ignores unresolved template placeholders", () => {
    process.env.BOOND_HTTP_TIMEOUT_MS = "${user_config.timeout}";
    expect(resolveTimeoutMs()).toBe(DEFAULT_HTTP_TIMEOUT_MS);
  });
});

describe("parseBoondErrorBody", () => {
  it("returns the detail of a single error", () => {
    expect(
      parseBoondErrorBody(
        JSON.stringify({
          errors: [{ status: "422", detail: "422 - password mismatch" }],
        })
      )
    ).toBe("422 - password mismatch");
  });

  it("joins multiple errors with a separator", () => {
    expect(
      parseBoondErrorBody(
        JSON.stringify({
          errors: [{ detail: "first thing wrong" }, { detail: "second thing wrong" }],
        })
      )
    ).toBe("first thing wrong | second thing wrong");
  });

  it("includes title when distinct from detail", () => {
    expect(
      parseBoondErrorBody(
        JSON.stringify({
          errors: [{ title: "Forbidden", detail: "user cannot access this scope" }],
        })
      )
    ).toBe("Forbidden: user cannot access this scope");
  });

  it("falls back to code when detail is missing", () => {
    expect(
      parseBoondErrorBody(
        JSON.stringify({
          errors: [{ code: "503" }],
        })
      )
    ).toBe("code 503");
  });

  it("returns null on non-JSON body", () => {
    expect(parseBoondErrorBody("Internal Server Error")).toBeNull();
  });

  it("returns null when there are no errors[]", () => {
    expect(parseBoondErrorBody(JSON.stringify({ meta: {} }))).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(parseBoondErrorBody("")).toBeNull();
  });

  it("includes source.parameter so the LLM can see which field triggered the error", () => {
    // Without surfacing source.parameter, "1017 - Missing required attribute"
    // is opaque — it's the parameter name (startMonth, category, etc.) that
    // tells the caller what to add.
    expect(
      parseBoondErrorBody(
        JSON.stringify({
          errors: [{ detail: "1017 - Missing required attribute", source: { parameter: "startMonth" } }],
        })
      )
    ).toBe("1017 - Missing required attribute (parameter: startMonth)");
  });

  it("falls back to source.pointer when parameter is absent", () => {
    expect(
      parseBoondErrorBody(
        JSON.stringify({
          errors: [{ detail: "validation failed", source: { pointer: "/data/attributes/email" } }],
        })
      )
    ).toBe("validation failed (parameter: /data/attributes/email)");
  });
});

describe("formatApiError", () => {
  it("uses the parsed Boond detail in the headline and skips the raw body", () => {
    const body = JSON.stringify({ errors: [{ detail: "422 - password mismatch" }] });
    const msg = formatApiError(422, "Unprocessable Entity", "GET", "/resources", body);
    expect(msg).toContain("BoondManager API 422 Unprocessable Entity: 422 - password mismatch");
    expect(msg).toContain("Endpoint: GET /resources");
    expect(msg).toContain("Hint:");
    // raw body must not be repeated when we have a structured detail
    expect(msg).not.toContain(body);
  });

  it("falls back to a (truncated) raw body when JSON parsing fails", () => {
    const body = "x".repeat(800);
    const msg = formatApiError(500, "Server Error", "GET", "/resources", body);
    expect(msg).toContain("BoondManager API 500 Server Error");
    expect(msg).toContain("Body: " + "x".repeat(500) + "…");
    expect(msg).toContain("Hint:");
  });

  it("emits a 401-specific hint", () => {
    const msg = formatApiError(401, "Unauthorized", "GET", "/resources", "");
    expect(msg).toContain("Authentication failed");
  });

  it("emits a 5xx-specific hint", () => {
    const msg = formatApiError(503, "Service Unavailable", "GET", "/resources", "");
    expect(msg).toContain("BoondManager-side error");
  });

  it("recognises a Cloudflare WAF block and replaces the misleading status hint", () => {
    const cfBody =
      "<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title>" +
      "<meta http-equiv='cf-ray' content='abc'></head><body>Just a moment...</body></html>";
    const msg = formatApiError(403, "Forbidden", "GET", "/advantages", cfBody);
    expect(msg).toContain("blocked by Cloudflare WAF");
    // Generic 403 hint is replaced because it's misleading (the request
    // never reached BoondManager — it isn't a permission issue).
    expect(msg).not.toContain("the user lacks permission");
    // The HTML body itself isn't echoed.
    expect(msg).not.toContain("<html>");
  });
});

describe("resolveRetryConfig", () => {
  afterEach(() => {
    delete process.env.BOOND_HTTP_MAX_RETRIES;
    delete process.env.BOOND_HTTP_RETRY_BASE_MS;
    delete process.env.BOOND_HTTP_RETRY_MAX_MS;
  });

  it("returns defaults when nothing is set", () => {
    expect(resolveRetryConfig()).toEqual({
      maxRetries: DEFAULT_HTTP_MAX_RETRIES,
      baseDelayMs: DEFAULT_HTTP_RETRY_BASE_MS,
      maxDelayMs: DEFAULT_HTTP_RETRY_MAX_MS,
    });
  });

  it("honours numeric overrides", () => {
    process.env.BOOND_HTTP_MAX_RETRIES = "5";
    process.env.BOOND_HTTP_RETRY_BASE_MS = "50";
    process.env.BOOND_HTTP_RETRY_MAX_MS = "1000";
    expect(resolveRetryConfig()).toEqual({ maxRetries: 5, baseDelayMs: 50, maxDelayMs: 1000 });
  });

  it("allows BOOND_HTTP_MAX_RETRIES=0 to disable retries", () => {
    process.env.BOOND_HTTP_MAX_RETRIES = "0";
    expect(resolveRetryConfig().maxRetries).toBe(0);
  });

  it("rejects 0 / negative for delay knobs and falls back to defaults", () => {
    process.env.BOOND_HTTP_RETRY_BASE_MS = "0";
    process.env.BOOND_HTTP_RETRY_MAX_MS = "-1";
    const cfg = resolveRetryConfig();
    expect(cfg.baseDelayMs).toBe(DEFAULT_HTTP_RETRY_BASE_MS);
    expect(cfg.maxDelayMs).toBe(DEFAULT_HTTP_RETRY_MAX_MS);
  });

  it("ignores non-numeric values", () => {
    process.env.BOOND_HTTP_MAX_RETRIES = "lots";
    expect(resolveRetryConfig().maxRetries).toBe(DEFAULT_HTTP_MAX_RETRIES);
  });
});

describe("isRetryable", () => {
  it("retries 429 for any verb", () => {
    expect(isRetryable("GET", 429, false)).toBe(true);
    expect(isRetryable("POST", 429, false)).toBe(true);
    expect(isRetryable("DELETE", 429, false)).toBe(true);
  });

  it("retries 5xx only for GET", () => {
    expect(isRetryable("GET", 503, false)).toBe(true);
    expect(isRetryable("POST", 503, false)).toBe(false);
    expect(isRetryable("PATCH", 502, false)).toBe(false);
  });

  it("retries network/timeout errors only for GET", () => {
    expect(isRetryable("GET", undefined, true)).toBe(true);
    expect(isRetryable("POST", undefined, true)).toBe(false);
  });

  it("never retries 4xx other than 429", () => {
    expect(isRetryable("GET", 400, false)).toBe(false);
    expect(isRetryable("GET", 404, false)).toBe(false);
    expect(isRetryable("GET", 422, false)).toBe(false);
  });

  it("never retries 2xx/3xx", () => {
    expect(isRetryable("GET", 200, false)).toBe(false);
    expect(isRetryable("GET", 304, false)).toBe(false);
  });
});

describe("parseRetryAfter", () => {
  it("returns null on missing or empty values", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("   ")).toBeNull();
  });

  it("parses a numeric seconds value", () => {
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter("5")).toBe(5000);
    expect(parseRetryAfter("2.5")).toBe(2500);
  });

  it("parses an HTTP-date relative to now", () => {
    const now = Date.parse("2024-01-01T00:00:00Z");
    const future = new Date(now + 3000).toUTCString();
    expect(parseRetryAfter(future, now)).toBe(3000);
  });

  it("clamps past dates to 0", () => {
    const now = Date.parse("2024-01-01T00:00:00Z");
    const past = new Date(now - 5000).toUTCString();
    expect(parseRetryAfter(past, now)).toBe(0);
  });

  it("returns null for unparseable values", () => {
    expect(parseRetryAfter("not-a-date")).toBeNull();
  });

  it("returns null for negative seconds", () => {
    expect(parseRetryAfter("-1")).toBeNull();
  });
});

describe("computeBackoffMs", () => {
  it("returns a value within [0, baseMs * 2^attempt] when below cap", () => {
    expect(computeBackoffMs(0, 100, 10_000, () => 0)).toBe(0);
    expect(computeBackoffMs(0, 100, 10_000, () => 0.999)).toBe(99);
    expect(computeBackoffMs(2, 100, 10_000, () => 0.999)).toBe(399); // 100 * 4 = 400
  });

  it("clamps to maxMs", () => {
    expect(computeBackoffMs(20, 100, 500, () => 0.999)).toBe(499);
  });

  it("uses Math.random by default", () => {
    const v = computeBackoffMs(1, 100, 10_000);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(200);
  });
});

describe("apiRequest retries", () => {
  beforeEach(() => {
    process.env.BOOND_API_TOKEN = "test-token";
    process.env.BOOND_HTTP_RETRY_BASE_MS = "1";
    process.env.BOOND_HTTP_RETRY_MAX_MS = "1";
    // Rate limiting orthogonal to retry tests — keep it off so retry
    // counts and timing stay predictable.
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "0";
    resetRateLimiterForTests();
    initClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BOOND_API_TOKEN;
    delete process.env.BOOND_HTTP_RATE_LIMIT_RPS;
    resetRateLimiterForTests();
    delete process.env.BOOND_HTTP_MAX_RETRIES;
    delete process.env.BOOND_HTTP_RETRY_BASE_MS;
    delete process.env.BOOND_HTTP_RETRY_MAX_MS;
  });

  function okResponse(data: unknown = { data: [] }) {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": "10" }),
      json: () => Promise.resolve(data),
    };
  }

  function errResponse(status: number, statusText = "Error", retryAfter?: string) {
    const headers = new Headers();
    if (retryAfter !== undefined) headers.set("retry-after", retryAfter);
    return {
      ok: false,
      status,
      statusText,
      headers,
      text: () => Promise.resolve(""),
    };
  }

  it("retries GET on 503 and eventually succeeds", async () => {
    process.env.BOOND_HTTP_MAX_RETRIES = "2";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(503, "Service Unavailable"))
      .mockResolvedValueOnce(errResponse(503, "Service Unavailable"))
      .mockResolvedValueOnce(okResponse({ data: [{ id: "1", type: "candidate", attributes: {} }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiRequest("/candidates");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(Array.isArray(result.data) ? result.data[0].id : "").toBe("1");
  });

  it("does not retry GET on 4xx (other than 429)", async () => {
    process.env.BOOND_HTTP_MAX_RETRIES = "3";
    const fetchMock = vi.fn().mockResolvedValue(errResponse(404, "Not Found"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/candidates/999")).rejects.toThrow("BoondManager API 404");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries 429 even on POST and honours Retry-After (seconds)", async () => {
    process.env.BOOND_HTTP_MAX_RETRIES = "2";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(429, "Too Many Requests", "0"))
      .mockResolvedValueOnce(okResponse({ data: { id: "1", type: "candidate", attributes: {} } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiRequest("/candidates", "POST", { foo: "bar" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Array.isArray(result.data) ? "" : result.data.id).toBe("1");
  });

  it("does not retry 5xx on POST (write idempotency safety)", async () => {
    process.env.BOOND_HTTP_MAX_RETRIES = "3";
    const fetchMock = vi.fn().mockResolvedValue(errResponse(503, "Service Unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/candidates", "POST", { foo: "bar" })).rejects.toThrow("BoondManager API 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries network errors on GET and gives up after maxRetries", async () => {
    process.env.BOOND_HTTP_MAX_RETRIES = "2";
    const netErr = new Error("ECONNRESET");
    const fetchMock = vi.fn().mockRejectedValue(netErr);
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/candidates")).rejects.toThrow("ECONNRESET");
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("retries timeouts on GET", async () => {
    process.env.BOOND_HTTP_MAX_RETRIES = "1";
    const abortErr = new Error("aborted");
    abortErr.name = "TimeoutError";
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(abortErr)
      .mockResolvedValueOnce(okResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/candidates")).resolves.toEqual({ data: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry network errors on POST", async () => {
    process.env.BOOND_HTTP_MAX_RETRIES = "3";
    const netErr = new Error("ECONNRESET");
    const fetchMock = vi.fn().mockRejectedValue(netErr);
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/candidates", "POST", { foo: "bar" })).rejects.toThrow("ECONNRESET");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("BOOND_HTTP_MAX_RETRIES=0 disables retries on 503", async () => {
    process.env.BOOND_HTTP_MAX_RETRIES = "0";
    const fetchMock = vi.fn().mockResolvedValue(errResponse(503, "Service Unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/candidates")).rejects.toThrow("BoondManager API 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("resolveRateLimitConfig", () => {
  afterEach(() => {
    delete process.env.BOOND_HTTP_RATE_LIMIT_RPS;
    delete process.env.BOOND_HTTP_RATE_LIMIT_BURST;
  });

  it("returns the documented defaults when nothing is set", () => {
    expect(resolveRateLimitConfig()).toEqual({ rps: 10, burst: 20 });
  });

  it("disables rate limiting when RPS is 0", () => {
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "0";
    expect(resolveRateLimitConfig()).toBeNull();
  });

  it("disables rate limiting on a non-numeric RPS", () => {
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "many";
    expect(resolveRateLimitConfig()).toBeNull();
  });

  it("honours an explicit burst override", () => {
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "5";
    process.env.BOOND_HTTP_RATE_LIMIT_BURST = "30";
    expect(resolveRateLimitConfig()).toEqual({ rps: 5, burst: 30 });
  });

  it("derives a sane burst when RPS is overridden but burst is not", () => {
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "5";
    expect(resolveRateLimitConfig()).toEqual({ rps: 5, burst: 5 });
  });
});

describe("apiRequest rate limiting", () => {
  beforeEach(() => {
    process.env.BOOND_API_TOKEN = "test-token";
    process.env.BOOND_HTTP_MAX_RETRIES = "0";
    resetRateLimiterForTests();
    initClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BOOND_API_TOKEN;
    delete process.env.BOOND_HTTP_MAX_RETRIES;
    delete process.env.BOOND_HTTP_RATE_LIMIT_RPS;
    delete process.env.BOOND_HTTP_RATE_LIMIT_BURST;
    resetRateLimiterForTests();
  });

  it("does not throttle when RPS=0", async () => {
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "0";
    resetRateLimiterForTests();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": "10" }),
      json: () => Promise.resolve({ data: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const t0 = Date.now();
    await apiRequest("/candidates");
    await apiRequest("/candidates");
    await apiRequest("/candidates");
    const elapsed = Date.now() - t0;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    // No artificial throttle → should be near-instant.
    expect(elapsed).toBeLessThan(100);
  });

  it("throttles requests beyond the burst capacity", async () => {
    // 1 token, refill 1000/sec → 1ms wait per request after the first.
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "1000";
    process.env.BOOND_HTTP_RATE_LIMIT_BURST = "1";
    resetRateLimiterForTests();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": "10" }),
      json: () => Promise.resolve({ data: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    // Fire 5 requests in parallel; serialised acquires force them through one
    // by one. Sustained refill is fast (1ms), so total wall-time is small but
    // crucially > 0 — the bucket is acting.
    const before = vi.mocked(fetchMock).mock.calls.length;
    await Promise.all([
      apiRequest("/candidates"),
      apiRequest("/candidates"),
      apiRequest("/candidates"),
      apiRequest("/candidates"),
      apiRequest("/candidates"),
    ]);
    const after = vi.mocked(fetchMock).mock.calls.length;

    expect(after - before).toBe(5);
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
