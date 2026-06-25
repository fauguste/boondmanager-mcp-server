import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMockServer, registeredToolNames, toolCallback } from "./test-helpers.js";
import { registerPaymentTools } from "./payments.js";
import { apiRequest } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", () => ({
  apiRequest: vi.fn().mockResolvedValue({ data: { id: "9", type: "payment", attributes: {} } }),
  buildSearchQuery: vi.fn((params: Record<string, unknown>) => params),
  formatListResponse: vi.fn().mockReturnValue(""),
  formatDetailResponse: vi.fn().mockReturnValue(""),
}));

describe("registerPaymentTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "9", type: "payment", attributes: {} } } as never);
  });

  it("should register 3 payment tools", () => {
    registerPaymentTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(3);
  });

  it("should register all expected tool names", () => {
    registerPaymentTools(server);
    const names = registeredToolNames(server);
    expect(names).toContain("boond_payments_create");
    expect(names).toContain("boond_payments_search");
    expect(names).toContain("boond_payments_get");
  });

  it("should register search/get as readOnly and create as write", () => {
    registerPaymentTools(server);
    const calls = vi.mocked(server.registerTool).mock.calls;
    expect(calls.find((c) => c[0] === "boond_payments_create")?.[1].annotations?.readOnlyHint).toBe(false);
    expect(calls.find((c) => c[0] === "boond_payments_search")?.[1].annotations?.readOnlyHint).toBe(true);
    expect(calls.find((c) => c[0] === "boond_payments_get")?.[1].annotations?.readOnlyHint).toBe(true);
  });

  it("maps create input to Boond purchase payment body", async () => {
    registerPaymentTools(server);

    await toolCallback(
      server,
      "boond_payments_create"
    )({
      purchaseId: "3",
      paymentDate: "2026-08-10",
      amount: 3200,
      reference: "PAY-1",
      note: "note",
    });

    expect(apiRequest).toHaveBeenCalledWith("/payments", "POST", {
      data: {
        type: "payment",
        attributes: {
          date: "2026-08-10",
          amountExcludingTax: 3200,
          number: "PAY-1",
          informationComments: "note",
        },
        relationships: {
          purchase: { data: { id: "3", type: "purchase" } },
        },
      },
    });
  });

  it("converts payment search filters into keyword references", async () => {
    registerPaymentTools(server);

    await toolCallback(
      server,
      "boond_payments_search"
    )({
      purchaseId: "1",
      companyId: "2",
      projectId: "3",
      resourceId: "4",
      page: 1,
      pageSize: 20,
    });

    const query = vi.mocked(apiRequest).mock.calls[0][3] as Record<string, unknown>;
    expect(query.keywords).toContain("ACH1");
    expect(query.keywords).toContain("CSOC2");
    expect(query.keywords).toContain("PRJ3");
    expect(query.keywords).toContain("COMP4");
  });
});
