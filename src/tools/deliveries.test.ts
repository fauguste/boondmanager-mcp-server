import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMockServer, registeredToolNames, toolCallback } from "./test-helpers.js";
import { buildDeliveryBody, registerDeliveryTools } from "./deliveries.js";
import { apiRequest, apiSearch } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn(), apiSearch: vi.fn() };
});

describe("registerDeliveryTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "21", type: "delivery", attributes: {} } } as never);
    vi.mocked(apiSearch).mockReset();
    vi.mocked(apiSearch).mockResolvedValue({ data: [] } as never);
  });

  it("should register 3 delivery tools", () => {
    registerDeliveryTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(5);
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
    // Search goes through apiSearch (per-route maxResults chunking).
    expect(vi.mocked(apiSearch).mock.calls[0][0]).toBe("/deliveries-groupments");
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

describe("buildDeliveryBody (#245)", () => {
  it("sends only the two mandatory relationships when no convenience field is given", () => {
    expect(buildDeliveryBody({ projectId: "2", resourceId: "4" })).toEqual({
      data: {
        type: "delivery",
        attributes: {},
        relationships: {
          project: { data: { id: "2", type: "project" } },
          dependsOn: { data: { id: "4", type: "resource" } },
        },
      },
    });
  });

  it("forces the daily price only when a unit price is supplied", () => {
    const withPrice = buildDeliveryBody({ projectId: "2", resourceId: "4", unitPrice: 700 }) as {
      data: { attributes: Record<string, unknown> };
    };
    expect(withPrice.data.attributes).toEqual({
      averageDailyPriceExcludingTax: 700,
      forceAverageDailyPriceExcludingTax: true,
    });
    const withQuantity = buildDeliveryBody({ projectId: "2", resourceId: "4", quantity: 10 }) as {
      data: { attributes: Record<string, unknown> };
    };
    expect(withQuantity.data.attributes).toEqual({ numberOfDaysInvoicedOrQuantity: 10 });
  });
});

describe("boond_deliveries_update / _delete (issue #252)", () => {
  let server: McpServer;
  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "21", type: "delivery", attributes: {} } } as never);
  });

  it("PUTs the mapped attributes on /deliveries/{id}, without touching the project / resource attachment", async () => {
    registerDeliveryTools(server);
    expect(registeredToolNames(server)).toEqual(
      expect.arrayContaining(["boond_deliveries_update", "boond_deliveries_delete"])
    );
    const result = (await toolCallback(
      server,
      "boond_deliveries_update"
    )({
      id: "21",
      endDate: "2026-12-31",
      unitPrice: 650,
      note: "prolongation",
    })) as { structuredContent?: Record<string, unknown> };
    expect(apiRequest).toHaveBeenCalledWith("/deliveries/21", "PUT", {
      data: {
        type: "delivery",
        id: "21",
        attributes: {
          endDate: "2026-12-31",
          averageDailyPriceExcludingTax: 650,
          forceAverageDailyPriceExcludingTax: true,
          informationComments: "prolongation",
        },
      },
    });
    expect(result.structuredContent).toEqual({ id: "21", type: "delivery" });
  });

  it("delete is destructive and update idempotent", () => {
    registerDeliveryTools(server);
    const call = (name: string) => vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === name)?.[1];
    expect(call("boond_deliveries_delete")?.annotations?.destructiveHint).toBe(true);
    expect(call("boond_deliveries_update")?.annotations?.idempotentHint).toBe(true);
    expect(call("boond_deliveries_update")?.annotations?.readOnlyHint).toBe(false);
  });
});
