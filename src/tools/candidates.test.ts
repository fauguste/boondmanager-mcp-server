import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCandidateTools } from "./candidates.js";
import * as boondClient from "../services/boond-client.js";

function createMockServer() {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer;
}

function getHandler(server: McpServer, name: string) {
  const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === name);
  if (!call) throw new Error(`tool ${name} not registered`);
  return call[2] as (params: unknown) => Promise<unknown>;
}

describe("registerCandidateTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates via PUT /candidates/{id}/information (issue #134)", async () => {
    registerCandidateTools(server);
    const apiSpy = vi
      .spyOn(boondClient, "apiRequest")
      .mockResolvedValue({ data: { id: "4012", type: "candidate", attributes: {} } } as never);

    const handler = getHandler(server, "boond_candidates_update");
    await handler({ id: "4012", phone1: "+33769594357" });

    const [path, method] = apiSpy.mock.calls[0];
    // The base resource returns 405 on PATCH; updates target the
    // /information sub-resource with PUT.
    expect(path).toBe("/candidates/4012/information");
    expect(method).toBe("PUT");
  });

  it("should register CRUD tools + 5 tab tools = 10 total", () => {
    registerCandidateTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(10);
  });

  it("should register all CRUD tools", () => {
    registerCandidateTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_candidates_search");
    expect(names).toContain("boond_candidates_get");
    expect(names).toContain("boond_candidates_create");
    expect(names).toContain("boond_candidates_update");
    expect(names).toContain("boond_candidates_delete");
  });

  it("should register all 5 tab tools", () => {
    registerCandidateTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_candidates_information");
    expect(names).toContain("boond_candidates_technical_data");
    expect(names).toContain("boond_candidates_administrative");
    expect(names).toContain("boond_candidates_actions");
    expect(names).toContain("boond_candidates_positionings");
  });

  it("should register tab tools as readOnly and non-destructive", () => {
    registerCandidateTools(server);
    const tabCalls = vi
      .mocked(server.registerTool)
      .mock.calls.filter(
        (c) =>
          typeof c[0] === "string" &&
          [
            "boond_candidates_information",
            "boond_candidates_technical_data",
            "boond_candidates_administrative",
            "boond_candidates_actions",
            "boond_candidates_positionings",
          ].includes(c[0] as string)
      );

    expect(tabCalls).toHaveLength(5);
    for (const call of tabCalls) {
      const [, metadata] = call;
      expect(metadata.annotations?.readOnlyHint).toBe(true);
      expect(metadata.annotations?.destructiveHint).toBe(false);
    }
  });
});
