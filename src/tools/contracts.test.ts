import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildContractBody, contractSummary, filterContracts, registerContractTools } from "./contracts.js";
import { toolCallback } from "./test-helpers.js";
import { apiRequest, apiSearch } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn(), apiSearch: vi.fn() };
});

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

  it("should register 3 contract tools", () => {
    registerContractTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(3);
  });

  it("should register all expected tool names", () => {
    registerContractTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_contracts_search");
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

  it("names only tools that exist as siblings (#229, #253)", () => {
    registerContractTools(server);
    for (const call of vi.mocked(server.registerTool).mock.calls) {
      const description = String(call[1].description);
      for (const sibling of description.match(/boond_[a-z_]+/g) ?? []) {
        expect(["boond_contracts_search", "boond_contracts_get", "boond_resources_contracts"]).toContain(sibling);
      }
    }
  });
});

const CONTRACT = (id: string, attributes: Record<string, unknown>) => ({ id, type: "contract", attributes });

describe("boond_contracts_search (composed, issue #253)", () => {
  let server: McpServer;
  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiSearch).mockReset();
  });

  it("scans the resources of the perimeter, reads each administrative tab and filters the included contracts", async () => {
    vi.mocked(apiSearch).mockResolvedValue({
      data: [
        { id: "1", type: "resource", attributes: { firstName: "Ana", lastName: "Silva" } },
        { id: "2", type: "resource", attributes: { firstName: "Bob", lastName: "Roy" } },
      ],
      meta: { totals: { rows: 2 } },
    } as never);
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === "/resources/1/administrative") {
        return {
          data: { id: "1", type: "resource", attributes: {} },
          included: [
            CONTRACT("10", { typeOf: 1, startDate: "2026-01-01", endDate: "2026-10-15" }),
            { id: "9", type: "document", attributes: {} },
          ],
        } as never;
      }
      if (path === "/resources/2/administrative") {
        return {
          data: { id: "2", type: "resource", attributes: {} },
          included: [CONTRACT("11", { typeOf: 0, startDate: "2020-03-01" })],
        } as never;
      }
      throw new Error(`unexpected ${path}`);
    });
    registerContractTools(server);
    const result = (await toolCallback(
      server,
      "boond_contracts_search"
    )({
      perimeterDynamic: ["managers"],
      period: "ending",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      page: 1,
      pageSize: 30,
    })) as { content: Array<{ text: string }>; structuredContent: { total?: number; items: Array<{ id?: string }> } };

    // The resource search carries the perimeter, never the contract filters.
    const [path, query] = vi.mocked(apiSearch).mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(path).toBe("/resources");
    expect(query).toMatchObject({ perimeterDynamic: ["managers"] });
    expect(query).not.toHaveProperty("period");
    expect(query).not.toHaveProperty("startDate");
    // Only the contract ending inside the window survives; the open-ended CDI does not "end".
    expect(result.structuredContent.total).toBe(1);
    expect(result.structuredContent.items.map((i) => i.id)).toEqual(["10"]);
    expect(result.content[0].text).toContain("[contract #10]");
    expect(result.content[0].text).toContain("Ana Silva (#1)");
  });

  it("reads a single resource when resourceId is given, without searching", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      data: { id: "7", type: "resource", attributes: {} },
      included: [CONTRACT("70", { typeOf: 1, startDate: "2025-01-01" })],
    } as never);
    registerContractTools(server);
    const result = (await toolCallback(
      server,
      "boond_contracts_search"
    )({ resourceId: "7", page: 1, pageSize: 30 })) as {
      structuredContent: { total?: number };
    };
    expect(apiSearch).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledWith("/resources/7/administrative");
    expect(result.structuredContent.total).toBe(1);
  });
});

describe("filterContracts / contractSummary", () => {
  const cdi = CONTRACT("1", { typeOf: 0, startDate: "2020-01-01", probationEndDate: "2020-04-01" });
  const cdd = CONTRACT("2", {
    typeOf: 1,
    startDate: "2026-09-01",
    endDate: "2026-12-31",
    renewalProbationEndDate: "2026-10-10",
    probationState: 0,
  });
  const window = { startDate: "2026-10-01", endDate: "2026-10-31" };

  it("running: an open-ended contract runs on any window, a dated one only when it overlaps", () => {
    expect(filterContracts([cdi, cdd], { period: "running", ...window }).map((c) => c.id)).toEqual(["1", "2"]);
    expect(filterContracts([cdd], { period: "running", startDate: "2027-01-01", endDate: "2027-02-01" })).toEqual([]);
  });

  it("ending / starting / probationEnding look at the matching date only", () => {
    expect(
      filterContracts([cdi, cdd], { period: "ending", startDate: "2026-12-01", endDate: "2026-12-31" }).map((c) => c.id)
    ).toEqual(["2"]);
    expect(
      filterContracts([cdi, cdd], { period: "starting", startDate: "2026-09-01", endDate: "2026-09-30" }).map(
        (c) => c.id
      )
    ).toEqual(["2"]);
    expect(filterContracts([cdi, cdd], { period: "probationEnding", ...window }).map((c) => c.id)).toEqual(["2"]);
  });

  it("contractTypes filters on typeOf and combines with the period", () => {
    expect(filterContracts([cdi, cdd], { contractTypes: [0] }).map((c) => c.id)).toEqual(["1"]);
    expect(filterContracts([cdi, cdd], { contractTypes: [0], period: "ending", ...window })).toEqual([]);
  });

  it("renders one readable line per contract", () => {
    expect(contractSummary({ ...cdd, attributes: { ...cdd.attributes, resource: "Bob Roy (#2)" } })).toBe(
      "[contract #2] | Ressource: Bob Roy (#2) | Type: 1 | 2026-09-01 → 2026-12-31 | Fin PE: 2026-10-10 (état 0)"
    );
    expect(contractSummary(cdi)).toBe("[contract #1] | Type: 0 | 2020-01-01 → en cours | Fin PE: 2020-04-01");
  });
});

describe("buildContractBody (#245)", () => {
  it("attaches the resource only when an id is given", () => {
    expect(buildContractBody({ typeOf: 0, resourceId: "30888" })).toEqual({
      data: {
        type: "contract",
        attributes: { typeOf: 0 },
        relationships: { resource: { data: { id: "30888", type: "resource" } } },
      },
    });
    expect(buildContractBody({ typeOf: 1 })).toEqual({ data: { type: "contract", attributes: { typeOf: 1 } } });
  });
});
