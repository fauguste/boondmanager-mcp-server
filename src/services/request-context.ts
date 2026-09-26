/**
 * Per-request cancellation context (issue #231).
 *
 * The SDK hands every handler an `extra.signal` — an `AbortSignal` fired by
 * `notifications/cancelled` or by the transport closing. Before this module
 * nothing forwarded it: a chunked `/actions` search (up to 5 sequential
 * calls), a reporting query of tens of seconds or a 5 MiB download ran to
 * completion after the client had given up, spending rate-limit tokens and
 * BoondManager quota on a result nobody would read.
 *
 * Rather than threading a `signal` argument through ~180 handler signatures,
 * the signal travels in an `AsyncLocalStorage`: `propagateRequestSignal()`
 * (`tools/registration-decorators.ts`) runs each handler inside
 * `runWithRequestSignal`, and `send()` (`http/transport.ts`) reads it back
 * with `currentRequestSignal()` — the same pattern as the OAuth token
 * (`oauthContext`). Work that is *shared* between requests (the dictionary
 * cache's in-flight load, #226) opts out with `withoutRequestSignal`: one
 * caller cancelling must not fail the load every other caller is waiting on.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<AbortSignal>();

/** Run `fn` with `signal` as the current request's cancellation signal. */
export function runWithRequestSignal<T>(signal: AbortSignal | undefined, fn: () => T): T {
  return signal === undefined ? storage.run(undefined as unknown as AbortSignal, fn) : storage.run(signal, fn);
}

/** Run `fn` with no request signal, for work whose result other requests share. */
export function withoutRequestSignal<T>(fn: () => T): T {
  return storage.run(undefined as unknown as AbortSignal, fn);
}

/** The signal of the request being handled, if a handler is on the stack. */
export function currentRequestSignal(): AbortSignal | undefined {
  return storage.getStore() ?? undefined;
}

/** Narrowing for the SDK's `extra`, typed `unknown` at every call site. */
export function requestSignalFrom(extra: unknown): AbortSignal | undefined {
  if (typeof extra !== "object" || extra === null) return undefined;
  const signal = (extra as { signal?: unknown }).signal;
  return signal instanceof AbortSignal ? signal : undefined;
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
