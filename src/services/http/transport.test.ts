import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initClient, resetClientForTests } from "./auth.js";
import { resetRateLimiterForTests } from "./rate-limit.js";
import { resolveTimeoutMs, assertSafeApiPath, apiRequest, apiUploadForm } from "./transport.js";
import { DEFAULT_HTTP_TIMEOUT_MS } from "../../constants.js";

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

describe("apiUploadForm", () => {
  beforeEach(() => {
    process.env.BOOND_API_TOKEN = "test-token";
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "0";
    resetRateLimiterForTests();
    resetClientForTests();
    initClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BOOND_API_TOKEN;
    delete process.env.BOOND_HTTP_RATE_LIMIT_RPS;
    resetRateLimiterForTests();
    resetClientForTests();
  });

  it("POSTs a FormData body with the given fields and returns JSON", async () => {
    const mockResponse = { data: { id: "777", type: "document", attributes: {} } };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": "50" }),
      json: () => Promise.resolve(mockResponse),
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await apiUploadForm("/documents", {
      parentType: "candidateResume",
      parentId: "42",
      fileUrl: "https://example.com/cv.pdf",
    });
    expect(result).toEqual(mockResponse);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/documents");
    expect(options.method).toBe("POST");
    const form = options.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("parentType")).toBe("candidateResume");
    expect(form.get("parentId")).toBe("42");
    // No manual Content-Type: fetch must derive the multipart boundary itself
    expect((options.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("throws a formatted error on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        statusText: "Unprocessable",
        headers: new Headers(),
        text: () => Promise.resolve('{"errors":[{"detail":"invalid parentType"}]}'),
      })
    );
    await expect(apiUploadForm("/documents", { parentType: "nope" })).rejects.toThrow(/invalid parentType/);
  });
});

describe("one send path for JSON, binary and multipart (#239)", () => {
  beforeEach(() => {
    process.env.BOOND_API_TOKEN = "test-token";
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "0";
    process.env.BOOND_HTTP_RETRY_BASE_MS = "1";
    process.env.BOOND_HTTP_RETRY_MAX_MS = "1";
    resetRateLimiterForTests();
    resetClientForTests();
    initClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BOOND_API_TOKEN;
    delete process.env.BOOND_HTTP_RATE_LIMIT_RPS;
    delete process.env.BOOND_HTTP_MAX_RETRIES;
    delete process.env.BOOND_HTTP_RETRY_BASE_MS;
    delete process.env.BOOND_HTTP_RETRY_MAX_MS;
    delete process.env.BOOND_HTTP_TIMEOUT_MS;
    resetRateLimiterForTests();
    resetClientForTests();
  });

  it("apiUploadForm reports a timeout with the endpoint, like apiRequest", async () => {
    // Before the split the upload helper let the bare DOMException through:
    // `TimeoutError: The operation was aborted due to timeout`, no endpoint,
    // no hint about BOOND_HTTP_TIMEOUT_MS.
    process.env.BOOND_HTTP_MAX_RETRIES = "0";
    process.env.BOOND_HTTP_TIMEOUT_MS = "1234";
    const abortErr = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortErr));
    await expect(apiUploadForm("/documents", { fileUrl: "https://x/y.pdf" })).rejects.toThrow(
      /timed out after 1234ms[\s\S]*Endpoint: POST \/documents[\s\S]*BOOND_HTTP_TIMEOUT_MS/
    );
  });

  it("apiUploadForm honours a 429 with Retry-After and resends the same FormData", async () => {
    process.env.BOOND_HTTP_MAX_RETRIES = "1";
    const ok = { data: { id: "9", type: "document", attributes: {} } };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: new Headers({ "retry-after": "0" }),
        text: () => Promise.resolve(""),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "40" }),
        json: () => Promise.resolve(ok),
      });
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiUploadForm("/documents", { parentId: "42" })).resolves.toEqual(ok);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map((c) => (c[1] as RequestInit).body as FormData);
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies[1].get("parentId")).toBe("42");
  });

  it("apiUploadForm does not retry a 5xx (POST is not idempotent)", async () => {
    process.env.BOOND_HTTP_MAX_RETRIES = "2";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      headers: new Headers(),
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiUploadForm("/documents", { parentId: "42" })).rejects.toThrow(/502/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a 2xx whose body is not JSON names the endpoint instead of leaking a SyntaxError", async () => {
    process.env.BOOND_HTTP_MAX_RETRIES = "0";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "120" }),
        json: () => Promise.reject(new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON")),
      })
    );
    const err = await apiRequest("/candidates").catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/not JSON[\s\S]*Endpoint: GET \/candidates/);
    expect((err as Error).cause).toBeInstanceOf(SyntaxError);
  });
});
