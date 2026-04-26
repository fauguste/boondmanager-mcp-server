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
} from "./boond-client.js";
import { CHARACTER_LIMIT, DEFAULT_HTTP_TIMEOUT_MS } from "../constants.js";

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
});

describe("apiRequest", () => {
  beforeEach(() => {
    process.env.BOOND_API_TOKEN = "test-token";
    initClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BOOND_API_TOKEN;
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
        text: () => Promise.resolve(JSON.stringify({
          errors: [{ status: "422", code: "422", detail: "422 - password mismatch" }],
        })),
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
    expect(parseBoondErrorBody(JSON.stringify({
      errors: [{ status: "422", detail: "422 - password mismatch" }],
    }))).toBe("422 - password mismatch");
  });

  it("joins multiple errors with a separator", () => {
    expect(parseBoondErrorBody(JSON.stringify({
      errors: [
        { detail: "first thing wrong" },
        { detail: "second thing wrong" },
      ],
    }))).toBe("first thing wrong | second thing wrong");
  });

  it("includes title when distinct from detail", () => {
    expect(parseBoondErrorBody(JSON.stringify({
      errors: [{ title: "Forbidden", detail: "user cannot access this scope" }],
    }))).toBe("Forbidden: user cannot access this scope");
  });

  it("falls back to code when detail is missing", () => {
    expect(parseBoondErrorBody(JSON.stringify({
      errors: [{ code: "503" }],
    }))).toBe("code 503");
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
});
