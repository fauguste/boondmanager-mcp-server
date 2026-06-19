import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerOpportunityTools } from "./opportunities.js";
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

describe("registerOpportunityTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("should register CRUD tools + 5 tab tools = 10 total", () => {
    registerOpportunityTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(10);
  });

  it("should register all CRUD tools", () => {
    registerOpportunityTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_opportunities_search");
    expect(names).toContain("boond_opportunities_get");
    expect(names).toContain("boond_opportunities_create");
    expect(names).toContain("boond_opportunities_update");
    expect(names).toContain("boond_opportunities_delete");
  });

  it("should register all 5 tab tools", () => {
    registerOpportunityTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_opportunities_information");
    expect(names).toContain("boond_opportunities_actions");
    expect(names).toContain("boond_opportunities_positionings");
    expect(names).toContain("boond_opportunities_projects");
    expect(names).toContain("boond_opportunities_simulation");
  });

  it("should register tab tools as readOnly and non-destructive", () => {
    registerOpportunityTools(server);
    const tabCalls = vi
      .mocked(server.registerTool)
      .mock.calls.filter(
        (c) =>
          typeof c[0] === "string" &&
          [
            "boond_opportunities_information",
            "boond_opportunities_actions",
            "boond_opportunities_positionings",
            "boond_opportunities_projects",
            "boond_opportunities_simulation",
          ].includes(c[0] as string)
      );

    expect(tabCalls).toHaveLength(5);
    for (const call of tabCalls) {
      const [, metadata] = call;
      expect(metadata.annotations?.readOnlyHint).toBe(true);
      expect(metadata.annotations?.destructiveHint).toBe(false);
    }
  });

  // Regression for issue #113: `name` must be sent to the Boond API as
  // `/data/attributes/title`, otherwise POST /opportunities returns
  // "1017 - Missing required attribute (parameter: /data/attributes/title)".
  describe("name → title mapping (issue #113)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("maps `name` to `title` on create and keeps relationships", async () => {
      registerOpportunityTools(server);
      const apiSpy = vi
        .spyOn(boondClient, "apiRequest")
        .mockResolvedValue({ data: { id: "7", type: "opportunity", attributes: {} } } as never);

      const handler = getHandler(server, "boond_opportunities_create");
      await handler({ name: "Test opportunity", companyId: "12", contactId: "34" });

      const [path, method, body] = apiSpy.mock.calls[0];
      expect(path).toBe("/opportunities");
      expect(method).toBe("POST");
      const data = (
        body as {
          data: {
            attributes: Record<string, unknown>;
            relationships: Record<string, unknown>;
          };
        }
      ).data;
      expect(data.attributes.title).toBe("Test opportunity");
      expect(data.attributes.name).toBeUndefined();
      expect(data.relationships.company).toEqual({ data: { id: "12", type: "company" } });
      expect(data.relationships.contact).toEqual({ data: { id: "34", type: "contact" } });
    });

    it("maps `name` to `title` on update via PUT /opportunities/{id}/information (issue #124)", async () => {
      registerOpportunityTools(server);
      const apiSpy = vi
        .spyOn(boondClient, "apiRequest")
        .mockResolvedValue({ data: { id: "7", type: "opportunity", attributes: {} } } as never);

      const handler = getHandler(server, "boond_opportunities_update");
      await handler({ id: "7", name: "Renamed" });

      const [path, method, body] = apiSpy.mock.calls[0];
      // The base resource returns 405 on PATCH; updates target the
      // /information sub-resource with PUT.
      expect(path).toBe("/opportunities/7/information");
      expect(method).toBe("PUT");
      const attrs = (body as { data: { attributes: Record<string, unknown> } }).data.attributes;
      expect(attrs.title).toBe("Renamed");
      expect(attrs.name).toBeUndefined();
    });

    it("omits `title` on update when `name` is not provided", async () => {
      registerOpportunityTools(server);
      const apiSpy = vi
        .spyOn(boondClient, "apiRequest")
        .mockResolvedValue({ data: { id: "7", type: "opportunity", attributes: {} } } as never);

      const handler = getHandler(server, "boond_opportunities_update");
      await handler({ id: "7", note: "just a note" });

      const [, , body] = apiSpy.mock.calls[0];
      const attrs = (body as { data: { attributes: Record<string, unknown> } }).data.attributes;
      expect(attrs).not.toHaveProperty("title");
    });
  });

  // Regression for issue #124: create/update must expose the main opportunity
  // fields and map them to the correct API attributes / relationships.
  describe("extended fields (issue #124)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    function bodyOf(call: unknown[]): {
      attributes: Record<string, unknown>;
      relationships: Record<string, unknown>;
    } {
      return (call[2] as { data: { attributes: Record<string, unknown>; relationships: Record<string, unknown> } })
        .data;
    }

    it("maps typeOf/criteria/expertiseArea/turnover attributes and note→description on create", async () => {
      registerOpportunityTools(server);
      const apiSpy = vi
        .spyOn(boondClient, "apiRequest")
        .mockResolvedValue({ data: { id: "9", type: "opportunity", attributes: {} } } as never);

      const handler = getHandler(server, "boond_opportunities_create");
      await handler({
        name: "Full opp",
        typeOf: 3,
        note: "Mission description",
        criteria: "React, 5 ans",
        expertiseArea: "developpementweb",
        turnoverEstimatedExcludingTax: 120000,
      });

      const { attributes } = bodyOf(apiSpy.mock.calls[0]);
      expect(attributes.title).toBe("Full opp");
      expect(attributes.typeOf).toBe(3);
      expect(attributes.description).toBe("Mission description");
      expect(attributes.note).toBeUndefined();
      expect(attributes.criteria).toBe("React, 5 ans");
      expect(attributes.expertiseArea).toBe("developpementweb");
      expect(attributes.turnoverEstimatedExcludingTax).toBe(120000);
    });

    it("maps pole/hrManager/mainManager/agency ids to relationships on create", async () => {
      registerOpportunityTools(server);
      const apiSpy = vi
        .spyOn(boondClient, "apiRequest")
        .mockResolvedValue({ data: { id: "9", type: "opportunity", attributes: {} } } as never);

      const handler = getHandler(server, "boond_opportunities_create");
      await handler({
        name: "Rel opp",
        poleId: "5",
        hrManagerId: "11",
        mainManagerId: "12",
        agencyId: "2",
      });

      const { relationships } = bodyOf(apiSpy.mock.calls[0]);
      expect(relationships.pole).toEqual({ data: { id: "5", type: "pole" } });
      expect(relationships.hrManager).toEqual({ data: { id: "11", type: "resource" } });
      expect(relationships.mainManager).toEqual({ data: { id: "12", type: "resource" } });
      expect(relationships.agency).toEqual({ data: { id: "2", type: "agency" } });
    });

    it("forwards extended fields on update (PUT /information)", async () => {
      registerOpportunityTools(server);
      const apiSpy = vi
        .spyOn(boondClient, "apiRequest")
        .mockResolvedValue({ data: { id: "7", type: "opportunity", attributes: {} } } as never);

      const handler = getHandler(server, "boond_opportunities_update");
      await handler({ id: "7", typeOf: 2, criteria: "Java", poleId: "8" });

      const [path, method] = apiSpy.mock.calls[0];
      expect(path).toBe("/opportunities/7/information");
      expect(method).toBe("PUT");
      const { attributes, relationships } = bodyOf(apiSpy.mock.calls[0]);
      expect(attributes.typeOf).toBe(2);
      expect(attributes.criteria).toBe("Java");
      expect(relationships.pole).toEqual({ data: { id: "8", type: "pole" } });
    });
  });
});
