import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMockServer, toolCallback } from "./test-helpers.js";
import { describeRow, isExactMatch, registerFindTool, searchAttempts } from "./find.js";
import { apiSearch } from "../services/boond-client.js";
import { resolveAccessPolicy } from "../config/access-policy.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiSearch: vi.fn() };
});

const person = (id: string, firstName: string, lastName: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "resource",
  attributes: { firstName, lastName, ...extra },
});

type FindResult = {
  isError?: boolean;
  content: Array<{ text: string }>;
  structuredContent: {
    count: number;
    match?: { id: string };
    ambiguous?: boolean;
    items: Array<{ id: string; exact: boolean }>;
  };
};

describe("boond_find (issue #262)", () => {
  let server: McpServer;
  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiSearch).mockReset();
  });

  it("tries fullName in both orders before free text, and stops at the first hit", async () => {
    vi.mocked(apiSearch)
      .mockResolvedValueOnce({ data: [] } as never)
      .mockResolvedValueOnce({ data: [person("42", "Jean", "Dupont", { email1: "j@ex.com" })] } as never);
    registerFindTool(server);
    const result = (await toolCallback(
      server,
      "boond_find"
    )({ entity: "resource", query: "Jean Dupont" })) as FindResult;
    const queries = vi.mocked(apiSearch).mock.calls.map((c) => c[1] as Record<string, unknown>);
    expect(queries[0]).toMatchObject({ keywords: "Dupont#Jean", keywordsType: "fullName", maxResults: 10 });
    expect(queries[1]).toMatchObject({ keywords: "Jean#Dupont", keywordsType: "fullName" });
    expect(apiSearch).toHaveBeenCalledTimes(2);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.match).toEqual({ id: "42", label: "Jean Dupont" });
    expect(result.content[0].text).toContain("ID 42");
  });

  it("refuses to choose between two exact homonyms (isError + list)", async () => {
    vi.mocked(apiSearch).mockResolvedValue({
      data: [person("1", "Jean", "Dupont", { title: "Dev" }), person("2", "Jean", "Dupont", { title: "PM" })],
    } as never);
    registerFindTool(server);
    const result = (await toolCallback(
      server,
      "boond_find"
    )({ entity: "candidate", query: "dupont jean" })) as FindResult;
    expect(result.isError).toBe(true);
    expect(result.structuredContent.ambiguous).toBe(true);
    expect(result.structuredContent.match).toBeUndefined();
    expect(result.content[0].text).toContain("#1 Jean Dupont (Dev)");
    expect(result.content[0].text).toContain("#2 Jean Dupont (PM)");
  });

  it("returns close results without a match when nothing is exact", async () => {
    vi.mocked(apiSearch).mockResolvedValue({ data: [person("7", "Jeanne", "Dupont")] } as never);
    registerFindTool(server);
    const result = (await toolCallback(
      server,
      "boond_find"
    )({ entity: "contact", query: "Jean Dupont" })) as FindResult;
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.match).toBeUndefined();
    expect(result.structuredContent.items[0]?.exact).toBe(false);
    expect(result.content[0].text).toContain("Aucune correspondance exacte");
  });

  it("looks people and companies up by e-mail with keywordsType emails", async () => {
    vi.mocked(apiSearch).mockResolvedValue({ data: [person("9", "Ana", "Silva", { email1: "Ana@Ex.com" })] } as never);
    registerFindTool(server);
    const result = (await toolCallback(
      server,
      "boond_find"
    )({
      entity: "resource",
      query: "ana",
      email: "ana@ex.com",
    })) as FindResult;
    expect(vi.mocked(apiSearch).mock.calls[0]?.[1]).toMatchObject({ keywords: "ana@ex.com", keywordsType: "emails" });
    expect(result.structuredContent.match?.id).toBe("9");
  });

  it("companies search on name, projects and opportunities on plain keywords", () => {
    expect(searchAttempts("company", "ACME")).toEqual([
      { keywords: "ACME", keywordsType: "name" },
      { keywords: "ACME" },
    ]);
    expect(searchAttempts("project", "Refonte SI")).toEqual([{ keywords: "Refonte SI" }]);
    expect(searchAttempts("resource", "Dupont")).toEqual([
      { keywords: "Dupont", keywordsType: "lastName" },
      { keywords: "Dupont" },
    ]);
  });

  it("labels rows per entity and matches ignoring case and accents", () => {
    const company = { id: "3", type: "company", attributes: { name: "Société Générale", town: "Paris" } };
    expect(describeRow("company", company)).toEqual({ label: "Société Générale", detail: "Paris" });
    expect(isExactMatch("company", company, { label: "Société Générale" }, "societe generale")).toBe(true);
    const project = { id: "4", type: "project", attributes: { reference: "PRJ-12", title: "Refonte SI" } };
    expect(describeRow("project", project)).toEqual({ label: "Refonte SI", detail: "PRJ-12" });
  });

  it("says so when nothing is found (not an error)", async () => {
    vi.mocked(apiSearch).mockResolvedValue({ data: [] } as never);
    registerFindTool(server);
    const result = (await toolCallback(server, "boond_find")({ entity: "opportunity", query: "Nope" })) as FindResult;
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.count).toBe(0);
  });

  it("only offers the entities the access policy allows, and is absent when none is", () => {
    const finance = resolveAccessPolicy({ BOOND_MCP_PROFILE: "finance" } as NodeJS.ProcessEnv);
    registerFindTool(server, finance);
    const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_find");
    const schema = call?.[1].inputSchema as { safeParse: (v: unknown) => { success: boolean } };
    expect(schema.safeParse({ entity: "company", query: "x" }).success).toBe(true);
    expect(schema.safeParse({ entity: "candidate", query: "x" }).success).toBe(false);

    const none = resolveAccessPolicy({ BOOND_MCP_DOMAINS: "application,agencies" } as NodeJS.ProcessEnv);
    const bare = createMockServer();
    registerFindTool(bare, none);
    expect(bare.registerTool).not.toHaveBeenCalled();
  });
});
