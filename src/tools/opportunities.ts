import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OpportunityCreateSchema, OpportunityUpdateSchema, OpportunitySearchSchema } from "../schemas/index.js";
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
  entityName: "opportunité",
  entityNamePlural: "opportunités",
  apiPath: "/opportunities",
  prefix: "boond_opportunities",
};

const OPPORTUNITY_TABS: TabDefinition[] = [
  {
    name: "information",
    tab: "information",
    title: "Informations générales d'une opportunité",
    subject: "les informations générales",
    content: "client, dates, montant, probabilité, état",
    returns: "Fiche de l'opportunité.",
  },
  {
    name: "actions",
    tab: "actions",
    title: "Actions liées à une opportunité",
    subject: "les actions",
    content: "appels, emails, RDV, notes",
    returns: "Liste des actions rattachées à l'opportunité.",
  },
  {
    name: "positionings",
    tab: "positionings",
    title: "Positionnements sur une opportunité",
    subject: "les positionnements",
    content: "candidats et ressources proposés au client",
    returns: "Liste des positionnements de l'opportunité.",
  },
  {
    name: "projects",
    tab: "projects",
    title: "Projets issus d'une opportunité",
    subject: "les projets",
    content: "missions nées de cette affaire une fois gagnée",
    returns: "Liste des projets liés à l'opportunité.",
  },
  {
    name: "simulation",
    tab: "simulation",
    title: "Simulation financière d'une opportunité",
    subject: "la simulation financière",
    content: "marge, CA prévisionnel, coûts",
    returns: "Chiffrage prévisionnel de l'opportunité — prévisionnel, pas du réalisé.",
  },
];

const OPPORTUNITY_SEARCH_DESCRIPTION = `Recherche des opportunités commerciales dans BoondManager avec filtres serveur.

Cas d'usage courants :
• **Mes opportunités** sans connaître son propre ID : \`perimeterDynamic: ["data"]\`. Pour "opportunités de X" : \`perimeterManagers: [<X_id>]\` (combiner avec \`perimeterManagersType: "main"|"hr"\`).
• **États / types** : \`opportunityStates: [<id>]\` (dictionnaire \`setting.state.opportunity\`), \`opportunityTypes: [<id>]\` (\`setting.typeOf.project\`). IDs entiers issus du dictionnaire.
• **Lié à une société/contact/candidat** : utiliser \`keywords\` avec préfixes — \`"CSOC<id>"\` (société), \`"CCON<id>"\` (contact), \`"CAND<id>"\` (candidat), \`"COMP<id>"\` (ressource), \`"PROD<id>"\` (produit), \`"AO<id>"\` (opportunité).
• **Métier** : \`activityAreas\`, \`expertiseAreas\`, \`tools\`, \`places\` (zones), \`durations\`, \`origins\`.
• **Positionnements** : \`positioningStates: [<id>]\` ou \`["none"]\` pour les opportunités sans positionnement.
• **Période** : \`period: "created"|"started"|"closingDate"|"updated"|"updatedPositioning"|"withActions"|...\` + \`startDate\`/\`endDate\`. Ex: clôtures 2026 → \`period: "closingDate", startDate: "2026-01-01", endDate: "2026-12-31"\`.

Tri : \`sort: "creationDate"|"title"|"company.name"|"startDate"|"endDate"|"state"|"closingDate"|"answerDate"|"updateDate"|...\` + \`order\`.

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

  registerTabTools(server, { ...OPTS, prefix: OPTS.prefix }, OPPORTUNITY_TABS);
}
