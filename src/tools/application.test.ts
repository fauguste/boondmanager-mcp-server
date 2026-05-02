import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerApplicationTools } from "./application.js";
import * as boondClient from "../services/boond-client.js";
import * as dictionaryService from "../services/dictionary.js";

function createMockServer() {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer;
}

describe("registerApplicationTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
    vi.restoreAllMocks();
    dictionaryService.resetDictionaryCacheForTests();
  });

  it("should register 2 application tools", () => {
    registerApplicationTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(2);
  });

  it("should register dictionary tool", () => {
    registerApplicationTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_application_dictionary");
  });

  it("should register current user tool", () => {
    registerApplicationTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_application_current_user");
  });

  it("should register all tools as readOnly", () => {
    registerApplicationTools(server);
    for (const call of vi.mocked(server.registerTool).mock.calls) {
      const [, metadata] = call;
      expect(metadata.annotations?.readOnlyHint).toBe(true);
      expect(metadata.annotations?.destructiveHint).toBe(false);
    }
  });

  describe("boond_application_dictionary", () => {
    function getDictionaryHandler() {
      registerApplicationTools(server);
      const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_application_dictionary");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return call![2] as any;
    }

    it("extracts the requested sub-path from the cached dictionary", async () => {
      vi.spyOn(boondClient, "apiRequest").mockResolvedValue({
        data: {
          setting: {
            state: { resource: [{ id: 1, value: "Actif" }] },
            tool: [{ id: 42, value: "Java" }],
          },
        },
      } as never);
      const handler = getDictionaryHandler();
      const result = await handler({ dictionaryType: "setting.state.resource" });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Actif");
      expect(result.content[0].text).toContain("1");
    });

    it("hits the API once across multiple invocations (caching)", async () => {
      const apiSpy = vi.spyOn(boondClient, "apiRequest").mockResolvedValue({
        data: { setting: { state: { resource: [], candidate: [] } } },
      } as never);
      const handler = getDictionaryHandler();
      await handler({ dictionaryType: "setting.state.resource" });
      await handler({ dictionaryType: "setting.state.candidate" });
      await handler({ dictionaryType: "setting.state.resource" });
      expect(apiSpy).toHaveBeenCalledTimes(1);
    });

    it("returns isError=true with a hint when the path is unknown", async () => {
      vi.spyOn(boondClient, "apiRequest").mockResolvedValue({
        data: { setting: {} },
      } as never);
      const handler = getDictionaryHandler();
      const result = await handler({ dictionaryType: "states/resources" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/states\/resources/);
      expect(result.content[0].text).toMatch(/setting\.state\.resource/);
    });
  });
});
