import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  OpportunityCreateSchema,
  OpportunityUpdateSchema,
  OpportunitySearchSchema,
  IdSchema,
} from "../schemas/index.js";
import type { IdInput } from "../schemas/index.js";
import {
  registerSearchTool,
  registerGetTool,
  registerCreateTool,
  registerUpdateTool,
  registerDeleteTool,
  buildJsonApiBody,
} from "./crud-factory.js";
import { apiRequest, formatTabResponse } from "../services/boond-client.js";

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

const OPPORTUNITY_SEARCH_DESCRIPTION = `Recherche des opportunités commerciales dans BoondManager avec filtres serveur.

⚠️ Utilisez les filtres structurés plutôt que la pagination intégrale. Les noms de paramètres sont ceux exacts de l'API.

Cas d'usage courants :
• **Mes opportunités** sans connaître son propre ID : \`perimeterDynamic: ["data"]\`. Pour "opportunités de X" : \`perimeterManagers: [<X_id>]\` (combiner avec \`perimeterManagersType: "main"|"hr"\`).
• **États / types** : \`opportunityStates: [<id>]\` (dictionnaire \`setting.state.opportunity\`), \`opportunityTypes: [<id>]\` (\`setting.typeOf.project\`). IDs entiers issus du dictionnaire.
• **Lié à une société/contact/candidat** : utiliser \`keywords\` avec préfixes — \`"CSOC<id>"\` (société), \`"CCON<id>"\` (contact), \`"CAND<id>"\` (candidat), \`"COMP<id>"\` (ressource), \`"PROD<id>"\` (produit), \`"AO<id>"\` (opportunité).
• **Périmètre orga** : \`perimeterAgencies\`, \`perimeterPoles\`, \`perimeterBusinessUnits\`. \`narrowPerimeter: true\` pour ET.
• **Métier** : \`activityAreas\`, \`expertiseAreas\`, \`tools\`, \`places\` (zones), \`durations\`, \`origins\`.
• **Positionnements** : \`positioningStates: [<id>]\` ou \`["none"]\` pour les opportunités sans positionnement.
• **Période** : \`period: "created"|"started"|"closingDate"|"updated"|"updatedPositioning"|"withActions"|...\` + \`startDate\`/\`endDate\`. Ex: clôtures 2026 → \`period: "closingDate", startDate: "2026-01-01", endDate: "2026-12-31"\`.

Pagination : \`page\`, \`pageSize\` (max 500). Tri : \`sort: "creationDate"|"title"|"company.name"|"startDate"|"endDate"|"state"|"closingDate"|"answerDate"|"updateDate"|...\` + \`order\`.

Returns : liste paginée des opportunités. Utiliser \`boond_opportunities_get\` ou les outils d'onglets pour le détail.`;

/**
 * Builds the JSON:API body for create (no id) and update (with id) of an
 * opportunity. Maps the friendly schema field names to the API's attribute /
 * relationship names (see issues #113 and #124):
 *   - `name` → /data/attributes/title
 *   - `note` → /data/attributes/description (the API has no `note` attribute)
 *   - `{company,contact,pole,hrManager,mainManager,agency}Id` → relationships
 * `buildJsonApiBody` strips undefined attributes and relationships, so partial
 * updates only touch the supplied fields.
 */
function buildOpportunityBody(params: Record<string, unknown>): unknown {
  const { id, name, note, companyId, contactId, poleId, hrManagerId, mainManagerId, agencyId, ...attributes } =
    params as {
      id?: string;
      name?: string;
      note?: string;
      companyId?: string;
      contactId?: string;
      poleId?: string;
      hrManagerId?: string;
      mainManagerId?: string;
      agencyId?: string;
    } & Record<string, unknown>;

  return buildJsonApiBody("opportunity", { ...attributes, title: name, description: note }, id, {
    company: companyId ? { id: companyId, type: "company" } : undefined,
    contact: contactId ? { id: contactId, type: "contact" } : undefined,
    pole: poleId ? { id: poleId, type: "pole" } : undefined,
    hrManager: hrManagerId ? { id: hrManagerId, type: "resource" } : undefined,
    mainManager: mainManagerId ? { id: mainManagerId, type: "resource" } : undefined,
    agency: agencyId ? { id: agencyId, type: "agency" } : undefined,
  });
}

export function registerOpportunityTools(server: McpServer): void {
  registerSearchTool(server, OPTS, {
    schema: OpportunitySearchSchema,
    description: OPPORTUNITY_SEARCH_DESCRIPTION,
  });
  registerGetTool(server, OPTS);

  registerCreateTool(server, OPTS, OpportunityCreateSchema, buildOpportunityBody);

  // Updates go through PUT /opportunities/{id}/information — the base resource
  // returns 405 on PATCH (issue #124). buildJsonApiBody drops undefined values,
  // so PUT still only touches the fields the caller supplied.
  registerUpdateTool(server, OPTS, OpportunityUpdateSchema, buildOpportunityBody, {
    method: "PUT",
    pathSuffix: "information",
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
        const text = formatTabResponse(response);
        return {
          content: [{ type: "text" as const, text }],
        };
      }
    );
  }
}
