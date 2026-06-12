import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerActionTools } from "./actions.js";
import { apiRequest } from "../services/boond-client.js";
import { resetDictionaryOverridesForTests } from "../config/dictionary-overrides.js";

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

    it("should return an error mentioning BOOND_DICTIONARY_OVERRIDES for a label typeOf without overrides", async () => {
      // No overrides configured: a string typeOf cannot be resolved.
      resetDictionaryOverridesForTests();
      const handler = getCreateHandler();
      const result = await handler({ typeOf: "Call", contactId: "6695" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("BOOND_DICTIONARY_OVERRIDES");
      expect(result.content[0].text).toContain("boond_application_dictionary");
      expect(apiRequest).not.toHaveBeenCalled();
    });
  });

  describe("boond_actions_create with dictionary overrides", () => {
    const OVERRIDES = JSON.stringify({
      action: { contact: { Call: 61, Email: 63 }, candidate: { Call: 40 } },
    });

    function getCreateRegistration() {
      registerActionTools(server);
      return vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_actions_create");
    }

    function getCreateHandler() {
      return getCreateRegistration()?.[2] as (params: Record<string, unknown>) => Promise<{
        isError?: boolean;
        content: Array<{ type: string; text: string }>;
      }>;
    }

    beforeEach(() => {
      vi.mocked(apiRequest).mockClear();
      process.env.BOOND_DICTIONARY_OVERRIDES = OVERRIDES;
      resetDictionaryOverridesForTests();
    });

    afterEach(() => {
      delete process.env.BOOND_DICTIONARY_OVERRIDES;
      resetDictionaryOverridesForTests();
    });

    it("resolves a typeOf label against the dependsOn entity (contact)", async () => {
      const handler = getCreateHandler();
      await handler({ typeOf: "Call", title: "Suivi", contactId: "6695" });
      expect(apiRequest).toHaveBeenCalledWith("/actions", "POST", {
        data: {
          type: "action",
          attributes: { typeOf: 61, title: "Suivi" },
          relationships: {
            dependsOn: { data: { id: "6695", type: "contact" } },
          },
        },
      });
    });

    it("resolves labels case-insensitively and per entity", async () => {
      const handler = getCreateHandler();
      await handler({ typeOf: " call ", candidateId: "99" });
      const body = vi.mocked(apiRequest).mock.calls[0][2] as {
        data: { attributes: Record<string, unknown> };
      };
      expect(body.data.attributes.typeOf).toBe(40);
    });

    it("returns an error listing the available labels for an unknown label", async () => {
      const handler = getCreateHandler();
      const result = await handler({ typeOf: "Visio", contactId: "6695" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('"Visio"');
      expect(result.content[0].text).toContain("Call");
      expect(result.content[0].text).toContain("Email");
      expect(apiRequest).not.toHaveBeenCalled();
    });

    it("keeps a numeric typeOf strictly unchanged", async () => {
      const handler = getCreateHandler();
      await handler({ typeOf: 7, contactId: "6695" });
      const body = vi.mocked(apiRequest).mock.calls[0][2] as {
        data: { attributes: Record<string, unknown> };
      };
      expect(body.data.attributes.typeOf).toBe(7);
    });

    it("enriches the tool description with the configured labels", () => {
      const description = getCreateRegistration()?.[1].description as string;
      expect(description).toContain("Libellés personnalisés acceptés pour typeOf");
      expect(description).toContain("Contact : Call=61, Email=63");
      expect(description).toContain("Candidat : Call=40");
    });

    it("leaves the tool description untouched without overrides", () => {
      delete process.env.BOOND_DICTIONARY_OVERRIDES;
      resetDictionaryOverridesForTests();
      const description = getCreateRegistration()?.[1].description as string;
      expect(description).not.toContain("Libellés personnalisés");
    });
  });
});
