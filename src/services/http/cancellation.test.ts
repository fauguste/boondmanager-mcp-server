import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initClient, resetClientForTests } from "./auth.js";
import { resetRateLimiterForTests } from "./rate-limit.js";
import { apiRequest, send } from "./transport.js";
import { apiDownload } from "./download.js";
import { apiSearch } from "../search.js";
import { RequestCancelledError, runWithRequestSignal } from "../request-context.js";

/**
 * `notifications/cancelled` end-to-end inside the client (#231): the signal
 * the SDK hands a handler must stop the work — before the next attempt, in the
 * rate-limit queue, during the fetch, during a backoff and between two chunks
 * of a search — and never be mistaken for a timeout or retried.
 */
describe("request cancellation reaches fetch (#231)", () => {
  beforeEach(() => {
    process.env.BOOND_API_TOKEN = "test-token";
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "0";
    process.env.BOOND_HTTP_MAX_RETRIES = "2";
    process.env.BOOND_HTTP_RETRY_BASE_MS = "1";
    process.env.BOOND_HTTP_RETRY_MAX_MS = "1";
    resetRateLimiterForTests();
    resetClientForTests();
    initClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const k of [
      "BOOND_API_TOKEN",
      "BOOND_HTTP_RATE_LIMIT_RPS",
      "BOOND_HTTP_RATE_LIMIT_BURST",
      "BOOND_HTTP_MAX_RETRIES",
      "BOOND_HTTP_RETRY_BASE_MS",
      "BOOND_HTTP_RETRY_MAX_MS",
    ]) {
      delete process.env[k];
    }
    resetRateLimiterForTests();
    resetClientForTests();
  });

  /** A fetch that never answers on its own and rejects when its signal fires. */
  function hangingFetch() {
    return vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
        })
    );
  }

  function okJson(data: unknown = { data: [] }) {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": "10" }),
      json: () => Promise.resolve(data),
    };
  }

  it("an already-cancelled request is refused before any fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    const err = await runWithRequestSignal(controller.signal, () => apiRequest("/candidates")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RequestCancelledError);
    expect((err as Error).message).toContain("Endpoint: GET /candidates");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancelling mid-flight aborts the socket, is reported as a cancellation and is not retried", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const pending = runWithRequestSignal(controller.signal, () => apiRequest("/candidates"));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const fetchSignal = (fetchMock.mock.calls[0][1] as RequestInit).signal!;
    expect(fetchSignal.aborted).toBe(false);
    controller.abort();
    const err = await pending.catch((e: unknown) => e);
    expect(fetchSignal.aborted).toBe(true);
    expect(err).toBeInstanceOf(RequestCancelledError);
    expect((err as Error).name).toBe("AbortError");
    expect((err as Error).message).not.toMatch(/timed out/);
    // GET + network-class failure would be retried twice without the signal.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a timeout is still a timeout when the request was not cancelled", async () => {
    process.env.BOOND_HTTP_MAX_RETRIES = "0";
    const abortErr = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortErr));
    const controller = new AbortController();
    await expect(runWithRequestSignal(controller.signal, () => apiRequest("/candidates"))).rejects.toThrow(/timed out/);
  });

  it("cancelling during a retry backoff returns at once instead of sitting out the delay", async () => {
    process.env.BOOND_HTTP_RETRY_BASE_MS = "60000";
    process.env.BOOND_HTTP_RETRY_MAX_MS = "60000";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Unavailable",
      headers: new Headers({ "retry-after": "60" }),
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const started = Date.now();
    const pending = runWithRequestSignal(controller.signal, () => apiRequest("/candidates"));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RequestCancelledError);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancelling while queued on the rate limiter releases the caller and keeps the bucket usable", async () => {
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "0.001"; // one token, then a ~1000 s refill
    process.env.BOOND_HTTP_RATE_LIMIT_BURST = "1";
    resetRateLimiterForTests();
    const fetchMock = vi.fn().mockResolvedValue(okJson());
    vi.stubGlobal("fetch", fetchMock);
    await apiRequest("/candidates"); // spends the only token
    const controller = new AbortController();
    const queued = runWithRequestSignal(controller.signal, () => apiRequest("/candidates"));
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    const err = await queued.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RequestCancelledError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a chunked search stops between two chunks", async () => {
    const controller = new AbortController();
    const row = (i: number) => ({ id: String(i), type: "action", attributes: {} });
    const fetchMock = vi.fn().mockImplementation(() => {
      // Cancel right after the first page has been served.
      controller.abort();
      return Promise.resolve(
        okJson({ data: Array.from({ length: 100 }, (_, i) => row(i)), meta: { totals: { rows: 500 } } })
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const err = await runWithRequestSignal(controller.signal, () =>
      apiSearch("/actions", { maxResults: 500, page: 1 })
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RequestCancelledError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a document download is cancelled through the same path", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const pending = runWithRequestSignal(controller.signal, () => apiDownload("/documents/1_resume"));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(RequestCancelledError);
  });

  it("an explicit `signal` option overrides the request context", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const own = new AbortController();
    own.abort();
    const err = await runWithRequestSignal(new AbortController().signal, () =>
      send("/candidates", { signal: own.signal })
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RequestCancelledError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("without a request context nothing changes: only the timeout signal is passed to fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson());
    vi.stubGlobal("fetch", fetchMock);
    await apiRequest("/candidates");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal!.aborted).toBe(false);
  });
});
