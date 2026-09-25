import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTimesheetTools, timesheetSummary, buildTimeLine, formatTimesheetDefaults } from "./timesheets.js";
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

  it("should register 6 timesheet tools", () => {
    registerTimesheetTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(6);
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

  describe("write model (#249)", () => {
    it("registers default (read-only) and update (idempotent write)", () => {
      registerTimesheetTools(server);
      const calls = vi.mocked(server.registerTool).mock.calls;
      const def = calls.find((c) => c[0] === "boond_timesheets_default")!;
      const upd = calls.find((c) => c[0] === "boond_timesheets_update")!;
      expect(def[1].annotations?.readOnlyHint).toBe(true);
      expect(upd[1].annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true, destructiveHint: false });
      expect(upd[1].description).toContain("remplacent le tableau entier");
      const create = calls.find((c) => c[0] === "boond_timesheets_create")!;
      expect(create[1].description).toContain("boond_timesheets_default");
      expect(create[1].description).toContain("`state` n'est pas un champ d'écriture");
    });

    it("the create schema takes term + lines and no report-level totals or state", () => {
      registerTimesheetTools(server);
      const create = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_timesheets_create")!;
      const schema = create[1].inputSchema as unknown as { safeParse: (v: unknown) => { success: boolean } };
      expect(schema.safeParse({ resourceId: "1", term: "2026-09" }).success).toBe(true);
      expect(schema.safeParse({ resourceId: "1", term: "2026-09", state: "validated" }).success).toBe(false);
      expect(schema.safeParse({ resourceId: "1", term: "2026-09", totalDays: 20 }).success).toBe(false);
      expect(
        schema.safeParse({
          resourceId: "1",
          term: "2026-09",
          regularTimes: [{ startDate: "2026-09-01", projectId: "2947", deliveryId: "18360" }],
        }).success
      ).toBe(true);
    });

    it("default passes resource / term (and agency) as query params on a clean path", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { id: "0", type: "timesreport", attributes: {} } } as never);
      registerTimesheetTools(server);
      await toolCallback(server, "boond_timesheets_default")({ resourceId: "30888", term: "2026-10" });
      expect(apiRequest).toHaveBeenCalledWith("/times-reports/default", "GET", undefined, {
        resource: "30888",
        term: "2026-10",
      });
      await toolCallback(server, "boond_timesheets_default")({ resourceId: "30888", term: "2026-10", agencyId: "3" });
      expect(vi.mocked(apiRequest).mock.calls[1][3]).toEqual({ resource: "30888", term: "2026-10", agency: "3" });
    });

    it("renders the work-unit types (from the included resource), chargeable pairs and planning", () => {
      // Shape observed on the live API (2026-09-25): the types sit on the
      // included resource's workUnitTypesAllowed, nowhere else.
      const text = formatTimesheetDefaults({
        data: {
          id: "0",
          type: "timesreport",
          attributes: {
            term: "2026-10",
            workUnitRate: 1,
            plannedTimes: [
              {
                startDate: "2026-10-01",
                duration: 1,
                workUnitType: { reference: 1, name: "Normale" },
                project: { id: "2947" },
                delivery: { id: "18360" },
                batch: null,
              },
              {
                startDate: "2026-10-02",
                duration: 1,
                workUnitType: { reference: 1, name: "Normale" },
                project: { id: "2947" },
                delivery: { id: "18360" },
                batch: null,
              },
            ],
            absencesTimes: [{ startDate: "2026-10-15", duration: 1, workUnitType: { reference: 4, name: "RTT" } }],
          },
          relationships: {
            resource: { data: { id: "30888", type: "resource" } },
            agency: { data: { id: "3", type: "agency" } },
          },
        },
        included: [
          {
            id: "30888",
            type: "resource",
            attributes: {
              firstName: "Jean",
              lastName: "Dupont",
              workUnitTypesAllowed: [
                { reference: 1, activityType: "production", name: "Normale" },
                { reference: 4, activityType: "absence", name: "RTT" },
              ],
            },
          },
          { id: "3", type: "agency", attributes: { name: "Paris", calendar: "calendar" } },
          {
            id: "2947",
            type: "project",
            attributes: { reference: "PRJ2947" },
            relationships: { deliveries: { data: [{ id: "18360", type: "delivery" }] }, batches: { data: [] } },
          },
        ],
      } as never);
      expect(text).toContain("ressource #30888 (Jean Dupont), mois 2026-10");
      expect(text).toContain("reference=1 | Normale | production");
      expect(text).toContain("reference=4 | RTT | absence");
      expect(text).toContain("projectId=2947 | PRJ2947 | deliveryId ∈ #18360");
      expect(text).toContain("Planning prévu (2 ligne(s), 2 unité(s))");
      expect(text).toContain(
        "projectId=2947 | deliveryId=18360 | workUnitTypeReference=1 (Normale) : 2 jour(s), 2 unité(s), du 2026-10-01 au 2026-10-02"
      );
      expect(text).toContain("Absences déjà posées sur le mois (1)");
      expect(text).toContain("2026-10-15 | 1 | RTT (reference=4)");
    });

    it("stays readable with no imputation and no planned line", () => {
      const text = formatTimesheetDefaults({
        data: { id: "0", type: "timesreport", attributes: { term: "2026-10" }, relationships: {} },
        included: [],
      } as never);
      expect(text).toContain("seules des absences peuvent être saisies");
      expect(text).toContain("(aucune ligne planifiée)");
    });

    it("nests a line the way the API stores it, null for an absent project / delivery / batch", () => {
      expect(
        buildTimeLine({
          startDate: "2026-10-01",
          duration: 1,
          workUnitTypeReference: 1,
          projectId: "2947",
          deliveryId: "18360",
        })
      ).toEqual({
        startDate: "2026-10-01",
        duration: 1,
        workUnitType: { reference: 1 },
        project: { id: "2947" },
        delivery: { id: "18360" },
        batch: null,
      });
      expect(buildTimeLine({ startDate: "2026-10-15", duration: 0.5, workUnitTypeReference: 4, batchId: "7" })).toEqual(
        {
          startDate: "2026-10-15",
          duration: 0.5,
          workUnitType: { reference: 4 },
          project: null,
          delivery: null,
          batch: { id: "7" },
        }
      );
    });

    it("create POSTs a monthly container with nested lines and a resource relationship", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { id: "99", type: "timesreport", attributes: {} } } as never);
      registerTimesheetTools(server);
      const result = (await toolCallback(
        server,
        "boond_timesheets_create"
      )({
        resourceId: "30888",
        agencyId: "3",
        term: "2026-10",
        informationComments: "octobre",
        regularTimes: [
          { startDate: "2026-10-01", duration: 1, workUnitTypeReference: 1, projectId: "2947", deliveryId: "18360" },
        ],
      })) as { structuredContent?: Record<string, unknown> };
      expect(apiRequest).toHaveBeenCalledWith("/times-reports", "POST", {
        data: {
          type: "timesreport",
          attributes: {
            term: "2026-10",
            informationComments: "octobre",
            regularTimes: [
              {
                startDate: "2026-10-01",
                duration: 1,
                workUnitType: { reference: 1 },
                project: { id: "2947" },
                delivery: { id: "18360" },
                batch: null,
              },
            ],
          },
          relationships: {
            resource: { data: { id: "30888", type: "resource" } },
            agency: { data: { id: "3", type: "agency" } },
          },
        },
      });
      expect(result.structuredContent).toEqual({ id: "99", type: "timesreport" });
    });

    it("update PUTs on /times-reports/{id}, carries the id in the body and leaves untouched arrays out", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { id: "99", type: "timesreport", attributes: {} } } as never);
      registerTimesheetTools(server);
      await toolCallback(server, "boond_timesheets_update")({ id: "99", informationComments: "corrigé", closed: true });
      const [path, method, body] = vi.mocked(apiRequest).mock.calls[0];
      expect(path).toBe("/times-reports/99");
      expect(method).toBe("PUT");
      expect(body).toEqual({
        data: { id: "99", type: "timesreport", attributes: { informationComments: "corrigé", closed: true } },
      });
    });
  });
});
