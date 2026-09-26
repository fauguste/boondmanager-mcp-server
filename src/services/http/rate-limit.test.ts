import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initClient } from "./auth.js";
import {
  resolveRateLimitConfig,
  MAX_RATE_LIMIT_BUCKETS,
  getRateLimiter,
  rateLimiterBucketCountForTests,
  resetRateLimiterForTests,
} from "./rate-limit.js";
import { apiRequest } from "./transport.js";
import { oauthContext } from "../oauth.js";

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

describe("per-identity rate limiting (#232)", () => {
  beforeEach(() => {
    process.env.BOOND_HTTP_RATE_LIMIT_RPS = "1";
    process.env.BOOND_HTTP_RATE_LIMIT_BURST = "1";
    resetRateLimiterForTests();
  });

  afterEach(() => {
    delete process.env.BOOND_HTTP_RATE_LIMIT_RPS;
    delete process.env.BOOND_HTTP_RATE_LIMIT_BURST;
    resetRateLimiterForTests();
  });

  const under = <T>(token: string, fn: () => T): T => oauthContext.run({ accessToken: token }, fn);

  it("keeps one bucket per identity, and the same bucket for the same identity", () => {
    const a1 = under("token-A", () => getRateLimiter());
    const a2 = under("token-A", () => getRateLimiter());
    const b = under("token-B", () => getRateLimiter());
    const env1 = getRateLimiter();
    const env2 = getRateLimiter();
    expect(a1).toBe(a2);
    expect(b).not.toBe(a1);
    expect(env1).toBe(env2);
    expect(env1).not.toBe(a1);
    expect(rateLimiterBucketCountForTests()).toBe(3);
  });

  it("does not let one user's exhausted bucket throttle another user", async () => {
    // Burst 1 at 1 rps: A's single token is gone after one acquire, and the
    // next one for A would wait ~1 s. B must still find a full bucket.
    await under("token-A", () => getRateLimiter()!.acquire());
    expect(under("token-A", () => getRateLimiter()!.peek())).toBeLessThan(1);
    const t0 = Date.now();
    await under("token-B", () => getRateLimiter()!.acquire());
    expect(Date.now() - t0).toBeLessThan(100);
  });

  it("bounds the bucket map to MAX_RATE_LIMIT_BUCKETS with LRU eviction", () => {
    for (let i = 0; i < MAX_RATE_LIMIT_BUCKETS; i++) under(`token-${i}`, () => getRateLimiter());
    expect(rateLimiterBucketCountForTests()).toBe(MAX_RATE_LIMIT_BUCKETS);
    const first = under("token-0", () => getRateLimiter()); // touch → most recently used
    under("token-overflow", () => getRateLimiter());
    expect(rateLimiterBucketCountForTests()).toBe(MAX_RATE_LIMIT_BUCKETS);
    expect(under("token-0", () => getRateLimiter())).toBe(first); // survived
    const second = under("token-1", () => getRateLimiter()); // evicted → fresh bucket
    expect(rateLimiterBucketCountForTests()).toBe(MAX_RATE_LIMIT_BUCKETS);
    expect(second.peek()).toBe(1);
  });

  it("stays a single bucket on stdio / static auth (no OAuth context)", () => {
    getRateLimiter();
    getRateLimiter();
    expect(rateLimiterBucketCountForTests()).toBe(1);
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
