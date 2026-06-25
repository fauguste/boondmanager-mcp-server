import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerInvoiceTools } from "./invoices.js";
import { apiRequest } from "../services/boond-client.js";
import { InvoiceCreateSchema, InvoiceUpdateSchema } from "../schemas/index.js";

vi.mock("../services/boond-client.js", () => ({
  apiRequest: vi.fn().mockResolvedValue({ data: { id: "1", type: "invoice", attributes: {} } }),
  buildSearchQuery: vi.fn((params: Record<string, unknown>) => params),
  formatListResponse: vi.fn().mockReturnValue(""),
  formatDetailResponse: vi.fn().mockReturnValue(""),
}));

function createMockServer() {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer;
}

describe("registerInvoiceTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockClear();
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "1", type: "invoice", attributes: {} } } as never);
  });

  it("should register 5 invoice tools", () => {
    registerInvoiceTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(5);
  });

  it("should register all expected tool names", () => {
    registerInvoiceTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_invoices_search");
    expect(names).toContain("boond_invoices_get");
    expect(names).toContain("boond_invoices_create");
    expect(names).toContain("boond_invoices_update");
    expect(names).toContain("boond_invoices_delete");
  });

  it("should register search and get as readOnly", () => {
    registerInvoiceTools(server);
    const readOnlyCalls = vi
      .mocked(server.registerTool)
      .mock.calls.filter(
        (c) => typeof c[0] === "string" && ["boond_invoices_search", "boond_invoices_get"].includes(c[0] as string)
      );
    for (const call of readOnlyCalls) {
      expect(call[1].annotations?.readOnlyHint).toBe(true);
    }
  });

  it("should register delete as destructive", () => {
    registerInvoiceTools(server);
    const deleteCall = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_invoices_delete");
    expect(deleteCall?.[1].annotations?.destructiveHint).toBe(true);
  });

  it("keeps invoice create contract centered on orderId", () => {
    expect(InvoiceCreateSchema.safeParse({ orderId: "7", reference: "FAC-1" }).success).toBe(true);
    expect(InvoiceCreateSchema.safeParse({ companyId: "1", projectId: "2", reference: "FAC-1" }).success).toBe(false);
  });

  it("rejects invoice update fields that are not mapped by the information endpoint", () => {
    expect(InvoiceUpdateSchema.safeParse({ id: "1", orderId: "7" }).success).toBe(false);
    expect(InvoiceUpdateSchema.safeParse({ id: "1", dueDate: "2026-08-24" }).success).toBe(false);
    expect(InvoiceUpdateSchema.safeParse({ id: "1", amountIncludingTax: 12600 }).success).toBe(false);
  });

  it("creates invoices with an order relationship", async () => {
    registerInvoiceTools(server);
    const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_invoices_create");
    const handler = call?.[2] as (params: unknown) => Promise<unknown>;

    await handler({ orderId: "7", reference: "FAC-1", amountExcludingTax: 12000, taxRate: 5 });

    expect(apiRequest).toHaveBeenCalledWith("/invoices", "POST", {
      data: {
        type: "invoice",
        attributes: {
          reference: "FAC-1",
          invoiceRecords: [
            {
              invoiceRecordType: null,
              description: "Prestation",
              amountExcludingTax: 12000,
              quantity: 1,
              taxRates: [5],
              taxes: [5],
            },
          ],
        },
        relationships: {
          order: { data: { id: "7", type: "order" } },
        },
      },
    });
  });

  it("updates invoice information with records and customer payments", async () => {
    registerInvoiceTools(server);
    const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_invoices_update");
    const handler = call?.[2] as (params: unknown) => Promise<unknown>;

    await handler({
      id: "1",
      reference: "FAC-1",
      invoiceDate: "2026-07-25",
      expectedPaymentDate: "2026-08-24",
      amountExcludingTax: 12000,
      taxRate: 5,
      invoicePayments: [{ createdAt: "2026-08-10T10:00:00+0000", amountIncludingTax: 12600, comment: "paye" }],
      note: "Audit",
    });

    expect(apiRequest).toHaveBeenCalledWith("/invoices/1/information", "PUT", {
      data: {
        type: "invoice",
        attributes: {
          reference: "FAC-1",
          expectedPaymentDate: "2026-08-24",
          invoicePayments: [{ createdAt: "2026-08-10T10:00:00+0000", amountIncludingTax: 12600, comment: "paye" }],
          date: "2026-07-25",
          invoiceRecords: [
            {
              invoiceRecordType: null,
              description: "Audit",
              amountExcludingTax: 12000,
              quantity: 1,
              taxRates: [5],
              taxes: [5],
            },
          ],
          informationComments: "Audit",
        },
        id: "1",
      },
    });
  });
});
