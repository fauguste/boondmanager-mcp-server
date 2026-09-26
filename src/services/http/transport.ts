/**
 * The single HTTP send path towards BoondManager (issue #239).
 *
 * Before the split, `apiRequest`, `apiDownload` and `apiUploadForm` each
 * carried their own copy of "resolve URL, acquire a rate-limit token, resolve
 * the auth header, fetch with a timeout, map the error" — and they had
 * diverged: the upload helper did not translate timeouts (a bare
 * `TimeoutError` with no endpoint), retried nothing, and neither the download
 * nor the upload helper honoured a 429. `send()` is now the only place that
 * calls `fetch`, so the timeout, the rate limiter, the retry policy and the
 * error shaping are the same for JSON, binary and multipart requests. The
 * three helpers are thin wrappers that only decide what to do with the body.
 */
import { readPositiveInt } from "../../config/env.js";
import { DEFAULT_HTTP_TIMEOUT_MS } from "../../constants.js";
import type { JsonApiResponse } from "../../types.js";
import { getConfig } from "./auth.js";
import { BoondApiError, formatApiError, nonJsonResponseError, timeoutError } from "./errors.js";
import { getRateLimiter } from "./rate-limit.js";
import { computeBackoffMs, isRetryable, parseRetryAfter, resolveRetryConfig, sleep } from "./retry.js";
import { currentRequestContext, RequestCancelledError, throwIfCancelled } from "../request-context.js";
import { logger } from "../logger.js";

export type QueryValue = string | number | Array<string | number> | undefined;
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Resolve the per-request HTTP timeout in milliseconds.
 *
 * Reads BOOND_HTTP_TIMEOUT_MS at call time so tests / runtime overrides take
 * effect without restarting the process. Falls back to the default for
 * unset, non-numeric, or non-positive values.
 *
 * Exported for unit testing.
 */
export function resolveTimeoutMs(): number {
  return readPositiveInt("BOOND_HTTP_TIMEOUT_MS", DEFAULT_HTTP_TIMEOUT_MS);
}

/** True when an error from fetch() came from an AbortSignal firing. */
function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // AbortSignal.timeout() rejects with a DOMException whose name is "TimeoutError";
  // generic aborts surface as "AbortError". Both indicate the request never
  // completed end-to-end and should be reported as a timeout.
  return err.name === "TimeoutError" || err.name === "AbortError";
}

/**
 * Defense-in-depth against path traversal / query injection through entity
 * ids interpolated into API paths at ~40 call sites. Even though the id
 * schemas are now numeric-only, a future tool could forget to validate, so we
 * assert here that the path is well-formed: it must start with `/`, carry no
 * query (`?`) or fragment (`#`) — those arrive via `queryParams`, never the
 * path — and contain no traversal (`..`) or percent/backslash escapes. Built
 * paths only ever combine static segments with numeric ids and hyphenated tab
 * names, so this rejects nothing legitimate. Exported for unit testing.
 */
export function assertSafeApiPath(path: string): void {
  if (!path.startsWith("/")) {
    throw new Error(`Invalid API path (must start with "/"): ${path}`);
  }
  // `?`/`#` would inject a query/fragment; `%`/`\` could encode a traversal;
  // `..` is a literal traversal segment.
  if (/[?#%\\]/.test(path) || path.includes("..")) {
    throw new Error(`Unsafe API path rejected: ${path}`);
  }
}

/**
 * Validates `path` and resolves it against `baseUrl`, returning the
 * constructed URL. Throws if the path is unsafe (see `assertSafeApiPath`) or
 * if the resolved URL escapes the configured API base origin/path. Exported
 * for unit testing.
 */
export function resolveApiUrl(baseUrl: string, path: string): URL {
  assertSafeApiPath(path);
  const url = new URL(`${baseUrl}${path}`);
  // Belt-and-braces: confirm the constructed URL did not escape the API base
  // origin/path despite the textual guard above.
  const base = new URL(baseUrl);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new Error(`API path escaped the configured base URL: ${path}`);
  }
  return url;
}

/** Append query parameters; arrays use BoondManager's repeated bracket notation (`key[]=v1&key[]=v2`). */
function applyQuery(url: URL, queryParams: Record<string, QueryValue> | undefined): void {
  if (!queryParams) return;
  for (const [key, value] of Object.entries(queryParams)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const bracketKey = key.endsWith("[]") ? key : `${key}[]`;
      for (const v of value) {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.append(bracketKey, String(v));
        }
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

/** What a helper hands to `send()`: everything but the plumbing. */
export interface SendOptions {
  method?: HttpMethod;
  query?: Record<string, QueryValue>;
  /**
   * Request body, reused verbatim on every attempt: a JSON string or a
   * `FormData` (both are re-serialised by `fetch` per call, so a retry never
   * sends a consumed stream).
   */
  body?: string | FormData;
  /** Extra headers (`Accept`, `Content-Type`); the auth header is added per attempt. */
  headers?: Record<string, string>;
  /**
   * Cancellation signal. Defaults to the current MCP request's `extra.signal`
   * (`currentRequestSignal()`, issue #231) — pass one only to override it.
   */
  signal?: AbortSignal;
}

/**
 * Send one request through the whole pipeline — URL guard, per-identity rate
 * limiter, auth header resolved per attempt (so an OAuth refresh between two
 * tries is picked up), per-attempt timeout, retry policy with `Retry-After`,
 * error mapping — and return the first **2xx** `Response`, body unread.
 *
 * Throws `BoondApiError` on a non-2xx that the policy does not retry (or once
 * retries are exhausted), the standard timeout `Error` when an attempt never
 * completed, `RequestCancelledError` (name `AbortError`) when the client
 * cancelled — checked before each attempt, while waiting for a rate-limit
 * token, during the fetch itself and during a backoff, and never retried —
 * and the raw network error otherwise.
 */
export async function send(path: string, options: SendOptions = {}): Promise<Response> {
  const method = options.method ?? "GET";
  const { baseUrl, auth } = getConfig();
  const url = resolveApiUrl(baseUrl, path);
  applyQuery(url, options.query);

  const timeoutMs = resolveTimeoutMs();
  const retry = resolveRetryConfig();
  const totalAttempts = retry.maxRetries + 1;
  const limiter = getRateLimiter();
  const context = currentRequestContext();
  const signal = options.signal ?? context?.signal;
  const corrId = context?.corrId;
  // Correlation towards BoondManager (#236): the request id every log line
  // carries, and the client's W3C trace context when it sent one. Header
  // propagation only — no tracing SDK.
  const correlationHeaders: Record<string, string> = {
    ...(corrId ? { "X-Request-Id": corrId } : {}),
    ...(context?.traceparent ? { traceparent: context.traceparent } : {}),
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    throwIfCancelled(signal, method, path);
    // Acquire a token before each attempt so retries also count toward the
    // rate budget — this is what actually protects us from feedback loops
    // (transient 5xx → retry → transient 5xx → …) saturating the API.
    if (limiter) {
      try {
        await limiter.acquire(signal);
      } catch (err) {
        throwIfCancelled(signal, method, path);
        throw err;
      }
    }

    const authHeader = await auth();
    const headers: Record<string, string> = {
      [authHeader.name]: authHeader.value,
      ...correlationHeaders,
      ...options.headers,
    };
    const attemptStartedAt = Date.now();

    const fetchOptions: RequestInit = {
      method,
      headers,
      // Each attempt gets its own timeout signal — once a signal has fired it
      // can't be reused for the next try. The request's cancellation signal
      // is composed in so `notifications/cancelled` aborts the socket too.
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    };
    if (options.body !== undefined) fetchOptions.body = options.body;

    let response: Response | undefined;
    let networkError: Error | undefined;

    try {
      response = await fetch(url.toString(), fetchOptions);
    } catch (err) {
      // A cancellation is not a network failure: no retry, and the error
      // says "cancelled", not "timed out".
      if (signal?.aborted) throw new RequestCancelledError(method, path, err);
      networkError = isAbortError(err)
        ? timeoutError(timeoutMs, method, path, err)
        : err instanceof Error
          ? err
          : new Error(String(err));
    }

    // The query string is deliberately left out of every log line: `keywords`
    // and the perimeter filters are end-user data.
    const logFields = { corrId, method, path, attempt: attempt + 1, durationMs: Date.now() - attemptStartedAt };

    if (response && response.ok) {
      logger.debug({ ...logFields, status: response.status }, "boondmanager request");
      return response;
    }

    let attemptError: Error;
    let isNetworkOrTimeout = false;

    if (response) {
      const errorText = await response.text().catch(() => "");
      attemptError = new BoondApiError(
        formatApiError(response.status, response.statusText, method, path, errorText),
        response.status,
        method,
        path
      );
    } else {
      attemptError = networkError!;
      isNetworkOrTimeout = true;
    }

    const hasMoreAttempts = attempt < totalAttempts - 1;
    const timedOut = isNetworkOrTimeout && isAbortError((networkError as Error & { cause?: unknown }).cause);
    const failure = response ? { status: response.status } : { reason: timedOut ? "timeout" : "network" };
    if (!hasMoreAttempts || !isRetryable(method, response?.status, isNetworkOrTimeout)) {
      // A final 429 or timeout is worth a warning on its own; any other final
      // failure reaches the tool log as `ok: false` and the tool's error text.
      if (response?.status === 429 || timedOut) {
        logger.warn({ ...logFields, ...failure, totalAttempts }, "boondmanager request failed");
      } else {
        logger.debug({ ...logFields, ...failure, totalAttempts }, "boondmanager request failed");
      }
      throw attemptError;
    }

    // Only inspect Retry-After once we've actually decided to retry — keeps
    // the fast path off the headers object and matches tests that build
    // minimal Response stubs.
    const retryAfterMs = response ? parseRetryAfter(response.headers?.get("retry-after") ?? null) : null;
    const backoff =
      retryAfterMs !== null
        ? Math.min(retry.maxDelayMs, retryAfterMs)
        : computeBackoffMs(attempt, retry.baseDelayMs, retry.maxDelayMs);
    logger.warn({ ...logFields, ...failure, totalAttempts, backoffMs: backoff }, "boondmanager request retried");
    try {
      await sleep(backoff, signal);
    } catch (err) {
      throw new RequestCancelledError(method, path, err);
    }
    lastError = attemptError;
  }

  // Defensive — the loop always returns or throws. If somehow exhausted:
  throw lastError ?? new Error("BoondManager API request exhausted retries with no recorded error.");
}

/**
 * Read a 2xx body as JSON:API. A `204` / empty body (DELETE) is an empty page;
 * a body that is not JSON becomes an error that names the endpoint instead of
 * a bare `SyntaxError`.
 */
async function readJsonApi(response: Response, method: HttpMethod, path: string): Promise<JsonApiResponse> {
  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return { data: [] };
  }
  try {
    return (await response.json()) as JsonApiResponse;
  } catch (err) {
    throw nonJsonResponseError(response.status, method, path, err);
  }
}

/** JSON:API request. `body` is serialised for POST / PUT / PATCH only. */
export async function apiRequest(
  path: string,
  method: HttpMethod = "GET",
  body?: unknown,
  queryParams?: Record<string, QueryValue>
): Promise<JsonApiResponse> {
  const serialized =
    body && (method === "POST" || method === "PUT" || method === "PATCH") ? JSON.stringify(body) : undefined;
  const response = await send(path, {
    method,
    ...(queryParams !== undefined ? { query: queryParams } : {}),
    ...(serialized !== undefined ? { body: serialized } : {}),
    headers: { Accept: "application/json", "Content-Type": "application/json" },
  });
  return readJsonApi(response, method, path);
}

/**
 * POST a multipart/form-data payload to the BoondManager API (document
 * upload). Form values are simple string fields — the file itself travels by
 * reference via the `fileUrl` field (Boond downloads it server-side), so the
 * MCP server never buffers file bytes.
 */
export async function apiUploadForm(path: string, fields: Record<string, string>): Promise<JsonApiResponse> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  // No Content-Type header: fetch derives the multipart boundary from FormData.
  const response = await send(path, { method: "POST", body: form, headers: { Accept: "application/json" } });
  return readJsonApi(response, "POST", path);
}
