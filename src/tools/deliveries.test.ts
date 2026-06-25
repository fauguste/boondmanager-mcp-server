import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMockServer, registeredToolNames, toolCallback } from "./test-helpers.js";
import { registerDeliveryTools } from "./deliveries.js";
import { apiRequest } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", () => ({
  apiRequest: vi.fn().mockResolvedValue({ data: { id: "21", type: "delivery", attributes: {} } }),
  buildSearchQuery: vi.fn((params: Record<string, unknown>) => params),
  formatListResponse: vi.fn().mockReturnValue(""),
  formatDetailResponse: vi.fn().mockReturnValue(""),
}));

describe("registerDeliveryTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "21", type: "delivery", attributes: {} } } as never);
  });

  it("should register 3 delivery tools", () => {
    registerDeliveryTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(3);
  });

  it("should register all expected tool names", () => {
    registerDeliveryTools(server);
    const names = registeredToolNames(server);
    expect(names).toContain("boond_deliveries_create");
    expect(names).toContain("boond_deliveries_search");
    expect(names).toContain("boond_deliveries_get");
  });

  it("should register search/get as readOnly and create as write", () => {
    registerDeliveryTools(server);
    const calls = vi.mocked(server.registerTool).mock.calls;
    expect(calls.find((c) => c[0] === "boond_deliveries_create")?.[1].annotations?.readOnlyHint).toBe(false);
    expect(calls.find((c) => c[0] === "boond_deliveries_search")?.[1].annotations?.readOnlyHint).toBe(true);
    expect(calls.find((c) => c[0] === "boond_deliveries_get")?.[1].annotations?.readOnlyHint).toBe(true);
  });

  it("search should call the BoondManager API on the deliveries groupments path", async () => {
    registerDeliveryTools(server);
    await toolCallback(server, "boond_deliveries_search")({ page: 2, pageSize: 10 });
    expect(vi.mocked(apiRequest).mock.calls[0][0]).toBe("/deliveries-groupments");
    expect(vi.mocked(apiRequest).mock.calls[0][1]).toBe("GET");
  });

  it("get should call the BoondManager API on the detail path", async () => {
    registerDeliveryTools(server);
    await toolCallback(server, "boond_deliveries_get")({ id: "42" });
    expect(vi.mocked(apiRequest).mock.calls[0][0]).toBe("/deliveries/42");
  });

  it("creates deliveries through /deliveries with project and dependsOn resource", async () => {
    registerDeliveryTools(server);

    await toolCallback(
      server,
      "boond_deliveries_create"
    )({
      projectId: "2",
      resourceId: "4",
      title: "Prestation",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      quantity: 15,
      unitPrice: 850,
      note: "note",
    });

    expect(apiRequest).toHaveBeenCalledWith("/deliveries", "POST", {
      data: {
        type: "delivery",
        attributes: {
          title: "Prestation",
          startDate: "2026-08-01",
          endDate: "2026-08-31",
          numberOfDaysInvoicedOrQuantity: 15,
          averageDailyPriceExcludingTax: 850,
          forceAverageDailyPriceExcludingTax: true,
          informationComments: "note",
        },
        relationships: {
          project: { data: { id: "2", type: "project" } },
          dependsOn: { data: { id: "4", type: "resource" } },
        },
      },
    });
  });
});
