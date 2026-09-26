import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMockServer, registeredToolNames, toolCallback } from "./test-helpers.js";
import { buildAdvantageBody, registerAdvantageTools } from "./advantages.js";
import { apiRequest } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn(), apiSearch: vi.fn() };
});

describe("registerAdvantageTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ data: [] } as never);
  });

  it("registers search, default, create and get — the reads read-only (#254)", () => {
    registerAdvantageTools(server);
    expect(registeredToolNames(server)).toEqual([
      "boond_advantages_search",
      "boond_advantages_default",
      "boond_advantages_create",
      "boond_advantages_get",
    ]);
    for (const call of vi.mocked(server.registerTool).mock.calls) {
      expect(call[1].annotations?.readOnlyHint).toBe(call[0] !== "boond_advantages_create");
    }
  });

  // `GET /advantages` does not exist — the live API answers a WAF 403 page and
  // the RAML only documents POST there; the list lives under the resource
  // (issue #247).
  it("lists a resource's advantages through /resources/{id}/advantages, never GET /advantages", async () => {
    registerAdvantageTools(server);
    await toolCallback(
      server,
      "boond_advantages_search"
    )({
      resourceId: "47182",
      advantageTypes: ["2_1"],
      page: 2,
      pageSize: 10,
    });
    const [path, method, , query] = vi.mocked(apiRequest).mock.calls[0];
    expect(path).toBe("/resources/47182/advantages");
    expect(method).toBe("GET");
    expect(query).toMatchObject({ advantageTypes: ["2_1"], page: 2, maxResults: 10 });
    expect(query).not.toHaveProperty("resourceId");
  });

  it("requires resourceId in the advertised schema", () => {
    registerAdvantageTools(server);
    const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_advantages_search")!;
    const schema = call[1].inputSchema as unknown as { safeParse: (v: unknown) => { success: boolean } };
    expect(schema.safeParse({ page: 1 }).success).toBe(false);
    expect(schema.safeParse({ resourceId: "5" }).success).toBe(true);
    expect(schema.safeParse({ resourceId: "5", keywords: "x" }).success).toBe(false);
  });

  it("get reads /advantages/{id}", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "9", type: "advantage", attributes: {} } } as never);
    registerAdvantageTools(server);
    await toolCallback(server, "boond_advantages_get")({ id: "9" });
    expect(vi.mocked(apiRequest).mock.calls[0][0]).toBe("/advantages/9");
  });
});

describe("boond_advantages_default / _create (issue #254)", () => {
  let server: McpServer;
  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "12", type: "advantage", attributes: {} } } as never);
  });

  it("registers the default and create tools alongside search and get", () => {
    registerAdvantageTools(server);
    expect(registeredToolNames(server)).toEqual(
      expect.arrayContaining([
        "boond_advantages_default",
        "boond_advantages_create",
        "boond_advantages_search",
        "boond_advantages_get",
      ])
    );
  });

  it("default reads GET /advantages/default with the given ids", async () => {
    registerAdvantageTools(server);
    await toolCallback(server, "boond_advantages_default")({ resourceId: "18081", contractId: "3900" });
    expect(apiRequest).toHaveBeenCalledWith("/advantages/default", "GET", undefined, {
      resource: "18081",
      contract: "3900",
    });
  });

  it("create POSTs attributes + relationships built from models.advantage", async () => {
    registerAdvantageTools(server);
    const result = (await toolCallback(
      server,
      "boond_advantages_create"
    )({
      resourceId: "18081",
      advantageType: "2_1",
      date: "2026-09-01",
      quantity: 20,
      projectId: "5",
      note: "TR septembre",
    })) as { structuredContent?: Record<string, unknown> };
    expect(apiRequest).toHaveBeenCalledWith("/advantages", "POST", {
      data: {
        type: "advantage",
        attributes: { advantageType: "2_1", date: "2026-09-01", quantity: 20, informationComments: "TR septembre" },
        relationships: {
          resource: { data: { id: "18081", type: "resource" } },
          project: { data: { id: "5", type: "project" } },
        },
      },
    });
    expect(result.structuredContent).toEqual({ id: "12", type: "advantage" });
    expect(buildAdvantageBody({ resourceId: "1", advantageType: 2, date: "2026-01-01" })).toEqual({
      data: {
        type: "advantage",
        attributes: { advantageType: 2, date: "2026-01-01" },
        relationships: { resource: { data: { id: "1", type: "resource" } } },
      },
    });
  });
});
