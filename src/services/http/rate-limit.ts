/**
 * Client-side rate limiting towards BoondManager: one token bucket per caller
 * identity (issue #232), LRU-bounded. The bucket itself is `TokenBucket` in
 * `services/rate-limiter.ts`; this module owns the configuration and the map.
 */
import { readString } from "../../config/env.js";
import { DEFAULT_HTTP_RATE_LIMIT_BURST, DEFAULT_HTTP_RATE_LIMIT_RPS } from "../../constants.js";
import { currentAuthIdentity } from "../oauth.js";
import { TokenBucket } from "../rate-limiter.js";

export interface RateLimitConfig {
  rps: number;
  burst: number;
}

/**
 * Read rate-limit env vars. `rps` of 0 (or non-numeric) disables rate
 * limiting entirely. `burst` falls back to `rps * 2` when unset, mirroring
 * the documented default behaviour. Exported for unit testing.
 */
export function resolveRateLimitConfig(): RateLimitConfig | null {
  const rpsRaw = readString("BOOND_HTTP_RATE_LIMIT_RPS");
  const rps = rpsRaw === undefined ? DEFAULT_HTTP_RATE_LIMIT_RPS : Number(rpsRaw);
  if (!Number.isFinite(rps) || rps <= 0) return null;
  const burstRaw = readString("BOOND_HTTP_RATE_LIMIT_BURST");
  let burst: number;
  if (burstRaw === undefined) {
    burst = rpsRaw === undefined ? DEFAULT_HTTP_RATE_LIMIT_BURST : Math.max(1, Math.ceil(rps));
  } else {
    const parsed = Number(burstRaw);
    burst = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : Math.max(1, Math.ceil(rps));
  }
  return { rps, burst };
}

/**
 * Upper bound on live per-identity buckets. A bucket is a few numbers, so
 * 500 idle users cost nothing measurable; the cap exists so an attacker
 * cycling tokens cannot grow the map without bound. Eviction is LRU: an
 * evicted identity simply starts again with a full bucket.
 */
export const MAX_RATE_LIMIT_BUCKETS = 500;

let rateLimitConfig: RateLimitConfig | null = null;
let rateLimitConfigResolved = false;
/** Insertion-ordered map used as an LRU: a hit re-inserts, an insert past the cap evicts the oldest. */
const rateLimiters = new Map<string, TokenBucket>();

/**
 * The token bucket for the *current* caller (issue #232).
 *
 * One bucket per process was right for stdio (one user) and wrong for the
 * HTTP OAuth transport, where every request may belong to a different user:
 * a single client's burst throttled everyone else, and one buggy client
 * could hold the whole deployment at the rate limit. Buckets are keyed by
 * `currentAuthIdentity()` — `sha256(token)` in OAuth, the constant `env`
 * identity on stdio / static auth, so those keep exactly one bucket.
 *
 * Note this is fairness *between* users of the same server, not a change to
 * the ceiling BoondManager sees: `BOOND_HTTP_RATE_LIMIT_RPS` is per identity.
 */
export function getRateLimiter(): TokenBucket | null {
  if (!rateLimitConfigResolved) {
    rateLimitConfig = resolveRateLimitConfig();
    rateLimitConfigResolved = true;
  }
  if (!rateLimitConfig) return null;
  const key = currentAuthIdentity();
  const existing = rateLimiters.get(key);
  if (existing) {
    rateLimiters.delete(key);
    rateLimiters.set(key, existing);
    return existing;
  }
  const bucket = new TokenBucket(rateLimitConfig.burst, rateLimitConfig.rps);
  rateLimiters.set(key, bucket);
  while (rateLimiters.size > MAX_RATE_LIMIT_BUCKETS) {
    const oldest = rateLimiters.keys().next().value;
    if (oldest === undefined) break;
    rateLimiters.delete(oldest);
  }
  return bucket;
}

/** Number of live per-identity buckets. Exposed for tests. */
export function rateLimiterBucketCountForTests(): number {
  return rateLimiters.size;
}

/**
 * Reset the rate limiters so the next request re-reads env vars.
 * Intended for tests that toggle `BOOND_HTTP_RATE_LIMIT_*` between cases.
 */
export function resetRateLimiterForTests(): void {
  rateLimiters.clear();
  rateLimitConfig = null;
  rateLimitConfigResolved = false;
}
