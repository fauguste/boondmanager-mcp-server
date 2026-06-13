import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReportingTools } from "./reporting.js";

function createMockServer() {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer;
}

describe("registerReportingTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("should register 5 reporting tools", () => {
    registerReportingTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(5);
  });

  it("should register all expected tool names", () => {
    registerReportingTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_reporting_companies");
    expect(names).toContain("boond_reporting_projects");
    expect(names).toContain("boond_reporting_resources");
    expect(names).toContain("boond_reporting_synthesis");
    expect(names).toContain("boond_reporting_production_plans");
  });

  it("should register all tools as readOnly", () => {
    registerReportingTools(server);
    for (const call of vi.mocked(server.registerTool).mock.calls) {
      expect(call[1].annotations?.readOnlyHint).toBe(true);
    }
  });

  function shapeKeysFor(name: string): string[] {
    if (vi.mocked(server.registerTool).mock.calls.length === 0) registerReportingTools(server);
    const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === name);
    if (!call) throw new Error(`tool ${name} not registered`);
    // inputSchema is the full strict ZodObject; introspect its declared keys.
    const schema = call[1].inputSchema as unknown as { shape: Record<string, unknown> };
    return Object.keys(schema.shape);
  }

  it("should expose the shared perimeter + period filters on every endpoint", () => {
    for (const name of [
      "boond_reporting_companies",
      "boond_reporting_projects",
      "boond_reporting_resources",
      "boond_reporting_synthesis",
      "boond_reporting_production_plans",
    ]) {
      expect(shapeKeysFor(name)).toEqual(
        expect.arrayContaining(["perimeterDynamic", "perimeterManagers", "perimeterAgencies", "periodDynamic"])
      );
    }
  });

  it("should wire each endpoint's specific filters (previously dropped)", () => {
    expect(shapeKeysFor("boond_reporting_companies")).toEqual(
      expect.arrayContaining(["companiesStates", "companies", "maxCompanies", "showPercentage"])
    );
    expect(shapeKeysFor("boond_reporting_projects")).toEqual(
      expect.arrayContaining(["projectTypes", "projectStates", "maxProjects", "resources"])
    );
    expect(shapeKeysFor("boond_reporting_resources")).toEqual(
      expect.arrayContaining(["reportingCategory", "resourceStates", "period", "maxResources"])
    );
    expect(shapeKeysFor("boond_reporting_synthesis")).toEqual(
      expect.arrayContaining(["reportingType", "reportingCategory", "compareIndicators"])
    );
    expect(shapeKeysFor("boond_reporting_production_plans")).toEqual(
      expect.arrayContaining(["positioningStates", "positioningPeriod", "showContracts"])
    );
  });
});
