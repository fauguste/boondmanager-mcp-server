import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerOrderTools } from "./orders.js";
import { apiRequest } from "../services/boond-client.js";
import { OrderCreateSchema, OrderUpdateSchema } from "../schemas/index.js";

vi.mock("../services/boond-client.js", () => ({
  apiRequest: vi.fn().mockResolvedValue({ data: { id: "1", type: "order", attributes: {} } }),
  buildSearchQuery: vi.fn((params: Record<string, unknown>) => params),
  formatListResponse: vi.fn().mockReturnValue(""),
  formatDetailResponse: vi.fn().mockReturnValue(""),
}));

function createMockServer() {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer;
}

describe("registerOrderTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockClear();
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "1", type: "order", attributes: {} } } as never);
  });

  it("should register 5 order tools", () => {
    registerOrderTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(5);
  });

  it("should register all expected tool names", () => {
    registerOrderTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_orders_search");
    expect(names).toContain("boond_orders_get");
    expect(names).toContain("boond_orders_create");
    expect(names).toContain("boond_orders_update");
    expect(names).toContain("boond_orders_delete");
  });

  it("should register search and get as readOnly", () => {
    registerOrderTools(server);
    const readOnlyCalls = vi
      .mocked(server.registerTool)
      .mock.calls.filter(
        (c) => typeof c[0] === "string" && ["boond_orders_search", "boond_orders_get"].includes(c[0] as string)
      );
    for (const call of readOnlyCalls) {
      expect(call[1].annotations?.readOnlyHint).toBe(true);
    }
  });

  it("should register delete as destructive", () => {
    registerOrderTools(server);
    const deleteCall = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_orders_delete");
    expect(deleteCall?.[1].annotations?.destructiveHint).toBe(true);
  });

  it("rejects order amount fields that are not mapped", () => {
    expect(OrderCreateSchema.safeParse({ amountIncludingTax: 12600 }).success).toBe(false);
    expect(OrderUpdateSchema.safeParse({ id: "1", amountIncludingTax: 12600 }).success).toBe(false);
  });

  it("updates order information with Boond schedule fields", async () => {
    registerOrderTools(server);
    const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_orders_update");
    const handler = call?.[2] as (params: unknown) => Promise<unknown>;

    await handler({
      id: "1",
      reference: "BC-1",
      amountExcludingTax: 12000,
      customerAgreement: true,
      schedules: [{ title: "Echeance", date: "2026-07-31", amountExcludingTax: 12000 }],
    });

    expect(apiRequest).toHaveBeenCalledWith("/orders/1/information", "PUT", {
      data: {
        type: "order",
        attributes: {
          number: "BC-1",
          turnoverOrderedExcludingTax: 12000,
          customerAgreement: true,
          schedules: [
            {
              date: "2026-07-31",
              title: "Echeance",
              turnoverQuotaExcludingTax: 12000,
              turnoverTermOfPaymentExcludingTax: 12000,
              forceTermOfPaymentExcludingTax: true,
            },
          ],
        },
        id: "1",
      },
    });
  });
});
