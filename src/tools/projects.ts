import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ProjectCreateSchema, ProjectUpdateSchema, ProjectSearchSchema } from "../schemas/index.js";
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
  entityName: "projet",
  entityNamePlural: "projets",
  apiPath: "/projects",
  prefix: "boond_projects",
};

const PROJECT_TABS: TabDefinition[] = [
  {
    name: "information",
    tab: "information",
    title: "Informations générales d'un projet",
    subject: "les informations générales",
    content: "client, dates, état, description, responsable",
    returns: "Fiche du projet.",
  },
  {
    name: "actions",
    tab: "actions",
    title: "Actions liées à un projet",
    subject: "les actions",
    content: "appels, emails, RDV, notes",
    returns: "Liste des actions rattachées au projet.",
  },
  {
    name: "simulation",
    tab: "simulation",
    title: "Simulation financière d'un projet",
    subject: "la simulation financière",
    content: "marge, CA, coûts, rentabilité",
    returns: "Chiffrage du projet.",
  },
  {
    name: "deliveries_groupments",
    tab: "deliveries-groupments",
    title: "Livraisons et groupements d'un projet",
    subject: "les livraisons et leurs groupements",
    content: "lignes de mission facturables du projet",
    returns:
      "Liste des livraisons du projet. Les ID de livraison qui s'y trouvent sont ceux qu'exige une ligne de note de frais.",
  },
  {
    name: "orders",
    tab: "orders",
    title: "Bons de commande d'un projet",
    subject: "les bons de commande",
    returns: "Liste des bons de commande adossés au projet.",
  },
  {
    name: "purchases",
    tab: "purchases",
    title: "Achats d'un projet",
    subject: "les achats et la sous-traitance",
    returns: "Liste des achats imputés au projet.",
  },
  {
    name: "productivity",
    tab: "productivity",
    title: "Productivité d'un projet",
    subject: "les données de productivité",
    content: "temps passé, jours consommés",
    returns: "Consommé du projet — du réalisé, contrairement à `boond_projects_simulation`.",
  },
];

const PROJECT_SEARCH_DESCRIPTION = `Recherche des projets / missions dans BoondManager avec filtres serveur.

Cas d'usage courants :
• **Mes projets** sans connaître son propre ID : \`perimeterDynamic: ["data"]\`. Pour "projets de X" : \`perimeterManagers: [<X_id>]\`.
• **États / types** : \`projectStates: [<id>]\` (dictionnaire \`setting.state.project\`), \`projectTypes: [<id>]\` (\`setting.typeOf.project\`). IDs entiers.
• **Société cliente** : \`companies: [<companyId>]\` (filtre les projets rattachés à ces sociétés).
• **Lié à un contact / opportunité / contrat / ressource / produit** : utiliser \`keywords\` avec préfixes — \`"PRJ<id>"\` (projet), \`"CSOC<id>"\` (société), \`"CCON<id>"\` (contact), \`"AO<id>"\` (opportunité), \`"CTR<id>"\` (contrat), \`"COMP<id>"\` (ressource), \`"PROD<id>"\` (produit), \`"MIS<id>"\` (livraison).
• **Métier** : \`activityAreas\`, \`expertiseAreas\`, \`flags\` (tags).
• **Période** : \`period: "running"\` (en cours), \`"created"\`, \`"started"\`, \`"stopped"\`, \`"closed"\`, \`"updated"\`, \`"hasAdditionalDataOrPurchase"\` + \`startDate\`/\`endDate\`. Ex: projets en cours en 2026 → \`period: "running", startDate: "2026-01-01", endDate: "2026-12-31"\`.

Tri : \`sort: "startDate"|"endDate"|"reference"|"company.name"|"mainManager.lastName"\` + \`order\`.

Returns : liste paginée des projets. Utiliser \`boond_projects_get\` ou les outils d'onglets pour le détail.`;

export function registerProjectTools(server: McpServer): void {
  registerSearchTool(server, OPTS, {
    schema: ProjectSearchSchema,
    description: PROJECT_SEARCH_DESCRIPTION,
  });
  registerGetTool(server, OPTS);

  registerCreateTool(server, OPTS, ProjectCreateSchema, (params) => {
    const { companyId, contactId, opportunityId, name, ...attrs } = params;
    const apiAttrs = { ...attrs, ...(name ? { title: name } : {}) };
    const body = buildJsonApiBody("project", apiAttrs);
    const relationships: Record<string, unknown> = {};
    if (companyId) relationships.company = { data: { id: companyId, type: "company" } };
    if (contactId) relationships.contact = { data: { id: contactId, type: "contact" } };
    if (opportunityId) relationships.opportunity = { data: { id: opportunityId, type: "opportunity" } };
    if (Object.keys(relationships).length > 0) {
      (body as Record<string, Record<string, unknown>>).data.relationships = relationships;
    }
    return body;
  });

  // Updates go through PUT /projects/{id}/information — the base resource
  // returns 405 on PATCH (issue #134, same root cause as #124). buildJsonApiBody
  // drops undefined values, so PUT still only touches the supplied fields.
  registerUpdateTool(
    server,
    OPTS,
    ProjectUpdateSchema,
    (params) => {
      const { id, name, ...attrs } = params;
      const apiAttrs = { ...attrs, ...(name ? { title: name } : {}) };
      return buildJsonApiBody("project", apiAttrs, id as string);
    },
    { method: "PUT", pathSuffix: "information" }
  );

  registerDeleteTool(server, OPTS);

  registerTabTools(server, { ...OPTS, prefix: OPTS.prefix }, PROJECT_TABS);
}
