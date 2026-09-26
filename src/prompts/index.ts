import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { z } from "zod";
import type { DomainName } from "../constants.js";
import { isDomainAllowed, type AccessPolicy } from "../config/access-policy.js";
import { apiRequest } from "../services/boond-client.js";
import { addDays, periodBounds, toIsoDate, type PeriodBounds } from "./periods.js";

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
  messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
});

export interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  argsSchema: z.ZodRawShape;
  /**
   * Business domains this prompt's runbook orchestrates. Used by the access
   * policy: the prompt (and its mirror workflow tool in `tools/workflows.ts`)
   * is cut when ANY of these domains is filtered out, so a surfaced runbook
   * never points the model at tools that aren't registered. Optional
   * name-resolution helpers (e.g. resolving a manager name via
   * `boond_resources_search`) are intentionally NOT listed: if their domain
   * is filtered, the user simply passes a numeric id instead.
   */
  domains: readonly DomainName[];
  /**
   * Render the runbook. `now` is the reference date for relative periods
   * ("cette semaine", "D → D+H"): the server resolves them to literal ISO
   * dates (issue #260, `./periods.ts`) instead of leaving the arithmetic to
   * the model. Injected by tests; defaults to the wall clock.
   */
  build: (args: Record<string, string | undefined>, now?: Date) => string;
}

/**
 * One line telling the model the resolved bounds, or — when the caller's
 * wording was not understood — today's date so it at least has an anchor.
 */
function periodLine(bounds: PeriodBounds | null, rawArg: string | undefined, now: Date): string {
  if (bounds) {
    return `Période : ${bounds.label} — du ${bounds.startDate} au ${bounds.endDate} (mois ${bounds.startMonth}${bounds.endMonth !== bounds.startMonth ? ` à ${bounds.endMonth}` : ""}). Utiliser ces dates telles quelles.`;
  }
  return `Période : « ${rawArg?.trim()} » — à interpréter à partir d'aujourd'hui (${toIsoDate(now)}) en dates YYYY-MM-DD avant tout appel.`;
}

/**
 * Pour chaque prompt, l'utilisateur peut passer soit un ID numérique (rapide,
 * sans ambiguïté), soit un libellé textuel (« Jean Dupont », « ACME »,
 * « Refonte SI »…). Le runbook renvoyé au modèle contient alors une étape
 * préalable qui résout le libellé via le `*_search` adéquat avant de l'utiliser
 * comme filtre. Cela évite à l'utilisateur de chercher l'ID en amont — la
 * majorité des appels passent en une seule formulation naturelle.
 */
type EntityKind = "resource" | "society" | "opportunity" | "agency" | "project" | "candidate" | "contact";

const SEARCH_TOOL_BY_KIND: Record<EntityKind, string> = {
  resource: "boond_resources_search",
  society: "boond_companies_search",
  opportunity: "boond_opportunities_search",
  agency: "boond_agencies_search",
  project: "boond_projects_search",
  candidate: "boond_candidates_search",
  contact: "boond_contacts_search",
};

const LABEL_BY_KIND: Record<EntityKind, string> = {
  resource: "ressource",
  society: "société",
  opportunity: "opportunité",
  agency: "agence",
  project: "projet",
  candidate: "candidat",
  contact: "contact",
};

interface Resolved {
  /** Texte à inliner là où l'ID apparaît dans les filtres : soit un ID numérique, soit un placeholder. */
  idForFilter: string;
  /** Bloc d'instructions à prépender avant les étapes (vide si l'input est déjà un ID numérique). */
  preamble: string;
}

const resolveEntity = (input: string, kind: EntityKind, placeholder: string): Resolved => {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    return { idForFilter: trimmed, preamble: "" };
  }
  const tool = SEARCH_TOOL_BY_KIND[kind];
  const label = LABEL_BY_KIND[kind];
  const preamble = [
    `**Préalable — résolution de la ${label} :** « ${trimmed} » n'est pas un ID numérique.`,
    `- Appeler \`${tool}\` avec \`keywords: "${trimmed}"\` et \`pageSize: 5\`.`,
    `- Retenir l'\`id\` du résultat le plus pertinent → ce sera la valeur \`${placeholder}\` à utiliser dans toutes les étapes ci-dessous.`,
    `- Si plusieurs candidats matchent, demander confirmation à l'utilisateur avant de poursuivre.`,
    "",
  ].join("\n");
  return { idForFilter: placeholder, preamble };
};

const ID_OR_NAME_HINT_RESOURCE =
  "Accepte soit l'ID numérique, soit « Prénom Nom » (le serveur résoudra automatiquement via `boond_resources_search`).";
const ID_OR_NAME_HINT_SOCIETY =
  "Accepte soit l'ID numérique, soit le nom de la société (résolution auto via `boond_companies_search`).";
const ID_OR_NAME_HINT_OPPORTUNITY =
  "Accepte soit l'ID numérique, soit l'intitulé de l'opportunité (résolution auto via `boond_opportunities_search`).";
const ID_OR_NAME_HINT_AGENCY =
  "Accepte soit l'ID numérique, soit le nom de l'agence (résolution auto via `boond_agencies_search`).";
const ID_OR_NAME_HINT_PROJECT =
  "Accepte soit l'ID numérique, soit le libellé du projet (résolution auto via `boond_projects_search`).";
const ID_OR_NAME_HINT_CANDIDATE =
  "Accepte soit l'ID numérique, soit « Prénom Nom » du candidat (résolution auto via `boond_candidates_search`).";

/** Manager scope shared by the team-level runbooks: explicit `perimeterManagers` or the caller's own N-1. */
function managerScope(manager_id: string | undefined): { scope: string; preamble: string } {
  if (manager_id) {
    const r = resolveEntity(manager_id, "resource", "<MANAGER_ID>");
    return { scope: `\`perimeterManagers: [${r.idForFilter}]\``, preamble: r.preamble };
  }
  return { scope: "`perimeterDynamic: ['managers']`", preamble: "" };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const MANAGER_ARG = (what: string) =>
  z
    .string()
    .optional()
    .describe(
      `Manager pour restreindre à son équipe (${what}). ` +
        ID_OR_NAME_HINT_RESOURCE +
        " Si absent, scope = mon équipe via `perimeterDynamic: ['managers']`."
    );
const MONTH_ARG = (what: string) =>
  z
    .string()
    .optional()
    .describe(`${what} : \`YYYY-MM\`, « ce mois », « mois dernier », « avril 2026 »… Défaut : le mois en cours.`);

export const PROMPTS: PromptDefinition[] = [
  {
    name: "synthese_equipe",
    title: "Synthèse d'une équipe",
    description:
      "Produit un état d'équipe : qui est sur quoi, qui est absent, qui est disponible. " +
      "Si manager_id est omis, utilise l'utilisateur courant comme manager.",
    argsSchema: {
      manager_id: z
        .string()
        .optional()
        .describe(
          "Manager ciblé. " +
            ID_OR_NAME_HINT_RESOURCE +
            " Si absent, l'outil `boond_application_current_user` est appelé pour le récupérer."
        ),
      periode: z
        .string()
        .optional()
        .describe(
          "Période d'analyse (ex: 'cette semaine', 'mois dernier', '2026-04', 'avril 2026', '2026-W14'). Défaut: mois en cours. Résolue en dates ISO côté serveur."
        ),
    },
    domains: ["resources", "application"],
    build: ({ manager_id, periode }, now = new Date()) => {
      const bounds = periodBounds(periode, now, "month");
      const periodeText = bounds ? bounds.label : periode!.trim();
      let preamble = "";
      let managerStep: string;
      let managerIdLit: string;
      if (manager_id) {
        const r = resolveEntity(manager_id, "resource", "<MANAGER_ID>");
        preamble = r.preamble;
        managerIdLit = r.idForFilter;
        managerStep = `Le manager ciblé a pour ID \`${managerIdLit}\`.`;
      } else {
        managerIdLit = "<MANAGER_ID>";
        managerStep =
          "Commence par appeler `boond_application_current_user` pour obtenir mon ID utilisateur, puis utilise-le comme `<MANAGER_ID>`.";
      }
      const lines: string[] = [`Produis une synthèse de l'équipe pour ${periodeText}.`, ""];
      if (preamble) lines.push(preamble);
      lines.push(
        managerStep,
        periodLine(bounds, periode, now),
        "",
        "Étapes :",
        `1. Lister les membres de l'équipe : \`boond_resources_search\` avec \`perimeterManagers: [${managerIdLit}]\` et \`resourceStates\` pour ne garder que les actifs (récupère les états valides via \`boond_application_dictionary\` avec \`setting.state.resource\` si besoin).`,
        "2. Pour chaque ressource retournée, récupérer en parallèle :",
        "   - `boond_resources_positionings` (qui est sur quel projet)",
        "   - `boond_resources_absences_reports` (absences validées/à venir — ne retenir que celles qui recoupent la période ci-dessus)",
        "   - `boond_resources_times_reports` (CRA de la période, pour confirmer l'occupation)",
        "3. Synthétiser un tableau par personne : nom, projet courant, % occupation, absences sur la période, disponibilité.",
        "4. Conclure par les signaux faibles (sur-/sous-charge, absences non couvertes, ressources sans positionnement)."
      );
      return lines.join("\n");
    },
  },

  {
    name: "pipeline_commercial",
    title: "Pipeline commercial sur une période",
    description:
      "Analyse les opportunités commerciales avec closing prévu dans la période donnée : " +
      "répartition par état, CA pondéré, top opportunités.",
    argsSchema: {
      date_debut: z.string().describe("Début de période (YYYY-MM-DD)."),
      date_fin: z.string().describe("Fin de période (YYYY-MM-DD)."),
      manager_id: z
        .string()
        .optional()
        .describe(
          "Commercial ciblé. " +
            ID_OR_NAME_HINT_RESOURCE +
            " Si absent, scope = équipe de l'utilisateur courant via `perimeterDynamic: ['data']`."
        ),
    },
    domains: ["opportunities", "application"],
    build: ({ date_debut, date_fin, manager_id }) => {
      let preamble = "";
      let scopeFilter: string;
      if (manager_id) {
        const r = resolveEntity(manager_id, "resource", "<MANAGER_ID>");
        preamble = r.preamble;
        scopeFilter = `\`perimeterManagers: [${r.idForFilter}]\``;
      } else {
        scopeFilter = "`perimeterDynamic: ['data']` (mes opportunités)";
      }
      const lines: string[] = [`Analyse mon pipeline commercial avec closing entre ${date_debut} et ${date_fin}.`, ""];
      if (preamble) lines.push(preamble);
      lines.push(
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
        "   - Risques : opportunités dont la closingDate est passée mais qui ne sont pas encore en état Gagnée/Perdue."
      );
      return lines.join("\n");
    },
  },

  {
    name: "factures_a_relancer",
    title: "Factures impayées à relancer",
    description:
      "Liste les factures impayées avec date d'échéance dépassée, regroupées par société. " +
      "Optionnellement filtrable sur une société spécifique.",
    argsSchema: {
      society_id: z
        .string()
        .optional()
        .describe("Société ciblée pour la relance. " + ID_OR_NAME_HINT_SOCIETY),
    },
    domains: ["invoices", "application"],
    build: ({ society_id }, now = new Date()) => {
      const today = toIsoDate(now);
      let preamble = "";
      let filterLine: string;
      if (society_id) {
        const r = resolveEntity(society_id, "society", "<SOCIETE_ID>");
        preamble = r.preamble;
        filterLine = `   - \`companyId: "${r.idForFilter}"\``;
      } else {
        filterLine = "   - sans filtre société (toutes les factures du périmètre courant)";
      }
      const lines: string[] = [
        `Identifie les factures à relancer (impayées dont l'échéance est dépassée au ${today}).`,
        "",
      ];
      if (preamble) lines.push(preamble);
      lines.push(
        `Date de référence : aujourd'hui = ${today}.`,
        "",
        "Étapes :",
        "1. Lire la ressource `boond://dictionary/states/invoices` (pas d'appel d'outil) et retenir les IDs des états **impayés** : tous les états sauf « payée » (et « annulée » / avoir s'ils existent).",
        "2. Appeler `boond_invoices_search` **en filtrant côté API** :",
        filterLine,
        "   - `states: [<IDs impayés de l'étape 1>]`",
        '   - `period: "expectedPayment"`, `endDate: "' +
          today +
          "\"` — échéance de paiement attendue avant aujourd'hui",
        "   - `creditNote: false`",
        "   - `pageSize: 100`, `fields: ['reference', 'state', 'expectedPaymentDate', 'turnoverInvoicedExcludingTax', 'company']`",
        "   - **Paginer jusqu'au bout** : tant que `structuredContent.count` vaut 100, rappeler avec `page: 2`, `page: 3`… Ne pas s'arrêter à la première page.",
        `3. Contrôle : chaque facture rendue doit avoir un état de l'étape 1 et une \`expectedPaymentDate\` strictement antérieure au ${today} — sinon signaler l'écart plutôt que de trier à la main.`,
        "4. Pour chaque facture retenue, récupérer le détail via `boond_invoices_get` si nécessaire pour obtenir le contact/email de relance.",
        "5. Restituer un tableau groupé par société : société | nombre de factures impayées | total HT impayé | facture la plus ancienne (référence + jours de retard) | contact à relancer.",
        "6. Ajouter une ligne « Total » en bas."
      );
      return lines.join("\n");
    },
  },

  {
    name: "candidats_pour_opportunite",
    title: "Candidats correspondant à une opportunité",
    description:
      "À partir d'une opportunité (ses outils, expertise, mobilité), trouve les candidats actifs qui matchent.",
    argsSchema: {
      opportunity_id: z.string().describe("Opportunité à pourvoir. " + ID_OR_NAME_HINT_OPPORTUNITY),
    },
    domains: ["candidates", "opportunities", "application"],
    build: ({ opportunity_id }) => {
      const r = resolveEntity(opportunity_id ?? "", "opportunity", "<OPPORTUNITY_ID>");
      const oppLit = r.idForFilter;
      const lines: string[] = [`Identifie les candidats qui matchent l'opportunité ${oppLit}.`, ""];
      if (r.preamble) lines.push(r.preamble);
      lines.push(
        "Étapes :",
        `1. Récupérer le détail de l'opportunité : \`boond_opportunities_get(id="${oppLit}")\` puis l'onglet \`information\` pour les attributs détaillés.`,
        "2. Extraire les critères : `tools`, `expertiseAreas`, `activityAreas`, `places` (mobilité), `durations`, `startDate`/`endDate`.",
        "3. Appeler `boond_candidates_search` avec :",
        '   - les `tools` extraits (logique OU par défaut ; si l\'opportunité est très exigeante, repasser avec `["#AND#", ...]` pour exiger toutes les compétences)',
        "   - `expertiseAreas` correspondants",
        "   - `mobilityAreas` matchant le lieu",
        "   - `candidateStates` actifs uniquement (consulter `setting.state.candidate` via `boond_application_dictionary`)",
        '   - `period: "available"` + `startDate`/`endDate` calés sur la mission, pour ne garder que les candidats disponibles',
        "   - `pageSize: 50`",
        "4. Pour les top 20 candidats retournés, récupérer `boond_candidates_technical_data` pour vérifier l'adéquation fine.",
        "5. Restituer un classement : nom | titre | dispo | note d'adéquation (sur 10) avec justification 1 ligne."
      );
      return lines.join("\n");
    },
  },

  {
    name: "fiche_consultant",
    title: "Fiche complète d'un collaborateur",
    description: "Vue 360° d'une ressource : info, profil technique, positionnements, absences, CRA récents.",
    argsSchema: {
      resource_id: z.string().describe("Ressource ciblée. " + ID_OR_NAME_HINT_RESOURCE),
    },
    domains: ["resources"],
    build: ({ resource_id }) => {
      const r = resolveEntity(resource_id ?? "", "resource", "<RESOURCE_ID>");
      const idLit = r.idForFilter;
      const lines: string[] = [`Produis la fiche complète de la ressource ${idLit}.`, ""];
      if (r.preamble) lines.push(r.preamble);
      lines.push(
        "Étapes (à exécuter en parallèle quand possible) :",
        `1. \`boond_resources_information(id="${idLit}")\` — coordonnées et état civil`,
        `2. \`boond_resources_technical_data(id="${idLit}")\` — compétences, formations, langues, CV`,
        `3. \`boond_resources_administrative(id="${idLit}")\` — données RH (TJM, salaire, contrat) si autorisé`,
        `4. \`boond_resources_positionings(id="${idLit}")\` — positionnements actifs et historiques`,
        `5. \`boond_resources_projects(id="${idLit}")\` — projets passés/en cours`,
        `6. \`boond_resources_absences_reports(id="${idLit}")\` — absences à venir et passées récentes`,
        `7. \`boond_resources_times_reports(id="${idLit}")\` — CRA des 3 derniers mois`,
        "",
        "Restitution : un document structuré en sections (Identité / Profil technique / Mission actuelle / Historique projets / Disponibilité / RH si pertinent). Mettre en évidence : projet courant, prochaine date de fin de mission, prochaine absence, taux d'occupation moyen sur 3 mois."
      );
      return lines.join("\n");
    },
  },

  {
    name: "staffing_disponible",
    title: "Consultants disponibles pour un staffing",
    description:
      "Identifie les ressources internes disponibles pour un staffing sur une fenêtre donnée, " +
      "avec filtres optionnels par compétences (texte libre) et périmètre. " +
      "Trie par date de disponibilité croissante et propose les profils prioritaires à activer.",
    argsSchema: {
      start_date: z.string().describe("Début de fenêtre de staffing (YYYY-MM-DD)."),
      end_date: z.string().describe("Fin de fenêtre de staffing (YYYY-MM-DD)."),
      competences: z
        .string()
        .optional()
        .describe(
          "Compétences recherchées en texte libre (ex: 'Java Spring AWS'). Le modèle les mappera vers `tools` via le dictionnaire."
        ),
      manager_id: z
        .string()
        .optional()
        .describe(
          "Manager pour restreindre à son équipe. " +
            ID_OR_NAME_HINT_RESOURCE +
            " Si absent, scope = mon équipe via `perimeterDynamic: ['managers']`."
        ),
    },
    domains: ["resources", "application"],
    build: ({ start_date, end_date, competences, manager_id }) => {
      let preamble = "";
      let scope: string;
      if (manager_id) {
        const r = resolveEntity(manager_id, "resource", "<MANAGER_ID>");
        preamble = r.preamble;
        scope = `\`perimeterManagers: [${r.idForFilter}]\``;
      } else {
        scope = "`perimeterDynamic: ['managers']` (mon équipe / mes N-1)";
      }
      const skillsStep = competences
        ? `1. Mapper les compétences « ${competences} » vers leurs IDs : \`boond_application_dictionary\` avec \`setting.tool\` (et éventuellement \`setting.expertiseArea\`).`
        : "1. Pas de filtre compétences fourni — passer directement à l'étape 2.";
      const toolsLine = competences
        ? "   - `tools: [...]` issus de l'étape 1 (logique OU ; pour exiger toutes les compétences, mettre `'#AND#'` en 1er élément)"
        : "";
      const lines: string[] = [
        `Identifie les ressources internes disponibles pour un staffing entre ${start_date} et ${end_date}.`,
        "",
      ];
      if (preamble) lines.push(preamble);
      lines.push(
        `Périmètre : ${scope}.`,
        "",
        "Étapes :",
        skillsStep,
        "2. Appeler `boond_resources_search` avec :",
        `   - \`period: "available"\`, \`startDate: "${start_date}"\`, \`endDate: "${end_date}"\``,
        `   - ${scope}`,
        toolsLine,
        "   - `resourceStates: [...]` filtrés sur les états « actif » uniquement (consulter `setting.state.resource` via `boond_application_dictionary`)",
        '   - `pageSize: 50`, `sort: "availability"`, `order: "asc"`',
        "3. Pour les 15 premières ressources retournées (en parallèle) :",
        "   - `boond_resources_positionings` — vérifier qu'aucun positionnement actif ne couvre déjà la fenêtre",
        "   - `boond_resources_technical_data` — confirmer compétences clés et niveau d'expérience",
        "4. Restituer un tableau trié par date de disponibilité : ressource | titre | dispo le | compétences matchées | mobilité | manager | TJM cible.",
        "5. Conclure par les 3 profils prioritaires à activer + un signal si la pénurie est forte (< 5 résultats — suggérer d'élargir la fenêtre ou les compétences)."
      );
      return lines.filter(Boolean).join("\n");
    },
  },

  {
    name: "fin_de_mission",
    title: "Anticipation des fins de mission",
    description:
      "Liste les ressources dont la mission se termine dans les prochains jours, " +
      "pour anticiper le repositionnement. Met en évidence les fins imminentes sans relais identifié.",
    argsSchema: {
      horizon_jours: z
        .string()
        .optional()
        .describe(
          "Nombre de jours à anticiper — entier (défaut: 60). Ex: '30' pour ne voir que les fins très proches."
        ),
      manager_id: z
        .string()
        .optional()
        .describe(
          "Manager pour restreindre à son équipe. " +
            ID_OR_NAME_HINT_RESOURCE +
            " Si absent, scope = mon équipe via `perimeterDynamic: ['managers']`."
        ),
    },
    domains: ["resources", "application"],
    build: ({ horizon_jours, manager_id }, now = new Date()) => {
      const parsedHorizon = Number.parseInt(horizon_jours ?? "", 10);
      const horizonDays = Number.isFinite(parsedHorizon) && parsedHorizon > 0 ? parsedHorizon : 60;
      const horizon = String(horizonDays);
      const startDate = toIsoDate(now);
      const endDate = toIsoDate(addDays(now, horizonDays));
      let preamble = "";
      let scope: string;
      if (manager_id) {
        const r = resolveEntity(manager_id, "resource", "<MANAGER_ID>");
        preamble = r.preamble;
        scope = `\`perimeterManagers: [${r.idForFilter}]\``;
      } else {
        scope = "`perimeterDynamic: ['managers']`";
      }
      const lines: string[] = [
        `Liste les ressources dont la mission se termine dans les ${horizon} prochains jours.`,
        "",
      ];
      if (preamble) lines.push(preamble);
      lines.push(
        `Périmètre : ${scope}.`,
        "",
        "Étapes :",
        `1. Fenêtre (calculée côté serveur) : D = ${startDate} → D+H = ${endDate}. Utiliser ces dates telles quelles.`,
        "2. Appeler `boond_resources_search` avec :",
        `   - \`period: "available"\`, \`startDate: "${startDate}"\`, \`endDate: "${endDate}"\``,
        `   - ${scope}`,
        "   - `resourceStates` filtrés sur les états « actif » (consulter `setting.state.resource`)",
        '   - `pageSize: 100`, `sort: "availability"`, `order: "asc"`',
        "   → Cela retourne les ressources qui (re)deviennent disponibles dans la fenêtre — proxy direct pour « fin de mission ».",
        "3. Pour chaque ressource, en parallèle :",
        "   - `boond_resources_positionings` — récupérer le positionnement courant (projet + société + date de fin) et détecter d'éventuels positionnements de relais déjà actés",
        "   - `boond_resources_projects` — historique projet récent pour contexte",
        "4. Restituer un tableau trié par date de fin croissante : ressource | projet courant | société cliente | date de fin | jours restants | manager | relais déjà identifié (oui/non).",
        "5. Mettre en évidence en haut du tableau :",
        "   - **Urgent** : fin dans <= 15 jours sans relais identifié",
        "   - **À surveiller** : fin entre 15 et 30 jours sans relais",
        "6. Conclure par 3-5 actions concrètes : relances commerciales, repositionnements internes, etc."
      );
      return lines.join("\n");
    },
  },

  {
    name: "cartographie_competences",
    title: "Cartographie des compétences d'un périmètre",
    description:
      "Produit une cartographie des compétences techniques d'un périmètre (équipe, agence, …) : " +
      "top compétences, compétences rares (risque bus-factor) et compétences manquantes vs opportunités ouvertes.",
    argsSchema: {
      manager_id: z
        .string()
        .optional()
        .describe(
          "Manager pour cibler son équipe. " +
            ID_OR_NAME_HINT_RESOURCE +
            " Si absent, scope = mon équipe via `perimeterDynamic: ['managers']`."
        ),
      agency_id: z
        .string()
        .optional()
        .describe("Agence pour cartographier toute une agence (alternatif à `manager_id`). " + ID_OR_NAME_HINT_AGENCY),
      top_n: z
        .string()
        .optional()
        .describe("Nombre de compétences à mettre en avant dans le top — entier (défaut: 20)."),
    },
    domains: ["resources", "opportunities", "application"],
    build: ({ manager_id, agency_id, top_n }) => {
      const top = top_n || "20";
      let preamble = "";
      let scope: string;
      if (agency_id) {
        const r = resolveEntity(agency_id, "agency", "<AGENCY_ID>");
        preamble = r.preamble;
        scope = `\`perimeterAgencies: [${r.idForFilter}]\``;
      } else if (manager_id) {
        const r = resolveEntity(manager_id, "resource", "<MANAGER_ID>");
        preamble = r.preamble;
        scope = `\`perimeterManagers: [${r.idForFilter}]\``;
      } else {
        scope = "`perimeterDynamic: ['managers']`";
      }
      const lines: string[] = ["Cartographie les compétences techniques du périmètre.", ""];
      if (preamble) lines.push(preamble);
      lines.push(
        `Périmètre : ${scope}.`,
        "",
        "Étapes :",
        "1. Lister les ressources actives via `boond_resources_search` :",
        `   - ${scope}`,
        "   - `resourceStates` filtrés sur les états « actif » (consulter `setting.state.resource` via `boond_application_dictionary`)",
        "   - `pageSize: 100` (paginer si > 100)",
        "2. Récupérer le dictionnaire `setting.tool` (et `setting.expertiseArea`, `setting.languageSpoken`) via `boond_application_dictionary` pour traduire les IDs en libellés.",
        "3. Pour chaque ressource (par batchs parallèles), appeler `boond_resources_technical_data` et extraire `tools`, `expertiseAreas`, `languages`, `experiences`.",
        "4. Agréger côté agent :",
        `   - **Top ${top}** : compétences les plus représentées (nb de ressources)`,
        "   - **Rares** : compétences possédées par 1 ou 2 personnes (risque bus-factor)",
        "   - **Saturées** : compétences possédées par > 70% de l'équipe (potentielle banalisation)",
        "5. Croiser avec les opportunités ouvertes via `boond_opportunities_search` (`opportunityStates` actifs, `perimeterDynamic`/`perimeterAgencies` cohérents) et leurs `tools` :",
        "   - **Manquantes** : compétences demandées sur les opportunités mais absentes du périmètre — alerte recrutement / formation",
        "6. Restituer en 4 sections :",
        `   - Top ${top} compétences (tableau : compétence | nb ressources | exemples de noms)`,
        "   - Compétences rares (avec porteurs nominatifs et nombre d'opportunités demandant cette compétence)",
        "   - Compétences saturées",
        "   - Compétences manquantes vs opportunités (recommandations recrutement / formation)"
      );
      return lines.join("\n");
    },
  },

  {
    name: "cvs_a_mettre_a_jour",
    title: "Audit fraîcheur des CV / dossiers techniques",
    description:
      "Identifie les ressources dont le CV ou le dossier technique est obsolète, incomplet, ou manquant. " +
      "Priorise celles bientôt sur le marché (en intercontrat ou disponibles à court terme).",
    argsSchema: {
      seuil_mois: z
        .string()
        .optional()
        .describe(
          "Un dossier technique non touché depuis plus de N mois est considéré obsolète — entier (défaut: 12)."
        ),
      manager_id: z
        .string()
        .optional()
        .describe(
          "Manager pour cibler son équipe. " +
            ID_OR_NAME_HINT_RESOURCE +
            " Si absent, scope = mon équipe via `perimeterDynamic: ['managers']`."
        ),
    },
    domains: ["resources", "application"],
    build: ({ seuil_mois, manager_id }) => {
      const seuil = seuil_mois || "12";
      let preamble = "";
      let scope: string;
      if (manager_id) {
        const r = resolveEntity(manager_id, "resource", "<MANAGER_ID>");
        preamble = r.preamble;
        scope = `\`perimeterManagers: [${r.idForFilter}]\``;
      } else {
        scope = "`perimeterDynamic: ['managers']`";
      }
      const lines: string[] = [
        `Identifie les CV / dossiers techniques à rafraîchir (seuil d'obsolescence : ${seuil} mois).`,
        "",
      ];
      if (preamble) lines.push(preamble);
      lines.push(
        `Périmètre : ${scope}.`,
        "",
        "Étapes :",
        "1. Lister les ressources actives via `boond_resources_search` :",
        `   - ${scope}`,
        "   - `resourceStates` filtrés sur les états « actif » (consulter `setting.state.resource`)",
        "   - `pageSize: 100` (paginer si nécessaire)",
        "2. Pour chaque ressource (par batchs parallèles), appeler `boond_resources_technical_data` et lire :",
        "   - `updateDate` du dossier technique",
        "   - présence et longueur du CV (`resume`)",
        "   - nombre de compétences déclarées (`tools`)",
        "   - nombre d'expériences renseignées",
        "3. Filtrer côté agent : ne conserver que les ressources dont au moins UN critère est défaillant —",
        `   - \`updateDate\` antérieure de plus de ${seuil} mois, OU`,
        "   - CV manquant / vide, OU",
        "   - moins de 3 compétences (`tools`) déclarées, OU",
        "   - aucune expérience renseignée.",
        '4. Croiser avec la disponibilité pour prioriser : `boond_resources_search` avec `period: "available"` + fenêtre des 3 prochains mois, et marquer les ressources concernées comme **prioritaires**.',
        "5. Restituer un tableau de relance trié par priorité décroissante : ressource | manager | dernière maj DT | jours d'ancienneté | trous (CV manquant / 0 compétences / 0 expérience) | bientôt dispo (oui/non).",
        "6. Conclure par les 5 ressources à relancer en premier (avec template de message court à envoyer au manager)."
      );
      return lines.join("\n");
    },
  },

  {
    name: "recherche_profil_competences",
    title: "Recherche multi-source d'un profil par compétences",
    description:
      "Recherche un profil correspondant à un mix de compétences libres, en croisant ressources internes " +
      "et candidats. Sortie classée par adéquation. Utile en amont d'un staffing ou d'une opportunité non encore qualifiée.",
    argsSchema: {
      competences: z
        .string()
        .describe("Compétences recherchées en texte libre (ex: 'Java Spring AWS Kubernetes', '.NET Azure DevOps')."),
      experience_min: z
        .string()
        .optional()
        .describe(
          "Niveau d'expérience minimum en texte libre (ex: '5 ans', 'senior'). Le modèle le mappera vers `experiences` via le dictionnaire."
        ),
      dispo_avant: z
        .string()
        .optional()
        .describe(
          "Disponibilité requise au plus tard à cette date (YYYY-MM-DD). Si fourni, applique `period: 'available'` + `endDate`."
        ),
      inclure_candidats: z
        .string()
        .optional()
        .describe(
          "'oui' (défaut) pour inclure aussi les candidats actifs ; 'non' pour ne chercher que dans les ressources internes."
        ),
      manager_id: z
        .string()
        .optional()
        .describe(
          "Manager pour restreindre le scope ressources internes. " +
            ID_OR_NAME_HINT_RESOURCE +
            " Sinon scope ouvert (toute l'organisation accessible)."
        ),
    },
    domains: ["resources", "candidates", "application"],
    build: ({ competences, experience_min, dispo_avant, inclure_candidats, manager_id }) => {
      const includeCandidates = (inclure_candidats || "oui").toLowerCase() !== "non";
      let preamble = "";
      let scope: string;
      let scopeFilter: string;
      if (manager_id) {
        const r = resolveEntity(manager_id, "resource", "<MANAGER_ID>");
        preamble = r.preamble;
        scopeFilter = `\`perimeterManagers: [${r.idForFilter}]\``;
        scope = scopeFilter;
      } else {
        scope = "(pas de filtre périmètre — recherche sur l'ensemble accessible à l'utilisateur)";
        scopeFilter = "";
      }
      const dispoLine = dispo_avant
        ? `   - \`period: "available"\`, \`endDate: "${dispo_avant}"\` (disponible au plus tard à cette date)`
        : "";
      const expStep = experience_min
        ? `2bis. Mapper l'expérience minimum « ${experience_min} » vers les IDs \`experiences\` via \`boond_application_dictionary\` avec \`setting.experience\`.`
        : "";
      const lines: string[] = [`Recherche un profil correspondant aux compétences : « ${competences} ».`, ""];
      if (preamble) lines.push(preamble);
      lines.push(
        `Scope ressources internes : ${scope}.`,
        `Inclure les candidats actifs : ${includeCandidates ? "oui" : "non"}.`,
        "",
        "Étapes :",
        "1. Mapper les compétences libres vers leurs IDs :",
        "   - `boond_application_dictionary` avec `setting.tool` pour les outils / technos",
        "   - `boond_application_dictionary` avec `setting.expertiseArea` pour les domaines d'expertise",
        "2. Identifier les compétences indispensables (toutes requises) vs souhaitables, à partir du libellé du besoin.",
        expStep,
        "3. Recherche dans les ressources internes via `boond_resources_search` :",
        '   - `tools: [...]` (si plusieurs compétences indispensables, préfixer par `"#AND#"` pour exiger toutes ; sinon laisser en OU)',
        "   - `expertiseAreas: [...]` éventuellement",
        experience_min ? "   - `experiences: [...]` issus de l'étape 2bis" : "",
        dispoLine,
        scopeFilter ? `   - ${scopeFilter}` : "",
        "   - `resourceStates` actifs uniquement (consulter `setting.state.resource`)",
        "   - `pageSize: 30`",
        includeCandidates
          ? "4. En parallèle, recherche dans les candidats via `boond_candidates_search` avec les mêmes filtres + `candidateStates` actifs (consulter `setting.state.candidate`)."
          : "4. (Skip — recherche limitée aux ressources internes.)",
        "5. Pour les top 10 résultats combinés, récupérer `technical_data` (`boond_resources_technical_data` ou `boond_candidates_technical_data`) pour vérifier l'adéquation fine.",
        "6. Restituer un classement unique : type (Ressource interne / Candidat) | nom | titre | compétences matchées | expérience | dispo | localisation/mobilité | note d'adéquation /10 (1 ligne de justification).",
        "7. Si moins de 5 résultats : suggérer un assouplissement (retirer une compétence secondaire, élargir le périmètre géographique, accepter un junior, sous-traitance)."
      );
      return lines.filter(Boolean).join("\n");
    },
  },

  {
    name: "recap_hebdo",
    title: "Récap hebdomadaire (moi + mon équipe)",
    description:
      "Compile en une vue ce qui s'est passé / va se passer cette semaine pour moi et mon équipe : opportunités, projets, absences, CRA.",
    argsSchema: {
      semaine: z
        .string()
        .optional()
        .describe(
          "Semaine ciblée (ex: 'cette semaine', 'semaine dernière', 'semaine prochaine', '2026-W14'). Défaut: cette semaine. Résolue en dates ISO côté serveur."
        ),
    },
    domains: ["resources", "opportunities", "projects", "absences", "timesheets", "application"],
    build: ({ semaine }, now = new Date()) => {
      const bounds = periodBounds(semaine, now, "week");
      const semaineText = bounds ? bounds.label : semaine!.trim();
      const start = bounds ? `"${bounds.startDate}"` : "<DEBUT>";
      const end = bounds ? `"${bounds.endDate}"` : "<FIN>";
      const startMonth = bounds ? `"${bounds.startMonth}"` : "<MOIS_DEBUT>";
      const endMonth = bounds ? `"${bounds.endMonth}"` : "<MOIS_FIN>";
      return [
        `Produis mon récap pour ${semaineText}.`,
        "",
        periodLine(bounds, semaine, now),
        "",
        "Étapes :",
        "1. `boond_application_current_user` pour récupérer mon ID.",
        "2. `boond_resources_search` avec `perimeterDynamic: ['managers']`, `pageSize: 100`, `fields: ['firstName', 'lastName']` — mon équipe (mes N-1). Conserver la liste des IDs.",
        "3. En parallèle, un seul appel par source (pas un appel par membre) :",
        `   a. \`boond_opportunities_search\` avec \`perimeterDynamic: ['data']\`, \`period: 'updated'\`, \`startDate: ${start}\`, \`endDate: ${end}\` — opportunités touchées sur la semaine.`,
        `   b. \`boond_absences_search\` avec \`startMonth: ${startMonth}\`, \`endMonth: ${endMonth}\`, \`pageSize: 200\` — toutes les absences du périmètre sur ce(s) mois ; ne retenir que celles dont la ressource est dans l'équipe de l'étape 2 et qui recoupent la semaine.`,
        `   c. \`boond_timesheets_search\` avec \`startMonth: ${startMonth}\`, \`endMonth: ${endMonth}\`, \`pageSize: 200\` — les CRA du périmètre sur ce(s) mois. Pour chaque membre de l'équipe : signaler un CRA **absent** sur le mois ; sinon reporter son \`state\` tel quel (le dictionnaire n'a pas de table d'états CRA — ne pas inventer de libellé).`,
        `   d. \`boond_projects_search\` avec \`perimeterDynamic: ['data']\`, \`period: 'running'\`, \`startDate: ${start}\`, \`endDate: ${end}\` — mes projets actifs.`,
        "4. Lire `boond://dictionary/states/opportunities` et `boond://dictionary/states/projects` pour libeller les états.",
        "5. Restituer en 5 sections :",
        "   - **Pipeline** : opps qui ont bougé (nouvelles, état changé, closing imminent)",
        "   - **Équipe** : qui est absent cette semaine, qui termine sa mission",
        "   - **CRA** : membres dont le CRA du mois est absent ou non validé (à relancer)",
        "   - **Projets** : projets actifs, dont ceux qui s'arrêtent ou démarrent dans la semaine",
        "   - **Actions à mener** : 3-5 puces concrètes (relances, validations, repositionnements)",
      ].join("\n");
    },
  },
  {
    name: "traiter_note_de_frais",
    title: "Traiter un justificatif en note de frais",
    description:
      "À partir d'une photo ou d'un PDF de justificatif joint à la conversation, extrait les données de la dépense " +
      "et crée la ligne de frais correspondante dans BoondManager, après récapitulatif et validation explicite. " +
      "Aucun montant n'est inventé : un champ illisible est demandé à l'utilisateur.",
    argsSchema: {
      resource_id: z
        .string()
        .optional()
        .describe(
          "Collaborateur concerné. " +
            ID_OR_NAME_HINT_RESOURCE +
            " Si absent, `boond_application_current_user` est appelé pour le récupérer."
        ),
      project_id: z
        .string()
        .optional()
        .describe("Projet à imputer / refacturer. " + ID_OR_NAME_HINT_PROJECT),
      term: z
        .string()
        .optional()
        .describe("Mois de la note de frais (YYYY-MM). Défaut : mois de la date du justificatif."),
      contexte: z
        .string()
        .optional()
        .describe("Précision libre sur la dépense (ex: « déjeuner client Dupont », « A/R Nancy en voiture »)."),
    },
    domains: ["expenses", "application"],
    build: ({ resource_id, project_id, term, contexte }) => {
      const lines: string[] = [
        "Traite le justificatif joint à cette conversation et enregistre-le en note de frais dans BoondManager.",
        "",
      ];

      let resourceLit = "<RESOURCE_ID>";
      let resourceStep: string;
      if (resource_id) {
        const r = resolveEntity(resource_id, "resource", "<RESOURCE_ID>");
        if (r.preamble) lines.push(r.preamble);
        resourceLit = r.idForFilter;
        resourceStep = `Le collaborateur concerné a pour ID \`${resourceLit}\`.`;
      } else {
        resourceStep = "Appeler `boond_application_current_user` pour obtenir mon ID → ce sera `<RESOURCE_ID>`.";
      }

      let projectLine = "";
      if (project_id) {
        const p = resolveEntity(project_id, "project", "<PROJET_ID>");
        if (p.preamble) lines.push(p.preamble);
        projectLine = `   - Imputer sur le projet \`${p.idForFilter}\` (demandé explicitement). Vérifier qu'il figure bien dans les imputations possibles retournées à l'étape 3.`;
      }

      const termLine = term
        ? `Le mois de la note de frais est imposé : \`term = "${term}"\`.`
        : "Déduire `term` (format `YYYY-MM`) du mois de la date lue sur le justificatif.";

      lines.push(
        contexte ? `Contexte fourni par l'utilisateur : « ${contexte} ».` : "",
        contexte ? "" : "",
        "Étapes :",
        "",
        "**1. Lire le justificatif.** Extraire : date de la dépense, marchand, montant TTC, taux ou montant de TVA, devise, nature de la dépense (repas / transport / hébergement / carburant / péage / fournitures…), et le nombre de kilomètres s'il s'agit d'un trajet en véhicule personnel.",
        "   - ⚠️ **Ne jamais inventer une valeur.** Si un champ est illisible, absent ou ambigu (montant coupé, date partielle, devise non indiquée), le demander à l'utilisateur et attendre sa réponse avant de continuer.",
        "   - Si plusieurs tickets figurent sur l'image, les traiter comme autant de lignes distinctes.",
        "",
        `**2. Identifier le collaborateur et le mois.** ${resourceStep} ${termLine}`,
        "",
        `**3. Récupérer les référentiels de saisie** : \`boond_expenses_default\` avec \`resourceId: "${resourceLit}"\` et le \`term\` de l'étape 2. Il retourne :`,
        "   - `agencyId`, `currencyAgency`, `exchangeRateAgency` → à recopier tels quels ;",
        "   - la liste des **types de frais** de l'agence (`reference` + libellé + taux de TVA) → mapper la nature extraite à l'étape 1 vers la `reference` la plus proche. Ces codes sont propres à l'agence : ils ne sont **pas** dans `boond_application_dictionary`, ne pas essayer de les y chercher ;",
        "   - les **barèmes kilométriques** (`ratePerKilometerTypeReference`) si la dépense est un trajet ;",
        "   - les couples `projectId` / `deliveryId` imputables → les deux sont **obligatoires** sur chaque ligne, et l'API refuse un couple qu'elle ne juge pas imputable sur ce mois.",
        projectLine,
        "   - Si aucune imputation n'est disponible pour ce collaborateur sur ce mois, s'arrêter et le signaler : la ligne ne peut pas être créée.",
        "",
        `**4. Vérifier s'il existe déjà une note de frais pour ce mois** : \`boond_expenses_search\` avec \`resourceId: "${resourceLit}"\` et la période correspondant au \`term\`.`,
        "   - ⚠️ L'API **n'empêche pas les doublons** : deux notes de frais peuvent coexister sur le même mois pour le même collaborateur. Il faut donc vérifier, pas supposer.",
        "   - Note existante → on la complétera à l'étape 6 via `boond_expenses_update`. Aucune note → on en créera une via `boond_expenses_create`.",
        "",
        "**5. Récapituler et ATTENDRE la validation de l'utilisateur.** Cette étape n'est pas optionnelle : l'écriture n'est pas idempotente et une lecture visuelle peut se tromper d'un facteur 10 sur un montant.",
        "   - Présenter un tableau : date | marchand / description | type de frais retenu (libellé + `reference`) | montant TTC | taux de TVA | devise | projet + prestation d'imputation | refacturable oui/non.",
        "   - Indiquer explicitement s'il s'agit d'une création ou d'un ajout à une note existante.",
        "   - Signaler toute valeur déduite plutôt que lue (type de frais mappé par approximation, TVA prise du référentiel faute d'être lisible sur le ticket).",
        "   - **Ne pas appeler l'outil d'écriture avant un « oui » explicite.**",
        "",
        "**6. Écrire.**",
        "   - Création : `boond_expenses_create` avec `resourceId`, `agencyId`, `term`, `exchangeRateAgency`, `currencyAgency` et une entrée `actualExpenses` par dépense.",
        "   - Ajout à une note existante : relire la note avec `boond_expenses_get`, puis `boond_expenses_update` en renvoyant **l'intégralité** des lignes (les anciennes + la nouvelle). `actualExpenses` remplace le tableau complet — n'envoyer que la nouvelle ligne effacerait les précédentes.",
        "   - Sur une ligne : `amountIncludingTax` est le montant **TTC** et `tax` un **taux** de TVA en pourcentage (ex: `20`), pas un montant. Le HT et le montant de TVA sont recalculés par BoondManager — ne pas les saisir, et si le ticket ne donne qu'un montant de TVA, convertir en taux (ou reprendre le taux du type de frais).",
        "   - Frais kilométrique : `isKilometricExpense: true`, `numberOfKilometers`, pas de `expenseTypeReference` — le montant est calculé par le barème.",
        "",
        "**7. Restituer le résultat et la limite sur le justificatif.** Confirmer l'ID de la note de frais et de la ligne créée, puis dire clairement que **le justificatif n'a pas été attaché** : une image collée dans la conversation n'a pas d'URL atteignable par BoondManager, et `boond_documents_create` ne téléverse que depuis une URL (le serveur MCP ne lit jamais de fichier local). Deux options à proposer :",
        "   - (a) si l'utilisateur peut fournir une **URL https** du justificatif : appeler `boond_documents_create` avec `parentType: \"expensesReport\"` et `parentId` = l'ID de la note de frais ;",
        "   - (b) sinon : attacher le fichier manuellement dans l'interface BoondManager.",
        "",
        "**8. État de la note.** Ne pas promettre une mise en validation : la création part toujours en `savedAndNoValidation` et le passage en validation relève du workflow BoondManager, pas d'un champ d'écriture. Inviter l'utilisateur à soumettre la note depuis l'interface quand elle est complète."
      );
      return lines.filter(Boolean).join("\n");
    },
  },

  {
    name: "alertes_contrats",
    title: "Fins de contrat et périodes d'essai à venir",
    description:
      "Liste les contrats de travail qui se terminent et les périodes d'essai qui expirent dans les prochains jours " +
      "sur un périmètre, pour anticiper renouvellements, ruptures et entretiens de fin de PE.",
    argsSchema: {
      horizon_jours: z
        .string()
        .optional()
        .describe("Nombre de jours à anticiper — entier (défaut: 45). Ex: '30' pour les échéances les plus proches."),
      manager_id: z
        .string()
        .optional()
        .describe(
          "Manager pour restreindre à son équipe. " +
            ID_OR_NAME_HINT_RESOURCE +
            " Si absent, scope = mon équipe via `perimeterDynamic: ['managers']`."
        ),
    },
    domains: ["contracts", "resources", "application"],
    build: ({ horizon_jours, manager_id }, now = new Date()) => {
      const parsedHorizon = Number.parseInt(horizon_jours ?? "", 10);
      const horizonDays = Number.isFinite(parsedHorizon) && parsedHorizon > 0 ? parsedHorizon : 45;
      const startDate = toIsoDate(now);
      const endDate = toIsoDate(addDays(now, horizonDays));
      let preamble = "";
      let scope: string;
      if (manager_id) {
        const r = resolveEntity(manager_id, "resource", "<MANAGER_ID>");
        preamble = r.preamble;
        scope = `\`perimeterManagers: [${r.idForFilter}]\``;
      } else {
        scope = "`perimeterDynamic: ['managers']`";
      }
      const lines: string[] = [
        `Liste les fins de contrat et les fins de période d'essai des ${horizonDays} prochains jours.`,
        "",
      ];
      if (preamble) lines.push(preamble);
      lines.push(
        `Périmètre : ${scope}. Fenêtre (calculée côté serveur) : ${startDate} → ${endDate}, à utiliser telle quelle.`,
        "",
        "Étapes :",
        "1. Lire `boond://dictionary/typeOf/contracts` (pas d'appel d'outil) pour traduire `typeOf` (CDI, CDD, freelance…), et `boond://dictionary/states/probations` pour `probationState`.",
        "2. Appeler `boond_contracts_search` — recherche composée, une requête par ressource, donc `pageSize: 100` et paginer si `structuredContent.count` atteint 100 :",
        `   - ${scope}, \`resourceStates\` limités aux états « actif » (\`boond://dictionary/states/resources\`)`,
        `   - \`period: "ending"\`, \`startDate: "${startDate}"\`, \`endDate: "${endDate}"\` → les contrats qui se terminent dans la fenêtre`,
        '3. Rappeler `boond_contracts_search` avec les mêmes filtres et `period: "probationEnding"` → les périodes d\'essai (initiale ou renouvelée) qui expirent dans la fenêtre.',
        "4. Pour un contrat de l'étape 2 dont le type est CDD / mission : vérifier via `boond_resources_contracts` qu'aucun contrat suivant n'existe déjà (renouvellement saisi).",
        "5. Restituer deux tableaux triés par échéance croissante :",
        "   - **Fins de contrat** : ressource | type | début | fin | jours restants | contrat suivant déjà saisi (oui/non) | motif de fin s'il est renseigné",
        "   - **Fins de période d'essai** : ressource | type | fin de PE (initiale / renouvelée) | jours restants | état de la PE",
        "6. Mettre en évidence les échéances à moins de 15 jours, et conclure par les actions à engager (entretien de fin de PE, proposition de renouvellement, préavis)."
      );
      return lines.join("\n");
    },
  },

  {
    name: "relance_cra",
    title: "Relance des CRA du mois",
    description:
      "Pour un mois et une équipe : qui n'a pas saisi son CRA, qui l'a saisi sans le soumettre, et quels CRA attendent " +
      "la validation du manager — avec la liste à relancer et les validations à traiter.",
    argsSchema: { mois: MONTH_ARG("Mois du CRA"), manager_id: MANAGER_ARG("les CRA de ses N-1") },
    domains: ["validations", "timesheets", "resources", "application"],
    build: ({ mois, manager_id }, now = new Date()) => {
      const bounds = periodBounds(mois, now, "month");
      const month = bounds ? bounds.startMonth : "<MOIS>";
      const { scope, preamble } = managerScope(manager_id);
      const lines = [`Relance des CRA du mois ${month}.`, ""];
      if (preamble) lines.push(preamble);
      lines.push(
        periodLine(bounds, mois, now),
        `Périmètre : ${scope}.`,
        "",
        "Étapes :",
        `1. \`boond_resources_search\` avec ${scope}, \`resourceStates\` limités aux états « actif » (\`boond://dictionary/states/resources\`), \`pageSize: 200\` → l'équipe attendue.`,
        `2. \`boond_timesheets_search\` avec \`startMonth: "${month}"\`, \`endMonth: "${month}"\`, ${scope}, \`pageSize: 200\` → les CRA existants et leur \`state\` (chaîne du workflow : \`savedAndNoValidation\` = saisi non soumis, \`waitingForValidation\`, \`validated\`, \`rejected\`).`,
        `3. \`boond_validations_search\` avec \`startMonth: "${month}"\`, \`endMonth: "${month}"\`, \`documentTypes: ["timesReport"]\`, \`validationStates: ["waitingForValidation"]\`, ${scope} → les CRA qui attendent ma validation, avec l'ID de **validation** (différent de l'ID du CRA).`,
        "4. Croiser : membre sans CRA → **à relancer (saisie)** ; CRA `savedAndNoValidation` → **à relancer (soumission)** ; `rejected` → **à corriger** ; `waitingForValidation` → **à valider par moi**.",
        '5. Pour chaque CRA à valider : relire `boond_timesheets_get` (jours, absences, cohérence avec le planning), puis proposer `boond_validations_update` avec `decision: "validate"` — ou `"reject"` + `reason` — **une décision à la fois, après accord explicite de l\'utilisateur**.',
        "6. Restituer deux tableaux : à relancer (ressource | situation | dernière mise à jour) et à valider (ressource | ID de validation | jours saisis | décision proposée), puis un message de relance prêt à envoyer."
      );
      return lines.join("\n");
    },
  },

  {
    name: "absences_a_valider",
    title: "Demandes d'absence à valider",
    description:
      "Liste les demandes d'absence en attente de validation sur une équipe, les recoupe avec les absences déjà posées " +
      "sur la période, et prépare la décision (validation ou refus motivé) pour chacune.",
    argsSchema: { mois: MONTH_ARG("Mois des absences"), manager_id: MANAGER_ARG("les demandes de ses N-1") },
    domains: ["validations", "absences", "application"],
    build: ({ mois, manager_id }, now = new Date()) => {
      const bounds = periodBounds(mois, now, "month");
      const startMonth = bounds ? bounds.startMonth : "<MOIS_DEBUT>";
      const endMonth = bounds ? bounds.endMonth : "<MOIS_FIN>";
      const { scope, preamble } = managerScope(manager_id);
      const lines = ["Traite les demandes d'absence en attente de validation.", ""];
      if (preamble) lines.push(preamble);
      lines.push(
        periodLine(bounds, mois, now),
        `Périmètre : ${scope}.`,
        "",
        "Étapes :",
        `1. \`boond_validations_search\` avec \`startMonth: "${startMonth}"\`, \`endMonth: "${endMonth}"\`, \`documentTypes: ["absencesReport"]\`, \`validationStates: ["waitingForValidation"]\`, ${scope}, \`pageSize: 100\` → les demandes en attente (ID de validation + demande liée).`,
        "2. Pour chaque demande : `boond_absences_get` sur l'ID de la demande (`documentId`) → dates, type, durée, motif.",
        `3. \`boond_absences_search\` avec \`startMonth: "${startMonth}"\`, \`endMonth: "${endMonth}"\`, \`validationStates: ["validated"]\`, ${scope}, \`pageSize: 200\` → les absences déjà validées de l'équipe, pour repérer les chevauchements (plusieurs personnes absentes le même jour).`,
        "4. Restituer un tableau : ressource | type | dates | durée | ID de validation | chevauchements dans l'équipe | décision proposée.",
        '5. **Décider une demande à la fois, après accord explicite** : `boond_validations_update` avec `decision: "validate"`, ou `"reject"` + `reason` (le refus demande une confirmation à l\'utilisateur). Ne jamais enchaîner les décisions sans accord.'
      );
      return lines.join("\n");
    },
  },

  {
    name: "marge_projet",
    title: "Marge d'un projet : simulé vs réalisé",
    description:
      "Compare le chiffre d'affaires, les coûts et la marge simulés d'un projet à son réalisé (productivité, reporting), " +
      "prestation par prestation, et explique l'écart.",
    argsSchema: {
      project_id: z.string().describe("Projet à analyser. " + ID_OR_NAME_HINT_PROJECT),
      periode: z
        .string()
        .optional()
        .describe(
          "Fenêtre du reporting : `YYYY-MM-DD..YYYY-MM-DD`, « ce mois », « 2026 »… Défaut : toute la vie du projet."
        ),
    },
    domains: ["projects", "reporting", "application"],
    build: ({ project_id, periode }, now = new Date()) => {
      const r = resolveEntity(project_id ?? "", "project", "<PROJET_ID>");
      const bounds = periode ? periodBounds(periode, now, "month") : null;
      const lines = [`Analyse la marge du projet \`${r.idForFilter}\` : simulé vs réalisé.`, ""];
      if (r.preamble) lines.push(r.preamble);
      if (periode) lines.push(periodLine(bounds, periode, now));
      const window = bounds
        ? `\`startDate: "${bounds.startDate}"\`, \`endDate: "${bounds.endDate}"\``
        : "sans bornes de dates (`startDate` / `endDate` = début et fin du projet lus à l'étape 1)";
      lines.push(
        "",
        "Étapes :",
        `1. \`boond_projects_get\` sur \`${r.idForFilter}\` → client, dates, mode (régie / forfait), responsable.`,
        `2. \`boond_projects_simulation\` → CA, coûts et marge **simulés** ; \`boond_projects_deliveries_groupments\` → les prestations avec TJM (\`averageDailyPriceExcludingTax\`), CJM (\`averageDailyCost\`) et jours prévus.`,
        `3. \`boond_projects_productivity\` → le **réalisé** par prestation (jours produits, CA, coûts).`,
        `4. \`boond_reporting_projects\` avec \`projects: [${r.idForFilter}]\`, ${window} → les agrégats BoondManager (CA facturé, coûts, marge, taux de marge) sur la fenêtre.`,
        "5. Restituer : un tableau par prestation (ressource | TJM | CJM | jours prévus / produits | CA simulé / réalisé | marge simulée / réalisée), puis le total projet et le **taux de marge** — en nommant les écarts (jours non produits, TJM revu, sous-traitance plus chère) et ce qui reste à facturer.",
        "6. Ne pas recalculer ce que BoondManager fournit : reprendre ses montants, et signaler quand deux sources divergent."
      );
      return lines.join("\n");
    },
  },

  {
    name: "preparation_entretien",
    title: "Préparer un entretien candidat",
    description:
      "Rassemble en une fiche tout ce que BoondManager sait d'un candidat (parcours, compétences, CV, positionnements, " +
      "historique des échanges) et, si une opportunité est visée, confronte le profil au besoin pour lister les points à creuser.",
    argsSchema: {
      candidate_id: z.string().describe("Candidat reçu en entretien. " + ID_OR_NAME_HINT_CANDIDATE),
      opportunity_id: z
        .string()
        .optional()
        .describe("Opportunité visée, pour comparer profil et besoin. " + ID_OR_NAME_HINT_OPPORTUNITY),
    },
    domains: ["candidates", "opportunities", "documents", "application"],
    build: ({ candidate_id, opportunity_id }) => {
      const c = resolveEntity(candidate_id ?? "", "candidate", "<CANDIDAT_ID>");
      const lines = [`Prépare l'entretien du candidat \`${c.idForFilter}\`.`, ""];
      if (c.preamble) lines.push(c.preamble);
      let opp: ReturnType<typeof resolveEntity> | undefined;
      if (opportunity_id) {
        opp = resolveEntity(opportunity_id, "opportunity", "<OPPORTUNITE_ID>");
        if (opp.preamble) lines.push(opp.preamble);
      }
      lines.push(
        "Étapes :",
        `1. Lire la ressource \`boond://candidate/${c.idForFilter}\` (fiche + informations + compétences en une lecture) — à défaut \`boond_candidates_get\`, \`boond_candidates_information\` et \`boond_candidates_technical_data\`.`,
        "2. Le CV : dans les relations `resumes` de la fiche, prendre le document le plus récent et l'ouvrir avec `boond_documents_get` (ID suffixé, ex. `123_resume`). S'il est absent, le dire.",
        `3. \`boond_candidates_positionings\` → positionnements en cours et passés (opportunités, états, dates) ; \`boond_candidates_actions\` → l'historique des échanges (dernier contact, promesses faites, disponibilité, prétentions).`,
        opp
          ? `4. Le besoin : \`boond_opportunities_get\` sur \`${opp.idForFilter}\` et \`boond_opportunities_information\` → compétences attendues (\`tools\`, \`expertiseAreas\`), expérience, mobilité, TJM cible, dates.`
          : "4. Sans opportunité visée : s'en tenir au profil, et repérer les opportunités ouvertes proches via `boond_opportunities_search` (`keywords` sur les compétences principales) pour orienter l'entretien.",
        "5. Restituer une **fiche de préparation** : synthèse du profil (5 lignes) | compétences déclarées vs attendues (✓ / ✗ / à vérifier) | parcours et dates à confirmer | disponibilité, mobilité, prétentions connues | historique des échanges | **8 à 10 questions ciblées** (trous du CV, compétences non prouvées, motivation, contraintes).",
        "6. Ne rien affirmer que la fiche ne dit pas : un champ vide est « non renseigné », pas une supposition."
      );
      return lines.join("\n");
    },
  },

  {
    name: "preparation_rdv_client",
    title: "Préparer un rendez-vous client",
    description:
      "Brief de rendez-vous pour une société cliente : contacts, opportunités en cours, projets et prestations, factures impayées, " +
      "derniers échanges — et les sujets à aborder.",
    argsSchema: {
      society_id: z.string().describe("Société cliente. " + ID_OR_NAME_HINT_SOCIETY),
      horizon_jours: z
        .string()
        .optional()
        .describe("Profondeur de l'historique des échanges en jours — entier (défaut: 90)."),
    },
    domains: ["companies", "contacts", "opportunities", "projects", "invoices", "actions", "application"],
    build: ({ society_id, horizon_jours }, now = new Date()) => {
      const s = resolveEntity(society_id ?? "", "society", "<SOCIETE_ID>");
      const horizon = positiveInt(horizon_jours, 90);
      const since = toIsoDate(addDays(now, -horizon));
      const today = toIsoDate(now);
      const lines = [`Prépare le rendez-vous avec la société \`${s.idForFilter}\`.`, ""];
      if (s.preamble) lines.push(s.preamble);
      lines.push(
        `Date de référence : aujourd'hui = ${today}.`,
        "",
        "Étapes :",
        `1. Lire la ressource \`boond://company/${s.idForFilter}\` (fiche + informations) — à défaut \`boond_companies_get\`.`,
        `2. \`boond_companies_contacts\` → interlocuteurs (fonction, e-mail, téléphone) ; \`boond_companies_opportunities\` → opportunités et leur état (lire \`boond://dictionary/states/opportunities\` pour les libellés) ; \`boond_companies_projects\` → projets en cours et prestations.`,
        `3. Factures : lire \`boond://dictionary/states/invoices\` puis \`boond_invoices_search\` avec \`companyId: "${s.idForFilter}"\`, \`states: [<états impayés>]\`, \`period: "expectedPayment"\`, \`endDate: "${today}"\` → les impayés échus à évoquer (ou à ne pas évoquer, selon le contexte).`,
        `4. \`boond_actions_search\` avec \`companyId: "${s.idForFilter}"\`, \`period: "started"\`, \`startDate: "${since}"\`, \`endDate: "${today}"\`, \`sort: "startDate"\`, \`order: "desc"\`, \`pageSize: 50\` → les ${horizon} derniers jours d'échanges (qui a parlé à qui, engagements pris).`,
        "5. Restituer le **brief** : la société en 3 lignes | qui on rencontre et qui on connaît | opportunités ouvertes (montant, étape, prochaine action) | projets / consultants en place et fins de prestation proches | impayés (montant, ancienneté) | derniers échanges | **5 sujets à aborder** et les questions à poser.",
        "6. Proposer, après le rendez-vous, de tracer le compte rendu avec `boond_actions_create` rattaché au contact rencontré (`contactId` + `companyId`)."
      );
      return lines.join("\n");
    },
  },

  {
    name: "relance_devis",
    title: "Devis et propositions à relancer",
    description:
      "Trouve les opportunités en phase de proposition envoyée / négociation sans action depuis N jours sur un périmètre, " +
      "et prépare les relances.",
    argsSchema: {
      jours_sans_action: z
        .string()
        .optional()
        .describe("Silence minimal en jours pour relancer — entier (défaut: 15)."),
      manager_id: MANAGER_ARG("les opportunités de ses N-1"),
    },
    domains: ["opportunities", "actions", "application"],
    build: ({ jours_sans_action, manager_id }, now = new Date()) => {
      const days = positiveInt(jours_sans_action, 15);
      const cutoff = toIsoDate(addDays(now, -days));
      const today = toIsoDate(now);
      const { scope, preamble } = managerScope(manager_id);
      const lines = [`Liste les propositions commerciales à relancer (aucune action depuis ${days} jours).`, ""];
      if (preamble) lines.push(preamble);
      lines.push(
        `Date de référence : aujourd'hui = ${today} ; seuil = ${cutoff}. Périmètre : ${scope}.`,
        "",
        "Étapes :",
        "1. Lire `boond://dictionary/states/opportunities` (pas d'appel d'outil) et retenir les IDs des états « proposition envoyée », « en négociation », « soutenance » — les états où le client a la balle.",
        `2. \`boond_opportunities_search\` avec \`opportunityStates: [<IDs de l'étape 1>]\`, ${scope}, \`pageSize: 100\` → les propositions en cours (société, montant, date de clôture prévue).`,
        `3. Pour chaque opportunité : \`boond_actions_search\` avec \`opportunityId\`, \`period: "started"\`, \`startDate: "${cutoff}"\`, \`endDate: "${today}"\`, \`pageSize: 1\` → aucune ligne = **à relancer** ; sinon noter la dernière action.`,
        "4. Pour les opportunités à relancer : `boond_opportunities_actions` (dernier échange, promesse faite, interlocuteur) pour rédiger une relance pertinente.",
        "5. Restituer un tableau trié par montant décroissant : opportunité | société | montant | état | date de clôture | dernier échange | interlocuteur | relance proposée (canal + angle).",
        "6. Proposer de tracer chaque relance faite avec `boond_actions_create` (`opportunityId`, `typeOf` via `boond://dictionary/actions/opportunities`) — après accord de l'utilisateur, jamais en lot silencieux."
      );
      return lines.join("\n");
    },
  },

  {
    name: "purge_rgpd_candidats",
    title: "Purge RGPD des candidats inactifs",
    description:
      "Identifie les candidats sans mise à jour ni positionnement actif depuis N mois, présente la liste à confirmer, " +
      "puis supprime candidat par candidat avec confirmation — jamais en lot silencieux.",
    argsSchema: {
      mois_inactivite: z
        .string()
        .optional()
        .describe("Ancienneté minimale de la dernière mise à jour, en mois — entier (défaut: 24)."),
      manager_id: MANAGER_ARG("les candidats suivis par ses N-1"),
    },
    domains: ["candidates", "application"],
    build: ({ mois_inactivite, manager_id }, now = new Date()) => {
      const months = positiveInt(mois_inactivite, 24);
      const cutoffDate = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
      const cutoff = toIsoDate(cutoffDate);
      const { scope, preamble } = managerScope(manager_id);
      const lines = [
        `Purge RGPD : candidats sans activité depuis ${months} mois (dernière mise à jour avant le ${cutoff}).`,
        "",
      ];
      if (preamble) lines.push(preamble);
      lines.push(
        `Périmètre : ${scope}.`,
        "",
        "Étapes :",
        `1. \`boond_candidates_search\` avec \`period: "updated"\`, \`startDate: "2000-01-01"\`, \`endDate: "${cutoff}"\`, ${scope}, \`sort: "updateDate"\`, \`order: "asc"\`, \`pageSize: 100\`, \`fields: ["firstName", "lastName", "updateDate", "state"]\` — **paginer jusqu'au bout**.`,
        "2. Exclure d'office : les candidats dont l'état signifie « en cours de recrutement » ou « embauché » (`boond://dictionary/states/candidates`), et ceux qui ont un positionnement encore ouvert — vérifier avec `boond_candidates_positionings` sur chaque candidat restant en état ambigu.",
        "3. Restituer la liste à purger : candidat | dernière mise à jour | état | positionnements | motif de conservation éventuel — et **attendre la validation explicite** de l'utilisateur, ligne par ligne ou en bloc, avant toute suppression.",
        "4. Supprimer avec `boond_candidates_delete`, **un candidat par appel** : l'outil demande une confirmation (elicitation) et un refus annule l'appel (`deleted: false`). Ne pas contourner, ne pas grouper.",
        "5. Restituer le bilan : supprimés | conservés (avec le motif) | refusés à la confirmation. Rappeler que les documents (CV) rattachés partent avec le candidat et qu'aucune restauration n'est possible côté API."
      );
      return lines.join("\n");
    },
  },

  {
    name: "preparation_facturation",
    title: "Préparation de la facturation mensuelle",
    description:
      "Pour un mois : CRA validés, prestations en cours et commandes concernées, reste à facturer par commande, factures déjà émises — " +
      "et la liste de ce qui bloque (CRA manquants ou non validés).",
    argsSchema: { mois: MONTH_ARG("Mois à facturer"), manager_id: MANAGER_ARG("les projets de ses N-1") },
    domains: ["timesheets", "deliveries", "orders", "invoices", "application"],
    build: ({ mois, manager_id }, now = new Date()) => {
      const bounds = periodBounds(mois, now, "month");
      const month = bounds ? bounds.startMonth : "<MOIS>";
      const startDate = bounds ? bounds.startDate : "<DATE_DEBUT>";
      const endDate = bounds ? bounds.endDate : "<DATE_FIN>";
      const { scope, preamble } = managerScope(manager_id);
      const lines = [`Prépare la facturation du mois ${month}.`, ""];
      if (preamble) lines.push(preamble);
      lines.push(
        periodLine(bounds, mois, now),
        `Périmètre : ${scope}.`,
        "",
        "Étapes :",
        `1. \`boond_deliveries_search\` avec \`period: "running"\`, \`startDate: "${startDate}"\`, \`endDate: "${endDate}"\`, ${scope}, \`pageSize: 200\` → les prestations actives sur le mois (ressource, projet, TJM, jours prévus).`,
        `2. \`boond_timesheets_search\` avec \`startMonth: "${month}"\`, \`endMonth: "${month}"\`, ${scope}, \`pageSize: 200\` → les CRA du mois et leur \`state\` ; seuls les \`validated\` sont facturables. Un CRA absent ou non validé sur une prestation active = **bloquant**, à lister.`,
        `3. \`boond_orders_search\` avec \`period: "period"\`, \`startDate: "${startDate}"\`, \`endDate: "${endDate}"\`, ${scope}, \`pageSize: 200\` → les bons de commande couvrant le mois ; pour chacun, \`boond_orders_invoices\` → les totaux BoondManager : commandé HT, facturé HT, **\`deltaInvoicedExcludingTax\` = reste à facturer**.`,
        `4. \`boond_invoices_search\` avec \`period: "period"\`, \`startDate: "${startDate}"\`, \`endDate: "${endDate}"\`, ${scope}, \`pageSize: 200\` → les factures déjà émises sur le mois, pour ne rien facturer deux fois.`,
        "5. Restituer : (a) **à facturer** — commande | client | prestations / ressources | jours validés × TJM | reste à facturer sur la commande | déjà émis ; (b) **bloqué** — prestation | ressource | CRA manquant ou en attente de validation (renvoyer vers `relance_cra`) ; (c) **commandes épuisées** (reste à facturer ≤ 0 alors que des jours sont validés) → avenant ou nouvelle commande à demander.",
        "6. Ne pas créer les factures ici : `boond_invoices_create` s'utilise ensuite, commande par commande, après validation du tableau par l'utilisateur."
      );
      return lines.join("\n");
    },
  },

  {
    name: "ingest_communication",
    title: "Ingérer un e-mail ou un compte rendu dans le CRM",
    description:
      "À partir d'un e-mail, d'un compte rendu d'appel ou d'une note de réunion collés dans la conversation : extrait les " +
      "entités (contact, société, engagements), déduplique contre BoondManager, présente le plan d'écriture, puis crée ou " +
      "rattache contact / société / action après validation explicite. Aucun Sampling : c'est le modèle qui extrait.",
    argsSchema: {
      contenu: z
        .string()
        .optional()
        .describe(
          "Le texte brut (e-mail, CR d'appel, note). Absent → prendre ce qui a été collé dans la conversation."
        ),
      type_action: z
        .string()
        .optional()
        .describe("Nature de l'action à tracer : appel, email, rendez-vous, note… Défaut : déduite du texte."),
      opportunite_id: z
        .string()
        .optional()
        .describe("Opportunité à laquelle rattacher l'action. " + ID_OR_NAME_HINT_OPPORTUNITY),
    },
    domains: ["contacts", "companies", "actions", "application"],
    build: ({ contenu, type_action, opportunite_id }, now = new Date()) => {
      const today = toIsoDate(now);
      const lines = ["Ingère la communication ci-dessous dans BoondManager (contact, société, action).", ""];
      let opp: ReturnType<typeof resolveEntity> | undefined;
      if (opportunite_id) {
        opp = resolveEntity(opportunite_id, "opportunity", "<OPPORTUNITE_ID>");
        if (opp.preamble) lines.push(opp.preamble);
      }
      lines.push(
        contenu
          ? `Texte à traiter :\n"""\n${contenu.trim()}\n"""`
          : "Texte à traiter : celui collé dans la conversation (le demander s'il n'y en a pas).",
        `Date de référence : aujourd'hui = ${today}.${type_action ? ` Type d'action demandé : « ${type_action} ».` : ""}`,
        "",
        "Étapes :",
        "**1. Extraire** — expéditeur (prénom, nom, e-mail, téléphone, fonction), société (nom, domaine de l'e-mail), objet, engagements pris de part et d'autre, échéances, besoins exprimés, date de l'échange. Ne rien inventer : un champ absent reste vide.",
        "",
        "**2. Dédupliquer avant toute création** — l'étape la plus importante :",
        '   - contact : `boond_find` avec `entity: "contact"` et `email` (l\'e-mail extrait) ; à défaut d\'e-mail, `boond_find` avec `query: "Prénom Nom"` — plusieurs correspondances exactes reviennent en erreur avec la liste : demander à l\'utilisateur lequel ;',
        '   - société : `boond_find` avec `entity: "company"` et `query` = nom de la société (ou `boond_companies_search` avec `keywords` = domaine de l\'e-mail) ;',
        "   - si le contact existe, lire sa société via `boond_contacts_get` et la comparer à celle du texte ;",
        opp
          ? `   - opportunité : \`${opp.idForFilter}\` (fournie).`
          : '   - opportunité : si le texte en désigne une, `boond_find` avec `entity: "opportunity"` ; sinon aucune.',
        "",
        "**3. Présenter le plan d'écriture et ATTENDRE la validation.** Un tableau : entité | action (créer / rattacher à #id existant / ignorer) | valeurs. Signaler les champs déduits (fonction devinée, société déduite du domaine). **Aucune écriture avant un « oui » explicite.**",
        "",
        "**4. Écrire, dans cet ordre** (le contact référence la société, l'action référence le contact) :",
        "   - société manquante → `boond_companies_create` ;",
        "   - contact manquant → `boond_contacts_create` avec `companyId` ;",
        `   - action → \`boond_actions_create\` avec \`contactId\` (+ \`companyId\`), \`typeOf\` lu dans \`boond://dictionary/actions/contacts\`${type_action ? ` (type « ${type_action} »)` : " (appel / e-mail / RDV / note selon le texte)"}, \`startDate\` = date de l'échange en ISO 8601 avec fuseau, \`title\` = objet, \`text\` = compte rendu structuré (contexte, engagements, prochaine étape).`,
        opp ? `   - rattacher l'action à l'opportunité \`${opp.idForFilter}\` (\`opportunityId\`).` : "",
        "",
        "**5. Restituer** les IDs créés ou rattachés, et proposer la suite : un rappel (`boond_actions_create` daté de l'échéance) pour chaque engagement pris."
      );
      return lines.filter(Boolean).join("\n");
    },
  },

  {
    name: "attention_du_jour",
    title: "Qu'est-ce qui demande mon attention aujourd'hui ?",
    description:
      "Lit les indicateurs d'alerte configurés sur le tableau de bord (fins de contrat, périodes d'essai, CRA / notes / absences non validés, " +
      "actions à venir…), exécute la recherche correspondante avec les seuils configurés, et classe ce qui en sort par urgence.",
    argsSchema: {},
    domains: ["alerts", "application"],
    build: (_args, now = new Date()) => {
      const today = toIsoDate(now);
      return [
        `Fais le point sur ce qui demande mon attention aujourd'hui (${today}).`,
        "",
        "Étapes :",
        "1. Lire la ressource `boond://alerts/me` (pas d'appel d'outil) — à défaut `boond_alerts_search`. Elle liste les **indicateurs configurés** sur mon tableau de bord, avec leurs seuils (`params.period` en jours, `-1` = mois précédent ; `X` / `Y` = IDs d'états ou de types ; `perimeter`, `dynamic_data` = mes données) — pas les occurrences.",
        `2. Pour chaque indicateur, exécuter la recherche correspondante avec ses seuils (aujourd'hui = ${today}) :`,
        '   - `contractsEndedUpcoming` → `boond_contracts_search` avec `perimeterDynamic: ["data"]`, `period: "ending"`, `startDate` = aujourd\'hui, `endDate` = aujourd\'hui + `period` jours ;',
        '   - `resourcesProbationaryDateUpcoming` → idem avec `period: "probationEnding"` ;',
        '   - `timesReportsWithNoValidation` / `expensesReportsWithNoValidation` / `absencesReportsWithNoValidation` → `boond_validations_search` avec `documentTypes` (`timesReport` / `expensesReport` / `absencesReport`), `validationStates: ["waitingForValidation"]`, `startMonth` / `endMonth` = mois précédent quand `period` vaut -1, `perimeterDynamic: ["data"]` ;',
        "   - `actionsUpcoming` → `boond_actions_search` avec `period: \"started\"`, `startDate` = aujourd'hui, `endDate` = aujourd'hui + `period` jours, `actionTypes` = `X` si non vide ;",
        "   - un indicateur sans correspondance (`resourcesWithFollowedDocuments`…) est listé tel quel, sans invention.",
        "3. Classer ce qui en sort : **urgent** (échéance dépassée ou sous 7 jours), **à traiter cette semaine**, **à surveiller**.",
        "4. Restituer une liste courte, du plus urgent au moins urgent : élément | indicateur | délai | action proposée (`boond_validations_update`, relance, renouvellement…). Terminer par les trois choses à faire en premier.",
        "5. Un indicateur dont la recherche ne renvoie rien est un « rien à signaler », pas un échec.",
      ].join("\n");
    },
  },

  {
    name: "saisir_cra",
    title: "Saisir ou compléter un CRA",
    description:
      "Saisit la feuille de temps (CRA) d'un collaborateur pour un mois : référentiels de saisie, planning prévu, " +
      "vérification d'un CRA existant, récapitulatif validé par l'utilisateur, puis création ou mise à jour.",
    argsSchema: {
      resource_id: z
        .string()
        .optional()
        .describe(
          "Collaborateur concerné. " +
            ID_OR_NAME_HINT_RESOURCE +
            " Si absent, `boond_application_current_user` est appelé pour le récupérer."
        ),
      term: z.string().optional().describe("Mois du CRA (YYYY-MM). Défaut : mois en cours."),
      consignes: z
        .string()
        .optional()
        .describe("Précisions libres (ex: « 2 jours de RTT les 12 et 13 », « demi-journée le 20 sur le projet X »)."),
    },
    domains: ["timesheets", "application"],
    build: ({ resource_id, term, consignes }, now = new Date()) => {
      const bounds = periodBounds(term, now, "month");
      const month = bounds ? bounds.startMonth : (term ?? "").trim();
      const lines: string[] = [`Saisis le CRA du mois ${month || "<YYYY-MM>"} dans BoondManager.`, ""];
      let resourceLit = "<RESOURCE_ID>";
      let resourceStep: string;
      if (resource_id) {
        const r = resolveEntity(resource_id, "resource", "<RESOURCE_ID>");
        if (r.preamble) lines.push(r.preamble);
        resourceLit = r.idForFilter;
        resourceStep = `Le collaborateur concerné a pour ID \`${resourceLit}\`.`;
      } else {
        resourceStep = "Appeler `boond_application_current_user` pour obtenir mon ID → ce sera `<RESOURCE_ID>`.";
      }
      lines.push(
        consignes ? `Consignes de l'utilisateur : « ${consignes} ».` : "",
        consignes ? "" : "",
        "Étapes :",
        "",
        `**1. Identifier le collaborateur et le mois.** ${resourceStep} Le mois est \`term = "${month || "<YYYY-MM>"}"\`${bounds ? ` (du ${bounds.startDate} au ${bounds.endDate})` : ""}.`,
        "",
        `**2. Récupérer les référentiels de saisie** : \`boond_timesheets_default\` avec \`resourceId: "${resourceLit}"\` et ce \`term\`. Il retourne :`,
        "   - les **types d'unité d'œuvre** autorisés pour cette ressource (`reference` + libellé + `activityType` : production / absence / exceptionalTime) — ils ne sont **pas** dans `boond_application_dictionary` ;",
        "   - les couples `projectId` / `deliveryId` imputables ce mois-là — obligatoires sur chaque ligne de production ;",
        "   - le **planning prévu** (jours et imputations issus des prestations) et les absences déjà posées.",
        "   - Aucune imputation disponible → seules des absences peuvent être saisies ; le signaler.",
        "",
        `**3. Vérifier si un CRA existe déjà** : \`boond_timesheets_search\` avec \`startMonth: "${month || "<YYYY-MM>"}"\`, \`endMonth: "${month || "<YYYY-MM>"}"\`, \`resourceId: "${resourceLit}"\`.`,
        "   - ⚠️ L'API **ne déduplique pas** : vérifier, pas supposer. CRA existant → le relire avec `boond_timesheets_get` (ses lignes actuelles) et le compléter à l'étape 5 via `boond_timesheets_update` ; aucun → `boond_timesheets_create`.",
        "",
        "**4. Construire les lignes et ATTENDRE la validation de l'utilisateur.** Partir du planning prévu, appliquer les consignes (absences, demi-journées, jours non travaillés), une ligne par jour : `startDate`, `duration` (1 = journée, 0.5 = demi-journée), `workUnitTypeReference`, et pour la production `projectId` + `deliveryId`.",
        "   - Présenter un tableau : jour | durée | type (libellé + `reference`) | projet / prestation. Puis le total du mois. Ne pas écrire avant un « oui » explicite.",
        "   - Ne jamais inventer une imputation : un couple hors de la liste de l'étape 2 est refusé par l'API.",
        "",
        "**5. Écrire.** Nouveau CRA → `boond_timesheets_create` (`resourceId`, `term`, `regularTimes[]`). CRA existant → `boond_timesheets_update` avec la liste **complète** des lignes (les lignes existantes fusionnées avec les nouvelles) : `regularTimes` remplace tout le tableau, une liste partielle efface le reste du mois.",
        "   - `state` n'est pas modifiable ici : la validation passe par le workflow BoondManager (`boond_validations_search` pour suivre).",
        "",
        "**6. Confirmer** : ID du CRA, nombre de jours saisis par imputation, et rappeler que le CRA reste à soumettre / valider dans BoondManager."
      );
      return lines.filter(Boolean).join("\n");
    },
  },
];

// ---- Assisted entry of entity arguments (`completions/complete`, issue #260) --
//
// Every `*_id` argument accepts an id or a label (see `resolveEntity`), so the
// completer returns *labels* — "Prénom Nom", a company name — which the user
// can pick and which the runbook then resolves; `CompleteResult.values` is
// substituted verbatim, so ids would be opaque in the picker. Keyed by
// argument name: `manager_id` / `resource_id` → resources, `society_id` →
// companies, and so on. `completable()` attaches the completer to the same
// Zod object (a non-enumerable symbol), so the mirror workflow tools keep
// advertising the unchanged JSON Schema.
const COMPLETION_KIND_BY_ARG: Record<string, EntityKind> = {
  manager_id: "resource",
  resource_id: "resource",
  society_id: "society",
  opportunity_id: "opportunity",
  agency_id: "agency",
  project_id: "project",
  candidate_id: "candidate",
  contact_id: "contact",
  // `ingest_communication` (#180) spells it the French way.
  opportunite_id: "opportunity",
};

const SEARCH_PATH_BY_KIND: Record<EntityKind, string> = {
  resource: "/resources",
  society: "/companies",
  opportunity: "/opportunities",
  agency: "/agencies",
  project: "/projects",
  candidate: "/candidates",
  contact: "/contacts",
};

const MAX_COMPLETIONS = 8;

function labelOf(attrs: Record<string, unknown>): string | undefined {
  const person = [attrs.firstName, attrs.lastName].filter((v) => typeof v === "string" && v.length > 0).join(" ");
  if (person) return person;
  for (const key of ["name", "title", "reference"]) {
    const v = attrs[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

/** Search the entity by the typed prefix; empty on any failure (no credentials, API down). */
export async function completeEntityArgument(kind: EntityKind, value: string): Promise<string[]> {
  const needle = value.trim();
  if (needle.length === 0) return [];
  try {
    const response = await apiRequest(SEARCH_PATH_BY_KIND[kind], "GET", undefined, {
      keywords: needle,
      maxResults: MAX_COMPLETIONS,
    });
    const rows = Array.isArray(response.data) ? response.data : response.data ? [response.data] : [];
    const labels = rows.map((r) => labelOf(r?.attributes ?? {})).filter((l): l is string => !!l);
    return [...new Set(labels)].slice(0, MAX_COMPLETIONS);
  } catch {
    return [];
  }
}

for (const p of PROMPTS) {
  for (const [arg, schema] of Object.entries(p.argsSchema)) {
    const kind = COMPLETION_KIND_BY_ARG[arg];
    if (kind) completable(schema, (value: unknown) => completeEntityArgument(kind, String(value ?? "")));
  }
}

export function registerAllPrompts(server: McpServer, policy?: AccessPolicy): void {
  for (const p of PROMPTS) {
    // Cut a prompt when any domain it orchestrates is filtered out, so the
    // surfaced runbook never references tools that aren't registered.
    if (policy && !p.domains.every((d) => isDomainAllowed(policy, d))) continue;
    server.registerPrompt(
      p.name,
      {
        title: p.title,
        description: p.description,
        argsSchema: p.argsSchema,
      },
      (args) => userMessage(p.build((args ?? {}) as Record<string, string | undefined>))
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
