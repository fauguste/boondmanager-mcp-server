import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import * as z4mini from "zod/v4-mini";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withFilterHints, withValidationFeedback, isSearchTool } from "./validation-wrapper.js";
import { decorateRegistrations, createRegistrationIndex } from "./registration-decorators.js";
import { ResourceSearchSchema, CandidateSearchSchema, InvoiceSearchSchema, SearchSchema } from "../schemas/index.js";
import { MAX_SEARCH_PAGE } from "../constants.js";

/** Messages as the SDK would surface them: every issue message, newline-joined. */
function messagesOf(schema: z.ZodType, input: unknown): string {
  const parsed = schema.safeParse(input);
  expect(parsed.success).toBe(false);
  return (parsed.error?.issues ?? []).map((i) => i.message).join("\n");
}

const jsonSchemaOf = (schema: unknown) =>
  JSON.stringify(z4mini.toJSONSchema(schema as never, { target: "draft-7", io: "input" }));

describe("withFilterHints", () => {
  it("turns an unknown filter into a named correction", () => {
    const schema = withFilterHints(ResourceSearchSchema, "resources");
    const msg = messagesOf(schema, { mainManagers: [42] });
    expect(msg).toContain("mainManagers");
    expect(msg).toContain("perimeterManagers");
  });

  it("uses the endpoint's own state filter name", () => {
    expect(messagesOf(withFilterHints(ResourceSearchSchema, "resources"), { states: [1] })).toContain("resourceStates");
    // Same wrong key, different endpoint, different correction.
    const candidateSchema = withFilterHints(CandidateSearchSchema, "candidates");
    expect(messagesOf(candidateSchema, { states: [1] })).toContain("candidateStates");
  });

  /**
   * The wrapper runs on every search tool, not just the six perimeter-aware
   * ones, and the alias table is written for those. Naming a replacement the
   * endpoint also rejects costs the model a second rejection, after which it
   * typically drops the filter — and reports an unscoped list as a scoped one.
   */
  it("never names a replacement the endpoint does not accept", () => {
    const msg = messagesOf(withFilterHints(InvoiceSearchSchema), { agencies: [3] });
    expect(msg).toContain("agencies");
    expect(msg).not.toContain("perimeterAgencies");
    expect(msg).toContain("non supporté par cet endpoint");
    // …while the endpoint that DOES accept it still gets the correction.
    expect(messagesOf(withFilterHints(ResourceSearchSchema, "resources"), { agencies: [3] })).toContain(
      "perimeterAgencies"
    );
  });

  it("keeps an endpoint-specific 'no such filter' hint (it names no replacement)", () => {
    const msg = messagesOf(withFilterHints(ResourceSearchSchema, "companies"), { typeOf: [1] });
    expect(msg).toContain("aucun filtre de type");
  });

  it("caps the correction lines instead of emitting one per stray key", () => {
    const junk = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`zzUnknown${i}`, 1]));
    const msg = messagesOf(withFilterHints(SearchSchema), junk);
    const corrections = msg.split("\n").filter((l) => l.startsWith("Filtre inconnu"));
    expect(corrections.length).toBeLessThanOrEqual(6);
    expect(msg).toContain("autre(s) filtre(s) inconnu(s)");
  });

  it("does not treat a prototype property name as a known filter", () => {
    for (const key of ["constructor", "toString", "hasOwnProperty", "valueOf"]) {
      const msg = messagesOf(withFilterHints(ResourceSearchSchema, "resources"), { [key]: 1 });
      expect(msg, key).toContain("non supporté par cet endpoint");
      expect(msg, key).not.toContain("undefined");
    }
  });

  it("points entity-id filters at entity search, not at the dictionary", () => {
    const msg = messagesOf(withFilterHints(ResourceSearchSchema, "resources"), { perimeterManagers: ["Jean Dupont"] });
    expect(msg).toContain("boond_resources_search");
    expect(msg).toContain("pas via `boond://dictionary/*`");
    // …while a genuinely dictionary-backed filter still sends it there.
    const dictMsg = messagesOf(withFilterHints(ResourceSearchSchema, "resources"), { resourceStates: ["actif"] });
    expect(dictMsg).toContain("résoudre l'ID via les ressources `boond://dictionary/*`");
  });

  it("leaves the advertised JSON Schema byte-for-byte identical", () => {
    expect(jsonSchemaOf(withFilterHints(ResourceSearchSchema, "resources"))).toBe(jsonSchemaOf(ResourceSearchSchema));
    expect(jsonSchemaOf(withFilterHints(SearchSchema))).toBe(jsonSchemaOf(SearchSchema));
  });

  it("still accepts valid input, defaults included", () => {
    const schema = withFilterHints(SearchSchema);
    const parsed = schema.safeParse({ keywords: "dupont" });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ keywords: "dupont", page: 1 });
  });

  it("does not touch field-level messages (the page ceiling keeps its own)", () => {
    const msg = messagesOf(withFilterHints(SearchSchema), { page: 500 });
    expect(msg).toContain(String(MAX_SEARCH_PAGE));
    expect(msg).toContain("MAX_SEARCH_PAGE");
  });

  it("explains that dictionary filters take integer ids, with the resolution path", () => {
    const msg = messagesOf(withFilterHints(ResourceSearchSchema, "resources"), { resourceStates: ["actif"] });
    expect(msg).toContain("boond://dictionary");
  });

  it("returns non-strict / non-object schemas untouched", () => {
    const loose = z.object({ a: z.string().optional() });
    expect(withFilterHints(loose)).toBe(loose);
    const str = z.string();
    expect(withFilterHints(str)).toBe(str);
    const shape = { a: z.string() };
    expect(withFilterHints(shape)).toBe(shape);
  });
});

describe("isSearchTool", () => {
  it("targets search tools only", () => {
    expect(isSearchTool("boond_resources_search")).toBe(true);
    expect(isSearchTool("boond_resources_get")).toBe(false);
    expect(isSearchTool("boond_candidates_technical_data")).toBe(false);
  });

  /**
   * The reporting tools carry the same treacherous perimeter/state vocabulary but
   * are not named `*_search`; `openWorldHint` is what the codebase reserves for
   * listing tools, so keying on it covers them (and any future hand-rolled
   * search tool) instead of silently excluding them.
   */
  it("covers a listing tool that is not named *_search, via openWorldHint", () => {
    expect(isSearchTool("boond_reporting_companies", { annotations: { openWorldHint: true } })).toBe(true);
    expect(isSearchTool("boond_candidates_get", { annotations: { readOnlyHint: true } })).toBe(false);
  });
});

describe("withValidationFeedback", () => {
  it("swaps the inputSchema of a search tool and leaves the rest of the config alone", () => {
    const config = {
      title: "t",
      description: "d",
      inputSchema: ResourceSearchSchema,
      annotations: { readOnlyHint: true },
    };
    const out = withValidationFeedback("boond_resources_search", config, "resources");
    expect(out).not.toBe(config);
    expect(out.inputSchema).not.toBe(ResourceSearchSchema);
    expect(out.title).toBe("t");
    expect(out.annotations).toBe(config.annotations);
  });

  it("is a no-op (same reference) for non-search tools", () => {
    const config = { inputSchema: ResourceSearchSchema };
    expect(withValidationFeedback("boond_resources_get", config, "resources")).toBe(config);
  });

  it("is a no-op for a search tool with no input schema", () => {
    const config = { title: "t" };
    expect(withValidationFeedback("boond_x_search", config)).toBe(config);
  });
});

describe("decorateRegistrations", () => {
  function stub() {
    return { registerTool: vi.fn(), registerPrompt: vi.fn() } as unknown as McpServer;
  }

  it("records every tool against its domain (exact, no name parsing)", () => {
    const s = stub();
    const index = createRegistrationIndex();
    const wrapped = decorateRegistrations(s, "provider-invoices", index);
    wrapped.registerTool("boond_provider_invoices_search", { inputSchema: SearchSchema } as never, (() => {}) as never);
    // A tool whose name doesn't start with its domain (the workflow mirrors).
    decorateRegistrations(s, "workflows", index).registerTool("boond_workflow_x", {} as never, (() => {}) as never);
    expect(index.toolDomains.get("boond_provider_invoices_search")).toBe("provider-invoices");
    expect(index.toolDomains.get("boond_workflow_x")).toBe("workflows");
  });

  it("enriches a search tool's schema on the way through, and forwards the handler", () => {
    const s = stub();
    const handler = () => ({ content: [] });
    decorateRegistrations(s, "resources").registerTool(
      "boond_resources_search",
      { inputSchema: ResourceSearchSchema } as never,
      handler as never
    );
    const [name, config, cb] = vi.mocked(s.registerTool).mock.calls[0];
    expect(name).toBe("boond_resources_search");
    expect(cb).toBe(handler);
    const msg = messagesOf((config as { inputSchema: z.ZodType }).inputSchema, { mainManagers: [1] });
    expect(msg).toContain("perimeterManagers");
  });

  it("passes other methods straight through", () => {
    const s = stub();
    decorateRegistrations(s, "resources").registerPrompt("p", {} as never, (() => {}) as never);
    expect(vi.mocked(s.registerPrompt)).toHaveBeenCalledTimes(1);
  });
});
