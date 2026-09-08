import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ContactCreateSchema, ContactUpdateSchema, ContactSearchSchema } from "../schemas/index.js";
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
  entityName: "contact",
  entityNamePlural: "contacts",
  apiPath: "/contacts",
  prefix: "boond_contacts",
};

const CONTACT_TABS: TabDefinition[] = [
  {
    name: "information",
    tab: "information",
    title: "Informations générales d'un contact",
    subject: "les informations générales",
    content: "coordonnées, société de rattachement, fonction, tags",
    returns: "Bloc identité et rattachement du contact.",
  },
  {
    name: "actions",
    tab: "actions",
    title: "Actions liées à un contact",
    subject: "les actions",
    content: "appels, emails, RDV, notes",
    returns: "Liste des actions rattachées au contact.",
  },
  {
    name: "opportunities",
    tab: "opportunities",
    title: "Opportunités d'un contact",
    subject: "les opportunités commerciales",
    content: "affaires portées par ce contact",
    returns: "Liste des opportunités du contact.",
  },
  {
    name: "projects",
    tab: "projects",
    title: "Projets d'un contact",
    subject: "les projets",
    returns: "Liste des projets rattachés au contact.",
  },
  {
    name: "orders",
    tab: "orders",
    title: "Bons de commande d'un contact",
    subject: "les bons de commande",
    returns: "Liste des bons de commande du contact.",
  },
  {
    name: "invoices",
    tab: "invoices",
    title: "Factures d'un contact",
    subject: "les factures",
    returns: "Liste des factures adressées au contact.",
  },
];

const CONTACT_SEARCH_DESCRIPTION = `Recherche des contacts (interlocuteurs clients / prospects) dans BoondManager avec filtres serveur.

Cas d'usage courants :
• **Mes contacts** sans connaître son propre ID : \`perimeterDynamic: ["data"]\`. Pour "contacts gérés par X" : \`perimeterManagers: [<X_id>]\`.
• **Contacts d'une société donnée** : utiliser \`keywords: "CSOC<companyId>"\` (préfixe CSOC + ID). Exemple : \`keywords: "CSOC6420"\` pour la société 6420.
• **États / types** : \`states: [<id>]\` (dictionnaire \`setting.state.contact\`), \`typesOf: [<id>]\` (⚠️ avec un 's' final, dictionnaire \`setting.typeOf.contact\`), \`companyStates\` (états des sociétés rattachées). IDs entiers.
• **Profil métier** : \`activityAreas\`, \`expertiseAreas\`, \`tools\`, \`origins\` (sources), \`influencers\`.
• **Période** : \`period: "created"|"updated"|"withActions"|"withoutActions"|"noAction"\` + \`startDate\`/\`endDate\`.
• **Complétude** : \`completeness: ["email:empty","phone:empty"]\` (OU par défaut, '#AND#' en 1er pour ET) — utile pour "contacts sans email".
• **Recherche par nom** : \`keywords: "Dupont"\` + \`keywordsType: "lastName"\` (ou firstName, fullName \`"NOM#PRENOM"\`, companyFullName \`"CSOCid#NOM#PRENOM"\`, emails, phones, socialNetworks).

Tri : \`sort\` + \`order\`.

Returns : liste paginée des contacts. Utiliser \`boond_contacts_get\` ou les outils d'onglets pour le détail.`;

export function registerContactTools(server: McpServer): void {
  registerSearchTool(server, OPTS, {
    schema: ContactSearchSchema,
    description: CONTACT_SEARCH_DESCRIPTION,
  });
  registerGetTool(server, OPTS);

  registerCreateTool(server, OPTS, ContactCreateSchema, (params) => {
    const { companyId, ...attrs } = params;
    const body = buildJsonApiBody("contact", attrs);
    if (companyId) {
      (body as Record<string, Record<string, unknown>>).data.relationships = {
        company: { data: { id: companyId as string, type: "company" } },
      };
    }
    return body;
  });

  // Updates go through PUT /contacts/{id}/information — the base resource
  // returns 405 on PATCH (issue #134, same root cause as #124). buildJsonApiBody
  // drops undefined values, so PUT still only touches the supplied fields.
  registerUpdateTool(
    server,
    OPTS,
    ContactUpdateSchema,
    (params) => {
      const { id, ...attrs } = params;
      return buildJsonApiBody("contact", attrs, id as string);
    },
    { method: "PUT", pathSuffix: "information" }
  );

  registerDeleteTool(server, OPTS);

  registerTabTools(server, { ...OPTS, prefix: OPTS.prefix }, CONTACT_TABS);
}
