import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllPrompts, REGISTERED_PROMPTS } from "./index.js";

function createMockServer() {
  return { registerPrompt: vi.fn() } as unknown as McpServer;
}

describe("registerAllPrompts", () => {
  let server: McpServer;
  beforeEach(() => {
    server = createMockServer();
  });

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
    expect(names).toEqual(
      expect.arrayContaining([
        "synthese_equipe",
        "pipeline_commercial",
        "factures_a_relancer",
        "candidats_pour_opportunite",
        "fiche_consultant",
        "recap_hebdo",
        "staffing_disponible",
        "fin_de_mission",
        "cartographie_competences",
        "cvs_a_mettre_a_jour",
        "recherche_profil_competences",
      ])
    );
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

  it("staffing_disponible uses period=available + dates and references resources_search", async () => {
    registerAllPrompts(server);
    const call = vi.mocked(server.registerPrompt).mock.calls.find((c) => c[0] === "staffing_disponible");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = call![2] as any;
    const result = await cb({ start_date: "2026-05-01", end_date: "2026-08-01" });
    const text = result.messages[0].content.text;
    expect(text).toContain("boond_resources_search");
    expect(text).toContain('period: "available"');
    expect(text).toContain("2026-05-01");
    expect(text).toContain("2026-08-01");
    expect(text).toContain("perimeterDynamic");
  });

  it("staffing_disponible adds the tools mapping step when competences are provided", async () => {
    registerAllPrompts(server);
    const call = vi.mocked(server.registerPrompt).mock.calls.find((c) => c[0] === "staffing_disponible");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = call![2] as any;
    const without = await cb({ start_date: "2026-05-01", end_date: "2026-08-01" });
    expect(without.messages[0].content.text).not.toContain("Mapper les compétences");
    const withSkills = await cb({ start_date: "2026-05-01", end_date: "2026-08-01", competences: "Java Spring" });
    const text = withSkills.messages[0].content.text;
    expect(text).toContain("Mapper les compétences");
    expect(text).toContain("Java Spring");
    expect(text).toContain("setting.tool");
    expect(text).toContain("tools: [...]");
  });

  it("staffing_disponible scopes to perimeterManagers when manager_id is provided", async () => {
    registerAllPrompts(server);
    const call = vi.mocked(server.registerPrompt).mock.calls.find((c) => c[0] === "staffing_disponible");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = call![2] as any;
    const result = await cb({ start_date: "2026-05-01", end_date: "2026-08-01", manager_id: "18081" });
    expect(result.messages[0].content.text).toContain("perimeterManagers: [18081]");
  });

  it("fin_de_mission injects the horizon and references resources_search + positionings", async () => {
    registerAllPrompts(server);
    const call = vi.mocked(server.registerPrompt).mock.calls.find((c) => c[0] === "fin_de_mission");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = call![2] as any;
    const defaultResult = await cb({});
    expect(defaultResult.messages[0].content.text).toContain("60 prochains jours");
    const result = await cb({ horizon_jours: "30" });
    const text = result.messages[0].content.text;
    expect(text).toContain("30 prochains jours");
    expect(text).toContain("boond_resources_search");
    expect(text).toContain("boond_resources_positionings");
    expect(text).toContain('period: "available"');
  });

  it("cartographie_competences scopes to perimeterAgencies when agency_id is given, else defaults to managers", async () => {
    registerAllPrompts(server);
    const call = vi.mocked(server.registerPrompt).mock.calls.find((c) => c[0] === "cartographie_competences");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = call![2] as any;
    const def = await cb({});
    expect(def.messages[0].content.text).toContain("perimeterDynamic");
    expect(def.messages[0].content.text).toContain("Top 20");
    const withAgency = await cb({ agency_id: "7", top_n: "10" });
    const text = withAgency.messages[0].content.text;
    expect(text).toContain("perimeterAgencies: [7]");
    expect(text).toContain("Top 10");
    expect(text).toContain("boond_resources_technical_data");
    expect(text).toContain("setting.tool");
    expect(text).toContain("boond_opportunities_search");
  });

  it("cvs_a_mettre_a_jour applies the seuil_mois threshold and references technical_data", async () => {
    registerAllPrompts(server);
    const call = vi.mocked(server.registerPrompt).mock.calls.find((c) => c[0] === "cvs_a_mettre_a_jour");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = call![2] as any;
    const def = await cb({});
    expect(def.messages[0].content.text).toContain("12 mois");
    const result = await cb({ seuil_mois: "6", manager_id: "18081" });
    const text = result.messages[0].content.text;
    expect(text).toContain("6 mois");
    expect(text).toContain("perimeterManagers: [18081]");
    expect(text).toContain("boond_resources_technical_data");
    expect(text).toContain('period: "available"');
  });

  it("recherche_profil_competences includes candidates by default and skips them on opt-out", async () => {
    registerAllPrompts(server);
    const call = vi.mocked(server.registerPrompt).mock.calls.find((c) => c[0] === "recherche_profil_competences");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = call![2] as any;
    const def = await cb({ competences: "Java Spring AWS" });
    const defText = def.messages[0].content.text;
    expect(defText).toContain("Java Spring AWS");
    expect(defText).toContain("boond_resources_search");
    expect(defText).toContain("boond_candidates_search");
    expect(defText).toContain("setting.tool");
    expect(defText).toContain("setting.expertiseArea");
    const internalOnly = await cb({ competences: ".NET Azure", inclure_candidats: "non" });
    const internalText = internalOnly.messages[0].content.text;
    expect(internalText).not.toContain("boond_candidates_search");
    expect(internalText).toContain("Skip");
  });

  it("recherche_profil_competences applies dispo_avant via period=available + endDate", async () => {
    registerAllPrompts(server);
    const call = vi.mocked(server.registerPrompt).mock.calls.find((c) => c[0] === "recherche_profil_competences");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = call![2] as any;
    const result = await cb({ competences: "Python", dispo_avant: "2026-06-30" });
    const text = result.messages[0].content.text;
    expect(text).toContain('period: "available"');
    expect(text).toContain("2026-06-30");
  });
});
