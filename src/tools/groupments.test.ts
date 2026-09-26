import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMockServer, registeredToolNames, toolCallback } from "./test-helpers.js";
import { buildGroupmentBody, registerGroupmentTools } from "./groupments.js";
import { apiRequest } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

describe("registerGroupmentTools (issue #256)", () => {
  let server: McpServer;
  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "55", type: "groupment", attributes: {} } } as never);
  });

  it("registers default, get, create and update", () => {
    registerGroupmentTools(server);
    expect(registeredToolNames(server)).toEqual([
      "boond_groupments_default",
      "boond_groupments_get",
      "boond_groupments_create",
      "boond_groupments_update",
    ]);
  });

  it("default reads GET /groupments/default?project=", async () => {
    registerGroupmentTools(server);
    await toolCallback(server, "boond_groupments_default")({ projectId: "5" });
    expect(apiRequest).toHaveBeenCalledWith("/groupments/default", "GET", undefined, { project: "5" });
  });

  it("create POSTs project + deliveries relationships, update PUTs on /groupments/{id} without the project", async () => {
    registerGroupmentTools(server);
    await toolCallback(
      server,
      "boond_groupments_create"
    )({
      projectId: "5",
      title: "Lot 1",
      deliveryIds: ["10", "11"],
      averageDailyPriceExcludingTax: 700,
      note: "forfait",
    });
    expect(apiRequest).toHaveBeenCalledWith("/groupments", "POST", {
      data: {
        type: "groupment",
        attributes: { title: "Lot 1", averageDailyPriceExcludingTax: 700, informationComments: "forfait" },
        relationships: {
          project: { data: { id: "5", type: "project" } },
          deliveries: {
            data: [
              { id: "10", type: "delivery" },
              { id: "11", type: "delivery" },
            ],
          },
        },
      },
    });
    await toolCallback(server, "boond_groupments_update")({ id: "55", endDate: "2026-12-31" });
    expect(apiRequest).toHaveBeenLastCalledWith("/groupments/55", "PUT", {
      data: { type: "groupment", id: "55", attributes: { endDate: "2026-12-31" } },
    });
    expect(buildGroupmentBody({ projectId: "5", title: "x" })).toEqual({
      data: {
        type: "groupment",
        attributes: { title: "x" },
        relationships: { project: { data: { id: "5", type: "project" } } },
      },
    });
  });
});
