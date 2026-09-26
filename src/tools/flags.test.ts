import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMockServer, registeredToolNames, toolCallback } from "./test-helpers.js";
import { buildAttachedFlagBody, buildFlagBody, registerFlagTools } from "./flags.js";
import { apiRequest, apiSearch } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn(), apiSearch: vi.fn() };
});

describe("registerFlagTools", () => {
  let server: McpServer;
  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiSearch).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "85", type: "flag", attributes: { name: "VIP" } } } as never);
    vi.mocked(apiSearch).mockResolvedValue({ data: [] } as never);
  });

  it("registers search, get and the four write / attached tools (#254)", () => {
    registerFlagTools(server);
    expect(registeredToolNames(server)).toEqual([
      "boond_flags_search",
      "boond_flags_get",
      "boond_flags_create",
      "boond_flags_attached",
      "boond_flags_attach",
      "boond_flags_detach",
    ]);
  });

  it("search and get keep the standard read paths", async () => {
    registerFlagTools(server);
    await toolCallback(server, "boond_flags_search")({ page: 1, pageSize: 10 });
    expect(vi.mocked(apiSearch).mock.calls[0]?.[0]).toBe("/flags");
    await toolCallback(server, "boond_flags_get")({ id: "85" });
    expect(vi.mocked(apiRequest).mock.calls[0]?.[0]).toBe("/flags/85");
  });

  it("create POSTs name (+ optional mainManager) on /flags", async () => {
    registerFlagTools(server);
    const result = (await toolCallback(
      server,
      "boond_flags_create"
    )({ name: "vivier Java Q4", mainManagerId: "18081" })) as {
      structuredContent?: Record<string, unknown>;
    };
    expect(apiRequest).toHaveBeenCalledWith("/flags", "POST", {
      data: {
        type: "flag",
        attributes: { name: "vivier Java Q4" },
        relationships: { mainManager: { data: { id: "18081", type: "resource" } } },
      },
    });
    expect(result.structuredContent).toEqual({ id: "85", type: "flag" });
    expect(buildFlagBody({ name: "x" })).toEqual({ data: { type: "flag", attributes: { name: "x" } } });
  });

  it("attached lists GET /{entity}/{id}/attached-flags", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      data: [{ id: "1", type: "attachedflag", attributes: { name: "VIP" } }],
    } as never);
    registerFlagTools(server);
    const result = (await toolCallback(server, "boond_flags_attached")({ entity: "candidate", id: "42" })) as {
      content: Array<{ text: string }>;
    };
    expect(apiRequest).toHaveBeenCalledWith("/candidates/42/attached-flags");
    expect(result.content[0]?.text).toContain("VIP");
  });

  it("attach POSTs flag + dependsOn relationships on /attached-flags", async () => {
    registerFlagTools(server);
    const result = (await toolCallback(
      server,
      "boond_flags_attach"
    )({ entity: "candidate", id: "42", flagId: "85" })) as {
      structuredContent: Record<string, unknown>;
    };
    expect(apiRequest).toHaveBeenCalledWith(
      "/attached-flags",
      "POST",
      buildAttachedFlagBody({ entity: "candidate", id: "42", flagId: "85" })
    );
    expect(buildAttachedFlagBody({ entity: "company", id: "7", flagId: "85" })).toEqual({
      data: {
        type: "attachedflag",
        attributes: {},
        relationships: {
          flag: { data: { id: "85", type: "flag" } },
          dependsOn: { data: { id: "7", type: "company" } },
        },
      },
    });
    expect(result.structuredContent).toEqual({ entity: "candidate", id: "42", flagId: "85", attached: true });
  });

  it("detach DELETEs /attached-flags with flag + the entity's query parameter (RAML)", async () => {
    registerFlagTools(server);
    const result = (await toolCallback(
      server,
      "boond_flags_detach"
    )({ entity: "opportunity", id: "9", flagId: "85" })) as {
      structuredContent: Record<string, unknown>;
    };
    expect(apiRequest).toHaveBeenCalledWith("/attached-flags", "DELETE", undefined, { flag: "85", opportunity: "9" });
    expect(result.structuredContent).toEqual({ entity: "opportunity", id: "9", flagId: "85", attached: false });
  });

  it("annotations: reads read-only, writes idempotent and non-destructive", () => {
    registerFlagTools(server);
    const a = (name: string) => vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === name)?.[1].annotations;
    expect(a("boond_flags_attached")?.readOnlyHint).toBe(true);
    expect(a("boond_flags_attach")).toMatchObject({
      readOnlyHint: false,
      idempotentHint: true,
      destructiveHint: false,
    });
    expect(a("boond_flags_detach")).toMatchObject({
      readOnlyHint: false,
      idempotentHint: true,
      destructiveHint: false,
    });
    expect(a("boond_flags_create")?.idempotentHint).toBe(false);
  });
});
