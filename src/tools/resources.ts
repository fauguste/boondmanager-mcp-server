import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceCreateSchema, ResourceUpdateSchema, ResourceSearchSchema, IdSchema } from "../schemas/index.js";
import type { IdInput } from "../schemas/index.js";
import {
  registerSearchTool,
  registerGetTool,
  registerCreateTool,
  registerUpdateTool,
  registerDeleteTool,
  buildJsonApiBody,
} from "./crud-factory.js";
import { apiRequest, formatDetailResponse } from "../services/boond-client.js";

const OPTS = {
  entityName: "ressource",
  entityNamePlural: "ressources",
  apiPath: "/resources",
  prefix: "boond_resources",
};

const TAB_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

interface TabDefinition {
  name: string;
  tab: string;
  title: string;
  description: string;
}

const RESOURCE_TABS: TabDefinition[] = [
  {
    name: "information",
    tab: "information",
    title: "Informations générales d'une ressource",
    description: `Récupère les informations générales d'une ressource (coordonnées, adresse, état civil, photo, tags, manager...).

Args:
  - id (string): ID de la ressource

Returns: Données personnelles et administratives de la ressource.`,
  },
  {
    name: "technical_data",
    tab: "technical-data",
    title: "Compétences techniques d'une ressource",
    description: `Récupère le profil technique d'une ressource (compétences, expériences, formations, certifications, langues, CV...).

Args:
  - id (string): ID de la ressource

Returns: Données techniques et compétences de la ressource.`,
  },
  {
    name: "administrative",
    tab: "administrative",
    title: "Données administratives d'une ressource",
    description: `Récupère les informations administratives d'une ressource (salaire, TJM, coût journalier, informations RH...).

Args:
  - id (string): ID de la ressource

Returns: Données administratives et RH de la ressource.`,
  },
  {
    name: "advantages",
    tab: "advantages",
    title: "Avantages d'une ressource",
    description: `Récupère les avantages associés à une ressource (tickets restaurant, mutuelle, véhicule, primes...).

Args:
  - id (string): ID de la ressource

Returns: Liste des avantages de la ressource.`,
  },
  {
    name: "actions",
    tab: "actions",
    title: "Actions liées à une ressource",
    description: `Récupère les actions (appels, emails, RDV, notes) associées à une ressource.

Args:
  - id (string): ID de la ressource

Returns: Liste des actions liées à la ressource.`,
  },
  {
    name: "positionings",
    tab: "positionings",
    title: "Positionnements d'une ressource",
    description: `Récupère les positionnements (placements sur des projets) d'une ressource.

Args:
  - id (string): ID de la ressource

Returns: Liste des positionnements de la ressource.`,
  },
  {
    name: "projects",
    tab: "projects",
    title: "Projets d'une ressource",
    description: `Récupère les projets auxquels une ressource participe ou a participé.

Args:
  - id (string): ID de la ressource

Returns: Liste des projets de la ressource.`,
  },
  {
    name: "times_reports",
    tab: "times-reports",
    title: "Feuilles de temps d'une ressource",
    description: `Récupère les feuilles de temps d'une ressource.

Args:
  - id (string): ID de la ressource

Returns: Liste des feuilles de temps de la ressource.`,
  },
  {
    name: "expenses_reports",
    tab: "expenses-reports",
    title: "Notes de frais d'une ressource",
    description: `Récupère les notes de frais d'une ressource.

Args:
  - id (string): ID de la ressource

Returns: Liste des notes de frais de la ressource.`,
  },
  {
    name: "absences_reports",
    tab: "absences-reports",
    title: "Demandes d'absences d'une ressource",
    description: `Récupère les demandes d'absences d'une ressource (congés, RTT, maladie...).

Args:
  - id (string): ID de la ressource

Returns: Liste des demandes d'absences de la ressource.`,
  },
];

const RESOURCE_SEARCH_DESCRIPTION = `Recherche des ressources (collaborateurs internes) dans BoondManager avec filtres avancés côté serveur.

⚠️ IMPORTANT — utilisez les filtres ci-dessous plutôt que de paginer toute la base. Le filtre \`mainManagers\` est la clé pour toute question hiérarchique (N-1, N-2, équipe d'un manager).

Cas d'usage courants :
• Mes N-1 (équipe directe) : appeler d'abord \`boond_application_current_user\` pour obtenir votre userId, puis \`mainManagers: ["<monUserId>"]\`.
• Mes N-2 et au-delà : pour chaque N-1 obtenu, rappeler cet outil avec \`mainManagers: ["<idDuN-1>"]\`. Répéter récursivement pour la hiérarchie descendante.
• Équipe d'un autre manager : \`mainManagers: ["<idDuManager>"]\`.
• Collaborateurs actifs uniquement : \`states: [1]\` (consulter \`boond_application_dictionary\` avec \`states/resources\` pour les valeurs exactes).
• Recherche par compétence : \`skills: ["Java", "AWS"]\`, \`tools: ["Kubernetes"]\`.
• Périmètre organisationnel : \`agencies\`, \`poles\`, \`businessUnits\`.
• \`keywords\` reste utile pour une recherche plein texte (nom, email) mais ne remplace pas les filtres structurés ci-dessus.

Les filtres multivalués (\`mainManagers\`, \`states\`, \`skills\`…) acceptent un tableau ; passer un seul ID dans un tableau d'un élément fonctionne également.

Returns : liste paginée des ressources (id, nom, email, ville, état, titre). Utiliser \`boond_resources_get\` ou les outils d'onglets pour le détail.`;

export function registerResourceTools(server: McpServer): void {
  registerSearchTool(server, OPTS, {
    schema: ResourceSearchSchema,
    description: RESOURCE_SEARCH_DESCRIPTION,
  });
  registerGetTool(server, OPTS);

  registerCreateTool(server, OPTS, ResourceCreateSchema, (params) => {
    const { ...attrs } = params;
    return buildJsonApiBody("resource", attrs);
  });

  registerUpdateTool(server, OPTS, ResourceUpdateSchema, (params) => {
    const { id, ...attrs } = params;
    return buildJsonApiBody("resource", attrs, id as string);
  });

  registerDeleteTool(server, OPTS);

  // Register one tool per resource tab
  for (const tab of RESOURCE_TABS) {
    server.registerTool(
      `boond_resources_${tab.name}`,
      {
        title: tab.title,
        description: tab.description,
        inputSchema: IdSchema,
        annotations: TAB_TOOL_ANNOTATIONS,
      },
      async (params: IdInput) => {
        const response = await apiRequest(`/resources/${params.id}/${tab.tab}`);
        const text = formatDetailResponse(response);
        return {
          content: [{ type: "text" as const, text }],
        };
      }
    );
  }
}
