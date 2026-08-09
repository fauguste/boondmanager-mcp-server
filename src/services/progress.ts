/**
 * MCP progress notifications (`notifications/progress`).
 *
 * A handful of tool calls fan out into several sequential BoondManager
 * requests (`apiSearch` in chunked mode, a wide reporting query, a 5 MiB
 * document download). Without a signal, the client sees one call that takes a
 * long time — indistinguishable from a hang.
 *
 * Two rules from the spec shape this module:
 *
 * 1. **No `progressToken`, no notification.** A progress notification is only
 *    legal when the client opted in by putting a `progressToken` in the
 *    request's `_meta`. `progressReporterFrom` therefore returns a **no-op**
 *    reporter in every other case, so a call without a token behaves exactly
 *    as it did before this module existed.
 * 2. **Progress must strictly increase** for a given token; `total` stays
 *    constant. Emitting is the caller's job — see `apiSearch`.
 *
 * Reporting is deliberately fire-and-forget (`void`, never awaited, errors
 * swallowed): a disconnected client or a transport that cannot carry the
 * notification must never cost the caller its result.
 */

/** Method name of the MCP progress notification. */
const PROGRESS_METHOD = "notifications/progress";

export interface ProgressReporter {
  /**
   * Emit one progress step. Never throws, never blocks: the notification is
   * sent fire-and-forget.
   */
  (progress: number, total: number | undefined, message: string): void;
  /**
   * `false` when the client sent no `progressToken` (the reporter is a no-op).
   * Lets a caller skip work that exists *only* to feed progress — e.g.
   * `apiDownload` streams the body chunk by chunk instead of buffering it in
   * one `arrayBuffer()` call only when someone is listening.
   */
  readonly enabled: boolean;
}

/** Shared no-op instance: no allocation on the (overwhelmingly common) tokenless path. */
const NOOP_REPORTER: ProgressReporter = Object.assign(() => {}, { enabled: false as const });

type ProgressNotification = {
  method: typeof PROGRESS_METHOD;
  params: {
    progressToken: string | number;
    progress: number;
    total?: number;
    message?: string;
  };
};

type NotificationSender = (notification: ProgressNotification) => Promise<void> | void;

/**
 * Build a reporter from the `extra` argument the SDK hands to a tool handler
 * (`RequestHandlerExtra`: `_meta` carries the client's `progressToken`,
 * `sendNotification` routes the notification onto the response stream of the
 * request being handled).
 *
 * Typed as `unknown` on purpose: tool handlers receive it positionally and
 * tests call them with nothing at all, so the narrowing lives here rather than
 * in ~180 handlers.
 */
export function progressReporterFrom(extra: unknown): ProgressReporter {
  if (typeof extra !== "object" || extra === null) return NOOP_REPORTER;

  const { _meta, sendNotification } = extra as { _meta?: unknown; sendNotification?: unknown };
  if (typeof sendNotification !== "function") return NOOP_REPORTER;
  if (typeof _meta !== "object" || _meta === null) return NOOP_REPORTER;

  const progressToken = (_meta as { progressToken?: unknown }).progressToken;
  if (typeof progressToken !== "string" && typeof progressToken !== "number") return NOOP_REPORTER;

  const send = sendNotification as NotificationSender;
  const report = (progress: number, total: number | undefined, message: string): void => {
    try {
      const sent = send({
        method: PROGRESS_METHOD,
        params: {
          progressToken,
          progress,
          ...(total !== undefined ? { total } : {}),
          message,
        },
      });
      // A rejected send (client gone, stream closed) must not surface as an
      // unhandled rejection, and must not fail the tool call.
      void Promise.resolve(sent).catch(() => {});
    } catch {
      /* A synchronous throw from the transport is just as harmless. */
    }
  };

  return Object.assign(report, { enabled: true as const });
}
