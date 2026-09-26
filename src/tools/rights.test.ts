import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMockServer, toolCallback } from "./test-helpers.js";
import { registerRightsTool, RIGHTS_ENTITIES } from "./rights.js";
import { apiRequest } from "../services/boond-client.js";
import { resolveAccessPolicy } from "../config/access-policy.js";
import { REGISTERED_DOMAINS } from "../constants.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

describe("boond_rights_get (issue #257)", () => {
  let server: McpServer;
  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({
      data: { id: "5", type: "rights", attributes: { canDelete: false } },
    } as never);
  });

  it("reads GET /{collection}/{id}/rights for every entity of the table", async () => {
    registerRightsTool(server);
    for (const [entity, { path }] of Object.entries(RIGHTS_ENTITIES)) {
      vi.mocked(apiRequest).mockClear();
      const result = (await toolCallback(server, "boond_rights_get")({ entity, id: "5" })) as {
        content: Array<{ text: string }>;
      };
      expect(apiRequest).toHaveBeenCalledWith(`${path}/5/rights`);
      expect(result.content[0]?.text).toContain(`Droits sur ${entity} #5`);
      expect(result.content[0]?.text).toContain("canDelete");
    }
  });

  it("maps every entity to a registered domain", () => {
    for (const { domain } of Object.values(RIGHTS_ENTITIES)) expect(REGISTERED_DOMAINS).toContain(domain);
  });

  it("narrows the entity enum to the domains the policy allows, and is absent when none is", () => {
    registerRightsTool(server, resolveAccessPolicy({ BOOND_MCP_PROFILE: "finance" } as NodeJS.ProcessEnv));
    const schema = vi.mocked(server.registerTool).mock.calls[0]?.[1].inputSchema as {
      safeParse: (v: unknown) => { success: boolean };
    };
    expect(schema.safeParse({ entity: "invoice", id: "1" }).success).toBe(true);
    expect(schema.safeParse({ entity: "candidate", id: "1" }).success).toBe(false);
    const bare = createMockServer();
    registerRightsTool(bare, resolveAccessPolicy({ BOOND_MCP_DOMAINS: "application,logs" } as NodeJS.ProcessEnv));
    expect(bare.registerTool).not.toHaveBeenCalled();
  });

  it("is read-only", () => {
    registerRightsTool(server);
    expect(vi.mocked(server.registerTool).mock.calls[0]?.[1].annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
  });
});
