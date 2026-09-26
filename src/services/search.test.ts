import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initClient } from "./http/auth.js";
import { resetRateLimiterForTests } from "./http/rate-limit.js";
import { buildSearchQuery, apiSearch } from "./search.js";
import { progressReporterFrom } from "./progress.js";

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

  it("should never forward `fields` (client-side projection) to the API", () => {
    const result = buildSearchQuery({ keywords: "test", fields: ["title", "city"] });
    expect(result).not.toHaveProperty("fields");
    expect(result.keywords).toBe("test");
  });
});

describe("apiSearch (per-route maxResults chunking)", () => {
  // Mock fetch as a paginated backend: page N with maxResults M returns rows
  // [(N-1)*M, N*M) as resources whose id === their absolute 0-based row index,
  // capped at `totalRows`. This lets us assert both the chunk boundaries sent
  // to the API and the absolute window returned to the caller.
  function pagedFetch(totalRows: number) {
    return vi.fn().mockImplementation((url: string) => {
      const u = new URL(url);
      const max = Number(u.searchParams.get("maxResults") ?? "30");
      const page = Number(u.searchParams.get("page") ?? "1");
      const start = (page - 1) * max;
      const items = [];
      for (let i = start; i < Math.min(start + max, totalRows); i++) {
        items.push({ id: String(i), type: "action", attributes: {} });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "100" }),
        json: () => Promise.resolve({ data: items, meta: { totals: { rows: totalRows } } }),
      });
    });
  }

  const maxResultsOf = (call: unknown[]) => Number(new URL(call[0] as string).searchParams.get("maxResults"));
  const pageOf = (call: unknown[]) => Number(new URL(call[0] as string).searchParams.get("page"));

  beforeEach(() => {
    process.env.BOOND_API_TOKEN = "test-token";
    process.env.BOOND_HTTP_MAX_RETRIES = "0";
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

  it("takes the fast path (single call) for non-capped routes even at pageSize 500", async () => {
    vi.stubGlobal("fetch", pagedFetch(2000));

    const res = await apiSearch("/candidates", { maxResults: 500, page: 1 });

    expect(fetch).toHaveBeenCalledOnce();
    expect(maxResultsOf(vi.mocked(fetch).mock.calls[0])).toBe(500);
    expect(Array.isArray(res.data) ? res.data.length : 0).toBe(500);
  });

  it("takes the fast path when the /actions request is within the cap", async () => {
    vi.stubGlobal("fetch", pagedFetch(2000));

    await apiSearch("/actions", { maxResults: 100, page: 1 });

    expect(fetch).toHaveBeenCalledOnce();
    expect(maxResultsOf(vi.mocked(fetch).mock.calls[0])).toBe(100);
  });

  it("chunks a large /actions request into calls that never exceed maxResults 100", async () => {
    vi.stubGlobal("fetch", pagedFetch(2000));

    const res = await apiSearch("/actions", { maxResults: 500, page: 1 });

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(5);
    for (const call of calls) expect(maxResultsOf(call)).toBeLessThanOrEqual(100);
    expect(calls.map(pageOf)).toEqual([1, 2, 3, 4, 5]);

    const data = res.data as { id: string }[];
    expect(data).toHaveLength(500);
    expect(data[0].id).toBe("0");
    expect(data[499].id).toBe("499");
    // Grand total from the server survives the merge.
    expect(res.meta?.totals?.rows).toBe(2000);
  });

  it("stops early when the server returns a short page", async () => {
    vi.stubGlobal("fetch", pagedFetch(250));

    const res = await apiSearch("/actions", { maxResults: 500, page: 1 });

    // 100 + 100 + 50 → third page is short, so we stop after 3 calls.
    expect(vi.mocked(fetch).mock.calls).toHaveLength(3);
    expect((res.data as unknown[]).length).toBe(250);
  });

  it("honours page > 1 with the correct absolute offset", async () => {
    vi.stubGlobal("fetch", pagedFetch(2000));

    const res = await apiSearch("/actions", { maxResults: 500, page: 2 });

    // Rows 500..999 → Boond pages 6..10 at 100/page.
    expect(vi.mocked(fetch).mock.calls.map(pageOf)).toEqual([6, 7, 8, 9, 10]);
    const data = res.data as { id: string }[];
    expect(data).toHaveLength(500);
    expect(data[0].id).toBe("500");
    expect(data[499].id).toBe("999");
  });

  it("slices a non-zero offset inside the first chunk", async () => {
    vi.stubGlobal("fetch", pagedFetch(2000));

    // page 2 × 150 → startRow 150 → first Boond page 2, offset 50 within it.
    const res = await apiSearch("/actions", { maxResults: 150, page: 2 });

    expect(vi.mocked(fetch).mock.calls.map(pageOf)).toEqual([2, 3]);
    const data = res.data as { id: string }[];
    expect(data).toHaveLength(150);
    expect(data[0].id).toBe("150");
    expect(data[149].id).toBe("299");
  });
});

describe("apiSearch progress notifications", () => {
  // Same paginated backend as the chunking suite above.
  function pagedFetch(totalRows: number) {
    return vi.fn().mockImplementation((url: string) => {
      const u = new URL(url);
      const max = Number(u.searchParams.get("maxResults") ?? "30");
      const page = Number(u.searchParams.get("page") ?? "1");
      const items = [];
      for (let i = (page - 1) * max; i < Math.min(page * max, totalRows); i++) {
        items.push({ id: String(i), type: "action", attributes: {} });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "100" }),
        json: () => Promise.resolve({ data: items, meta: { totals: { rows: totalRows } } }),
      });
    });
  }

  /** A real reporter wired to a spy, so the notification shape is asserted too. */
  function reporterSpy() {
    const send = vi.fn().mockResolvedValue(undefined);
    return {
      send,
      reporter: progressReporterFrom({ _meta: { progressToken: "tok" }, sendNotification: send }),
      params: () => send.mock.calls.map((c) => c[0].params as { progress: number; total?: number; message: string }),
    };
  }

  beforeEach(() => {
    process.env.BOOND_API_TOKEN = "test-token";
    process.env.BOOND_HTTP_MAX_RETRIES = "0";
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

  it("emits one step per chunk, strictly increasing, with a constant total", async () => {
    vi.stubGlobal("fetch", pagedFetch(2000));
    const spy = reporterSpy();

    const res = await apiSearch("/actions", { maxResults: 500, page: 1 }, spy.reporter);

    const params = spy.params();
    expect(params).toHaveLength(5);
    expect(params.map((p) => p.progress)).toEqual([1, 2, 3, 4, 5]);
    expect(params.every((p) => p.total === 5)).toBe(true);
    expect(params[1].message).toContain("page 2/5");
    expect(params[1].message).toContain("/actions");
    // The progress channel changes nothing about the payload.
    expect((res.data as unknown[]).length).toBe(500);
  });

  it("stays silent on the fast path — a single API call has nothing to report", async () => {
    vi.stubGlobal("fetch", pagedFetch(2000));
    const spy = reporterSpy();

    await apiSearch("/candidates", { maxResults: 500, page: 1 }, spy.reporter);
    await apiSearch("/actions", { maxResults: 100, page: 1 }, spy.reporter);

    expect(spy.send).not.toHaveBeenCalled();
  });

  it("closes the bar at `total` when the result set runs out early", async () => {
    vi.stubGlobal("fetch", pagedFetch(250));
    const spy = reporterSpy();

    await apiSearch("/actions", { maxResults: 500, page: 1 }, spy.reporter);

    // 3 fetched chunks (100+100+50) + the completion step: 5/5, still increasing.
    const progress = spy.params().map((p) => p.progress);
    expect(progress).toEqual([1, 2, 3, 5]);
    expect(spy.params().at(-1)?.message).toContain("terminé");
  });

  it("emits nothing at all when the client sent no progressToken", async () => {
    vi.stubGlobal("fetch", pagedFetch(2000));
    const send = vi.fn();
    const reporter = progressReporterFrom({ _meta: {}, sendNotification: send });

    const withReporter = await apiSearch("/actions", { maxResults: 500, page: 1 }, reporter);
    const without = await apiSearch("/actions", { maxResults: 500, page: 1 });

    expect(send).not.toHaveBeenCalled();
    expect(withReporter).toEqual(without);
  });

  it("never fails the call when the notification channel is broken", async () => {
    vi.stubGlobal("fetch", pagedFetch(2000));
    const reporter = progressReporterFrom({
      _meta: { progressToken: "tok" },
      sendNotification: vi.fn().mockRejectedValue(new Error("client gone")),
    });

    const res = await apiSearch("/actions", { maxResults: 500, page: 1 }, reporter);

    expect((res.data as unknown[]).length).toBe(500);
  });
});
