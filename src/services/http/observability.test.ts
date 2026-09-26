import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initClient, resetClientForTests } from "./auth.js";
import { resetRateLimiterForTests } from "./rate-limit.js";
import { apiRequest } from "./transport.js";
import { runWithRequestContext } from "../request-context.js";
import { logger } from "../logger.js";

/**
 * What `send()` tells the log and BoondManager about each request (#236):
 * correlation headers derived from the request context, one `debug` line per
 * completed attempt, `warn` on a retry, a 429 or a timeout — and never the
 * query string, which carries end-user search terms.
 */
describe("client observability (#236)", () => {
  let debug: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.BOOND_API_TOKEN = "test-token";
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "0";
    process.env.BOOND_HTTP_MAX_RETRIES = "0";
    process.env.BOOND_HTTP_RETRY_BASE_MS = "1";
    process.env.BOOND_HTTP_RETRY_MAX_MS = "1";
    resetRateLimiterForTests();
    resetClientForTests();
    initClient();
    debug = vi.spyOn(logger, "debug").mockImplementation(() => undefined);
    warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const k of [
      "BOOND_API_TOKEN",
      "BOOND_HTTP_RATE_LIMIT_RPS",
      "BOOND_HTTP_MAX_RETRIES",
      "BOOND_HTTP_RETRY_BASE_MS",
      "BOOND_HTTP_RETRY_MAX_MS",
      "BOOND_HTTP_TIMEOUT_MS",
    ]) {
      delete process.env[k];
    }
    resetRateLimiterForTests();
    resetClientForTests();
  });

  const ok = () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-length": "10" }),
    json: () => Promise.resolve({ data: [] }),
  });
  const err = (status: number, retryAfter?: string) => {
    const headers = new Headers();
    if (retryAfter !== undefined) headers.set("retry-after", retryAfter);
    return { ok: false, status, statusText: "Error", headers, text: () => Promise.resolve("") };
  };
  const headersOf = (fetchMock: ReturnType<typeof vi.fn>, call = 0) =>
    (fetchMock.mock.calls[call][1] as RequestInit).headers as Record<string, string>;

  it("forwards the request's corrId as X-Request-Id and the client's traceparent verbatim", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchMock);
    const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    await runWithRequestContext({ corrId: "4bf92f3577b34da6a3ce929d0e0e4736", traceparent }, () =>
      apiRequest("/candidates")
    );
    expect(headersOf(fetchMock)["X-Request-Id"]).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(headersOf(fetchMock)["traceparent"]).toBe(traceparent);
  });

  it("sends no correlation headers outside a request context (byte-for-byte legacy request)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchMock);
    await apiRequest("/candidates");
    expect(headersOf(fetchMock)).not.toHaveProperty("X-Request-Id");
    expect(headersOf(fetchMock)).not.toHaveProperty("traceparent");
  });

  it("never sends or logs a baggage header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchMock);
    await runWithRequestContext({ corrId: "abcd1234" }, () => apiRequest("/candidates"));
    expect(Object.keys(headersOf(fetchMock)).map((k) => k.toLowerCase())).not.toContain("baggage");
    expect(JSON.stringify([debug.mock.calls, warn.mock.calls])).not.toContain("baggage");
  });

  it("logs each completed request at debug with corrId, method, path, status and duration — no query string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchMock);
    await runWithRequestContext({ corrId: "abcd1234" }, () =>
      apiRequest("/candidates", "GET", undefined, { keywords: "Jean Dupont", maxResults: 30 })
    );
    expect(debug).toHaveBeenCalledTimes(1);
    const [fields, message] = debug.mock.calls[0] as [Record<string, unknown>, string];
    expect(message).toBe("boondmanager request");
    expect(fields).toMatchObject({ corrId: "abcd1234", method: "GET", path: "/candidates", status: 200, attempt: 1 });
    expect(typeof fields.durationMs).toBe("number");
    expect(JSON.stringify(fields)).not.toContain("Dupont");
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns on a retried attempt with the attempt number, the cause and the backoff", async () => {
    process.env.BOOND_HTTP_MAX_RETRIES = "2";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(err(503))
      .mockResolvedValueOnce(err(429, "0"))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    await runWithRequestContext({ corrId: "abcd1234" }, () => apiRequest("/candidates"));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toMatchObject({
      corrId: "abcd1234",
      path: "/candidates",
      attempt: 1,
      status: 503,
      totalAttempts: 3,
    });
    expect(warn.mock.calls[0][1]).toBe("boondmanager request retried");
    expect(warn.mock.calls[1][0]).toMatchObject({ attempt: 2, status: 429, backoffMs: 0 });
    expect(debug).toHaveBeenCalledWith(expect.objectContaining({ attempt: 3, status: 200 }), "boondmanager request");
  });

  it("warns on a final 429 and on a timeout, but keeps an ordinary 4xx at debug", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(err(429)));
    await expect(apiRequest("/candidates", "POST", { a: 1 })).rejects.toThrow(/429/);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 429, attempt: 1 }),
      "boondmanager request failed"
    );

    warn.mockClear();
    process.env.BOOND_HTTP_TIMEOUT_MS = "5";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")));
    await expect(apiRequest("/candidates", "POST", { a: 1 })).rejects.toThrow(/timed out/);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ reason: "timeout" }), "boondmanager request failed");

    warn.mockClear();
    debug.mockClear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(err(404)));
    await expect(apiRequest("/candidates/9")).rejects.toThrow(/404/);
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }), "boondmanager request failed");
  });
});
