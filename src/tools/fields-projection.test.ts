import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatListResponse } from "../services/boond-client.js";
import { registerAbsenceTools } from "./absences.js";
import { registerActionTools } from "./actions.js";
import { registerAdvantageTools } from "./advantages.js";
import { registerDeliveryTools } from "./deliveries.js";
import { registerInvoiceTools } from "./invoices.js";
import { registerNotificationTools } from "./notifications.js";
import { registerPaymentTools } from "./payments.js";
import { registerPlanningAbsenceTools } from "./planning-absences.js";
import { registerPositioningTools } from "./positionings.js";
import { registerProviderInvoiceTools } from "./provider-invoices.js";
import { registerPurchaseTools } from "./purchases.js";
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
}> = [
  { register: registerAbsenceTools, tool: "boond_absences_search", entityName: "absence" },
  { register: registerActionTools, tool: "boond_actions_search", entityName: "action" },
  { register: registerAdvantageTools, tool: "boond_advantages_search", entityName: "avantage" },
  { register: registerDeliveryTools, tool: "boond_deliveries_search", entityName: "livraison" },
  { register: registerInvoiceTools, tool: "boond_invoices_search", entityName: "facture" },
  { register: registerNotificationTools, tool: "boond_notifications_search", entityName: "notification" },
  { register: registerPaymentTools, tool: "boond_payments_search", entityName: "paiement" },
  {
    register: registerPlanningAbsenceTools,
    tool: "boond_planning_absences_search",
    entityName: "planning absence",
  },
  { register: registerPositioningTools, tool: "boond_positionings_search", entityName: "positionnement" },
  {
    register: registerProviderInvoiceTools,
    tool: "boond_provider_invoices_search",
    entityName: "facture fournisseur",
  },
  { register: registerPurchaseTools, tool: "boond_purchases_search", entityName: "achat" },
  { register: registerValidationTools, tool: "boond_validations_search", entityName: "validation" },
];

describe("fields projection forwarding (hand-rolled search tools)", () => {
  let server: McpServer;

  beforeEach(() => {
    server = { registerTool: vi.fn() } as unknown as McpServer;
    vi.mocked(formatListResponse).mockClear();
  });

  for (const { register, tool, entityName } of HAND_ROLLED_SEARCH_TOOLS) {
    it(`${tool} forwards params.fields to formatListResponse`, async () => {
      register(server);
      const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === tool);
      expect(call, `${tool} is not registered`).toBeDefined();

      const handler = call?.[2] as (params: unknown) => Promise<unknown>;
      await handler({ page: 1, pageSize: 30, fields: ["reference", "date"] });

      expect(formatListResponse).toHaveBeenCalledWith(expect.anything(), entityName, ["reference", "date"]);
    });

    it(`${tool} renders the standard summary when fields is absent`, async () => {
      register(server);
      const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === tool);
      const handler = call?.[2] as (params: unknown) => Promise<unknown>;
      await handler({ page: 1, pageSize: 30 });

      expect(formatListResponse).toHaveBeenCalledWith(expect.anything(), entityName, undefined);
    });
  }

  it("covers every hand-rolled search tool that formats a list", () => {
    // Guard against a new hand-rolled search tool being added without a row
    // above. `boond_timesheets_search` and the `boond_reporting_*` family are
    // deliberately absent: they render through their own formatters.
    expect(HAND_ROLLED_SEARCH_TOOLS).toHaveLength(12);
  });
});
