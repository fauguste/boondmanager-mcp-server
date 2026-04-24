import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OpportunityCreateSchema, OpportunityUpdateSchema, OpportunitySearchSchema, IdSchema } from "../schemas/index.js";
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
  entityName: "opportunité",
  entityNamePlural: "opportunités",
  apiPath: "/opportunities",
  prefix: "boond_opportunities",
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

const OPPORTUNITY_TABS: TabDefinition[] = [
  {
    name: "information",
    tab: "information",
    title: "Informations générales d'une opportunité",
    description: `Récupère les informations générales d'une opportunité (client, dates, montant, probabilité, état...).

Args:
  - id (string): ID de l'opportunité

Returns: Données générales de l'opportunité.`,
  },
  {
    name: "actions",
    tab: "actions",
    title: "Actions liées à une opportunité",
    description: `Récupère les actions (appels, emails, RDV, notes) associées à une opportunité.

Args:
  - id (string): ID de l'opportunité

Returns: Liste des actions liées à l'opportunité.`,
  },
  {
    name: "positionings",
    tab: "positionings",
    title: "Positionnements d'une opportunité",
    description: `Récupère les positionnements (candidats/ressources proposés) sur une opportunité.

Args:
  - id (string): ID de l'opportunité

Returns: Liste des positionnements de l'opportunité.`,
  },
  {
    name: "projects",
    tab: "projects",
    title: "Projets liés à une opportunité",
    description: `Récupère les projets issus de cette opportunité.

Args:
  - id (string): ID de l'opportunité

Returns: Liste des projets liés à l'opportunité.`,
  },
  {
    name: "simulation",
    tab: "simulation",
    title: "Simulation financière d'une opportunité",
    description: `Récupère la simulation financière d'une opportunité (marge, CA prévisionnel, coûts...).

Args:
  - id (string): ID de l'opportunité

Returns: Données de simulation financière de l'opportunité.`,
  },
];

const OPPORTUNITY_SEARCH_DESCRIPTION = `Recherche des opportunités commerciales dans BoondManager avec filtres avancés.

⚠️ Privilégier les filtres structurés plutôt que de paginer toute la base.

Filtres utiles :
• \`mainManagers\` : ID(s) des commerciaux en charge (utile pour "mes opportunités" → passer votre userId via \`boond_application_current_user\`).
• \`states\` : états de l'opportunité (voir \`boond_application_dictionary\` avec \`states/opportunities\`).
• \`company\` / \`contact\` : filtrer par société cliente ou contact (ID unique chacun).
• \`period\` + \`startDate\`/\`endDate\` : filtrer sur une période (creation, update, startDate, endDate).
• \`activityAreas\`, \`origins\` : segmentation métier.
• \`agencies\`, \`poles\`, \`businessUnits\` : périmètre organisationnel.

Returns : liste paginée des opportunités. Utiliser \`boond_opportunities_get\` ou les outils d'onglets pour le détail.`;

export function registerOpportunityTools(server: McpServer): void {
  registerSearchTool(server, OPTS, {
    schema: OpportunitySearchSchema,
    description: OPPORTUNITY_SEARCH_DESCRIPTION,
  });
  registerGetTool(server, OPTS);

  registerCreateTool(server, OPTS, OpportunityCreateSchema, (params) => {
    const { companyId, contactId, ...attrs } = params;
    const body = buildJsonApiBody("opportunity", attrs);
    const relationships: Record<string, unknown> = {};
    if (companyId) relationships.company = { data: { id: companyId, type: "company" } };
    if (contactId) relationships.contact = { data: { id: contactId, type: "contact" } };
    if (Object.keys(relationships).length > 0) {
      (body as Record<string, Record<string, unknown>>).data.relationships = relationships;
    }
    return body;
  });

  registerUpdateTool(server, OPTS, OpportunityUpdateSchema, (params) => {
    const { id, ...attrs } = params;
    return buildJsonApiBody("opportunity", attrs, id as string);
  });

  registerDeleteTool(server, OPTS);

  // Register one tool per opportunity tab
  for (const tab of OPPORTUNITY_TABS) {
    server.registerTool(
      `boond_opportunities_${tab.name}`,
      {
        title: tab.title,
        description: tab.description,
        inputSchema: IdSchema,
        annotations: TAB_TOOL_ANNOTATIONS,
      },
      async (params: IdInput) => {
        const response = await apiRequest(`/opportunities/${params.id}/${tab.tab}`);
        const text = formatDetailResponse(response);
        return {
          content: [{ type: "text" as const, text }],
        };
      }
    );
  }
}
