import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JsonApiResponse } from "../types.js";
import {
  registerReportingDashboardTool,
  buildReportingDashboard,
  buildDashboardQuery,
  formatDashboardText,
  humanizeReference,
  entityLabel,
  ReportingDashboardOutputSchema,
} from "./reporting-dashboard.js";
import { reportingEndpoint } from "./reporting-endpoints.js";
import { REPORTING_UI_URI } from "../ui/index.js";
import * as client from "../services/boond-client.js";

function createMockServer() {
  return { registerTool: vi.fn() } as unknown as McpServer;
}

const projectsEp = reportingEndpoint("projects")!;
const synthesisEp = reportingEndpoint("synthesis")!;
const plansEp = reportingEndpoint("production_plans")!;

/**
 * Shapes recorded from the live BoondManager API (9.1.79.x). The three of them
 * are the reason the handler pivots at all: `/reporting-*` answers with one row
 * per (entity × indicator), and the three endpoint families differ in whether
 * they carry an entity axis, or scorecards at all.
 */
const projectsResponse: JsonApiResponse = {
  meta: { totals: { rows: 6, dependsOn: 457 }, dates: { startDate: "2026-01-01", endDate: "2026-06-30" } },
  data: [
    {
      id: "a1",
      type: "indicator",
      attributes: {
        scorecard: { category: "projects", reference: "reference", typeOf: "string" },
        value: "PRJ3261 - Data Scientist",
        target: null,
      },
      relationships: { dependsOn: { data: { id: "3261", type: "project" } } },
    },
    {
      id: "a2",
      type: "indicator",
      attributes: {
        scorecard: { category: "projects", reference: "turnoverSignedExcludingTax", typeOf: "money" },
        value: "4967.74194",
        target: null,
      },
      relationships: { dependsOn: { data: { id: "3261", type: "project" } } },
    },
    {
      id: "a3",
      type: "indicator",
      attributes: {
        scorecard: { category: "projects", reference: "profitabilitySigned", typeOf: "percentage" },
        value: "3.4",
        target: null,
      },
      relationships: { dependsOn: { data: { id: "3261", type: "project" } } },
    },
    {
      id: "b1",
      type: "indicator",
      attributes: {
        scorecard: { category: "projects", reference: "reference", typeOf: "string" },
        value: "PRJ3259 - Renfort RPA",
        target: null,
      },
      relationships: { dependsOn: { data: { id: "3259", type: "project" } } },
    },
    {
      id: "b2",
      type: "indicator",
      attributes: {
        scorecard: { category: "projects", reference: "turnoverSignedExcludingTax", typeOf: "money" },
        value: "4526.05629",
        target: null,
      },
      relationships: { dependsOn: { data: { id: "3259", type: "project" } } },
    },
    {
      id: "b3",
      type: "indicator",
      attributes: {
        // Compound indicator: two values joined by a pipe. Must stay a string.
        scorecard: {
          category: "projects",
          reference: "durationOfProductionSignedAndUsedTime",
          typeOf: "dayOrWorkUnit",
        },
        value: "210|0",
        target: null,
      },
      relationships: { dependsOn: { data: { id: "3259", type: "project" } } },
    },
  ],
  included: [
    { id: "3261", type: "project", attributes: { reference: "PRJ3261- Projet 901.E.PAR - Data Scientist" } },
    { id: "3259", type: "project", attributes: { reference: "PRJ3259 - Renfort RPA Bytel 2026" } },
  ],
};

const synthesisResponse: JsonApiResponse = {
  meta: { dates: { startDate: "2026-01-01", endDate: "2026-06-30" } } as JsonApiResponse["meta"],
  data: [
    {
      id: "s1",
      type: "indicator",
      attributes: {
        scorecard: { category: "commercialSynthesis", reference: "turnoverSignedExcludingTax", typeOf: "money" },
        value: "26590994.77845",
        target: null,
      },
    },
    {
      id: "s2",
      type: "indicator",
      attributes: {
        scorecard: {
          category: "commercialSynthesis",
          dictionaryId: 0,
          reference: "numberOfOpportunitiesPerStates",
          typeOf: "number",
        },
        value: "32",
        target: "40",
      },
    },
    {
      id: "s3",
      type: "indicator",
      attributes: {
        scorecard: {
          category: "commercialSynthesis",
          dictionaryId: 1,
          reference: "numberOfOpportunitiesPerStates",
          typeOf: "number",
        },
        value: "249",
        target: null,
      },
    },
  ],
};

const plansResponse: JsonApiResponse = {
  meta: { totals: { rows: 2077 } },
  data: [
    {
      id: "47058",
      type: "resource",
      attributes: { firstName: "Hans", lastName: "BAKAM WABO", thumbnail: "" },
      relationships: { deliveries: { data: [{ id: "17240", type: "delivery" }] } },
    },
    {
      id: "47059",
      type: "resource",
      attributes: { firstName: "Mona", lastName: "ASRI", thumbnail: "" },
      relationships: { deliveries: { data: [] } },
    },
  ],
};

describe("buildReportingDashboard", () => {
  it("pivots entity-scoped indicators into rows × columns", () => {
    const payload = buildReportingDashboard(projectsResponse, projectsEp);

    expect(payload.layout).toBe("entities");
    expect(payload.columns.map((c) => c.key)).toEqual([
      "reference",
      "turnoverSignedExcludingTax",
      "profitabilitySigned",
      "durationOfProductionSignedAndUsedTime",
    ]);
    expect(payload.rows).toHaveLength(2);
    expect(payload.count).toBe(2);

    const first = payload.rows[0];
    expect(first.entity).toEqual({ id: "3261", type: "project" });
    // Label comes from `included`, not from the indicator row.
    expect(first.label).toBe("PRJ3261- Projet 901.E.PAR - Data Scientist");
    expect(first.values["turnoverSignedExcludingTax"]).toBe(4967.74194);
    expect(first.values["profitabilitySigned"]).toBe(3.4);
    expect(first.values["reference"]).toBe("PRJ3261 - Data Scientist");
  });

  it("reports the entity total, not the indicator-row count", () => {
    // `meta.totals.rows` counts indicator rows (6 here); once pivoted, the
    // meaningful total is the number of entities behind them.
    expect(buildReportingDashboard(projectsResponse, projectsEp).total).toBe(457);
  });

  it("keeps compound indicator values as strings", () => {
    const payload = buildReportingDashboard(projectsResponse, projectsEp);
    expect(payload.rows[1].values["durationOfProductionSignedAndUsedTime"]).toBe("210|0");
  });

  it("surfaces the period the API actually reported on", () => {
    expect(buildReportingDashboard(projectsResponse, projectsEp).period).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-06-30",
    });
  });

  it("lists KPIs one per row when there is no entity axis (synthesis)", () => {
    const payload = buildReportingDashboard(synthesisResponse, synthesisEp);

    expect(payload.layout).toBe("indicators");
    expect(payload.columns.map((c) => c.key)).toEqual(["value", "target"]);
    expect(payload.rows).toHaveLength(3);
    expect(payload.rows[0]).toMatchObject({
      label: "Turnover signed excluding tax",
      kind: "money",
      values: { value: 26590994.77845, target: null },
    });
    expect(payload.rows[1].values["target"]).toBe(40);
    expect(formatDashboardText(payload)).toContain("| Indicateur | Valeur | Cible |");
  });

  it("keeps same-reference indicators apart by dictionaryId", () => {
    // `numberOfOpportunitiesPerStates` is emitted once per state; folding them
    // onto one key would keep only the last value.
    const payload = buildReportingDashboard(synthesisResponse, synthesisEp);
    const labels = payload.rows.map((r) => r.label);
    expect(labels).toContain("Number of opportunities per states (#0)");
    expect(labels).toContain("Number of opportunities per states (#1)");
    expect(new Set(payload.rows.map((r) => r.key)).size).toBe(3);
  });

  it("tabulates plain entity rows when the endpoint returns no scorecard", () => {
    const payload = buildReportingDashboard(plansResponse, plansEp);

    expect(payload.layout).toBe("entities");
    expect(payload.columns.map((c) => c.key)).toEqual(["firstName", "lastName", "thumbnail"]);
    expect(payload.rows[0]).toMatchObject({
      label: "Hans BAKAM WABO",
      entity: { id: "47058", type: "resource" },
    });
    // No `dependsOn` here, so `rows` *is* the entity count.
    expect(payload.total).toBe(2077);
  });

  it("produces a payload that validates against the declared outputSchema", () => {
    for (const [response, ep] of [
      [projectsResponse, projectsEp],
      [synthesisResponse, synthesisEp],
      [plansResponse, plansEp],
    ] as const) {
      expect(() => ReportingDashboardOutputSchema.parse(buildReportingDashboard(response, ep))).not.toThrow();
    }
  });

  it("handles an empty page without throwing", () => {
    const payload = buildReportingDashboard({ data: [] }, projectsEp);
    expect(payload.count).toBe(0);
    expect(payload.rows).toEqual([]);
    expect(payload.columns).toEqual([]);
  });
});

describe("humanizeReference / entityLabel", () => {
  it("turns an API reference into a readable label", () => {
    expect(humanizeReference("turnoverSignedExcludingTax")).toBe("Turnover signed excluding tax");
    expect(humanizeReference("numberOfProjectsInProgress")).toBe("Number of projects in progress");
    expect(humanizeReference("state")).toBe("State");
  });

  it("picks the richest identity attribute available", () => {
    expect(entityLabel({ id: "1", type: "company", attributes: { name: "SILAMIR" } }, "#1")).toBe("SILAMIR");
    expect(entityLabel({ id: "2", type: "resource", attributes: { firstName: "Mona", lastName: "ASRI" } }, "#2")).toBe(
      "Mona ASRI"
    );
    expect(entityLabel({ id: "3", type: "x", attributes: { name: "  " } }, "#3")).toBe("#3");
    expect(entityLabel(undefined, "#4")).toBe("#4");
  });
});

describe("buildDashboardQuery", () => {
  it("drops filters the selected endpoint does not accept", () => {
    // The dashboard's schema is a superset of the five; posting a projects
    // filter to /reporting-companies would be ignored silently by the API and
    // read back as a scoped result that isn't.
    const companies = reportingEndpoint("companies")!;
    const query = buildDashboardQuery(
      { report: "companies", projectStates: [1], companiesStates: [2], perimeterDynamic: ["data"] },
      companies
    );
    expect(query).toEqual({ companiesStates: [2], perimeterDynamic: ["data"] });
  });

  it("maps the uniform `max` onto the endpoint's own parameter", () => {
    expect(buildDashboardQuery({ report: "projects", max: 5 }, projectsEp)).toEqual({ maxProjects: 5 });
    expect(buildDashboardQuery({ report: "resources", max: 5 }, reportingEndpoint("resources")!)).toEqual({
      maxResources: 5,
    });
  });

  it("ignores `max` on endpoints that have no per-entity page size", () => {
    expect(buildDashboardQuery({ report: "synthesis", max: 5 }, synthesisEp)).toEqual({});
  });

  it("never forwards its own synthetic keys", () => {
    const query = buildDashboardQuery({ report: "projects", max: 3, startDate: "2026-01-01" }, projectsEp);
    expect(query["report"]).toBeUndefined();
    expect(query["max"]).toBeUndefined();
    expect(query["startDate"]).toBe("2026-01-01");
  });
});

describe("formatDashboardText", () => {
  it("renders a markdown table a model can read without the app", () => {
    const text = formatDashboardText(buildReportingDashboard(projectsResponse, projectsEp));
    expect(text).toContain("Reporting projets — 2026-01-01 → 2026-06-30");
    expect(text).toContain("2 ligne(s) sur 457 au total");
    expect(text).toContain("| Ligne | Reference |");
    expect(text).toContain("PRJ3261- Projet 901.E.PAR - Data Scientist");
    expect(text).toContain("Turnover signed excluding tax");
  });

  it("says so when there is nothing to show", () => {
    expect(formatDashboardText(buildReportingDashboard({ data: [] }, projectsEp))).toContain("Aucune donnée");
  });

  it("caps the columns it prints and says how many it hid", () => {
    const wide: JsonApiResponse = {
      data: Array.from({ length: 12 }, (_, i) => ({
        id: `i${i}`,
        type: "indicator",
        attributes: {
          scorecard: { category: "projects", reference: `indicator${i}`, typeOf: "number" },
          value: `${i}`,
        },
        relationships: { dependsOn: { data: { id: "1", type: "project" } } },
      })),
    };
    const text = formatDashboardText(buildReportingDashboard(wide, projectsEp));
    expect(text).toContain("+4 colonne(s) non affichée(s)");
  });
});

describe("registerReportingDashboardTool", () => {
  let server: McpServer;
  beforeEach(() => {
    server = createMockServer();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function registered() {
    registerReportingDashboardTool(server);
    const call = vi.mocked(server.registerTool).mock.calls[0];
    return {
      name: call[0] as string,
      config: call[1] as Record<string, unknown>,
      handler: call[2] as (params: unknown) => Promise<Record<string, unknown>>,
    };
  }

  it("points at the reporting app and stays readable by the model", () => {
    const { name, config } = registered();
    expect(name).toBe("boond_reporting_dashboard");
    expect(config._meta).toEqual({
      ui: { resourceUri: REPORTING_UI_URI, visibility: ["model", "app"] },
      "ui/resourceUri": REPORTING_UI_URI,
    });
  });

  it("declares read-only, idempotent annotations (the access policy derives `read` from them)", () => {
    const { config } = registered();
    expect(config.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  it("declares an outputSchema — the app is a typed consumer of the result", () => {
    expect(registered().config.outputSchema).toBe(ReportingDashboardOutputSchema);
  });

  /**
   * Graceful degradation is the prerequisite, not a nice-to-have: a client with
   * no MCP Apps support must get the same data.
   */
  it("always returns text AND structuredContent, with no UI capability declared", async () => {
    vi.spyOn(client, "apiRequest").mockResolvedValue(projectsResponse);
    const { handler } = registered();

    const result = await handler({ report: "projects" });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ report: "projects", layout: "entities", count: 2 });
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0].type).toBe("text");
    expect(content[0].text).toContain("PRJ3261");
    // No `ui://` resource link for a host that cannot read one.
    expect(content.some((c) => c.type === "resource_link")).toBe(false);
  });

  it("attaches the ui:// resource link only for a client that advertises MCP Apps", async () => {
    vi.spyOn(client, "apiRequest").mockResolvedValue(projectsResponse);
    const uiServer = {
      registerTool: vi.fn(),
      server: {
        getClientCapabilities: () => ({
          extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } },
        }),
      },
    } as unknown as McpServer;
    registerReportingDashboardTool(uiServer);
    const handler = vi.mocked(uiServer.registerTool).mock.calls[0][2] as (
      p: unknown
    ) => Promise<Record<string, unknown>>;

    const content = (await handler({ report: "projects" })).content as Array<{ type: string; uri?: string }>;
    const link = content.find((c) => c.type === "resource_link");
    expect(link?.uri).toBe(REPORTING_UI_URI);
  });

  it("refuses endpoints that need dates instead of letting the API answer 422", async () => {
    const spy = vi.spyOn(client, "apiRequest").mockResolvedValue(synthesisResponse);
    const { handler } = registered();

    const result = await handler({ report: "synthesis" });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain("startDate");
    expect(spy).not.toHaveBeenCalled();
  });

  it("calls the endpoint matching `report`", async () => {
    const spy = vi.spyOn(client, "apiRequest").mockResolvedValue(synthesisResponse);
    const { handler } = registered();

    await handler({ report: "synthesis", startDate: "2026-01-01", endDate: "2026-06-30" });
    expect(spy).toHaveBeenCalledWith(
      "/reporting-synthesis",
      "GET",
      undefined,
      expect.objectContaining({ startDate: "2026-01-01", endDate: "2026-06-30" })
    );
  });
});
