import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DomainName } from "../constants.js";
import { withValidationFeedback } from "./validation-wrapper.js";
import { withParameterDisclosure } from "./parameter-disclosure.js";
import { withUsageGuidance } from "./usage-guidance.js";
import {
  currentCorrId,
  requestSignalFrom,
  runWithRequestContext,
  traceparentFrom,
  type RequestContext,
} from "../services/request-context.js";
import { generateCorrelationId, logger } from "../services/logger.js";

/**
 * Per-domain registration decorations, applied centrally in
 * `server.ts::registerAll` so none of the 38 domain files has to know about
 * them. Two jobs, both keyed on the domain the registrar belongs to (which the
 * caller knows for free — it is iterating `TOOL_REGISTRARS`):
 *
 *  1. enrich `*_search` input schemas with filter-correction messages
 *     (`validation-wrapper.ts`);
 *  2. disclose the semantics of `fields` / `page` / `pageSize` on the tools
 *     that declare them (`parameter-disclosure.ts`) — facts a JSON Schema
 *     cannot carry, on ~32 tools spread over as many files;
 *  3. backfill the "when / rather than" guidance on the hand-rolled tools
 *     (`usage-guidance.ts`), which the composed templates already carry;
 *  4. record `tool name → domain` so the icon layer can attach the right
 *     domain icon without parsing tool names (`icons.ts`).
 *
 * Deliberately NOT merged into `withPolicy`: that wrapper has a fast path
 * returning the untouched server when no operation filter is active, and these
 * decorations must apply unconditionally.
 */

export interface RegistrationIndex {
  /**
   * Tool name → owning domain. Filled at registration time from
   * `TOOL_REGISTRARS`, so it is exact for multi-word domains
   * (`provider-invoices`) and for tools whose name doesn't start with their
   * domain (`boond_workflow_*` ← `workflows`).
   */
  toolDomains: Map<string, DomainName>;
}

export function createRegistrationIndex(): RegistrationIndex {
  return { toolDomains: new Map() };
}

/** The SDK registration methods whose last argument is a request handler. */
const HANDLER_REGISTRATIONS = new Set(["registerTool", "registerPrompt", "registerResource"]);

/** Size of a tool result as the model receives it: text content plus the structured payload. */
function resultChars(result: unknown): number {
  if (typeof result !== "object" || result === null) return 0;
  const { content, structuredContent } = result as { content?: unknown; structuredContent?: unknown };
  let chars = 0;
  if (Array.isArray(content)) {
    for (const item of content) {
      const text = (item as { text?: unknown })?.text;
      if (typeof text === "string") chars += text.length;
    }
  }
  if (structuredContent !== undefined) chars += JSON.stringify(structuredContent).length;
  return chars;
}

/**
 * Wrap a server so every handler registered through it — tool, prompt or
 * resource — runs inside a request context (issues #231, #236) and every tool
 * call leaves one log line.
 *
 * The handler is always the last argument of the registration call and
 * `extra` the last argument of the handler (`(args, extra)` for a tool with an
 * input schema, `(extra)` without, `(uri, variables, extra)` for a template).
 * From `extra` the wrapper takes:
 *
 * - `signal` — so `send()` can abort the BoondManager call on
 *   `notifications/cancelled`;
 * - `_meta.traceparent` (SEP-414) — forwarded to BoondManager verbatim, and
 *   its `trace-id` becomes the `corrId`; otherwise the id the HTTP transport
 *   generated for the connection is kept, and on stdio a fresh one is made.
 *   `_meta.baggage` is never read.
 *
 * `send()` reads the context back from the AsyncLocalStorage, so the ~180
 * handlers and the client helpers keep their signatures. The tool log line —
 * `{ corrId, tool, durationMs, ok, chars }` — is the single place ~185 tools
 * are instrumented; a thrown handler is logged at `warn` and rethrown so the
 * SDK still turns it into an `isError` result.
 *
 * Applied once, on the innermost server, in `server.ts::registerAll` — before
 * the per-domain decorations and the access policy — so that nothing
 * registered anywhere escapes it.
 */
export function instrumentHandlers(server: McpServer): McpServer {
  return new Proxy(server, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== "function") return value;
      if (typeof prop !== "string" || !HANDLER_REGISTRATIONS.has(prop)) {
        return (value as (...a: unknown[]) => unknown).bind(target);
      }
      return (...args: unknown[]) => {
        const handler = args[args.length - 1];
        if (typeof handler !== "function") {
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        }
        const name = String(args[0]);
        const isTool = prop === "registerTool";
        const wrapped = (...handlerArgs: unknown[]) => {
          const extra = handlerArgs[handlerArgs.length - 1];
          const trace = traceparentFrom(extra);
          const signal = requestSignalFrom(extra);
          const context: RequestContext = {
            ...(signal !== undefined ? { signal } : {}),
            corrId: trace?.traceId ?? currentCorrId() ?? generateCorrelationId(),
            ...(trace !== undefined ? { traceparent: trace.header } : {}),
          };
          return runWithRequestContext(context, () => {
            const call = () => (handler as (...a: unknown[]) => unknown)(...handlerArgs);
            if (!isTool) return call();
            const startedAt = Date.now();
            const done = (result: unknown) => {
              const ok = typeof result === "object" && result !== null && !(result as { isError?: boolean }).isError;
              logger.info(
                {
                  corrId: context.corrId,
                  tool: name,
                  durationMs: Date.now() - startedAt,
                  ok,
                  chars: resultChars(result),
                },
                "tool call"
              );
              return result;
            };
            const failed = (err: unknown) => {
              logger.warn(
                { corrId: context.corrId, tool: name, durationMs: Date.now() - startedAt, err },
                "tool call threw"
              );
              throw err;
            };
            try {
              const result = call();
              return result instanceof Promise ? result.then(done, failed) : done(result);
            } catch (err) {
              return failed(err);
            }
          });
        };
        return (value as (...a: unknown[]) => unknown).apply(target, [...args.slice(0, -1), wrapped]);
      };
    },
  });
}

/**
 * Wrap a server (or an already-wrapped Proxy) so every `registerTool` call made
 * by `domain`'s registrar is decorated. Methods other than `registerTool` pass
 * straight through, bound to the real target so the SDK's private fields keep
 * working (same technique as `withPolicy`).
 */
export function decorateRegistrations(server: McpServer, domain: DomainName, index?: RegistrationIndex): McpServer {
  return new Proxy(server, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== "function") return value;

      if (prop === "registerTool") {
        return (...args: unknown[]) => {
          const name = args[0] as string;
          const config = args[1] as { description?: string; inputSchema?: unknown } | undefined;
          index?.toolDomains.set(name, domain);
          // Order matters: the disclosure reads the schema shape the tool
          // declared, so it must run before `withValidationFeedback` rebuilds
          // that schema with its own error messages.
          const decorated =
            config === undefined
              ? config
              : withValidationFeedback(name, withUsageGuidance(name, withParameterDisclosure(config, name)), domain);
          return (value as (...a: unknown[]) => unknown).apply(target, [name, decorated, ...args.slice(2)]);
        };
      }

      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
}
