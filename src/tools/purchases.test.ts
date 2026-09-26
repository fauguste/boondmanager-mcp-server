import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildPurchaseBody, registerPurchaseTools } from "./purchases.js";
import { apiRequest, apiSearch } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn(), apiSearch: vi.fn() };
});

function createMockServer() {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer;
}

describe("registerPurchaseTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("should register 5 purchase tools (search/get/create/delete + information tab)", () => {
    registerPurchaseTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(5);
  });

  it("should register all expected tool names", () => {
    registerPurchaseTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_purchases_search");
    expect(names).toContain("boond_purchases_get");
    expect(names).toContain("boond_purchases_create");
    expect(names).toContain("boond_purchases_delete");
    expect(names).toContain("boond_purchases_information");
  });

  it("should register search and get as readOnly", () => {
    registerPurchaseTools(server);
    const readOnlyCalls = vi
      .mocked(server.registerTool)
      .mock.calls.filter(
        (c) => typeof c[0] === "string" && ["boond_purchases_search", "boond_purchases_get"].includes(c[0] as string)
      );
    for (const call of readOnlyCalls) {
      expect(call[1].annotations?.readOnlyHint).toBe(true);
    }
  });

  it("should register delete as destructive", () => {
    registerPurchaseTools(server);
    const deleteCall = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_purchases_delete");
    expect(deleteCall?.[1].annotations?.destructiveHint).toBe(true);
  });

  it("should register create as non-readOnly and non-destructive", () => {
    registerPurchaseTools(server);
    const createCall = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_purchases_create");
    expect(createCall?.[1].annotations?.readOnlyHint).toBe(false);
    expect(createCall?.[1].annotations?.destructiveHint).toBe(false);
  });
});

describe("purchase handlers (#245)", () => {
  let server: McpServer;
  const handler = (name: string) =>
    vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === name)![2] as (
      p: unknown,
      extra?: unknown
    ) => Promise<{ content: Array<{ text: string }>; structuredContent?: Record<string, unknown> }>;

  beforeEach(() => {
    server = { registerTool: vi.fn() } as unknown as McpServer;
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiSearch).mockReset();
    registerPurchaseTools(server);
  });

  it("buildPurchaseBody turns the optional ids into relationships and drops the absent ones", () => {
    expect(buildPurchaseBody({ title: "Sous-traitance", companyId: "5", projectId: "9", state: 1 })).toEqual({
      data: {
        type: "purchase",
        attributes: { title: "Sous-traitance", state: 1 },
        relationships: {
          company: { data: { id: "5", type: "company" } },
          project: { data: { id: "9", type: "project" } },
        },
      },
    });
    expect(buildPurchaseBody({ title: "Seul" })).toEqual({ data: { type: "purchase", attributes: { title: "Seul" } } });
  });

  it("search goes through apiSearch on /purchases with companyId as a CSOC keyword", async () => {
    vi.mocked(apiSearch).mockResolvedValue({ data: [], meta: { totals: { rows: 0 } } } as never);
    await handler("boond_purchases_search")({ companyId: "6221", page: 1, pageSize: 30 });
    const [path, query] = vi.mocked(apiSearch).mock.calls[0];
    expect(path).toBe("/purchases");
    expect(query).toMatchObject({ keywords: "CSOC6221", page: 1, maxResults: 30 });
    expect(query).not.toHaveProperty("companyId");
  });

  it("get reads /purchases/{id}", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "4", type: "purchase", attributes: {} } } as never);
    const result = await handler("boond_purchases_get")({ id: "4" });
    expect(vi.mocked(apiRequest).mock.calls[0][0]).toBe("/purchases/4");
    expect(result.content[0].text).toContain('"id": "4"');
  });

  it("create POSTs the JSON:API body and returns the new id as structuredContent", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "77", type: "purchase", attributes: {} } } as never);
    const result = await handler("boond_purchases_create")({ title: "Achat", contactId: "3" });
    expect(apiRequest).toHaveBeenCalledWith("/purchases", "POST", {
      data: {
        type: "purchase",
        attributes: { title: "Achat" },
        relationships: { contact: { data: { id: "3", type: "contact" } } },
      },
    });
    expect(result.structuredContent).toEqual({ id: "77", type: "purchase" });
  });
});
