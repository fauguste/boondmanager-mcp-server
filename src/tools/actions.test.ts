import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerActionTools } from "./actions.js";
import { apiRequest } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", () => ({
  apiRequest: vi.fn().mockResolvedValue({ data: { id: "123", type: "action" } }),
  buildSearchQuery: vi.fn().mockReturnValue({}),
  formatListResponse: vi.fn().mockReturnValue(""),
  formatDetailResponse: vi.fn().mockReturnValue(""),
}));

function createMockServer() {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer;
}

describe("registerActionTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("should register 4 action tools", () => {
    registerActionTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(4);
  });

  it("should register all expected tool names", () => {
    registerActionTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_actions_search");
    expect(names).toContain("boond_actions_get");
    expect(names).toContain("boond_actions_create");
    expect(names).toContain("boond_actions_delete");
  });

  it("should register search and get as readOnly", () => {
    registerActionTools(server);
    const readOnlyCalls = vi
      .mocked(server.registerTool)
      .mock.calls.filter(
        (c) => typeof c[0] === "string" && ["boond_actions_search", "boond_actions_get"].includes(c[0] as string)
      );
    for (const call of readOnlyCalls) {
      expect(call[1].annotations?.readOnlyHint).toBe(true);
    }
  });

  it("should register delete as destructive", () => {
    registerActionTools(server);
    const deleteCall = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_actions_delete");
    expect(deleteCall?.[1].annotations?.destructiveHint).toBe(true);
  });

  describe("boond_actions_create handler", () => {
    function getCreateHandler() {
      registerActionTools(server);
      const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_actions_create");
      return call?.[2] as (params: Record<string, unknown>) => Promise<{
        isError?: boolean;
        content: Array<{ type: string; text: string }>;
      }>;
    }

    beforeEach(() => {
      vi.mocked(apiRequest).mockClear();
    });

    it("should send a dependsOn relationship when contactId is provided", async () => {
      const handler = getCreateHandler();
      await handler({ typeOf: 1, title: "Call", contactId: "6695" });
      expect(apiRequest).toHaveBeenCalledWith("/actions", "POST", {
        data: {
          type: "action",
          attributes: { typeOf: 1, title: "Call" },
          relationships: {
            dependsOn: { data: { id: "6695", type: "contact" } },
          },
        },
      });
    });

    it("should add the company relationship alongside a contact dependsOn", async () => {
      const handler = getCreateHandler();
      await handler({ typeOf: 1, contactId: "6695", companyId: "42" });
      const body = vi.mocked(apiRequest).mock.calls[0][2] as {
        data: { relationships: Record<string, unknown> };
      };
      expect(body.data.relationships.dependsOn).toEqual({
        data: { id: "6695", type: "contact" },
      });
      expect(body.data.relationships.company).toEqual({
        data: { id: "42", type: "company" },
      });
    });

    it("should map candidateId to a candidate dependsOn", async () => {
      const handler = getCreateHandler();
      await handler({ typeOf: 2, candidateId: "99" });
      const body = vi.mocked(apiRequest).mock.calls[0][2] as {
        data: { relationships: Record<string, unknown> };
      };
      expect(body.data.relationships.dependsOn).toEqual({
        data: { id: "99", type: "candidate" },
      });
    });

    it("should return an error without calling the API when no entity id is provided", async () => {
      const handler = getCreateHandler();
      const result = await handler({ typeOf: 1, title: "Orphan" });
      expect(result.isError).toBe(true);
      expect(apiRequest).not.toHaveBeenCalled();
    });

    it("should return an error when only companyId is provided", async () => {
      const handler = getCreateHandler();
      const result = await handler({ typeOf: 1, companyId: "42" });
      expect(result.isError).toBe(true);
      expect(apiRequest).not.toHaveBeenCalled();
    });
  });
});
