/**
 * Per-request context: cancellation (issue #231) and correlation (issue #236).
 *
 * The SDK hands every handler an `extra.signal` — an `AbortSignal` fired by
 * `notifications/cancelled` or by the transport closing. Before #231 nothing
 * forwarded it: a chunked `/actions` search (up to 5 sequential calls), a
 * reporting query of tens of seconds or a 5 MiB download ran to completion
 * after the client had given up, spending rate-limit tokens and BoondManager
 * quota on a result nobody would read.
 *
 * Rather than threading `signal` / `corrId` arguments through ~180 handler
 * signatures, the context travels in an `AsyncLocalStorage`:
 * `instrumentHandlers()` (`tools/registration-decorators.ts`) runs each handler
 * inside `runWithRequestContext`, and `send()` (`http/transport.ts`) reads it
 * back — the same pattern as the OAuth token (`oauthContext`). Work that is
 * *shared* between requests (the dictionary cache's in-flight load, #226) opts
 * out of cancellation with `withoutRequestSignal`: one caller cancelling must
 * not fail the load every other caller is waiting on.
 *
 * `corrId` is the correlation id every log line of the request carries and
 * that `send()` forwards to BoondManager as `X-Request-Id`. It is, in order:
 * the W3C `trace-id` of a `_meta.traceparent` the client sent (SEP-414), the
 * id the HTTP transport generated for the connection, or a fresh one (stdio).
 * `traceparent` is forwarded verbatim when present. **`baggage` is never read
 * and never logged** — it may carry end-user identifiers.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  /** Fires on `notifications/cancelled` or when the transport closes. */
  signal?: AbortSignal;
  /** Correlation id shared by every log line and forwarded as `X-Request-Id`. */
  corrId?: string;
  /** W3C `traceparent` header received from the client, forwarded verbatim. */
  traceparent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with `context` as the current request's context (replaces any enclosing one). */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The context of the request being handled, if a handler is on the stack. */
export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Run `fn` with `signal` as the current request's cancellation signal; the rest of the context is kept. */
export function runWithRequestSignal<T>(signal: AbortSignal | undefined, fn: () => T): T {
  // Drop the enclosing signal rather than storing `undefined` under the key.
  const { signal: _enclosing, ...rest } = storage.getStore() ?? {};
  return storage.run(signal ? { ...rest, signal } : rest, fn);
}

/** Run `fn` with no cancellation signal, for work whose result other requests share. Correlation is kept. */
export function withoutRequestSignal<T>(fn: () => T): T {
  return runWithRequestSignal(undefined, fn);
}

/** The signal of the request being handled, if a handler is on the stack. */
export function currentRequestSignal(): AbortSignal | undefined {
  return storage.getStore()?.signal;
}

/** The correlation id of the request being handled, if any. */
export function currentCorrId(): string | undefined {
  return storage.getStore()?.corrId;
}

/** Narrowing for the SDK's `extra`, typed `unknown` at every call site. */
export function requestSignalFrom(extra: unknown): AbortSignal | undefined {
  if (typeof extra !== "object" || extra === null) return undefined;
  const signal = (extra as { signal?: unknown }).signal;
  return signal instanceof AbortSignal ? signal : undefined;
}

/**
 * W3C Trace Context `traceparent`: `version-traceid-parentid-flags`, lower-case
 * hex, trace-id not all zeros. Anything else is ignored rather than trusted.
 */
const TRACEPARENT_RE = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;

/** Parse a `traceparent` value; `undefined` when absent or malformed. */
export function parseTraceparent(value: unknown): { header: string; traceId: string } | undefined {
  if (typeof value !== "string") return undefined;
  const match = TRACEPARENT_RE.exec(value.trim());
  const traceId = match?.[1];
  if (!match || !traceId || /^0+$/.test(traceId)) return undefined;
  return { header: match[0], traceId };
}

/** The `traceparent` the client put in the request's `_meta` (SEP-414), if valid. */
export function traceparentFrom(extra: unknown): { header: string; traceId: string } | undefined {
  if (typeof extra !== "object" || extra === null) return undefined;
  const meta = (extra as { _meta?: unknown })._meta;
  if (typeof meta !== "object" || meta === null) return undefined;
  return parseTraceparent((meta as { traceparent?: unknown }).traceparent);
}

/**
 * Raised when the client cancelled the request. `name` is `AbortError` so it
 * reads like every other abort in Node; the message names the endpoint the
 * cancellation interrupted, which is what a log line needs.
 */
export class RequestCancelledError extends Error {
  readonly method: string;
  readonly path: string;
  constructor(method: string, path: string, cause?: unknown) {
    super(
      `BoondManager API request cancelled by the client (notifications/cancelled or transport closed).\nEndpoint: ${method} ${path}`,
      cause === undefined ? undefined : { cause }
    );
    this.name = "AbortError";
    this.method = method;
    this.path = path;
  }
}

/** Throw `RequestCancelledError` if `signal` has fired. Cheap — call it before every unit of work. */
export function throwIfCancelled(signal: AbortSignal | undefined, method: string, path: string): void {
  if (signal?.aborted) throw new RequestCancelledError(method, path, signal.reason);
}

/** A promise that rejects with the signal's reason the moment it fires (never resolves). */
export function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
  });
}
