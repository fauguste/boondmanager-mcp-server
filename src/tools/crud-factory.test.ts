import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildJsonApiBody,
  buildListStructured,
  registerSearchTool,
  registerGetTool,
  registerCreateTool,
  registerUpdateTool,
  registerDeleteTool,
} from "./crud-factory.js";
import { apiRequest } from "../services/boond-client.js";
import { z } from "zod";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

function createMockServer() {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer;
}

interface ElicitResult {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
}

/** Mock server whose underlying Server declares (or not) the elicitation capability. */
function createMockServerWithClient(elicitation: boolean, elicitResult?: ElicitResult | Error) {
  const elicitInput = vi.fn(async () => {
    if (elicitResult instanceof Error) throw elicitResult;
    return elicitResult ?? { action: "accept", content: { confirm: true } };
  });
  const server = {
    registerTool: vi.fn(),
    server: {
      getClientCapabilities: vi.fn(() => (elicitation ? { elicitation: {} } : {})),
      elicitInput,
    },
  } as unknown as McpServer;
  return { server, elicitInput };
}

/** Grab the registered handler for the first registerTool call. */
function registeredHandler(server: McpServer): (params: unknown) => Promise<{
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
}> {
  return vi.mocked(server.registerTool).mock.calls[0][2] as never;
}

const OPTS = {
  entityName: "test-entity",
  entityNamePlural: "test-entities",
  apiPath: "/tests",
  prefix: "boond_tests",
};

describe("buildJsonApiBody", () => {
  it("should build correct JSON:API structure", () => {
    const result = buildJsonApiBody("candidate", { firstName: "Jean", lastName: "Dupont" });
    expect(result).toEqual({
      data: {
        type: "candidate",
        attributes: { firstName: "Jean", lastName: "Dupont" },
      },
    });
  });

  it("should include id when provided", () => {
    const result = buildJsonApiBody("candidate", { firstName: "Jean" }, "123") as {
      data: { id: string; type: string; attributes: Record<string, unknown> };
    };
    expect(result.data.id).toBe("123");
  });

  it("should filter out undefined values", () => {
    const result = buildJsonApiBody("candidate", {
      firstName: "Jean",
      lastName: undefined,
      city: "Paris",
    }) as { data: { attributes: Record<string, unknown> } };
    expect(result.data.attributes).toEqual({ firstName: "Jean", city: "Paris" });
    expect(result.data.attributes).not.toHaveProperty("lastName");
  });

  it("should handle empty attributes", () => {
    const result = buildJsonApiBody("candidate", {}) as {
      data: { attributes: Record<string, unknown> };
    };
    expect(result.data.attributes).toEqual({});
  });

  it("should wrap relationships in JSON:API data envelopes", () => {
    const result = buildJsonApiBody("invoice", { amount: 100 }, undefined, {
      company: { id: "7", type: "company" },
      project: { id: "9", type: "project" },
    }) as { data: { relationships: Record<string, unknown> } };
    expect(result.data.relationships).toEqual({
      company: { data: { id: "7", type: "company" } },
      project: { data: { id: "9", type: "project" } },
    });
  });

  it("should skip undefined relationships and omit the key entirely when none remain", () => {
    const result = buildJsonApiBody("invoice", { amount: 100 }, undefined, {
      company: { id: "7", type: "company" },
      project: undefined,
    }) as { data: { relationships?: Record<string, unknown> } };
    expect(result.data.relationships).toEqual({ company: { data: { id: "7", type: "company" } } });

    const none = buildJsonApiBody("invoice", { amount: 100 }, undefined, {
      company: undefined,
    }) as { data: Record<string, unknown> };
    expect(none.data).not.toHaveProperty("relationships");
  });
});

describe("registerSearchTool", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("should register a tool with correct name", () => {
    registerSearchTool(server, OPTS);
    expect(server.registerTool).toHaveBeenCalledOnce();
    const [name] = vi.mocked(server.registerTool).mock.calls[0];
    expect(name).toBe("boond_tests_search");
  });

  it("should register with readOnly annotations", () => {
    registerSearchTool(server, OPTS);
    const [, metadata] = vi.mocked(server.registerTool).mock.calls[0];
    expect(metadata.annotations?.readOnlyHint).toBe(true);
    expect(metadata.annotations?.destructiveHint).toBe(false);
  });
});

describe("registerGetTool", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("should register a tool with correct name", () => {
    registerGetTool(server, OPTS);
    const [name] = vi.mocked(server.registerTool).mock.calls[0];
    expect(name).toBe("boond_tests_get");
  });

  it("should register with readOnly annotations", () => {
    registerGetTool(server, OPTS);
    const [, metadata] = vi.mocked(server.registerTool).mock.calls[0];
    expect(metadata.annotations?.readOnlyHint).toBe(true);
  });
});

describe("registerCreateTool", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("should register a tool with correct name", () => {
    const schema = z.object({ name: z.string() });
    registerCreateTool(server, OPTS, schema, (p) => buildJsonApiBody("test", p));
    const [name] = vi.mocked(server.registerTool).mock.calls[0];
    expect(name).toBe("boond_tests_create");
  });

  it("should register with non-readOnly, non-destructive annotations", () => {
    const schema = z.object({ name: z.string() });
    registerCreateTool(server, OPTS, schema, (p) => buildJsonApiBody("test", p));
    const [, metadata] = vi.mocked(server.registerTool).mock.calls[0];
    expect(metadata.annotations?.readOnlyHint).toBe(false);
    expect(metadata.annotations?.destructiveHint).toBe(false);
  });
});

describe("registerUpdateTool", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("should register a tool with correct name", () => {
    const schema = z.object({ id: z.string(), name: z.string().optional() });
    registerUpdateTool(server, OPTS, schema, (p) => buildJsonApiBody("test", p));
    const [name] = vi.mocked(server.registerTool).mock.calls[0];
    expect(name).toBe("boond_tests_update");
  });

  it("should register as idempotent", () => {
    const schema = z.object({ id: z.string() });
    registerUpdateTool(server, OPTS, schema, (p) => buildJsonApiBody("test", p));
    const [, metadata] = vi.mocked(server.registerTool).mock.calls[0];
    expect(metadata.annotations?.idempotentHint).toBe(true);
  });
});

describe("registerDeleteTool", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("should register a tool with correct name", () => {
    registerDeleteTool(server, OPTS);
    const [name] = vi.mocked(server.registerTool).mock.calls[0];
    expect(name).toBe("boond_tests_delete");
  });

  it("should register with destructive annotation", () => {
    registerDeleteTool(server, OPTS);
    const [, metadata] = vi.mocked(server.registerTool).mock.calls[0];
    expect(metadata.annotations?.destructiveHint).toBe(true);
  });
});

describe("structured output registration", () => {
  it("search/create/update/delete declare an outputSchema, get does not", () => {
    const server = createMockServer();
    registerSearchTool(server, OPTS);
    registerGetTool(server, OPTS);
    registerCreateTool(server, OPTS, z.object({ name: z.string() }), (p) => buildJsonApiBody("test", p));
    registerUpdateTool(server, OPTS, z.object({ id: z.string() }), (p) => buildJsonApiBody("test", p));
    registerDeleteTool(server, OPTS);
    const byName = new Map(vi.mocked(server.registerTool).mock.calls.map((c) => [c[0], c[1]]));
    expect(byName.get("boond_tests_search")?.outputSchema).toBeDefined();
    expect(byName.get("boond_tests_create")?.outputSchema).toBeDefined();
    expect(byName.get("boond_tests_update")?.outputSchema).toBeDefined();
    expect(byName.get("boond_tests_delete")?.outputSchema).toBeDefined();
    // Detail tools stay text-only: their text already is the full JSON and
    // duplicating it as structuredContent would double the payload.
    expect(byName.get("boond_tests_get")?.outputSchema).toBeUndefined();
  });
});

describe("registerSearchTool handler", () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
  });

  const RESPONSE = {
    data: [
      {
        id: "1",
        type: "candidate",
        attributes: { firstName: "Jean", lastName: "Dupont", title: "Dev", city: "Paris" },
      },
      { id: "2", type: "candidate", attributes: { firstName: "Anna", lastName: "Martin", title: "PO" } },
    ],
    meta: { totals: { rows: 42 } },
  };

  it("returns text summary plus compact structuredContent", async () => {
    vi.mocked(apiRequest).mockResolvedValue(RESPONSE);
    const server = createMockServer();
    registerSearchTool(server, OPTS);
    const result = await registeredHandler(server)({ keywords: "dupont" });
    expect(result.content[0].text).toContain("Jean Dupont");
    const structured = result.structuredContent as {
      total: number;
      count: number;
      items: Array<Record<string, unknown>>;
    };
    expect(structured.total).toBe(42);
    expect(structured.count).toBe(2);
    expect(structured.items[0]).toMatchObject({ id: "1", type: "candidate" });
    expect(typeof structured.items[0].summary).toBe("string");
    expect(structured.items[0].attributes).toBeUndefined();
  });

  it("projects `fields` into both text and structuredContent, and keeps it out of the API query", async () => {
    vi.mocked(apiRequest).mockResolvedValue(RESPONSE);
    const server = createMockServer();
    registerSearchTool(server, OPTS);
    const result = await registeredHandler(server)({ keywords: "dupont", fields: ["title", "unknownField"] });
    // Text: one line per item, restricted to the projected fields
    expect(result.content[0].text).toContain("title: Dev");
    expect(result.content[0].text).not.toContain("Email");
    // Structured: attributes instead of summary, unknown names skipped
    const structured = result.structuredContent as { items: Array<Record<string, unknown>> };
    expect(structured.items[0].attributes).toEqual({ title: "Dev" });
    expect(structured.items[0].summary).toBeUndefined();
    // API query: `fields` is client-side only
    const [, , , query] = vi.mocked(apiRequest).mock.calls[0];
    expect(query).not.toHaveProperty("fields");
    expect(query).not.toHaveProperty("fields[]");
  });
});

describe("buildListStructured", () => {
  it("handles single-resource responses and missing meta", () => {
    const structured = buildListStructured({ data: { id: "7", type: "project", attributes: { name: "X" } } });
    expect(structured.total).toBeUndefined();
    expect(structured.count).toBe(1);
    expect(structured.items[0].id).toBe("7");
  });
});

describe("registerDeleteTool handler (elicitation)", () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    delete process.env.BOOND_MCP_CONFIRM_DELETE;
  });

  it("deletes without prompting when the client lacks the elicitation capability", async () => {
    const { server, elicitInput } = createMockServerWithClient(false);
    registerDeleteTool(server, OPTS);
    const result = await registeredHandler(server)({ id: "12" });
    expect(elicitInput).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledWith("/tests/12", "DELETE");
    expect(result.structuredContent).toEqual({ id: "12", deleted: true });
  });

  it("deletes after an accepted confirmation", async () => {
    const { server, elicitInput } = createMockServerWithClient(true, { action: "accept", content: { confirm: true } });
    registerDeleteTool(server, OPTS);
    const result = await registeredHandler(server)({ id: "12" });
    expect(elicitInput).toHaveBeenCalledOnce();
    expect(apiRequest).toHaveBeenCalledWith("/tests/12", "DELETE");
    expect(result.structuredContent).toEqual({ id: "12", deleted: true });
  });

  it("aborts when the user declines", async () => {
    const { server } = createMockServerWithClient(true, { action: "decline" });
    registerDeleteTool(server, OPTS);
    const result = await registeredHandler(server)({ id: "12" });
    expect(apiRequest).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({ id: "12", deleted: false, reason: "decline" });
    expect(result.content[0].text).toContain("annulée");
  });

  it("aborts when the user answers confirm=false", async () => {
    const { server } = createMockServerWithClient(true, { action: "accept", content: { confirm: false } });
    registerDeleteTool(server, OPTS);
    const result = await registeredHandler(server)({ id: "12" });
    expect(apiRequest).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({ id: "12", deleted: false, reason: "confirm=false" });
  });

  it("falls back to deleting when the elicitation round-trip fails", async () => {
    const { server } = createMockServerWithClient(true, new Error("transport does not support server requests"));
    registerDeleteTool(server, OPTS);
    const result = await registeredHandler(server)({ id: "12" });
    expect(apiRequest).toHaveBeenCalledWith("/tests/12", "DELETE");
    expect(result.structuredContent).toEqual({ id: "12", deleted: true });
  });

  it("skips the prompt entirely when BOOND_MCP_CONFIRM_DELETE is disabled", async () => {
    process.env.BOOND_MCP_CONFIRM_DELETE = "0";
    const { server, elicitInput } = createMockServerWithClient(true);
    registerDeleteTool(server, OPTS);
    await registeredHandler(server)({ id: "12" });
    expect(elicitInput).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledWith("/tests/12", "DELETE");
  });

  it("works against a bare mock server without a `server` property (legacy tests)", async () => {
    const server = createMockServer();
    registerDeleteTool(server, OPTS);
    const result = await registeredHandler(server)({ id: "12" });
    expect(result.structuredContent).toEqual({ id: "12", deleted: true });
  });
});

describe("registerCreateTool / registerUpdateTool handlers", () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
  });

  it("create returns the new entity reference as structuredContent", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "99", type: "test", attributes: {} } });
    const server = createMockServer();
    registerCreateTool(server, OPTS, z.object({ name: z.string() }), (p) => buildJsonApiBody("test", p));
    const result = await registeredHandler(server)({ name: "X" });
    expect(result.structuredContent).toEqual({ id: "99", type: "test" });
  });

  it("update returns the entity reference as structuredContent", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "99", type: "test", attributes: {} } });
    const server = createMockServer();
    registerUpdateTool(server, OPTS, z.object({ id: z.string() }), (p) => buildJsonApiBody("test", p));
    const result = await registeredHandler(server)({ id: "99" });
    expect(result.structuredContent).toEqual({ id: "99", type: "test" });
  });
});
