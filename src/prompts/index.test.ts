import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllPrompts, REGISTERED_PROMPTS } from "./index.js";

function createMockServer() {
  return { registerPrompt: vi.fn() } as unknown as McpServer;
}

describe("registerAllPrompts", () => {
  let server: McpServer;
  beforeEach(() => { server = createMockServer(); });

  it("registers exactly the prompts declared in REGISTERED_PROMPTS", () => {
    registerAllPrompts(server);
    expect(server.registerPrompt).toHaveBeenCalledTimes(REGISTERED_PROMPTS.length);
  });

  it("each prompt has a unique name", () => {
    const names = REGISTERED_PROMPTS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("registers the expected workflow prompts", () => {
    registerAllPrompts(server);
    const names = vi.mocked(server.registerPrompt).mock.calls.map((c) => c[0]);
    expect(names).toEqual(expect.arrayContaining([
      "synthese_equipe",
      "pipeline_commercial",
      "factures_a_relancer",
      "candidats_pour_opportunite",
      "fiche_consultant",
      "recap_hebdo",
    ]));
  });

  it("every registered prompt declares both a title and a description", () => {
    registerAllPrompts(server);
    for (const call of vi.mocked(server.registerPrompt).mock.calls) {
      const [, config] = call;
      expect(config.title).toBeTruthy();
      expect(config.description).toBeTruthy();
    }
  });

  it("the callbacks return a single user message with non-empty text", async () => {
    registerAllPrompts(server);
    const calls = vi.mocked(server.registerPrompt).mock.calls;
    for (const [, , cb] of calls) {
      // Pass empty args — the build functions handle defaults / required-arg notes.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (cb as any)({});
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[0].content.type).toBe("text");
      expect(result.messages[0].content.text.length).toBeGreaterThan(50);
    }
  });

  it("synthese_equipe falls back to current_user when manager_id is omitted", async () => {
    registerAllPrompts(server);
    const call = vi.mocked(server.registerPrompt).mock.calls.find((c) => c[0] === "synthese_equipe");
    expect(call).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = call![2] as any;
    const result = await cb({});
    expect(result.messages[0].content.text).toContain("boond_application_current_user");
  });

  it("synthese_equipe injects an explicit manager_id when provided", async () => {
    registerAllPrompts(server);
    const call = vi.mocked(server.registerPrompt).mock.calls.find((c) => c[0] === "synthese_equipe");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = call![2] as any;
    const result = await cb({ manager_id: "18081" });
    expect(result.messages[0].content.text).toContain("18081");
  });

  it("pipeline_commercial uses perimeterManagers when manager_id is given, else perimeterDynamic", async () => {
    registerAllPrompts(server);
    const call = vi.mocked(server.registerPrompt).mock.calls.find((c) => c[0] === "pipeline_commercial");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = call![2] as any;
    const without = await cb({ date_debut: "2026-01-01", date_fin: "2026-12-31" });
    expect(without.messages[0].content.text).toContain("perimeterDynamic");
    const withId = await cb({ date_debut: "2026-01-01", date_fin: "2026-12-31", manager_id: "42" });
    expect(withId.messages[0].content.text).toContain("perimeterManagers: [42]");
  });

  it("candidats_pour_opportunite references the opportunity_id and matching filters", async () => {
    registerAllPrompts(server);
    const call = vi.mocked(server.registerPrompt).mock.calls.find((c) => c[0] === "candidats_pour_opportunite");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = call![2] as any;
    const result = await cb({ opportunity_id: "12842" });
    const text = result.messages[0].content.text;
    expect(text).toContain("12842");
    expect(text).toContain("boond_opportunities_get");
    expect(text).toContain("boond_candidates_search");
    expect(text).toContain("expertiseAreas");
    expect(text).toContain("mobilityAreas");
  });
});
