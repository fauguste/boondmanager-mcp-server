import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Pre-orchestrated MCP prompts for the most common Boond workflows.
 *
 * Why: the search tools alone require the LLM to discover the right filter
 * combination on its own — it works, but it costs tokens and a few wrong
 * turns. A prompt names the goal ("synthese_equipe", "pipeline_commercial",
 * …) and embeds the exact tool sequence + filter names the model should
 * use. From the user's perspective it's a single command instead of a
 * multi-turn conversation.
 *
 * Each prompt resolves to a user message. We deliberately do NOT execute
 * the tools server-side here — the LLM still drives, the prompt just gives
 * it the runbook. This keeps the LLM in control of error handling and
 * follow-up questions.
 */

const userMessage = (text: string) => ({
  messages: [
    { role: "user" as const, content: { type: "text" as const, text } },
  ],
});

interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  argsSchema: z.ZodRawShape;
  build: (args: Record<string, string | undefined>) => string;
}

const PROMPTS: PromptDefinition[] = [
  {
    name: "synthese_equipe",
    title: "Synthèse d'une équipe",
    description:
      "Produit un état d'équipe : qui est sur quoi, qui est absent, qui est disponible. "
      + "Si manager_id est omis, utilise l'utilisateur courant comme manager.",
    argsSchema: {
      manager_id: z.string().optional().describe(
        "ID du manager (ressource Boond). Si absent, l'outil `boond_application_current_user` doit être appelé pour le récupérer."
      ),
      periode: z.string().optional().describe(
        "Période d'analyse libre (ex: 'cette semaine', 'avril 2026'). Défaut: mois en cours."
      ),
    },
    build: ({ manager_id, periode }) => {
      const periodeText = periode || "le mois en cours";
      const managerStep = manager_id
        ? `Le manager ciblé est l'ID ${manager_id}.`
        : "Commence par appeler `boond_application_current_user` pour obtenir mon ID utilisateur, puis utilise-le comme `manager_id`.";
      return [
        `Produis une synthèse de l'équipe pour ${periodeText}.`,
        "",
        managerStep,
        "",
        "Étapes :",
        "1. Lister les membres de l'équipe : `boond_resources_search` avec `perimeterManagers: [<manager_id>]` et `resourceStates` pour ne garder que les actifs (récupère les états valides via `boond_application_dictionary` avec `setting.state.resource` si besoin).",
        "2. Pour chaque ressource retournée, récupérer en parallèle :",
        "   - `boond_resources_positionings` (qui est sur quel projet)",
        "   - `boond_resources_absences_reports` (absences validées/à venir)",
        "   - `boond_resources_times_reports` (CRA récent, pour confirmer l'occupation)",
        "3. Synthétiser un tableau par personne : nom, projet courant, % occupation, absences sur la période, disponibilité.",
        "4. Conclure par les signaux faibles (sur-/sous-charge, absences non couvertes, ressources sans positionnement).",
      ].join("\n");
    },
  },

  {
    name: "pipeline_commercial",
    title: "Pipeline commercial sur une période",
    description:
      "Analyse les opportunités commerciales avec closing prévu dans la période donnée : "
      + "répartition par état, CA pondéré, top opportunités.",
    argsSchema: {
      date_debut: z.string().describe("Début de période (YYYY-MM-DD)."),
      date_fin: z.string().describe("Fin de période (YYYY-MM-DD)."),
      manager_id: z.string().optional().describe(
        "ID du commercial. Si absent, scope = équipe de l'utilisateur courant via `perimeterDynamic: ['data']`."
      ),
    },
    build: ({ date_debut, date_fin, manager_id }) => {
      const scopeFilter = manager_id
        ? `\`perimeterManagers: [${manager_id}]\``
        : "`perimeterDynamic: ['data']` (mes opportunités)";
      return [
        `Analyse mon pipeline commercial avec closing entre ${date_debut} et ${date_fin}.`,
        "",
        `Périmètre : ${scopeFilter}.`,
        "",
        "Étapes :",
        "1. Appeler `boond_opportunities_search` avec :",
        `   - \`period: "closingDate"\``,
        `   - \`startDate: "${date_debut}"\`, \`endDate: "${date_fin}"\``,
        `   - ${scopeFilter}`,
        "   - `pageSize: 100`",
        "2. Si plus de 100 résultats, paginer via `page`.",
        "3. Récupérer le dictionnaire des états via `boond_application_dictionary` avec `setting.state.opportunity` pour traduire les ID en libellés.",
        "4. Restituer :",
        "   - Nombre total d'opportunités, par état",
        "   - CA pondéré total (somme de `turnoverWeightedExcludingTax`)",
        "   - Top 10 par montant pondéré, avec société/contact/closingDate",
        "   - Risques : opportunités dont la closingDate est passée mais qui ne sont pas encore en état Gagnée/Perdue.",
      ].join("\n");
    },
  },

  {
    name: "factures_a_relancer",
    title: "Factures impayées à relancer",
    description:
      "Liste les factures impayées avec date d'échéance dépassée, regroupées par société. "
      + "Optionnellement filtrable sur une société spécifique.",
    argsSchema: {
      society_id: z.string().optional().describe("ID d'une société pour cibler la relance."),
    },
    build: ({ society_id }) => {
      return [
        "Identifie les factures à relancer (impayées dont l'échéance est dépassée).",
        "",
        "Étapes :",
        "1. Appeler `boond_invoices_search` :",
        society_id ? `   - \`companyId: "${society_id}"\`` : "   - sans filtre société (toutes les factures du périmètre courant)",
        "   - `pageSize: 100`",
        "2. Récupérer le dictionnaire `setting.state.invoice` via `boond_application_dictionary` pour identifier les états « payée » / « partiellement payée » / etc.",
        "3. Filtrer côté agent : ne conserver que les factures dont l'état n'est PAS « payée » ET dont la `dueDate` est strictement antérieure à aujourd'hui.",
        "4. Pour chaque facture retenue, récupérer le détail via `boond_invoices_get` si nécessaire pour obtenir le contact/email de relance.",
        "5. Restituer un tableau groupé par société : société | nombre de factures impayées | total HT impayé | facture la plus ancienne (référence + jours de retard) | contact à relancer.",
        "6. Ajouter une ligne « Total » en bas.",
      ].join("\n");
    },
  },

  {
    name: "candidats_pour_opportunite",
    title: "Candidats correspondant à une opportunité",
    description:
      "À partir d'une opportunité (ses outils, expertise, mobilité), trouve les candidats actifs qui matchent.",
    argsSchema: {
      opportunity_id: z.string().describe("ID de l'opportunité à pourvoir."),
    },
    build: ({ opportunity_id }) => {
      return [
        `Identifie les candidats qui matchent l'opportunité ${opportunity_id}.`,
        "",
        "Étapes :",
        `1. Récupérer le détail de l'opportunité : \`boond_opportunities_get(id="${opportunity_id}")\` puis l'onglet \`information\` pour les attributs détaillés.`,
        "2. Extraire les critères : `tools`, `expertiseAreas`, `activityAreas`, `places` (mobilité), `durations`, `startDate`/`endDate`.",
        "3. Appeler `boond_candidates_search` avec :",
        "   - les `tools` extraits (logique OU par défaut ; si l'opportunité est très exigeante, repasser avec `[\"#AND#\", ...]` pour exiger toutes les compétences)",
        "   - `expertiseAreas` correspondants",
        "   - `mobilityAreas` matchant le lieu",
        "   - `candidateStates` actifs uniquement (consulter `setting.state.candidate` via `boond_application_dictionary`)",
        "   - `period: \"available\"` + `startDate`/`endDate` calés sur la mission, pour ne garder que les candidats disponibles",
        "   - `pageSize: 50`",
        "4. Pour les top 20 candidats retournés, récupérer `boond_candidates_technical_data` pour vérifier l'adéquation fine.",
        "5. Restituer un classement : nom | titre | dispo | note d'adéquation (sur 10) avec justification 1 ligne.",
      ].join("\n");
    },
  },

  {
    name: "fiche_consultant",
    title: "Fiche complète d'un collaborateur",
    description:
      "Vue 360° d'une ressource : info, profil technique, positionnements, absences, CRA récents.",
    argsSchema: {
      resource_id: z.string().describe("ID de la ressource."),
    },
    build: ({ resource_id }) => {
      return [
        `Produis la fiche complète de la ressource ${resource_id}.`,
        "",
        "Étapes (à exécuter en parallèle quand possible) :",
        `1. \`boond_resources_information(id="${resource_id}")\` — coordonnées et état civil`,
        `2. \`boond_resources_technical_data(id="${resource_id}")\` — compétences, formations, langues, CV`,
        `3. \`boond_resources_administrative(id="${resource_id}")\` — données RH (TJM, salaire, contrat) si autorisé`,
        `4. \`boond_resources_positionings(id="${resource_id}")\` — positionnements actifs et historiques`,
        `5. \`boond_resources_projects(id="${resource_id}")\` — projets passés/en cours`,
        `6. \`boond_resources_absences_reports(id="${resource_id}")\` — absences à venir et passées récentes`,
        `7. \`boond_resources_times_reports(id="${resource_id}")\` — CRA des 3 derniers mois`,
        "",
        "Restitution : un document structuré en sections (Identité / Profil technique / Mission actuelle / Historique projets / Disponibilité / RH si pertinent). Mettre en évidence : projet courant, prochaine date de fin de mission, prochaine absence, taux d'occupation moyen sur 3 mois.",
      ].join("\n");
    },
  },

  {
    name: "recap_hebdo",
    title: "Récap hebdomadaire (moi + mon équipe)",
    description:
      "Compile en une vue ce qui s'est passé / va se passer cette semaine pour moi et mon équipe : opportunités, projets, absences, CRA.",
    argsSchema: {
      semaine: z.string().optional().describe(
        "Semaine ciblée (ex: 'cette semaine', 'la semaine prochaine'). Défaut: cette semaine."
      ),
    },
    build: ({ semaine }) => {
      const semaineText = semaine || "cette semaine";
      return [
        `Produis mon récap pour ${semaineText}.`,
        "",
        "Étapes :",
        "1. `boond_application_current_user` pour récupérer mon ID.",
        "2. En parallèle :",
        "   a. `boond_opportunities_search` avec `perimeterDynamic: ['data']`, `period: 'updated'` + dates de la semaine — opportunités touchées cette semaine.",
        "   b. `boond_resources_search` avec `perimeterDynamic: ['managers']` — mon équipe (mes N-1).",
        "   c. Pour chaque membre d'équipe : `boond_resources_absences_reports` filtré sur la semaine.",
        "   d. `boond_projects_search` avec `perimeterDynamic: ['data']` et `period: 'running'` + dates de la semaine — mes projets actifs.",
        "3. Récupérer `setting.state.opportunity` et `setting.state.project` via `boond_application_dictionary` pour libeller les états.",
        "4. Restituer en 4 sections :",
        "   - **Pipeline** : opps qui ont bougé (nouvelles, état changé, closing imminent)",
        "   - **Équipe** : qui est absent cette semaine, qui termine sa mission",
        "   - **Projets** : projets actifs, dont ceux qui s'arrêtent ou démarrent dans la semaine",
        "   - **Actions à mener** : 3-5 puces concrètes (relances, validations, repositionnements)",
      ].join("\n");
    },
  },
];

export function registerAllPrompts(server: McpServer): void {
  for (const p of PROMPTS) {
    server.registerPrompt(
      p.name,
      {
        title: p.title,
        description: p.description,
        argsSchema: p.argsSchema,
      },
      async (args) => userMessage(p.build((args ?? {}) as Record<string, string | undefined>))
    );
  }
}

/** Exposed for tests so we can assert names/coverage without instantiating a server. */
export const REGISTERED_PROMPTS = PROMPTS.map((p) => ({
  name: p.name,
  title: p.title,
  description: p.description,
  argKeys: Object.keys(p.argsSchema),
}));
