import { describe, it, expect, beforeEach, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../services/boond-client.js";

/**
 * Shared test utilities for tool-registration suites.
 *
 * Behavioural helpers assume the calling test file has mocked the boond-client
 * module while keeping the real query/formatting helpers, e.g.:
 *
 *   vi.mock("../services/boond-client.js", async (importOriginal) => {
 *     const actual = await importOriginal<typeof import("../services/boond-client.js")>();
 *     return { ...actual, apiRequest: vi.fn() };
 *   });
 *
 * That way `apiRequest` is a spy (so we can assert on the path/method it is
 * called with) while `buildSearchQuery` / `formatListResponse` run for real,
 * exercising the domain tool's callback end-to-end.
 */
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
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });
      contract.registrar(server);
      await toolCallback(server, searchTool)({ page: 2, pageSize: 10 });
      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call[0]).toBe(contract.searchPath);
      expect(call[1]).toBe("GET");
    });

    it("get should call the BoondManager API on the detail path", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { id: "42", type: "x", attributes: {} } });
      contract.registrar(server);
      await toolCallback(server, getTool)({ id: "42" });
      expect(vi.mocked(apiRequest).mock.calls[0][0]).toBe(getPath("42"));
    });
  });
}
