import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPurchaseTools } from "./purchases.js";

function createMockServer() {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer;
}

describe("registerPurchaseTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("should register 4 purchase tools", () => {
    registerPurchaseTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(4);
  });

  it("should register all expected tool names", () => {
    registerPurchaseTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_purchases_search");
    expect(names).toContain("boond_purchases_get");
    expect(names).toContain("boond_purchases_create");
    expect(names).toContain("boond_purchases_delete");
  });

  it("should register search and get as readOnly", () => {
    registerPurchaseTools(server);
    const readOnlyCalls = vi
      .mocked(server.registerTool)
      .mock.calls.filter(
        (c) => typeof c[0] === "string" && ["boond_purchases_search", "boond_purchases_get"].includes(c[0] as string)
      );
    for (const call of readOnlyCalls) {
      expect(call[1].annotations?.readOnlyHint).toBe(true);
    }
  });

  it("should register delete as destructive", () => {
    registerPurchaseTools(server);
    const deleteCall = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_purchases_delete");
    expect(deleteCall?.[1].annotations?.destructiveHint).toBe(true);
  });

  it("should register create as non-readOnly and non-destructive", () => {
    registerPurchaseTools(server);
    const createCall = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_purchases_create");
    expect(createCall?.[1].annotations?.readOnlyHint).toBe(false);
    expect(createCall?.[1].annotations?.destructiveHint).toBe(false);
  });
});
