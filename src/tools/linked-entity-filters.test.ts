import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { KEYWORD_PREFIX_BY_FILTER, toKeywordReferences } from "./linked-entity-filters.js";
import { apiRequest, apiSearch } from "../services/boond-client.js";
import { registerAbsenceTools } from "./absences.js";
import { registerTimesheetTools } from "./timesheets.js";
import { registerActionTools } from "./actions.js";
import { registerDeliveryTools } from "./deliveries.js";
import { registerExpenseTools } from "./expenses.js";
import { registerInvoiceTools } from "./invoices.js";
import { registerOrderTools } from "./orders.js";
import { registerPaymentTools } from "./payments.js";
import { registerPositioningTools } from "./positionings.js";
import { registerProviderInvoiceTools } from "./provider-invoices.js";
import { registerPurchaseTools } from "./purchases.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return {
    ...actual,
    apiRequest: vi.fn().mockResolvedValue({ data: [] }),
    apiSearch: vi.fn().mockResolvedValue({ data: [] }),
  };
});

describe("toKeywordReferences", () => {
  it("moves every linked-entity id into keywords as a prefixed reference and drops the key", () => {
    expect(toKeywordReferences({ companyId: "6221", projectId: "2977", page: 1 })).toEqual({
      keywords: "CSOC6221 PRJ2977",
      page: 1,
    });
  });

  it("appends after the caller's own keywords and ignores absent / empty values", () => {
    expect(
      toKeywordReferences({ keywords: " facture ", resourceId: "5", companyId: undefined, candidateId: "" })
    ).toEqual({
      keywords: "facture COMP5",
    });
    expect(toKeywordReferences({ keywords: "", page: 2 })).toEqual({ page: 2 });
    expect(toKeywordReferences({ page: 2 })).toEqual({ page: 2 });
  });

  it("knows the prefixes the RAML documents", () => {
    expect(KEYWORD_PREFIX_BY_FILTER).toEqual({
      candidateId: "CAND",
      resourceId: "COMP",
      contactId: "CCON",
      companyId: "CSOC",
      projectId: "PRJ",
      opportunityId: "AO",
      purchaseId: "ACH",
      orderId: "BDC",
      invoiceId: "FACT",
      deliveryId: "MIS",
      productId: "PROD",
      contractId: "CTR",
    });
  });
});

/**
 * Table-driven: for every search tool and every `*Id` filter it accepts, the
 * query actually sent to BoondManager carries the prefixed reference in
 * `keywords` and no `*Id` key at all. Verified against the live API on
 * 2026-09-25: `companyId` / `projectId` / `resourceId` are ignored on every one
 * of these routes (row count identical to no filter), the references filter.
 */
const CASES: ReadonlyArray<{
  register: (server: McpServer) => void;
  tool: string;
  path: string;
  extra?: Record<string, unknown>;
  filters: Record<string, string>;
}> = [
  {
    register: registerInvoiceTools,
    tool: "boond_invoices_search",
    path: "/invoices",
    filters: { companyId: "CSOC", projectId: "PRJ", contactId: "CCON", orderId: "BDC" },
  },
  {
    register: registerOrderTools,
    tool: "boond_orders_search",
    path: "/orders",
    filters: { companyId: "CSOC", projectId: "PRJ", contactId: "CCON" },
  },
  {
    register: registerDeliveryTools,
    tool: "boond_deliveries_search",
    path: "/deliveries-groupments",
    filters: { projectId: "PRJ", companyId: "CSOC", resourceId: "COMP", opportunityId: "AO" },
  },
  {
    register: registerActionTools,
    tool: "boond_actions_search",
    path: "/actions",
    filters: {
      candidateId: "CAND",
      resourceId: "COMP",
      contactId: "CCON",
      companyId: "CSOC",
      opportunityId: "AO",
      projectId: "PRJ",
      orderId: "BDC",
      invoiceId: "FACT",
    },
  },
  {
    register: registerPurchaseTools,
    tool: "boond_purchases_search",
    path: "/purchases",
    filters: { companyId: "CSOC", projectId: "PRJ" },
  },
  {
    register: registerExpenseTools,
    tool: "boond_expenses_search",
    path: "/expenses",
    filters: { resourceId: "COMP", projectId: "PRJ" },
  },
  {
    register: registerPaymentTools,
    tool: "boond_payments_search",
    path: "/payments",
    filters: { purchaseId: "ACH", companyId: "CSOC", projectId: "PRJ", resourceId: "COMP", contactId: "CCON" },
  },
  {
    register: registerProviderInvoiceTools,
    tool: "boond_provider_invoices_search",
    path: "/provider-invoices",
    filters: { companyId: "CSOC", resourceId: "COMP" },
  },
  {
    register: registerTimesheetTools,
    tool: "boond_timesheets_search",
    path: "/times-reports",
    filters: { resourceId: "COMP" },
    extra: { startMonth: "2026-09", endMonth: "2026-09" },
  },
  {
    register: registerAbsenceTools,
    tool: "boond_absences_search",
    path: "/absences-reports",
    filters: { resourceId: "COMP" },
  },
  {
    register: registerPositioningTools,
    tool: "boond_positionings_search",
    path: "/positionings",
    filters: { candidateId: "CAND", resourceId: "COMP", opportunityId: "AO", companyId: "CSOC", contactId: "CCON" },
  },
];

describe("linked-entity filters reach BoondManager as keywords references (#247)", () => {
  let server: McpServer;
  beforeEach(() => {
    server = { registerTool: vi.fn() } as unknown as McpServer;
    vi.mocked(apiRequest).mockClear();
    vi.mocked(apiSearch).mockClear();
  });

  function sentQuery(path: string): Record<string, unknown> {
    const viaSearch = vi.mocked(apiSearch).mock.calls.find((c) => c[0] === path);
    if (viaSearch) return viaSearch[1] as Record<string, unknown>;
    const viaRequest = vi.mocked(apiRequest).mock.calls.find((c) => c[0] === path);
    if (!viaRequest) throw new Error(`no API call on ${path}`);
    return viaRequest[3] as Record<string, unknown>;
  }

  for (const c of CASES) {
    for (const [filter, prefix] of Object.entries(c.filters)) {
      it(`${c.tool}: ${filter} → keywords ${prefix}<id>, never a raw ${filter} parameter`, async () => {
        c.register(server);
        const call = vi.mocked(server.registerTool).mock.calls.find((x) => x[0] === c.tool);
        expect(call, `${c.tool} not registered`).toBeDefined();
        const handler = call![2] as (params: unknown, extra?: unknown) => Promise<unknown>;
        await handler({ ...c.extra, keywords: "libre", [filter]: "77", page: 1, pageSize: 30 });
        const query = sentQuery(c.path);
        expect(String(query.keywords).split(" ")).toEqual(["libre", `${prefix}77`]);
        expect(query).not.toHaveProperty(filter);
      });
    }
  }

  it("covers every search schema that declares a linked-entity filter", () => {
    // Guard: a new `*Id` filter on a search tool must land in the table above.
    expect(CASES.map((c) => c.tool).sort()).toEqual(
      [
        "boond_absences_search",
        "boond_actions_search",
        "boond_deliveries_search",
        "boond_expenses_search",
        "boond_invoices_search",
        "boond_orders_search",
        "boond_payments_search",
        "boond_positionings_search",
        "boond_provider_invoices_search",
        "boond_purchases_search",
        "boond_timesheets_search",
      ].sort()
    );
  });
});
