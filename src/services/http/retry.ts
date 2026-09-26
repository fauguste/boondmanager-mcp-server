/**
 * Retry policy for the BoondManager client: configuration, the retryability
 * decision, `Retry-After` parsing and full-jitter backoff. Pure functions,
 * exported for unit testing; `send()` in `transport.ts` is the only consumer.
 */
import { readPositiveInt } from "../../config/env.js";
import { DEFAULT_HTTP_MAX_RETRIES, DEFAULT_HTTP_RETRY_BASE_MS, DEFAULT_HTTP_RETRY_MAX_MS } from "../../constants.js";

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/** Resolve retry configuration from env, with safe fallbacks. Exported for tests. */
export function resolveRetryConfig(): RetryConfig {
  return {
    maxRetries: readPositiveInt("BOOND_HTTP_MAX_RETRIES", DEFAULT_HTTP_MAX_RETRIES, process.env, { allowZero: true }),
    baseDelayMs: readPositiveInt("BOOND_HTTP_RETRY_BASE_MS", DEFAULT_HTTP_RETRY_BASE_MS),
    maxDelayMs: readPositiveInt("BOOND_HTTP_RETRY_MAX_MS", DEFAULT_HTTP_RETRY_MAX_MS),
  };
}

/**
 * Decide whether a failed attempt is worth retrying.
 *
 * Retry policy is intentionally conservative for non-idempotent verbs to avoid
 * silently duplicating writes when the server's response was lost or delayed:
 *   - 429 (Too Many Requests) is always retried — the server explicitly
 *     rejected the request before processing it, so it is safe regardless of
 *     verb.
 *   - For GET only, 5xx responses, network failures, and timeouts are retried
 *     because GET is idempotent.
 *   - 4xx responses (other than 429) are never retried — the client must change
 *     the request before another attempt makes sense.
 *
 * Exported for unit testing.
 */
export function isRetryable(method: string, status: number | undefined, isNetworkOrTimeout: boolean): boolean {
  if (status === 429) return true;
  if (method !== "GET") return false;
  if (isNetworkOrTimeout) return true;
  if (status !== undefined && status >= 500 && status < 600) return true;
  return false;
}

/**
 * Parse a `Retry-After` header value into milliseconds.
 *
 * Accepts either a non-negative number of seconds or an HTTP-date. Returns
 * null when the value is absent or unparseable. Negative computed delays are
 * clamped to 0. Exported for unit testing.
 */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    // Numeric form is authoritative once we recognise it as a number — falling
    // through to Date.parse on a negative/odd numeric would silently produce
    // weird timestamps (e.g. Date.parse("-1") → year -1).
    return seconds >= 0 ? Math.floor(seconds * 1000) : null;
  }
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return null;
}

/**
 * Compute the next backoff delay using full jitter:
 *   delay = random(0, min(maxMs, baseMs * 2^attempt))
 *
 * Full jitter (vs. exponential-only) reduces thundering-herd risk when many
 * clients retry in lockstep. Exported for unit testing.
 */
export function computeBackoffMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random
): number {
  const exp = baseMs * 2 ** attempt;
  const capped = Math.min(maxMs, exp);
  return Math.floor(random() * capped);
}

/**
 * Backoff sleep. With a `signal`, the wait ends the moment it fires — a
 * cancelled caller does not sit out a 5 s `Retry-After` (issue #231); the
 * rejection carries the signal's reason.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(signal!.reason ?? new Error("aborted"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
