import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTimesheetTools } from "./timesheets.js";

function createMockServer() {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer;
}

describe("registerTimesheetTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("should register 4 timesheet tools", () => {
    registerTimesheetTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(4);
  });

  it("should register boond_resources_timesheets tool", () => {
    registerTimesheetTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_resources_timesheets");
  });

  it("should register boond_timesheets_search tool", () => {
    registerTimesheetTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_timesheets_search");
  });

  it("should register boond_timesheets_create tool", () => {
    registerTimesheetTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_timesheets_create");
  });

  it("should register boond_timesheets_get tool", () => {
    registerTimesheetTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_timesheets_get");
  });

  it("should register read tools as readOnly and create as write", () => {
    registerTimesheetTools(server);
    const calls = vi.mocked(server.registerTool).mock.calls;
    expect(calls.find((c) => c[0] === "boond_timesheets_create")?.[1].annotations?.readOnlyHint).toBe(false);
    expect(calls.find((c) => c[0] === "boond_timesheets_search")?.[1].annotations?.readOnlyHint).toBe(true);
    expect(calls.find((c) => c[0] === "boond_timesheets_get")?.[1].annotations?.readOnlyHint).toBe(true);
    expect(calls.find((c) => c[0] === "boond_resources_timesheets")?.[1].annotations?.readOnlyHint).toBe(true);
  });
});
