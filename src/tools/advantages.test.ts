import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMockServer, registeredToolNames, toolCallback } from "./test-helpers.js";
import { registerAdvantageTools } from "./advantages.js";
import { apiRequest } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn(), apiSearch: vi.fn() };
});

describe("registerAdvantageTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ data: [] } as never);
  });

  it("registers search + get, both read-only", () => {
    registerAdvantageTools(server);
    expect(registeredToolNames(server)).toEqual(["boond_advantages_search", "boond_advantages_get"]);
    for (const call of vi.mocked(server.registerTool).mock.calls) {
      expect(call[1].annotations?.readOnlyHint).toBe(true);
    }
  });

  // `GET /advantages` does not exist — the live API answers a WAF 403 page and
  // the RAML only documents POST there; the list lives under the resource
  // (issue #247).
  it("lists a resource's advantages through /resources/{id}/advantages, never GET /advantages", async () => {
    registerAdvantageTools(server);
    await toolCallback(
      server,
      "boond_advantages_search"
    )({
      resourceId: "47182",
      advantageTypes: ["2_1"],
      page: 2,
      pageSize: 10,
    });
    const [path, method, , query] = vi.mocked(apiRequest).mock.calls[0];
    expect(path).toBe("/resources/47182/advantages");
    expect(method).toBe("GET");
    expect(query).toMatchObject({ advantageTypes: ["2_1"], page: 2, maxResults: 10 });
    expect(query).not.toHaveProperty("resourceId");
  });

  it("requires resourceId in the advertised schema", () => {
    registerAdvantageTools(server);
    const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_advantages_search")!;
    const schema = call[1].inputSchema as unknown as { safeParse: (v: unknown) => { success: boolean } };
    expect(schema.safeParse({ page: 1 }).success).toBe(false);
    expect(schema.safeParse({ resourceId: "5" }).success).toBe(true);
    expect(schema.safeParse({ resourceId: "5", keywords: "x" }).success).toBe(false);
  });

  it("get reads /advantages/{id}", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "9", type: "advantage", attributes: {} } } as never);
    registerAdvantageTools(server);
    await toolCallback(server, "boond_advantages_get")({ id: "9" });
    expect(vi.mocked(apiRequest).mock.calls[0][0]).toBe("/advantages/9");
  });
});
