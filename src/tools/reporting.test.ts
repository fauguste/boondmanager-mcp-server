import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReportingTools } from "./reporting.js";
import { apiRequest } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn().mockResolvedValue({ data: [] }) };
});

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

  /**
   * A reporting query is a single request, but an aggregation over a wide
   * perimeter can run for tens of seconds with nothing on the wire — the exact
   * case `notifications/progress` exists for. Hence a step on both ends,
   * whereas a plain search stays silent when it makes a single API call.
   */
  describe("progress", () => {
    function handlerOf(name: string) {
      registerReportingTools(server);
      const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === name)!;
      return call[2] as unknown as (params: unknown, extra: unknown) => Promise<unknown>;
    }

    it("brackets the request with a start and an end step", async () => {
      const sendNotification = vi.fn().mockResolvedValue(undefined);
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      await handlerOf("boond_reporting_companies")(
        { startDate: "2026-01-01", endDate: "2026-01-31" },
        { _meta: { progressToken: "t" }, sendNotification }
      );

      const params = sendNotification.mock.calls.map((c) => c[0].params);
      expect(params.map((p: { progress: number }) => p.progress)).toEqual([0, 1]);
      expect(params.every((p: { total: number }) => p.total === 1)).toBe(true);
      expect(params[0].message).toContain("en cours");
      expect(params[1].message).toContain("terminé");
    });

    it("emits nothing without a progressToken", async () => {
      const sendNotification = vi.fn();
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      await handlerOf("boond_reporting_companies")({}, { _meta: {}, sendNotification });

      expect(sendNotification).not.toHaveBeenCalled();
    });
  });
});
