import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DomainName } from "../constants.js";
import { withValidationFeedback } from "./validation-wrapper.js";

/**
 * Per-domain registration decorations, applied centrally in
 * `server.ts::registerAll` so none of the 38 domain files has to know about
 * them. Two jobs, both keyed on the domain the registrar belongs to (which the
 * caller knows for free — it is iterating `TOOL_REGISTRARS`):
 *
 *  1. enrich `*_search` input schemas with filter-correction messages
 *     (`validation-wrapper.ts`);
 *  2. record `tool name → domain` so the icon layer can attach the right
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
          const config = args[1] as { inputSchema?: unknown } | undefined;
          index?.toolDomains.set(name, domain);
          const decorated = config === undefined ? config : withValidationFeedback(name, config, domain);
          return (value as (...a: unknown[]) => unknown).apply(target, [name, decorated, ...args.slice(2)]);
        };
      }

      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
}
