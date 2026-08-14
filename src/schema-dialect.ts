import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/**
 * Strip the JSON Schema **dialect declaration** (`$schema`) from the
 * `inputSchema` / `outputSchema` advertised in `tools/list`.
 *
 * ## The bug this fixes
 *
 * `McpServer` converts our Zod schemas with `toJsonSchemaCompat`, which for
 * Zod v4 calls `z.toJSONSchema(schema, { target: 'draft-7' })` — and that
 * stamps every advertised schema with
 *
 *     "$schema": "http://json-schema.org/draft-07/schema#"
 *
 * Hosts that validate `structuredContent` with a **2020-12-only** validator
 * (Ajv's `Ajv2020`, which is what the JSON Schema tooling around the Claude
 * tool API uses) refuse to *compile* such a schema at all:
 *
 *     no schema with key or ref "http://json-schema.org/draft-07/schema#"
 *
 * The compile happens when the tool is registered client-side, i.e. **before**
 * any call, so the tool doesn't fail — it becomes unusable. The symptom is
 * asymmetric and looks baffling: only the 59 tools that declare an
 * `outputSchema` are affected (every `*_search`, plus create/update/delete),
 * while the ~120 tools without one (`*_get`, dictionaries, reporting) work
 * fine — even though *all* 180 carry the same `$schema` on their `inputSchema`.
 * That leaves a client able to read an entity only if the id is already known,
 * with no way to search for it.
 *
 * ## Why removing the declaration is the right fix
 *
 * - `$schema` is **not** part of MCP's `Tool.inputSchema` / `Tool.outputSchema`
 *   shape. The spec asks for "a JSON Schema object"; the dialect declaration is
 *   optional metadata that no client needs, and most servers never emit.
 * - Our schemas use **no dialect-specific keyword** (verified over the whole
 *   catalogue: `type`, `properties`, `required`, `items`, `enum`, `pattern`,
 *   `propertyNames`, `additionalProperties`, `anyOf` — identical semantics in
 *   draft-07 and 2020-12; no `$ref`, no `$defs`, no `definitions`). Dropping
 *   the declaration therefore changes no schema's meaning: every validator
 *   applies its own default dialect and reads them the same way.
 * - The alternative — declaring 2020-12 instead — would just move the failure
 *   to draft-07-only validators (the MCP SDK's own client uses plain Ajv 8,
 *   whose default *is* draft-07). Declaring nothing is the only choice that
 *   satisfies both.
 * - Bonus: 45 bytes × 239 schemas ≈ **10 KiB off the `tools/list` payload**,
 *   which this codebase budgets carefully (see `icons.ts`).
 *
 * ## Why a response decorator
 *
 * `registerTool` takes Zod, and the draft-07 target is hardcoded inside the SDK
 * (`server/zod-json-schema-compat.js`) with no option to change or omit it — so
 * there is nothing to pass at registration time. Same shim mechanism as
 * `installProtocolIcons`: wrap the `tools/list` handler through the public
 * `Server.setRequestHandler`, keyed on schema identity. When the SDK stops
 * emitting `$schema` (or lets us choose), this file can be deleted —
 * `schema-dialect.test.ts` asserts over a real client, so the regression can't
 * come back silently.
 */

/** The two fields of a `tools/list` entry that carry a JSON Schema. */
const SCHEMA_FIELDS = ["inputSchema", "outputSchema"] as const;

/**
 * Recursively drop `$schema` string members. Returns the input **by identity**
 * when there is nothing to strip, so a future SDK that stops emitting the
 * declaration costs no allocation at all.
 *
 * The `typeof === "string"` guard matters: a dialect declaration is always a
 * string URI, whereas a *property named* `$schema` inside a `properties` map
 * would be a schema **object**. Without the guard this would silently delete
 * such a property from the advertised input shape.
 */
export function stripSchemaDialect<T>(value: T): T {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const stripped = stripSchemaDialect(item);
      if (stripped !== item) changed = true;
      return stripped;
    });
    return (changed ? out : value) as T;
  }
  if (value === null || typeof value !== "object") return value;

  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
    if (key === "$schema" && typeof member === "string") {
      changed = true;
      continue;
    }
    const stripped = stripSchemaDialect(member);
    if (stripped !== member) changed = true;
    out[key] = stripped;
  }
  return (changed ? out : value) as T;
}

/** Strip the dialect from one `tools/list` entry, keeping identity when possible. */
function withoutSchemaDialect<T extends object>(tool: T): T {
  let result = tool;
  for (const field of SCHEMA_FIELDS) {
    const schema = (result as Record<string, unknown>)[field];
    if (schema === undefined || schema === null) continue;
    const stripped = stripSchemaDialect(schema);
    if (stripped !== schema) result = { ...result, [field]: stripped };
  }
  return result;
}

type AnyHandler = (...args: unknown[]) => unknown;

/**
 * Remove the JSON Schema dialect declaration from `tools/list` responses.
 *
 * MUST be called before the first `registerTool` on this server: it works by
 * intercepting the `setRequestHandler` call the SDK makes when it lazily
 * installs the `tools/list` handler.
 */
export function installSchemaDialectCompat(server: McpServer): void {
  // `Server.setRequestHandler` is generic over the request schema; the shim is
  // schema-agnostic, hence the single cast at the boundary.
  const underlying = server.server as unknown as {
    setRequestHandler: (schema: unknown, handler: AnyHandler) => void;
  };
  const original = underlying.setRequestHandler.bind(underlying);

  underlying.setRequestHandler = (schema: unknown, handler: AnyHandler) => {
    if (schema !== ListToolsRequestSchema) return original(schema, handler);
    return original(schema, async (...args: unknown[]) => {
      const result = (await handler(...args)) as { tools?: object[] };
      if (!Array.isArray(result?.tools)) return result;
      return { ...result, tools: result.tools.map(withoutSchemaDialect) };
    });
  };
}
