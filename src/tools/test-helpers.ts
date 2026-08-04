import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { apiRequest, apiSearch } from "../services/boond-client.js";
import { createMcpServer } from "../server.js";

/**
 * Shared test utilities for tool-registration suites.
 *
 * Behavioural helpers assume the calling test file has mocked the boond-client
 * module while keeping the real query/formatting helpers, e.g.:
 *
 *   vi.mock("../services/boond-client.js", async (importOriginal) => {
 *     const actual = await importOriginal<typeof import("../services/boond-client.js")>();
 *     return { ...actual, apiRequest: vi.fn(), apiSearch: vi.fn() };
 *   });
 *
 * `apiRequest` (used by the get tool) and `apiSearch` (used by the search tool,
 * which chunks per-route — see ROUTE_MAX_RESULTS) are spies so we can assert on
 * the path they are called with, while `buildSearchQuery` / `formatListResponse`
 * run for real, exercising the domain tool's callback end-to-end.
 */
/**
 * Env vars that change what `createMcpServer()` exposes, or how it renders it.
 * Any suite asserting on the *full* catalogue (tool counts, list order, icon
 * budget) must neutralise them: `createMcpServer()` resolves the access policy
 * from the real `process.env`, so a developer machine (or a CI runner) that
 * exports `BOOND_MCP_PROFILE=finance` would drop the catalogue to 59 tools and
 * fail those assertions for an unrelated-looking reason — and `BOOND_MCP_ICONS=0`
 * would turn the icon-budget cap into a tautology (0 bytes always passes).
 */
const SERVER_SURFACE_ENV_VARS = [
  "BOOND_MCP_PROFILE",
  "BOOND_MCP_DOMAINS",
  "BOOND_MCP_EXCLUDE_DOMAINS",
  "BOOND_MCP_OPERATIONS",
  "BOOND_MCP_READ_ONLY",
  "BOOND_MCP_ICONS",
] as const;

/**
 * Pin the suite to the default, unrestricted surface: clears the env vars above
 * before each test and restores the ambient environment afterwards (so a test
 * may still set one of them itself to assert the opt-out behaviour).
 */
export function useDefaultServerSurface(): void {
  beforeEach(() => {
    for (const key of SERVER_SURFACE_ENV_VARS) vi.stubEnv(key, undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
}

/**
 * A real MCP client wired to a real server over the in-memory transport — the
 * only way to assert on what is actually advertised (`icons`, list order,
 * `isError` conversion) rather than on what we passed to `registerTool`.
 */
export async function connectMcpClient(): Promise<{
  client: Client;
  server: McpServer;
  close: () => Promise<void>;
}> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "vitest", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    server,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export function createMockServer(): McpServer {
  return {
    registerTool: vi.fn(),
    registerPrompt: vi.fn(),
    registerResource: vi.fn(),
  } as unknown as McpServer;
}

type ToolCallback = (args: Record<string, unknown>) => Promise<{ content: unknown[] }>;

/** Names registered on a mock server, in call order. */
export function registeredToolNames(server: McpServer): string[] {
  return vi.mocked(server.registerTool).mock.calls.map((c) => c[0] as string);
}

/** Pulls the callback (3rd registerTool arg) for a given tool name. */
export function toolCallback(server: McpServer, name: string): ToolCallback {
  const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === name);
  if (!call) throw new Error(`Tool "${name}" was not registered`);
  return call[2] as unknown as ToolCallback;
}

interface SearchGetContract {
  /** The register*Tools function under test. */
  registrar: (server: McpServer) => void;
  /** Tool-name prefix, e.g. "boond_agencies". */
  namePrefix: string;
  /** API path hit by the search tool, e.g. "/agencies". */
  searchPath: string;
  /** API path hit by the get tool. Defaults to `${searchPath}/${id}`. */
  getPath?: (id: string) => string;
}

/**
 * Generates the standard suite for a read-only search + get domain:
 * registration count, names, readOnly annotations, plus behavioural checks
 * that the callbacks call the BoondManager API on the expected path.
 */
export function describeSearchGetTools(label: string, contract: SearchGetContract): void {
  const searchTool = `${contract.namePrefix}_search`;
  const getTool = `${contract.namePrefix}_get`;
  const getPath = contract.getPath ?? ((id: string) => `${contract.searchPath}/${id}`);

  describe(label, () => {
    let server: McpServer;

    beforeEach(() => {
      server = createMockServer();
      vi.mocked(apiRequest).mockReset();
      vi.mocked(apiSearch).mockReset();
    });

    it("should register 2 tools", () => {
      contract.registrar(server);
      expect(server.registerTool).toHaveBeenCalledTimes(2);
    });

    it("should register the expected tool names", () => {
      contract.registrar(server);
      const names = registeredToolNames(server);
      expect(names).toContain(searchTool);
      expect(names).toContain(getTool);
    });

    it("should register all tools as readOnly", () => {
      contract.registrar(server);
      for (const call of vi.mocked(server.registerTool).mock.calls) {
        expect(call[1].annotations?.readOnlyHint).toBe(true);
        expect(call[1].annotations?.destructiveHint).toBe(false);
      }
    });

    it("search should call the BoondManager API on the search path", async () => {
      vi.mocked(apiSearch).mockResolvedValue({ data: [] });
      contract.registrar(server);
      await toolCallback(server, searchTool)({ page: 2, pageSize: 10 });
      // Search goes through apiSearch (per-route maxResults chunking), not a raw
      // apiRequest, so the route cap is always applied.
      const call = vi.mocked(apiSearch).mock.calls[0];
      expect(call[0]).toBe(contract.searchPath);
    });

    it("get should call the BoondManager API on the detail path", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { id: "42", type: "x", attributes: {} } });
      contract.registrar(server);
      await toolCallback(server, getTool)({ id: "42" });
      expect(vi.mocked(apiRequest).mock.calls[0][0]).toBe(getPath("42"));
    });
  });
}
