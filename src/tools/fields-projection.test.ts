import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatListResponse } from "../services/boond-client.js";
import { registerAbsenceTools } from "./absences.js";
import { registerActionTools } from "./actions.js";
import { registerAdvantageTools } from "./advantages.js";
import { registerAlertTools } from "./alerts.js";
import { registerContractTools } from "./contracts.js";
import { registerInvoiceTools } from "./invoices.js";
import { registerNotificationTools } from "./notifications.js";
import { registerPlanningAbsenceTools } from "./planning-absences.js";
import { registerPositioningTools } from "./positionings.js";
import { registerValidationTools } from "./validations.js";

vi.mock("../services/boond-client.js", () => ({
  apiRequest: vi.fn().mockResolvedValue({ data: [] }),
  apiSearch: vi.fn().mockResolvedValue({ data: [] }),
  buildSearchQuery: vi.fn((params: Record<string, unknown>) => params),
  formatListResponse: vi.fn().mockReturnValue(""),
  formatDetailResponse: vi.fn().mockReturnValue(""),
  formatTabResponse: vi.fn().mockReturnValue(""),
}));

/**
 * `fields` is a client-side projection: `buildSearchQuery` strips it, so the
 * ONLY thing that makes it work is the third argument handed to
 * `formatListResponse`. Drop that argument in a refactor and the tool keeps
 * accepting `fields` while silently returning the full default summary — the
 * exact token blow-up the projection exists to prevent, and something no
 * schema-level test can catch.
 *
 * The crud-factory search tools forward it centrally (covered in
 * crud-factory.test.ts); every hand-rolled search tool has to do it itself,
 * hence one row per tool here.
 */
const HAND_ROLLED_SEARCH_TOOLS: ReadonlyArray<{
  register: (server: McpServer) => void;
  tool: string;
  entityName: string;
  /** The tool hands `formatListResponse` its own per-row summary (4th argument). */
  ownSummary?: boolean;
}> = [
  { register: registerAbsenceTools, tool: "boond_absences_search", entityName: "absence" },
  { register: registerActionTools, tool: "boond_actions_search", entityName: "action" },
  { register: registerAdvantageTools, tool: "boond_advantages_search", entityName: "avantage" },
  { register: registerAlertTools, tool: "boond_alerts_search", entityName: "alerte", ownSummary: true },
  { register: registerContractTools, tool: "boond_contracts_search", entityName: "contrat", ownSummary: true },
  { register: registerInvoiceTools, tool: "boond_invoices_search", entityName: "facture" },
  { register: registerNotificationTools, tool: "boond_notifications_search", entityName: "notification" },
  {
    register: registerPlanningAbsenceTools,
    tool: "boond_planning_absences_search",
    entityName: "planning absence",
  },
  { register: registerPositioningTools, tool: "boond_positionings_search", entityName: "positionnement" },
  { register: registerValidationTools, tool: "boond_validations_search", entityName: "validation" },
];

describe("fields projection forwarding (hand-rolled search tools)", () => {
  let server: McpServer;

  beforeEach(() => {
    server = { registerTool: vi.fn() } as unknown as McpServer;
    vi.mocked(formatListResponse).mockClear();
  });

  for (const { register, tool, entityName, ownSummary } of HAND_ROLLED_SEARCH_TOOLS) {
    const tail = ownSummary ? [expect.any(Function)] : [];
    it(`${tool} forwards params.fields to formatListResponse`, async () => {
      register(server);
      const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === tool);
      expect(call, `${tool} is not registered`).toBeDefined();

      const handler = call?.[2] as (params: unknown) => Promise<unknown>;
      await handler({ page: 1, pageSize: 30, fields: ["reference", "date"] });

      expect(formatListResponse).toHaveBeenCalledWith(expect.anything(), entityName, ["reference", "date"], ...tail);
    });

    it(`${tool} renders the standard summary when fields is absent`, async () => {
      register(server);
      const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === tool);
      const handler = call?.[2] as (params: unknown) => Promise<unknown>;
      await handler({ page: 1, pageSize: 30 });

      expect(formatListResponse).toHaveBeenCalledWith(expect.anything(), entityName, undefined, ...tail);
    });
  }

  it("covers every hand-rolled search tool that formats a list", () => {
    // Guard against a new hand-rolled search tool being added without a row
    // above. The `boond_reporting_*` family is deliberately absent: it renders
    // through its own formatters.
    // deliveries, payments, provider-invoices, purchases and timesheets moved
    // to the crud-factory in #238 and left this table.
    expect(HAND_ROLLED_SEARCH_TOOLS).toHaveLength(10);
  });
});
