import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTimesheetTools, timesheetSummary } from "./timesheets.js";
import { toolCallback } from "./test-helpers.js";
import { apiRequest, apiSearch } from "../services/boond-client.js";
import { CHARACTER_LIMIT } from "../constants.js";

// Keep the real formatters: the point of #243 is that the timesheet tools go
// through `formatListResponse` and inherit its truncation / empty handling.
vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn(), apiSearch: vi.fn() };
});

function createMockServer() {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer;
}

describe("registerTimesheetTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("should register 4 timesheet tools", () => {
    registerTimesheetTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(4);
  });

  it("should register boond_resources_timesheets tool", () => {
    registerTimesheetTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_resources_timesheets");
  });

  it("should register boond_timesheets_search tool", () => {
    registerTimesheetTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_timesheets_search");
  });

  it("should register boond_timesheets_create tool", () => {
    registerTimesheetTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_timesheets_create");
  });

  it("should register boond_timesheets_get tool", () => {
    registerTimesheetTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_timesheets_get");
  });

  it("should register read tools as readOnly and create as write", () => {
    registerTimesheetTools(server);
    const calls = vi.mocked(server.registerTool).mock.calls;
    expect(calls.find((c) => c[0] === "boond_timesheets_create")?.[1].annotations?.readOnlyHint).toBe(false);
    expect(calls.find((c) => c[0] === "boond_timesheets_search")?.[1].annotations?.readOnlyHint).toBe(true);
    expect(calls.find((c) => c[0] === "boond_timesheets_get")?.[1].annotations?.readOnlyHint).toBe(true);
    expect(calls.find((c) => c[0] === "boond_resources_timesheets")?.[1].annotations?.readOnlyHint).toBe(true);
  });

  describe("list rendering through formatListResponse (#243)", () => {
    const search = (params: Record<string, unknown>) =>
      toolCallback(
        server,
        "boond_timesheets_search"
      )({ startMonth: "2026-09", endMonth: "2026-09", ...params }) as Promise<{
        content: Array<{ text: string }>;
      }>;

    it("formats one line per report with window, state and totals", () => {
      expect(
        timesheetSummary({
          id: "42",
          type: "timesreport",
          attributes: { term: "2026-09", startDate: "2026-09-01", endDate: "2026-09-30", state: 2, totalDays: 21 },
        })
      ).toBe("[timesreport #42] | Mois: 2026-09 | Du: 2026-09-01 | Au: 2026-09-30 | Statut: 2 | Jours: 21");
      expect(timesheetSummary({ id: "1", type: "timesreport", attributes: undefined as never })).toBe(
        "[timesreport #1]"
      );
    });

    it("answers 'aucun résultat' on data: null instead of throwing", async () => {
      vi.mocked(apiSearch).mockResolvedValue({ data: null } as never);
      registerTimesheetTools(server);
      const result = await search({});
      expect(result.content[0].text).toBe("Aucun(e) feuille de temps trouvé(e).");

      vi.mocked(apiRequest).mockResolvedValue({ data: null } as never);
      const byResource = (await toolCallback(server, "boond_resources_timesheets")({ resourceId: "5" })) as {
        content: Array<{ text: string }>;
      };
      expect(byResource.content[0].text).toBe("Aucun(e) feuille de temps trouvé(e).");
    });

    it("cuts an oversized page on a line boundary and says how many rows are shown", async () => {
      const rows = Array.from({ length: 500 }, (_, i) => ({
        id: String(i),
        type: "timesreport",
        attributes: {
          term: "2026-09",
          startDate: "2026-09-01",
          endDate: "2026-09-30",
          state: 1,
          totalDays: 20,
          totalHours: 140,
        },
      }));
      vi.mocked(apiSearch).mockResolvedValue({ data: rows, meta: { totals: { rows: 500 } } } as never);
      registerTimesheetTools(server);
      const { content } = await search({ pageSize: 500 });
      const text = content[0].text;
      expect(text.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
      expect(text).toMatch(/\[Résultats tronqués : \d+\/500 ligne\(s\) affichée\(s\)/);
      expect(text).not.toContain("[Résultats tronqués...]");
      // The last kept row is complete, not a half-line that reads as whole.
      const lastRow = text.split("\n\n[Résultats tronqués")[0].split("\n").pop();
      expect(lastRow).toMatch(/Heures: 140$/);
    });

    it("projects `fields` like every other search tool", async () => {
      vi.mocked(apiSearch).mockResolvedValue({
        data: [{ id: "1", type: "timesreport", attributes: { term: "2026-09", state: 2, totalDays: 20 } }],
      } as never);
      registerTimesheetTools(server);
      const { content } = await search({ fields: ["term"] });
      expect(content[0].text).toContain("2026-09");
      expect(content[0].text).not.toContain("Jours");
    });
  });
});
