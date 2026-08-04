import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import * as z4mini from "zod/v4-mini";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withFilterHints, withValidationFeedback, isSearchToolName } from "./validation-wrapper.js";
import { decorateRegistrations, createRegistrationIndex } from "./registration-decorators.js";
import { ResourceSearchSchema, SearchSchema } from "../schemas/index.js";
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
    const candidateSchema = withFilterHints(ResourceSearchSchema, "candidates");
    expect(messagesOf(candidateSchema, { states: [1] })).toContain("candidateStates");
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

describe("isSearchToolName", () => {
  it("targets search tools only", () => {
    expect(isSearchToolName("boond_resources_search")).toBe(true);
    expect(isSearchToolName("boond_resources_get")).toBe(false);
    expect(isSearchToolName("boond_candidates_technical_data")).toBe(false);
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
