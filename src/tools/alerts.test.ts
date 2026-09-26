import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMockServer, registeredToolNames, toolCallback } from "./test-helpers.js";
import { alertSummary, registerAlertTools } from "./alerts.js";
import { apiSearch } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiSearch: vi.fn() };
});

const ALERT = {
  id: "12",
  type: "alert",
  attributes: {
    module: "contracts",
    indicator: "probationEnd",
    state: 1,
    isDaily: true,
    isWeekly: false,
    params: { days: 15 },
  },
};

describe("registerAlertTools (issue #255)", () => {
  let server: McpServer;
  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiSearch).mockReset();
    vi.mocked(apiSearch).mockResolvedValue({ data: [ALERT], meta: { totals: { rows: 1 } } } as never);
  });

  it("registers a single read-only search over GET /alerts, with no query parameter", async () => {
    registerAlertTools(server);
    expect(registeredToolNames(server)).toEqual(["boond_alerts_search"]);
    const result = (await toolCallback(server, "boond_alerts_search")({})) as {
      content: Array<{ text: string }>;
      structuredContent: { total?: number; items: Array<{ id?: string; summary?: string }> };
    };
    expect(vi.mocked(apiSearch).mock.calls[0]?.[0]).toBe("/alerts");
    expect(vi.mocked(apiSearch).mock.calls[0]?.[1]).toEqual({});
    expect(result.content[0]?.text).toContain(
      "[alert #12] | Module: contracts | Indicateur: probationEnd | État: 1 | Rapport: quotidien"
    );
    expect(result.structuredContent.items[0]?.summary).toContain("Indicateur: probationEnd");
    const annotations = vi.mocked(server.registerTool).mock.calls[0]?.[1].annotations;
    expect(annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });

  it("alertSummary prints what models.alert publishes and any extra label it finds", () => {
    expect(
      alertSummary({ id: "1", type: "alert", attributes: { module: "invoices", title: "Retard", isWeekly: true } })
    ).toBe("[alert #1] | Module: invoices | Rapport: hebdomadaire | title: Retard");
    expect(alertSummary({ id: "2", type: "alert", attributes: {} })).toBe("[alert #2]");
  });
});
