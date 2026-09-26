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

  it("should register 8 order tools (CRUD + 3 tabs)", () => {
    registerOrderTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(8);
  });

  it("should register all expected tool names", () => {
    registerOrderTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_orders_search");
    expect(names).toContain("boond_orders_get");
    expect(names).toContain("boond_orders_create");
    expect(names).toContain("boond_orders_update");
    expect(names).toContain("boond_orders_delete");
    // ENTITY_TABS.orders, wired since #258.
    expect(names).toContain("boond_orders_information");
    expect(names).toContain("boond_orders_actions");
    expect(names).toContain("boond_orders_invoices");
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

describe("order body branches (#245)", () => {
  let server: McpServer;
  const handler = (name: string) =>
    vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === name)![2] as (p: unknown) => Promise<unknown>;
  const sentBody = (i = 0) => vi.mocked(apiRequest).mock.calls[i][2] as { data: Record<string, unknown> };

  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockClear();
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "1", type: "order", attributes: {} } } as never);
    registerOrderTools(server);
  });

  it("create without ids sends no relationships, and maps the convenience names", async () => {
    await handler("boond_orders_create")({
      reference: "BC-1",
      orderDate: "2026-09-01",
      amountExcludingTax: 1000,
      note: "n",
    });
    expect(sentBody().data).toEqual({
      type: "order",
      attributes: { number: "BC-1", date: "2026-09-01", turnoverOrderedExcludingTax: 1000, informationComments: "n" },
    });
  });

  it("normalises schedules: amount fallbacks, date fallbacks, default title, id kept only as a string", async () => {
    await handler("boond_orders_create")({
      companyId: "5",
      projectId: "9",
      schedules: [
        { id: "s1", date: "2026-10-31", title: "Acompte", amountExcludingTax: 400 },
        { endDate: "2026-11-30", turnoverTermOfPaymentExcludingTax: 600 },
        { startDate: "2026-12-01", turnoverQuotaExcludingTax: 50, forceTermOfPaymentExcludingTax: false },
      ],
    });
    const { relationships, attributes } = sentBody().data as {
      relationships: unknown;
      attributes: { schedules: Array<Record<string, unknown>> };
    };
    expect(relationships).toEqual({
      company: { data: { id: "5", type: "company" } },
      project: { data: { id: "9", type: "project" } },
    });
    expect(attributes.schedules).toEqual([
      {
        id: "s1",
        date: "2026-10-31",
        title: "Acompte",
        turnoverQuotaExcludingTax: 400,
        turnoverTermOfPaymentExcludingTax: 400,
        forceTermOfPaymentExcludingTax: true,
      },
      {
        date: "2026-11-30",
        title: "Echeance",
        turnoverQuotaExcludingTax: 600,
        turnoverTermOfPaymentExcludingTax: 600,
        forceTermOfPaymentExcludingTax: true,
      },
      {
        date: "2026-12-01",
        title: "Echeance",
        turnoverQuotaExcludingTax: 50,
        turnoverTermOfPaymentExcludingTax: 0,
        forceTermOfPaymentExcludingTax: false,
      },
    ]);
  });
});
