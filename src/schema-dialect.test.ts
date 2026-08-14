import { describe, it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import { stripSchemaDialect } from "./schema-dialect.js";
import { connectMcpClient, useDefaultServerSurface } from "./tools/test-helpers.js";

/**
 * Regression suite for the draft-07 `$schema` that made every tool with an
 * `outputSchema` (i.e. every `*_search`) unusable on hosts whose validator only
 * knows JSON Schema 2020-12. See `schema-dialect.ts` for the full story.
 */

useDefaultServerSurface();

/** Collect every JSON Pointer at which a `$schema` string still appears. */
function dialectDeclarations(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => dialectDeclarations(item, `${path}/${i}`));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, member]) =>
    key === "$schema" && typeof member === "string"
      ? [`${path}/$schema`]
      : dialectDeclarations(member, `${path}/${key}`)
  );
}

describe("stripSchemaDialect", () => {
  it("removes the dialect declaration at the root", () => {
    expect(stripSchemaDialect({ $schema: "http://json-schema.org/draft-07/schema#", type: "object" })).toEqual({
      type: "object",
    });
  });

  it("removes nested declarations too (arrays and objects)", () => {
    const stripped = stripSchemaDialect({
      type: "object",
      properties: { a: { $schema: "x", type: "string" } },
      anyOf: [{ $schema: "y", type: "number" }],
    });
    expect(dialectDeclarations(stripped)).toEqual([]);
    expect(stripped).toEqual({ type: "object", properties: { a: { type: "string" } }, anyOf: [{ type: "number" }] });
  });

  it("keeps a property *named* `$schema` — a schema object is not a dialect declaration", () => {
    // Deleting this would silently drop a filter from the advertised input shape.
    const schema = { type: "object", properties: { $schema: { type: "string" } } };
    expect(stripSchemaDialect(schema)).toEqual(schema);
  });

  it("returns the input by identity when there is nothing to strip", () => {
    const schema = { type: "object", properties: { id: { type: "string" } } };
    expect(stripSchemaDialect(schema)).toBe(schema);
  });

  it("leaves non-objects untouched", () => {
    expect(stripSchemaDialect("x")).toBe("x");
    expect(stripSchemaDialect(null)).toBe(null);
    expect(stripSchemaDialect(3)).toBe(3);
  });
});

describe("advertised tool schemas (over a real client)", () => {
  it("declare no JSON Schema dialect at all", async () => {
    const { client, close } = await connectMcpClient();
    try {
      const { tools } = await client.listTools();
      const offenders = tools.flatMap((tool) => [
        ...dialectDeclarations(tool.inputSchema).map((p) => `${tool.name}.inputSchema${p}`),
        ...dialectDeclarations(tool.outputSchema).map((p) => `${tool.name}.outputSchema${p}`),
      ]);
      expect(offenders).toEqual([]);
    } finally {
      await close();
    }
  });

  it("compile under a 2020-12-only validator — the one that used to reject them", async () => {
    const { client, close } = await connectMcpClient();
    try {
      const { tools } = await client.listTools();
      // strict:false — the assertion is about *dialect* support, not about Ajv's
      // opinions on unknown keywords in a third-party schema.
      const ajv = new Ajv2020({ strict: false });
      const failures: string[] = [];
      for (const tool of tools) {
        for (const field of ["inputSchema", "outputSchema"] as const) {
          const schema = tool[field];
          if (!schema) continue;
          try {
            ajv.compile(schema);
          } catch (error) {
            failures.push(`${tool.name}.${field}: ${(error as Error).message}`);
          }
        }
      }
      expect(failures).toEqual([]);
      // Guard the guard: the suite is only meaningful while some tool actually
      // declares an outputSchema (that is the half the host validator compiles).
      expect(tools.filter((t) => t.outputSchema).length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it("still validate a real structuredContent payload under 2020-12", async () => {
    const { client, close } = await connectMcpClient();
    try {
      const { tools } = await client.listTools();
      const search = tools.find((t) => t.name === "boond_candidates_search");
      const validate = new Ajv2020({ strict: false }).compile(search!.outputSchema!);
      expect(validate({ total: 2, count: 1, items: [{ id: "42", type: "candidate", summary: "Jean Dupont" }] })).toBe(
        true
      );
      expect(validate({ items: [] })).toBe(false); // `count` is required
    } finally {
      await close();
    }
  });
});
