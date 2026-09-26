import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProjectTools } from "./projects.js";
import * as boondClient from "../services/boond-client.js";

function createMockServer() {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer;
}

function getHandler(server: McpServer, name: string) {
  const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === name);
  if (!call) throw new Error(`tool ${name} not registered`);
  return call[2] as (params: unknown) => Promise<unknown>;
}

describe("registerProjectTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates via PUT /projects/{id}/information (issue #134)", async () => {
    registerProjectTools(server);
    const apiSpy = vi
      .spyOn(boondClient, "apiRequest")
      .mockResolvedValue({ data: { id: "8", type: "project", attributes: {} } } as never);

    const handler = getHandler(server, "boond_projects_update");
    await handler({ id: "8", reference: "PRJ-2026" });

    const [path, method] = apiSpy.mock.calls[0];
    // The base resource returns 405 on PATCH; updates target the
    // /information sub-resource with PUT.
    expect(path).toBe("/projects/8/information");
    expect(method).toBe("PUT");
  });

  it("should register CRUD tools + 7 tab tools = 12 total", () => {
    registerProjectTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(12);
  });

  it("should register all CRUD tools", () => {
    registerProjectTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_projects_search");
    expect(names).toContain("boond_projects_get");
    expect(names).toContain("boond_projects_create");
    expect(names).toContain("boond_projects_update");
    expect(names).toContain("boond_projects_delete");
  });

  it("should register all 7 tab tools", () => {
    registerProjectTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_projects_information");
    expect(names).toContain("boond_projects_actions");
    expect(names).toContain("boond_projects_simulation");
    expect(names).toContain("boond_projects_deliveries_groupments");
    expect(names).toContain("boond_projects_orders");
    expect(names).toContain("boond_projects_purchases");
    expect(names).toContain("boond_projects_productivity");
  });

  it("should register tab tools as readOnly and non-destructive", () => {
    registerProjectTools(server);
    const tabCalls = vi
      .mocked(server.registerTool)
      .mock.calls.filter(
        (c) =>
          typeof c[0] === "string" &&
          [
            "boond_projects_information",
            "boond_projects_actions",
            "boond_projects_simulation",
            "boond_projects_deliveries_groupments",
            "boond_projects_orders",
            "boond_projects_purchases",
            "boond_projects_productivity",
          ].includes(c[0] as string)
      );

    expect(tabCalls).toHaveLength(7);
    for (const call of tabCalls) {
      const [, metadata] = call;
      expect(metadata.annotations?.readOnlyHint).toBe(true);
      expect(metadata.annotations?.destructiveHint).toBe(false);
    }
  });
});

describe("project handlers (#245)", () => {
  let server: McpServer;
  beforeEach(() => {
    server = createMockServer();
    registerProjectTools(server);
  });
  afterEach(() => vi.restoreAllMocks());

  it("create maps `name` to `title` and the three optional ids to relationships", async () => {
    const apiSpy = vi
      .spyOn(boondClient, "apiRequest")
      .mockResolvedValue({ data: { id: "12", type: "project", attributes: {} } } as never);
    const result = (await getHandler(
      server,
      "boond_projects_create"
    )({
      name: "Refonte SI",
      companyId: "5",
      opportunityId: "8",
      startDate: "2026-10-01",
    })) as { structuredContent: unknown };
    expect(apiSpy).toHaveBeenCalledWith("/projects", "POST", {
      data: {
        type: "project",
        attributes: { title: "Refonte SI", startDate: "2026-10-01" },
        relationships: {
          company: { data: { id: "5", type: "company" } },
          opportunity: { data: { id: "8", type: "opportunity" } },
        },
      },
    });
    expect(result.structuredContent).toEqual({ id: "12", type: "project" });
  });

  it("create without any id sends no relationships key", async () => {
    const apiSpy = vi
      .spyOn(boondClient, "apiRequest")
      .mockResolvedValue({ data: { id: "13", type: "project", attributes: {} } } as never);
    await getHandler(server, "boond_projects_create")({ name: "Seul" });
    expect(apiSpy.mock.calls[0][2]).toEqual({ data: { type: "project", attributes: { title: "Seul" } } });
  });

  it("update maps `name` to `title` and carries the id in the body", async () => {
    const apiSpy = vi
      .spyOn(boondClient, "apiRequest")
      .mockResolvedValue({ data: { id: "8", type: "project", attributes: {} } } as never);
    await getHandler(server, "boond_projects_update")({ id: "8", name: "Nouveau nom" });
    expect(apiSpy.mock.calls[0][2]).toEqual({
      data: { type: "project", id: "8", attributes: { title: "Nouveau nom" } },
    });
  });

  it("each tab tool reads `/projects/{id}/{tab}` with the API spelling", async () => {
    const apiSpy = vi.spyOn(boondClient, "apiRequest").mockResolvedValue({ data: [] } as never);
    await getHandler(server, "boond_projects_deliveries_groupments")({ id: "8" });
    await getHandler(server, "boond_projects_simulation")({ id: "8" });
    expect(apiSpy.mock.calls.map((c) => c[0])).toEqual(["/projects/8/deliveries-groupments", "/projects/8/simulation"]);
  });

  it("get with a tab reads the tab, without one the base record", async () => {
    const apiSpy = vi
      .spyOn(boondClient, "apiRequest")
      .mockResolvedValue({ data: { id: "8", type: "project", attributes: {} } } as never);
    await getHandler(server, "boond_projects_get")({ id: "8", tab: "information" });
    await getHandler(server, "boond_projects_get")({ id: "8" });
    expect(apiSpy.mock.calls.map((c) => c[0])).toEqual(["/projects/8/information", "/projects/8"]);
  });
});
