import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWorkflowTools } from "./workflows.js";
import { PROMPTS } from "../prompts/index.js";
import { resolveAccessPolicy } from "../config/access-policy.js";

function createMockServer() {
  return { registerTool: vi.fn() } as unknown as McpServer;
}

describe("registerWorkflowTools", () => {
  let server: McpServer;
  beforeEach(() => {
    server = createMockServer();
  });

  it("registers exactly one tool per prompt", () => {
    registerWorkflowTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(PROMPTS.length);
  });

  it("each registered tool name follows the boond_workflow_* pattern", () => {
    registerWorkflowTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    for (const p of PROMPTS) {
      expect(names).toContain(`boond_workflow_${p.name}`);
    }
    for (const n of names) {
      expect(n).toMatch(/^boond_workflow_[a-z_]+$/);
    }
  });

  it("all workflow tools are read-only and idempotent", () => {
    registerWorkflowTools(server);
    for (const call of vi.mocked(server.registerTool).mock.calls) {
      const config = call[1];
      expect(config.annotations?.readOnlyHint).toBe(true);
      expect(config.annotations?.destructiveHint).toBe(false);
      expect(config.annotations?.idempotentHint).toBe(true);
      // Workflow tools synthesize a runbook locally; they don't hit BoondManager
      // themselves — the model executes the runbook by calling other tools.
      expect(config.annotations?.openWorldHint).toBe(false);
    }
  });

  it("each tool exposes the same args shape as its source prompt", () => {
    registerWorkflowTools(server);
    const calls = vi.mocked(server.registerTool).mock.calls;
    for (const p of PROMPTS) {
      const call = calls.find((c) => c[0] === `boond_workflow_${p.name}`);
      expect(call).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inputSchema = (call![1] as any).inputSchema;
      expect(Object.keys(inputSchema)).toEqual(Object.keys(p.argsSchema));
    }
  });

  it("the callback returns a non-empty text content matching the prompt's runbook", async () => {
    registerWorkflowTools(server);
    const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_workflow_synthese_equipe");
    expect(call).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = call![2] as any;
    const result = await cb({ manager_id: "18081" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const text = result.content[0].text as string;
    expect(text).toContain("18081");
    expect(text).toContain("boond_resources_search");
    expect(text).toContain("perimeterManagers");
  });

  it("the runbook output equals the source prompt's build() output for the same args", async () => {
    registerWorkflowTools(server);
    const calls = vi.mocked(server.registerTool).mock.calls;
    // Pick a prompt with optional args so we can pass {} and rely on defaults.
    const synth = PROMPTS.find((p) => p.name === "synthese_equipe");
    expect(synth).toBeDefined();
    const expected = synth!.build({});
    const call = calls.find((c) => c[0] === "boond_workflow_synthese_equipe");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = call![2] as any;
    const result = await cb({});
    expect(result.content[0].text).toBe(expected);
  });

  it("inherits the title from the source prompt and extends the description", () => {
    registerWorkflowTools(server);
    const calls = vi.mocked(server.registerTool).mock.calls;
    for (const p of PROMPTS) {
      const call = calls.find((c) => c[0] === `boond_workflow_${p.name}`);
      const config = call![1];
      expect(config.title).toBe(p.title);
      expect(config.description).toContain(p.description);
      expect(config.description).toContain(p.name);
    }
  });

  describe("access-policy domain filtering", () => {
    it("no policy → one tool per prompt (back-compat)", () => {
      registerWorkflowTools(server);
      expect(server.registerTool).toHaveBeenCalledTimes(PROMPTS.length);
    });

    it("keeps only workflow tools whose source prompt's domains are fully allowed", () => {
      const policy = resolveAccessPolicy({ BOOND_MCP_DOMAINS: "invoices,application" } as NodeJS.ProcessEnv);
      registerWorkflowTools(server, policy);
      const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
      expect(names).toContain("boond_workflow_factures_a_relancer");
      expect(names).not.toContain("boond_workflow_synthese_equipe");
    });
  });
});
