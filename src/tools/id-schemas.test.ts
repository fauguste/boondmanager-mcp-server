import { describe, it, expect } from "vitest";
import { connectMcpClient, useDefaultServerSurface } from "./test-helpers.js";

/**
 * Every id-shaped input is validated as a numeric BoondManager id (issue #228).
 *
 * `id` and `*Id` values end up in three places — an API path segment
 * (`PUT /candidates/{id}`, `/resources/{resourceId}/technical-data`), a
 * `keywords` prefix (`COMP{resourceId}`) or a JSON:API relationship — and the
 * first of those is a path-segment injection when the value is an open string:
 * `assertSafeApiPath` allows `/`, so `id: "5/information"` used to produce
 * `PUT /candidates/5/information`. The same class of hole was closed on
 * documents (#186) and on the resource templates (`EntityIdSchema` in
 * `resources/templates.ts`); this test is what stops it reopening one schema
 * at a time. It walks the schemas *as advertised* over a real client, so a
 * new `z.string().min(1)` id in any domain file fails here by name.
 */

const NUMERIC_ID_PATTERN = "^\\d+$";
/** The one documented exception: relations expose document ids suffixed (`123_resume`). */
const DOCUMENT_ID_PATTERN = "^\\d+(_[A-Za-z]+)?$";

interface JsonSchemaNode {
  type?: string | string[];
  pattern?: string;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode | JsonSchemaNode[];
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  allOf?: JsonSchemaNode[];
}

function isIdName(name: string): boolean {
  return name === "id" || /[a-z]Id$/.test(name);
}

/** Every (path, schema) pair whose property name is id-shaped, at any depth. */
function collectIdFields(node: JsonSchemaNode, path: string, out: Array<[string, JsonSchemaNode]>): void {
  for (const [name, child] of Object.entries(node.properties ?? {})) {
    const childPath = `${path}.${name}`;
    if (isIdName(name)) out.push([childPath, child]);
    collectIdFields(child, childPath, out);
  }
  const items = Array.isArray(node.items) ? node.items : node.items ? [node.items] : [];
  for (const item of items) collectIdFields(item, `${path}[]`, out);
  for (const alt of [...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])]) {
    collectIdFields(alt, path, out);
  }
}

/** Unwraps `.optional()` / nullable unions to the schema that carries the constraint. */
function constraintOf(node: JsonSchemaNode): JsonSchemaNode {
  const alts = node.anyOf ?? node.oneOf;
  if (alts && alts.length > 0) {
    const concrete = alts.filter((a) => a.type !== "null");
    if (concrete.length === 1) return constraintOf(concrete[0]!);
  }
  return node;
}

function isNumericId(node: JsonSchemaNode, toolName: string): boolean {
  const c = constraintOf(node);
  if (c.type === "integer") return true;
  if (c.type === "string" && c.pattern === NUMERIC_ID_PATTERN) return true;
  if (toolName === "boond_documents_get" && c.type === "string" && c.pattern === DOCUMENT_ID_PATTERN) return true;
  return false;
}

describe("id-shaped tool inputs (#228)", () => {
  useDefaultServerSurface();

  it("validates every `id` / `*Id` input as a numeric BoondManager id, on every advertised tool", async () => {
    const { client, close } = await connectMcpClient();
    try {
      const tools = (await client.listTools()).tools;
      const offenders: string[] = [];
      let checked = 0;
      for (const tool of tools) {
        const fields: Array<[string, JsonSchemaNode]> = [];
        collectIdFields(tool.inputSchema as JsonSchemaNode, tool.name, fields);
        for (const [path, node] of fields) {
          checked++;
          if (!isNumericId(node, tool.name)) offenders.push(`${path} → ${JSON.stringify(constraintOf(node))}`);
        }
      }
      // Guards against the assertion passing because nothing was walked.
      expect(checked).toBeGreaterThan(100);
      expect(offenders).toEqual([]);
    } finally {
      await close();
    }
  });

  it("would flag a bare-string id (the historical `z.string().min(1)` shape)", () => {
    expect(isNumericId({ type: "string", minLength: 1 } as JsonSchemaNode, "boond_candidates_update")).toBe(false);
    expect(isNumericId({ type: "string" }, "boond_purchases_create")).toBe(false);
    // …and does not let the document exception leak onto other tools.
    expect(isNumericId({ type: "string", pattern: DOCUMENT_ID_PATTERN }, "boond_candidates_get")).toBe(false);
    expect(isNumericId({ type: "string", pattern: DOCUMENT_ID_PATTERN }, "boond_documents_get")).toBe(true);
  });

  it("rejects a path segment smuggled into an update id at the tool boundary", async () => {
    const { client, close } = await connectMcpClient();
    try {
      const result = await client.callTool({
        name: "boond_candidates_update",
        arguments: { id: "5/information", firstName: "x" },
      });
      expect(result.isError).toBe(true);
      const text = JSON.stringify(result.content);
      expect(text).toContain("numérique");
    } finally {
      await close();
    }
  });
});
