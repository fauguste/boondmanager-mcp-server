import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerContractTools } from "./contracts.js";
import { toolCallback } from "./test-helpers.js";
import { apiRequest } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", () => ({
  apiRequest: vi.fn(),
  formatDetailResponse: vi.fn().mockReturnValue(""),
}));

function createMockServer() {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer;
}

describe("registerContractTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("should register 2 contract tools", () => {
    registerContractTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(2);
  });

  it("should register all expected tool names", () => {
    registerContractTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_contracts_get");
    expect(names).toContain("boond_contracts_create");
  });

  it("should register get as readOnly", () => {
    registerContractTools(server);
    const getCall = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_contracts_get");
    expect(getCall?.[1].annotations?.readOnlyHint).toBe(true);
  });

  it("should register create as non-readOnly", () => {
    registerContractTools(server);
    const createCall = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_contracts_create");
    expect(createCall?.[1].annotations?.readOnlyHint).toBe(false);
    expect(createCall?.[1].annotations?.destructiveHint).toBe(false);
  });

  it("returns the created contract id in structuredContent, as the description promises (#229)", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "77", type: "contract", attributes: {} } } as never);
    registerContractTools(server);
    const createCall = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_contracts_create");
    expect(createCall?.[1].outputSchema).toBeDefined();

    const result = (await toolCallback(
      server,
      "boond_contracts_create"
    )({ resourceId: "5", typeOf: 1, startDate: "2026-01-01" })) as { structuredContent?: Record<string, unknown> };
    expect(result.structuredContent).toEqual({ id: "77", type: "contract" });
    expect(apiRequest).toHaveBeenCalledWith("/contracts", "POST", {
      data: {
        type: "contract",
        attributes: { typeOf: 1, startDate: "2026-01-01" },
        relationships: { resource: { data: { id: "5", type: "resource" } } },
      },
    });
  });

  it("types typeOf as the dictionary integer, not a label (#229)", () => {
    registerContractTools(server);
    const createCall = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_contracts_create");
    const schema = createCall?.[1].inputSchema as { safeParse: (v: unknown) => { success: boolean } };
    expect(schema.safeParse({ typeOf: 1 }).success).toBe(true);
    expect(schema.safeParse({ typeOf: "CDI" }).success).toBe(false);
  });

  it("does not send the model to a tool that does not exist", () => {
    registerContractTools(server);
    for (const call of vi.mocked(server.registerTool).mock.calls) {
      expect(call[1].description).not.toContain("boond_contracts_search");
      expect(call[1].description).toContain("boond_resources_administrative");
    }
  });
});
