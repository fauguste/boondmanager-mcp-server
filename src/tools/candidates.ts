import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CandidateCreateSchema, CandidateUpdateSchema, CandidateSearchSchema } from "../schemas/index.js";
import {
  registerSearchTool,
  registerGetTool,
  registerCreateTool,
  registerUpdateTool,
  registerDeleteTool,
  buildJsonApiBody,
} from "./crud-factory.js";
import { registerTabTools } from "./tab-tools.js";
import type { TabDefinition } from "./tab-tools.js";

const OPTS = {
  entityName: "candidat",
  entityNamePlural: "candidats",
  apiPath: "/candidates",
  prefix: "boond_candidates",
};

const CANDIDATE_TABS: TabDefinition[] = [
  {
    name: "information",
    tab: "information",
    title: "Informations générales d'un candidat",
    subject: "les informations générales",
    content: "coordonnées, adresse, état civil, photo, tags, source",
    returns: "Bloc identité et coordonnées du candidat.",
  },
  {
    name: "technical_data",
    tab: "technical-data",
    title: "Compétences techniques d'un candidat",
    subject: "le profil technique",
    content: "compétences, expériences, formations, certifications, langues, CV",
    returns:
      "Profil technique du candidat. Les ID de documents (CV) qui s'y trouvent alimentent `boond_documents_get`.",
  },
  {
    name: "administrative",
    tab: "administrative",
    title: "Données administratives d'un candidat",
    subject: "les données administratives",
    content: "pièces justificatives, documents contractuels, informations RH",
    returns: "Bloc administratif du candidat, avec les ID de documents exploitables par `boond_documents_get`.",
  },
  {
    name: "actions",
    tab: "actions",
    title: "Actions liées à un candidat",
    subject: "les actions",
    content: "appels, emails, RDV, notes",
    returns: "Liste des actions rattachées au candidat.",
  },
  {
    name: "positionings",
    tab: "positionings",
    title: "Positionnements d'un candidat",
    subject: "les positionnements",
    content: "placements du candidat sur des opportunités ou des projets",
    returns: "Liste des positionnements du candidat.",
  },
];

const CANDIDATE_SEARCH_DESCRIPTION = `Recherche des candidats dans BoondManager avec filtres serveur.

Cas d'usage courants :
• **Mes candidats** sans connaître son propre ID : \`perimeterDynamic: ["data"]\`. Pour "candidats de l'équipe X" : \`perimeterManagers: [<X_id>]\` (utiliser \`perimeterManagersType: "main"|"hr"\` pour cibler Main vs HR Manager).
• **États / types** : \`candidateStates: [<id>]\` (dictionnaire \`setting.state.candidate\`), \`candidateTypes\` (\`setting.typeOf.resource\`), \`contractTypes\`, \`availabilityTypes\`. IDs entiers issus du dictionnaire.
• **Profil technique** : \`tools: [<id>]\` (OU; pour ET: \`["#AND#", "1", "2"]\`), \`expertiseAreas\`, \`activityAreas\`, \`experiences\`, \`trainings\`, \`mobilityAreas\`, \`languages\` (format \`langueId|niveauId\`).
• **Sourcing** : \`sources: [<id>]\` (origine du candidat), \`evaluations\`.
• **Période** : \`period: "created"|"updated"|"available"|"withActions"|...\` + \`startDate\`/\`endDate\`.
• **Recherche par nom** : \`keywords: "Dupont"\` + \`keywordsType: "lastName"\` (ou firstName, fullName avec \`"NOM#PRENOM"\`, emails, phones, title, titleSkills…). Sans \`keywordsType\`, recherche par défaut dans le CV.
• **Géolocalisation** : \`coordinates: "lat,lon"\` ou \`location\` + \`geoDistance\` (km, 5-200).

Tri : \`sort\` + \`order\`.

Returns : liste paginée des candidats. Utiliser \`boond_candidates_get\` ou les outils d'onglets pour le détail.`;

export function registerCandidateTools(server: McpServer): void {
  registerSearchTool(server, OPTS, {
    schema: CandidateSearchSchema,
    description: CANDIDATE_SEARCH_DESCRIPTION,
  });
  registerGetTool(server, OPTS);

  registerCreateTool(server, OPTS, CandidateCreateSchema, (params) => {
    const { ...attrs } = params;
    return buildJsonApiBody("candidate", attrs);
  });

  // Updates go through PUT /candidates/{id}/information — the base resource
  // returns 405 on PATCH (issue #134, same root cause as #124). buildJsonApiBody
  // drops undefined values, so PUT still only touches the supplied fields.
  registerUpdateTool(
    server,
    OPTS,
    CandidateUpdateSchema,
    (params) => {
      const { id, ...attrs } = params;
      return buildJsonApiBody("candidate", attrs, id as string);
    },
    { method: "PUT", pathSuffix: "information" }
  );

  registerDeleteTool(server, OPTS);

  registerTabTools(server, { ...OPTS, prefix: OPTS.prefix }, CANDIDATE_TABS);
}
