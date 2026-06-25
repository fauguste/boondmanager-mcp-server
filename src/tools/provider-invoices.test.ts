import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProviderInvoiceTools } from "./provider-invoices.js";
import { apiRequest } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", () => ({
  apiRequest: vi.fn().mockResolvedValue({ data: { id: "11", type: "providerinvoice", attributes: {} } }),
  buildSearchQuery: vi.fn((params: Record<string, unknown>) => params),
  formatListResponse: vi.fn().mockReturnValue(""),
  formatDetailResponse: vi.fn().mockReturnValue(""),
}));

function createMockServer() {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer;
}

describe("registerProviderInvoiceTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockClear();
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "11", type: "providerinvoice", attributes: {} } } as never);
  });

  it("should register 3 provider invoice tools", () => {
    registerProviderInvoiceTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(3);
  });

  it("should register all expected tool names", () => {
    registerProviderInvoiceTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_provider_invoices_create");
    expect(names).toContain("boond_provider_invoices_search");
    expect(names).toContain("boond_provider_invoices_get");
  });

  it("should register search/get as readOnly and create as write", () => {
    registerProviderInvoiceTools(server);
    const calls = vi.mocked(server.registerTool).mock.calls;
    expect(calls.find((c) => c[0] === "boond_provider_invoices_create")?.[1].annotations?.readOnlyHint).toBe(false);
    expect(calls.find((c) => c[0] === "boond_provider_invoices_search")?.[1].annotations?.readOnlyHint).toBe(true);
    expect(calls.find((c) => c[0] === "boond_provider_invoices_get")?.[1].annotations?.readOnlyHint).toBe(true);
  });

  it("rejects provider invoice fields that are not mapped", () => {
    registerProviderInvoiceTools(server);
    const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_provider_invoices_create");
    const schema = call?.[1].inputSchema as { safeParse: (input: unknown) => { success: boolean } };

    expect(
      schema.safeParse({
        reference: "FF-1",
        resourceId: "4",
        startDate: "2026-08-01",
        endDate: "2026-08-31",
        dueDate: "2026-09-30",
      }).success
    ).toBe(false);
  });

  it("maps create input to providerCompany/providerContact/resource relationships", async () => {
    registerProviderInvoiceTools(server);
    const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_provider_invoices_create");
    const handler = call?.[2] as (params: unknown) => Promise<unknown>;

    await handler({
      reference: "FF-1",
      resourceId: "4",
      companyId: "1",
      contactId: "2",
      invoiceDate: "2026-08-18",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      amountExcludingTax: 4700,
    });

    expect(apiRequest).toHaveBeenCalledWith("/provider-invoices", "POST", {
      data: {
        type: "providerinvoice",
        attributes: {
          reference: "FF-1",
          invoiceDate: "2026-08-18",
          startDate: "2026-08-01",
          endDate: "2026-08-31",
          amountExcludingTax: 4700,
        },
        relationships: {
          resource: { data: { id: "4", type: "resource" } },
          providerCompany: { data: { id: "1", type: "company" } },
          providerContact: { data: { id: "2", type: "contact" } },
        },
      },
    });
  });
});
