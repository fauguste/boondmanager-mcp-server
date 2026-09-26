import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMockServer, registeredToolNames, toolCallback } from "./test-helpers.js";
import { buildInactivityBody, registerInactivityTools } from "./inactivities.js";
import { apiRequest } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

describe("registerInactivityTools (issue #256)", () => {
  let server: McpServer;
  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "40", type: "inactivity", attributes: {} } } as never);
  });

  it("registers default, get and create", () => {
    registerInactivityTools(server);
    expect(registeredToolNames(server)).toEqual([
      "boond_inactivities_default",
      "boond_inactivities_get",
      "boond_inactivities_create",
    ]);
  });

  it("default and get hit the documented routes", async () => {
    registerInactivityTools(server);
    await toolCallback(server, "boond_inactivities_default")({ resourceId: "18081" });
    expect(apiRequest).toHaveBeenCalledWith("/inactivities/default", "GET", undefined, { resource: "18081" });
    await toolCallback(server, "boond_inactivities_get")({ id: "40" });
    expect(apiRequest).toHaveBeenLastCalledWith("/inactivities/40");
  });

  it("create POSTs the attributes with the resource (and contract) relationships", async () => {
    registerInactivityTools(server);
    const result = (await toolCallback(
      server,
      "boond_inactivities_create"
    )({
      resourceId: "18081",
      title: "Intercontrat",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      contractId: "3900",
      note: "Fin de mission ACME",
    })) as { structuredContent?: Record<string, unknown> };
    expect(apiRequest).toHaveBeenCalledWith("/inactivities", "POST", {
      data: {
        type: "inactivity",
        attributes: {
          title: "Intercontrat",
          startDate: "2026-10-01",
          endDate: "2026-10-31",
          informationComments: "Fin de mission ACME",
        },
        relationships: {
          resource: { data: { id: "18081", type: "resource" } },
          contract: { data: { id: "3900", type: "contract" } },
        },
      },
    });
    expect(result.structuredContent).toEqual({ id: "40", type: "inactivity" });
    expect(buildInactivityBody({ resourceId: "1", startDate: "2026-01-01", endDate: "2026-01-02" })).toEqual({
      data: {
        type: "inactivity",
        attributes: { startDate: "2026-01-01", endDate: "2026-01-02" },
        relationships: { resource: { data: { id: "1", type: "resource" } } },
      },
    });
  });
});
