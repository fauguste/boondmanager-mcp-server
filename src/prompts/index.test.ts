import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllPrompts, REGISTERED_PROMPTS, PROMPTS } from "./index.js";
import { REGISTERED_DOMAINS } from "../constants.js";
import { resolveAccessPolicy } from "../config/access-policy.js";

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
        "traiter_note_de_frais",
        "alertes_contrats",
        // Issue #259
        "relance_cra",
        "absences_a_valider",
        "marge_projet",
        "preparation_entretien",
        "preparation_rdv_client",
        "relance_devis",
        "purge_rgpd_candidats",
        "preparation_facturation",
        "ingest_communication",
        "attention_du_jour",
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

  describe("ID-or-name polymorphism", () => {
    /**
     * For each prompt that takes an entity reference (manager / society /
     * opportunity / resource / agency), passing a non-numeric value must
     * inject a "résolution préalable" block instructing the model to
     * resolve the name via the matching search tool before using it as a
     * filter. Numeric inputs continue to bypass resolution and inline the
     * ID directly (covered by other tests).
     */
    const promptsAndArgs: Array<{
      name: string;
      args: Record<string, string>;
      expectTool: string;
      expectQuoted: string;
      expectPlaceholder: string;
    }> = [
      {
        name: "synthese_equipe",
        args: { manager_id: "Jean Dupont" },
        expectTool: "boond_resources_search",
        expectQuoted: "Jean Dupont",
        expectPlaceholder: "<MANAGER_ID>",
      },
      {
        name: "pipeline_commercial",
        args: { date_debut: "2026-01-01", date_fin: "2026-12-31", manager_id: "Marie Martin" },
        expectTool: "boond_resources_search",
        expectQuoted: "Marie Martin",
        expectPlaceholder: "<MANAGER_ID>",
      },
      {
        name: "factures_a_relancer",
        args: { society_id: "ACME Corp" },
        expectTool: "boond_companies_search",
        expectQuoted: "ACME Corp",
        expectPlaceholder: "<SOCIETE_ID>",
      },
      {
        name: "candidats_pour_opportunite",
        args: { opportunity_id: "Refonte SI" },
        expectTool: "boond_opportunities_search",
        expectQuoted: "Refonte SI",
        expectPlaceholder: "<OPPORTUNITY_ID>",
      },
      {
        name: "fiche_consultant",
        args: { resource_id: "Alice Durand" },
        expectTool: "boond_resources_search",
        expectQuoted: "Alice Durand",
        expectPlaceholder: "<RESOURCE_ID>",
      },
      {
        name: "staffing_disponible",
        args: { start_date: "2026-05-01", end_date: "2026-08-01", manager_id: "Bob Leroy" },
        expectTool: "boond_resources_search",
        expectQuoted: "Bob Leroy",
        expectPlaceholder: "<MANAGER_ID>",
      },
      {
        name: "fin_de_mission",
        args: { manager_id: "Claire Petit" },
        expectTool: "boond_resources_search",
        expectQuoted: "Claire Petit",
        expectPlaceholder: "<MANAGER_ID>",
      },
      {
        name: "alertes_contrats",
        args: { manager_id: "Claire Petit" },
        expectTool: "boond_resources_search",
        expectQuoted: "Claire Petit",
        expectPlaceholder: "<MANAGER_ID>",
      },
      {
        name: "relance_cra",
        args: { manager_id: "Claire Petit" },
        expectTool: "boond_resources_search",
        expectQuoted: "Claire Petit",
        expectPlaceholder: "<MANAGER_ID>",
      },
      {
        name: "marge_projet",
        args: { project_id: "Refonte SI" },
        expectTool: "boond_projects_search",
        expectQuoted: "Refonte SI",
        expectPlaceholder: "<PROJET_ID>",
      },
      {
        name: "preparation_entretien",
        args: { candidate_id: "Ana Silva" },
        expectTool: "boond_candidates_search",
        expectQuoted: "Ana Silva",
        expectPlaceholder: "<CANDIDAT_ID>",
      },
      {
        name: "preparation_rdv_client",
        args: { society_id: "ACME Corp" },
        expectTool: "boond_companies_search",
        expectQuoted: "ACME Corp",
        expectPlaceholder: "<SOCIETE_ID>",
      },
      {
        name: "relance_devis",
        args: { manager_id: "Claire Petit" },
        expectTool: "boond_resources_search",
        expectQuoted: "Claire Petit",
        expectPlaceholder: "<MANAGER_ID>",
      },
      {
        name: "purge_rgpd_candidats",
        args: { manager_id: "Claire Petit" },
        expectTool: "boond_resources_search",
        expectQuoted: "Claire Petit",
        expectPlaceholder: "<MANAGER_ID>",
      },
      {
        name: "absences_a_valider",
        args: { manager_id: "Claire Petit" },
        expectTool: "boond_resources_search",
        expectQuoted: "Claire Petit",
        expectPlaceholder: "<MANAGER_ID>",
      },
      {
        name: "preparation_facturation",
        args: { manager_id: "Claire Petit" },
        expectTool: "boond_resources_search",
        expectQuoted: "Claire Petit",
        expectPlaceholder: "<MANAGER_ID>",
      },
      {
        name: "cartographie_competences",
        args: { agency_id: "Agence Lyon" },
        expectTool: "boond_agencies_search",
        expectQuoted: "Agence Lyon",
        expectPlaceholder: "<AGENCY_ID>",
      },
      {
        name: "cvs_a_mettre_a_jour",
        args: { manager_id: "David Bernard" },
        expectTool: "boond_resources_search",
        expectQuoted: "David Bernard",
        expectPlaceholder: "<MANAGER_ID>",
      },
      {
        name: "recherche_profil_competences",
        args: { competences: "Python", manager_id: "Eve Moreau" },
        expectTool: "boond_resources_search",
        expectQuoted: "Eve Moreau",
        expectPlaceholder: "<MANAGER_ID>",
      },
    ];

    it.each(promptsAndArgs)(
      "$name injects a resolution preamble when the entity arg is a name (not numeric)",
      async ({ name, args, expectTool, expectQuoted, expectPlaceholder }) => {
        registerAllPrompts(server);
        const call = vi.mocked(server.registerPrompt).mock.calls.find((c) => c[0] === name);
        expect(call).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cb = call![2] as any;
        const result = await cb(args);
        const text = result.messages[0].content.text as string;
        expect(text).toContain("Préalable");
        expect(text).toContain(expectTool);
        expect(text).toContain(`keywords: "${expectQuoted}"`);
        expect(text).toContain(expectPlaceholder);
      }
    );

    it("does NOT emit a resolution preamble when the entity arg is a numeric ID", async () => {
      registerAllPrompts(server);
      const call = vi.mocked(server.registerPrompt).mock.calls.find((c) => c[0] === "fiche_consultant");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cb = call![2] as any;
      const result = await cb({ resource_id: "18081" });
      const text = result.messages[0].content.text as string;
      expect(text).not.toContain("Préalable");
      expect(text).not.toContain("<RESOURCE_ID>");
      expect(text).toContain("18081");
    });
  });

  describe("traiter_note_de_frais", () => {
    const build = (args: Record<string, string> = {}): string => {
      const prompt = PROMPTS.find((p) => p.name === "traiter_note_de_frais")!;
      return prompt.build(args);
    };

    it("references the tools its runbook actually drives", () => {
      const text = build();
      for (const tool of [
        "boond_application_current_user",
        "boond_expenses_default",
        "boond_expenses_search",
        "boond_expenses_create",
        "boond_expenses_update",
        "boond_expenses_get",
        "boond_documents_create",
      ]) {
        expect(text).toContain(tool);
      }
    });

    // The expense-type codes live on the agency, not in the dictionary. Sending
    // the model to `boond_application_dictionary` for them is a dead end, so the
    // runbook must say so rather than stay silent.
    it("tells the model NOT to look for expense types in the dictionary", () => {
      const text = build();
      expect(text).toContain("boond_application_dictionary");
      expect(text).toMatch(/pas\*{0,2} dans `boond_application_dictionary`/);
    });

    // Non-idempotent write + a visual reading that can be off by a factor of ten:
    // the recap has to gate the call, not follow it.
    it("requires an explicit user validation before writing", () => {
      const text = build();
      expect(text).toContain("ATTENDRE la validation");
      expect(text).toContain("Ne pas appeler l'outil d'écriture avant un « oui » explicite");
      const recapAt = text.indexOf("ATTENDRE la validation");
      const writeAt = text.indexOf("boond_expenses_create");
      expect(recapAt).toBeGreaterThan(-1);
      expect(recapAt).toBeLessThan(text.lastIndexOf("boond_expenses_create"));
      expect(writeAt).toBeGreaterThan(-1);
    });

    it("forbids inventing an unreadable value", () => {
      const text = build();
      expect(text).toContain("Ne jamais inventer");
      expect(text).toContain("le demander à l'utilisateur");
    });

    it("states the term format", () => {
      expect(build()).toContain("`YYYY-MM`");
      expect(build({ term: "2027-01" })).toContain('`term = "2027-01"`');
    });

    // The API does not deduplicate: two reports can coexist on the same
    // (resource, term), so a blind create silently doubles the month.
    it("checks for an existing report before creating one", () => {
      const text = build();
      expect(text).toContain("boond_expenses_search");
      expect(text).toContain("n'empêche pas les doublons");
    });

    // `actualExpenses` replaces the whole array on PUT.
    it("warns that updating replaces every line", () => {
      expect(build()).toContain("l'intégralité** des lignes");
    });

    it("says the amount is TTC and the tax a rate", () => {
      const text = build();
      expect(text).toContain("montant **TTC**");
      expect(text).toContain("un **taux** de TVA");
    });

    // fileUrl-only upload is a deliberate security posture, not an oversight:
    // the runbook has to surface the limit and both escape hatches.
    it("states that the receipt is not attached, and how to attach it", () => {
      const text = build();
      expect(text).toContain("n'a pas été attaché");
      expect(text).toContain('parentType: "expensesReport"');
      expect(text).toContain("manuellement dans l'interface BoondManager");
    });

    it("does not promise a state transition the API ignores", () => {
      expect(build()).toContain("savedAndNoValidation");
    });

    it("resolves a resource passed by name, and inlines a numeric id as-is", () => {
      const byName = build({ resource_id: "Jean Dupont" });
      expect(byName).toContain("Préalable");
      expect(byName).toContain("boond_resources_search");
      expect(byName).toContain("<RESOURCE_ID>");

      const byId = build({ resource_id: "18081" });
      expect(byId).not.toContain("Préalable");
      expect(byId).toContain("18081");
    });

    it("resolves a project passed by label", () => {
      const text = build({ project_id: "Refonte SI" });
      expect(text).toContain("boond_projects_search");
      expect(text).toContain("<PROJET_ID>");
    });

    it("falls back to the current user when no resource is given", () => {
      expect(build()).toContain("boond_application_current_user");
    });

    it("inlines the free-form context when provided", () => {
      expect(build({ contexte: "déjeuner client Dupont" })).toContain("déjeuner client Dupont");
    });

    // finance is the profile this prompt exists for; `resources` is deliberately
    // absent from `domains` because it is not in that profile and one missing
    // domain cuts the whole prompt.
    it("survives the finance profile", () => {
      const policy = resolveAccessPolicy({ BOOND_MCP_PROFILE: "finance" } as NodeJS.ProcessEnv);
      registerAllPrompts(server, policy);
      const names = vi.mocked(server.registerPrompt).mock.calls.map((c) => c[0]);
      expect(names).toContain("traiter_note_de_frais");
    });
  });

  describe("domain metadata + access-policy filtering", () => {
    const known = new Set<string>(REGISTERED_DOMAINS);

    it("every prompt declares a non-empty domains array of known domains", () => {
      for (const p of PROMPTS) {
        expect(p.domains.length).toBeGreaterThan(0);
        for (const d of p.domains) {
          expect(known.has(d)).toBe(true);
        }
      }
    });

    it("no policy → all prompts registered (back-compat)", () => {
      registerAllPrompts(server);
      expect(server.registerPrompt).toHaveBeenCalledTimes(PROMPTS.length);
    });

    it("allow-list keeps only prompts whose domains are fully allowed", () => {
      const policy = resolveAccessPolicy({ BOOND_MCP_DOMAINS: "invoices,application" } as NodeJS.ProcessEnv);
      registerAllPrompts(server, policy);
      const names = vi.mocked(server.registerPrompt).mock.calls.map((c) => c[0]);
      expect(names).toContain("factures_a_relancer");
      expect(names).not.toContain("synthese_equipe");
      expect(names).not.toContain("pipeline_commercial");
    });

    it("excluding a transversal domain (application) cuts the prompts that rely on it", () => {
      const policy = resolveAccessPolicy({ BOOND_MCP_EXCLUDE_DOMAINS: "application" } as NodeJS.ProcessEnv);
      registerAllPrompts(server, policy);
      const names = vi.mocked(server.registerPrompt).mock.calls.map((c) => c[0]);
      // fiche_consultant is the only prompt that does not depend on `application`.
      expect(names).toContain("fiche_consultant");
      expect(names).not.toContain("synthese_equipe");
    });
  });

  describe("server-side dates (#260)", () => {
    // Wednesday 2026-09-23 → ISO week Mon 21 → Sun 27.
    const NOW = new Date(2026, 8, 23, 10, 0);
    const build = (name: string, args: Record<string, string | undefined>) =>
      PROMPTS.find((p) => p.name === name)!.build(args, NOW);

    it("recap_hebdo injects the week's ISO bounds and months, and reads absences + CRA in one call each", () => {
      const text = build("recap_hebdo", {});
      expect(text).toContain("du 2026-09-21 au 2026-09-27");
      expect(text).toContain('startDate: "2026-09-21"');
      expect(text).toContain('endDate: "2026-09-27"');
      expect(text).toContain('boond_absences_search` avec `startMonth: "2026-09"`, `endMonth: "2026-09"`');
      expect(text).toContain("boond_timesheets_search");
      expect(text).toContain("**CRA**");
      expect(text).not.toContain("boond_resources_absences_reports");
      expect(text).not.toContain("Pour chaque membre d'équipe : `boond");
      expect(text).toContain("boond://dictionary/states/opportunities");
    });

    it("recap_hebdo resolves 'semaine prochaine' across a month boundary and keeps unknown wording with today's date", () => {
      const next = build("recap_hebdo", { semaine: "la semaine prochaine" });
      expect(next).toContain("du 2026-09-28 au 2026-10-04");
      expect(next).toContain('startMonth: "2026-09"`, `endMonth: "2026-10"');
      const unknown = build("recap_hebdo", { semaine: "depuis la rentrée" });
      expect(unknown).toContain("« depuis la rentrée »");
      expect(unknown).toContain("aujourd'hui (2026-09-23)");
      expect(unknown).toContain("<DEBUT>");
    });

    it("synthese_equipe defaults to the current month and accepts 'avril 2026'", () => {
      expect(build("synthese_equipe", {})).toContain("du 2026-09-01 au 2026-09-30");
      const april = build("synthese_equipe", { periode: "avril 2026" });
      expect(april).toContain("du 2026-04-01 au 2026-04-30");
      expect(april).toContain("synthèse de l'équipe pour avril 2026");
    });

    it("fin_de_mission computes D and D+H itself, and falls back to 60 on a non-integer", () => {
      const text = build("fin_de_mission", { horizon_jours: "30" });
      expect(text).toContain("D = 2026-09-23 → D+H = 2026-10-23");
      expect(text).toContain('startDate: "2026-09-23"`, `endDate: "2026-10-23"');
      expect(text).not.toContain("Calculer la fenêtre");
      expect(build("fin_de_mission", { horizon_jours: "bientôt" })).toContain("60 prochains jours");
    });

    it("factures_a_relancer states today's date, reads the states resource, filters on the API and paginates to the end", () => {
      const text = build("factures_a_relancer", {});
      expect(text).toContain("aujourd'hui = 2026-09-23");
      expect(text).toContain('endDate: "2026-09-23"');
      expect(text).toContain("boond://dictionary/states/invoices");
      expect(text).not.toContain("boond_application_dictionary");
      expect(text).toContain("Paginer jusqu'au bout");
      expect(text).toContain("antérieure au 2026-09-23");
      // Issue #248: the unpaid states go to the API (`states`), the dictionary
      // is read BEFORE the search, and no client-side sort is asked for.
      expect(text.indexOf("boond://dictionary/states/invoices")).toBeLessThan(text.indexOf("boond_invoices_search"));
      expect(text).toContain("`states: [<IDs impayés de l'étape 1>]`");
      expect(text).toContain("`creditNote: false`");
      expect(text).not.toContain("Filtrer côté agent");
    });

    it("build() defaults `now` to the wall clock", () => {
      const text = PROMPTS.find((p) => p.name === "factures_a_relancer")!.build({});
      expect(text).toMatch(/aujourd'hui = \d{4}-\d{2}-\d{2}/);
    });
  });

  describe("alertes_contrats (#253)", () => {
    const NOW = new Date(2026, 8, 26);
    const build = (args: Record<string, string | undefined>) =>
      PROMPTS.find((p) => p.name === "alertes_contrats")!.build(args, NOW);

    it("drives the composed contract search on both windows with server-side dates", () => {
      const text = build({ horizon_jours: "30" });
      expect(text).toContain("30 prochains jours");
      expect(text).toContain('period: "ending"');
      expect(text).toContain('period: "probationEnding"');
      expect(text).toContain('startDate: "2026-09-26"');
      expect(text).toContain('endDate: "2026-10-26"');
      expect(text).toContain("boond://dictionary/typeOf/contracts");
      expect(text).toContain("boond_resources_contracts");
      expect(text).toContain("perimeterDynamic: ['managers']");
    });

    it("defaults the horizon to 45 days on a non-integer", () => {
      expect(build({ horizon_jours: "bientôt" })).toContain("45 prochains jours");
    });
  });

  describe("the eight ESN routines (#259)", () => {
    const NOW = new Date(2026, 8, 26); // 2026-09-26
    const build = (name: string, args: Record<string, string | undefined>) =>
      PROMPTS.find((p) => p.name === name)!.build(args, NOW);

    it("relance_cra crosses team, CRA states and pending validations, and decides one at a time", () => {
      const text = build("relance_cra", { mois: "mois dernier" });
      expect(text).toContain('startMonth: "2026-08"');
      expect(text).toContain('documentTypes: ["timesReport"]');
      expect(text).toContain('validationStates: ["waitingForValidation"]');
      expect(text).toContain("savedAndNoValidation");
      expect(text).toContain("boond_validations_update");
      expect(text).toContain("une décision à la fois");
      expect(text).toContain("perimeterDynamic: ['managers']");
    });

    it("absences_a_valider reads the pending absence validations and the validated absences of the team", () => {
      const text = build("absences_a_valider", {});
      expect(text).toContain('documentTypes: ["absencesReport"]');
      expect(text).toContain('startMonth: "2026-09"');
      expect(text).toContain('validationStates: ["validated"]');
      expect(text).toContain("boond_absences_get");
      expect(text).toContain("boond_validations_update");
    });

    it("marge_projet compares simulation, productivity and the reporting on the resolved project", () => {
      const text = build("marge_projet", { project_id: "123", periode: "2026-01-01..2026-06-30" });
      expect(text).toContain("boond_projects_simulation");
      expect(text).toContain("boond_projects_productivity");
      expect(text).toContain("boond_projects_deliveries_groupments");
      expect(text).toContain("`boond_reporting_projects` avec `projects: [123]`");
      expect(text).toContain('startDate: "2026-01-01"');
      expect(text).not.toContain("<PROJET_ID>");
    });

    it("preparation_entretien reads the candidate aggregate, the resume and the positionings, and the need when given", () => {
      const text = build("preparation_entretien", { candidate_id: "55", opportunity_id: "9" });
      expect(text).toContain("boond://candidate/55");
      expect(text).toContain("boond_documents_get");
      expect(text).toContain("boond_candidates_positionings");
      expect(text).toContain("`boond_opportunities_get` sur `9`");
      expect(text).toContain("8 à 10 questions");
      expect(build("preparation_entretien", { candidate_id: "55" })).toContain("Sans opportunité visée");
    });

    it("preparation_rdv_client filters unpaid invoices on the API and bounds the action history", () => {
      const text = build("preparation_rdv_client", { society_id: "6221", horizon_jours: "30" });
      expect(text).toContain("boond://company/6221");
      expect(text).toContain('companyId: "6221"');
      expect(text).toContain('period: "expectedPayment"');
      expect(text).toContain('startDate: "2026-08-27"');
      expect(text).toContain('endDate: "2026-09-26"');
      expect(text).toContain("boond_companies_contacts");
      expect(text).toContain("5 sujets à aborder");
    });

    it("relance_devis resolves the states from the dictionary and checks the silence window per opportunity", () => {
      const text = build("relance_devis", { jours_sans_action: "10" });
      expect(text).toContain("boond://dictionary/states/opportunities");
      expect(text).toContain("opportunityStates: [<IDs de l'étape 1>]");
      expect(text).toContain('startDate: "2026-09-16"');
      expect(text).toContain("boond_opportunities_actions");
      expect(build("relance_devis", { jours_sans_action: "x" })).toContain("depuis 15 jours");
    });

    it("purge_rgpd_candidats paginates the stale candidates, excludes active ones, and deletes one by one after consent", () => {
      const text = build("purge_rgpd_candidats", { mois_inactivite: "12" });
      expect(text).toContain('endDate: "2025-09-26"');
      expect(text).toContain('period: "updated"');
      expect(text).toContain("paginer jusqu'au bout");
      expect(text).toContain("boond_candidates_positionings");
      expect(text).toContain("attendre la validation explicite");
      expect(text).toContain("un candidat par appel");
      expect(build("purge_rgpd_candidats", {})).toContain("depuis 24 mois");
    });

    it("preparation_facturation starts from running deliveries and validated CRA, then reads the remaining amount per order", () => {
      const text = build("preparation_facturation", { mois: "2026-08" });
      expect(text).toContain('period: "running"');
      expect(text).toContain('startDate: "2026-08-01"');
      expect(text).toContain('endDate: "2026-08-31"');
      expect(text).toContain('startMonth: "2026-08"');
      expect(text).toContain("boond_orders_invoices");
      expect(text).toContain("deltaInvoicedExcludingTax");
      expect(text).toContain("relance_cra");
      expect(text).toContain("Ne pas créer les factures ici");
    });

    it("every routine declares the domains its runbook orchestrates", () => {
      const expected: Record<string, string[]> = {
        relance_cra: ["validations", "timesheets", "resources"],
        absences_a_valider: ["validations", "absences"],
        marge_projet: ["projects", "reporting"],
        preparation_entretien: ["candidates", "opportunities", "documents"],
        preparation_rdv_client: ["companies", "contacts", "opportunities", "projects", "invoices", "actions"],
        relance_devis: ["opportunities", "actions"],
        purge_rgpd_candidats: ["candidates"],
        preparation_facturation: ["timesheets", "deliveries", "orders", "invoices"],
      };
      for (const [name, domains] of Object.entries(expected)) {
        const prompt = PROMPTS.find((p) => p.name === name)!;
        expect(prompt.domains, name).toEqual(expect.arrayContaining(domains));
      }
    });
  });

  describe("attention_du_jour (#255)", () => {
    it("reads the alerts resource first, groups by urgency and maps each module to its tool", () => {
      const text = PROMPTS.find((p) => p.name === "attention_du_jour")!.build({}, new Date(2026, 8, 26));
      expect(text).toContain("(2026-09-26)");
      expect(text.indexOf("boond://alerts/me")).toBeLessThan(text.indexOf("boond_alerts_search"));
      expect(text).toContain("ne pas les recomposer");
      for (const tool of [
        "boond_contracts_search",
        "boond_validations_update",
        "boond_invoices_search",
        "boond_deliveries_search",
        "boond_opportunities_search",
      ]) {
        expect(text).toContain(tool);
      }
      expect(text).toContain("sans alerte est une information");
    });
  });

  describe("ingest_communication (#180)", () => {
    const build = (args: Record<string, string | undefined>) =>
      PROMPTS.find((p) => p.name === "ingest_communication")!.build(args, new Date(2026, 8, 26));

    it("extracts, deduplicates through boond_find, waits for consent, then writes in dependency order", () => {
      const text = build({ contenu: "Bonjour, suite à notre appel…", type_action: "appel", opportunite_id: "77" });
      expect(text).toContain("Bonjour, suite à notre appel…");
      const order = [
        "Extraire",
        "Dédupliquer",
        "boond_find",
        "ATTENDRE la validation",
        "boond_companies_create",
        "boond_contacts_create",
        "boond_actions_create",
      ];
      const positions = order.map((s) => text.indexOf(s));
      expect(positions.every((p) => p >= 0)).toBe(true);
      expect([...positions]).toEqual([...positions].sort((a, b) => a - b));
      expect(text).toContain('entity: "contact"');
      expect(text).toContain("boond://dictionary/actions/contacts");
      expect(text).toContain("`77` (fournie)");
      expect(text).toContain("type « appel »");
      expect(text).not.toMatch(/sampling/i);
    });

    it("asks for the pasted text when no contenu is given and resolves an opportunity label", () => {
      const text = build({ opportunite_id: "Refonte SI" });
      expect(text).toContain("celui collé dans la conversation");
      expect(text).toContain("boond_opportunities_search");
      expect(text).toContain("<OPPORTUNITE_ID>");
    });
  });

  describe("saisir_cra (#249)", () => {
    const NOW = new Date(2026, 9, 7);
    const build = (args: Record<string, string | undefined>) =>
      PROMPTS.find((p) => p.name === "saisir_cra")!.build(args, NOW);

    it("drives default → search → get/update or create, in that order, with the month resolved server-side", () => {
      const text = build({});
      const order = [
        "boond_timesheets_default",
        "boond_timesheets_search",
        "boond_timesheets_get",
        "boond_timesheets_update",
        "boond_timesheets_create",
      ];
      const positions = order.map((t) => text.indexOf(t));
      expect(positions.every((p) => p >= 0)).toBe(true);
      expect(text.indexOf("boond_timesheets_default")).toBeLessThan(text.indexOf("boond_timesheets_search"));
      expect(text).toContain('term = "2026-10"');
      expect(text).toContain('startMonth: "2026-10"');
      expect(build({ term: "2026-08" })).toContain('term = "2026-08"');
    });

    it("waits for the user, warns that update replaces every line, and does not promise a state change", () => {
      const text = build({ resource_id: "30888", consignes: "RTT le 12" });
      expect(text).toContain("ATTENDRE la validation de l'utilisateur");
      expect(text).toContain("remplace tout le tableau");
      expect(text).toContain("`state` n'est pas modifiable ici");
      expect(text).toContain("Consignes de l'utilisateur : « RTT le 12 »");
      expect(text).toContain('resourceId: "30888"');
      expect(text).not.toContain("boond_application_dictionary` pour les types");
    });
  });
});
