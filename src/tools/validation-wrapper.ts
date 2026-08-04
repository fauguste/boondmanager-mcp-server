import { z } from "zod";
import type { DomainName } from "../constants.js";
import { unknownFilterMessage, ENDPOINT_FILTER_ALIASES, type SearchEndpoint } from "../schemas/filter-aliases.js";

/**
 * Turn a `.strict()` search schema's unrecognized-key rejection into a
 * correction the model can act on (SEP-1303).
 *
 * ## Why this is a *schema* wrapper and not a handler wrapper
 *
 * The issue this implements proposed wrapping the tool handler and
 * `safeParse`-ing before the SDK does. That cannot work: `McpServer` validates
 * the input **before** invoking the handler
 * (`server/mcp.js::validateToolInput`), so on a validation failure the handler
 * is never reached. The two options left were (a) declare a permissive schema
 * to the SDK and validate strictly ourselves — which drops
 * `additionalProperties: false` from the advertised `inputSchema`, the thing
 * that lets a client validate before it even calls us — or (b) keep the strict
 * schema and make *its own* error message the correction. We do (b):
 *
 * - the advertised `inputSchema` is byte-for-byte what it was before (verified
 *   in the tests: the rebuilt schema's JSON Schema is unchanged);
 * - there is no second parse, so nothing is added to the hot path of a search;
 * - the SDK already reports a validation failure as a *tool* error
 *   (`isError: true`) rather than a protocol error — it catches its own
 *   `McpError` and funnels it through `createToolError`. So SEP-1303's
 *   requirement is met by the SDK; what was missing, and what this adds, is a
 *   message worth self-correcting from.
 *
 * Applied to search-shaped tools only (see `isSearchTool`): that is where the
 * filter vocabulary is treacherous (`mainManagers` vs `perimeterManagers`,
 * `states` vs `resourceStates`). `get`/`create`/`update` take ids and attribute
 * names the model reads straight off the schema.
 */

/** Does the domain have an endpoint-specific filter vocabulary? */
function searchEndpointOf(domain: DomainName | undefined): SearchEndpoint | undefined {
  if (domain !== undefined && Object.hasOwn(ENDPOINT_FILTER_ALIASES, domain)) return domain as SearchEndpoint;
  return undefined;
}

/**
 * A Zod v4 object schema that *rejects* unknown keys — i.e. `catchall` is
 * `ZodNever`, not merely present. `.catchall(z.string())` also sets it, and
 * rebuilding such a schema as `strictObject` would silently turn a permissive
 * schema into a strict one.
 */
function isStrictObject(schema: unknown): schema is z.ZodObject {
  if (!(schema instanceof z.ZodObject)) return false;
  const def = (schema as unknown as { _zod?: { def?: { catchall?: unknown } } })._zod?.def;
  return def?.catchall instanceof z.ZodNever;
}

/**
 * Rebuild a strict object schema with a filter-aware unrecognized-key message.
 * Anything else (raw shapes, non-strict objects, unions) is returned as-is —
 * we never make a lenient schema strict as a side effect.
 *
 * The rebuild reuses the exact same field schemas, so defaults, descriptions
 * and per-field messages are preserved. Only issues raised *by the object
 * itself* reach our error function; a field-level failure (e.g. `page: 500`)
 * keeps the message its own schema defines, which is why the returned
 * `undefined` fallback matters.
 */
export function withFilterHints<T>(schema: T, domain?: DomainName): T {
  if (!isStrictObject(schema)) return schema;
  const shape = schema.shape;
  const validKeys = Object.keys(shape);
  const endpoint = searchEndpointOf(domain);
  return z.strictObject(shape, {
    error: (issue) => {
      const raw = issue as { code?: string; keys?: unknown };
      if (raw.code !== "unrecognized_keys" || !Array.isArray(raw.keys)) return undefined;
      return unknownFilterMessage(raw.keys.map(String), validKeys, endpoint);
    },
  }) as unknown as T;
}

interface ToolConfigLike {
  inputSchema?: unknown;
  annotations?: { openWorldHint?: boolean };
}

/**
 * Is this a search-shaped tool, i.e. one whose filter vocabulary is worth
 * explaining?
 *
 * Keyed on the *registration* rather than the name only. `openWorldHint: true`
 * is exactly the annotation the codebase reserves for paginated,
 * keyword-filtered listing tools (see CLAUDE.md §MCP Annotations), so it catches
 * `boond_reporting_{companies,projects,resources,synthesis,production_plans}` —
 * strict schemas carrying the same treacherous `perimeter*` / `*States`
 * vocabulary, which a `_search` suffix test silently skipped — and any future
 * hand-rolled search tool that doesn't happen to be named `*_search`. The name
 * check is kept as an OR so a listing tool that omits the annotation is still
 * covered.
 */
export function isSearchTool(name: string, config?: ToolConfigLike): boolean {
  return name.endsWith("_search") || config?.annotations?.openWorldHint === true;
}

/**
 * Return the registration config a search tool should be registered with:
 * the same object with its `inputSchema` swapped for the hint-enriched clone.
 * Non-search tools and configs without a strict object schema come back
 * untouched (same reference), so this is a no-op for the ~150 other tools.
 */
export function withValidationFeedback<C extends ToolConfigLike>(name: string, config: C, domain?: DomainName): C {
  if (!isSearchTool(name, config) || config?.inputSchema === undefined) return config;
  const enriched = withFilterHints(config.inputSchema, domain);
  if (enriched === config.inputSchema) return config;
  return { ...config, inputSchema: enriched };
}
