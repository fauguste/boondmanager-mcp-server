import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initClient } from "./auth.js";
import { resolveRetryConfig, isRetryable, parseRetryAfter, computeBackoffMs } from "./retry.js";
import { resetRateLimiterForTests } from "./rate-limit.js";
import { apiRequest } from "./transport.js";
import { DEFAULT_HTTP_MAX_RETRIES, DEFAULT_HTTP_RETRY_BASE_MS, DEFAULT_HTTP_RETRY_MAX_MS } from "../../constants.js";

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
