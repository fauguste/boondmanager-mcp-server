import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CompanyCreateSchema, CompanyUpdateSchema, CompanySearchSchema } from "../schemas/index.js";
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
  entityName: "société",
  entityNamePlural: "sociétés",
  apiPath: "/companies",
  prefix: "boond_companies",
};

const COMPANY_TABS: TabDefinition[] = [
  {
    name: "information",
    tab: "information",
    title: "Informations générales d'une société",
    subject: "les informations générales",
    content: "coordonnées, SIRET, site web, secteur, taille, tags",
    returns: "Fiche signalétique de la société.",
  },
  {
    name: "contacts",
    tab: "contacts",
    title: "Contacts d'une société",
    subject: "les contacts",
    content: "interlocuteurs rattachés à la société",
    returns: "Liste des contacts de la société.",
  },
  {
    name: "actions",
    tab: "actions",
    title: "Actions liées à une société",
    subject: "les actions",
    content: "appels, emails, RDV, notes",
    returns: "Liste des actions rattachées à la société.",
  },
  {
    name: "opportunities",
    tab: "opportunities",
    title: "Opportunités d'une société",
    subject: "les opportunités commerciales",
    returns: "Liste des opportunités de la société.",
  },
  {
    name: "projects",
    tab: "projects",
    title: "Projets d'une société",
    subject: "les projets",
    returns: "Liste des projets de la société.",
  },
  {
    name: "orders",
    tab: "orders",
    title: "Bons de commande d'une société",
    subject: "les bons de commande",
    returns: "Liste des bons de commande de la société.",
  },
  {
    name: "invoices",
    tab: "invoices",
    title: "Factures d'une société",
    subject: "les factures client",
    returns:
      "Liste des factures de vente adressées à la société. Ne pas confondre avec `boond_companies_provider_invoices` (achat).",
  },
  {
    name: "purchases",
    tab: "purchases",
    title: "Achats d'une société",
    subject: "les achats et la sous-traitance",
    returns: "Liste des achats engagés auprès de la société.",
  },
  {
    name: "provider_invoices",
    tab: "provider_invoices",
    title: "Factures fournisseur d'une société",
    subject: "les factures fournisseur",
    content: "factures reçues de la société en tant que prestataire",
    returns: "Liste des factures d'achat. Ne pas confondre avec `boond_companies_invoices` (vente).",
  },
];

const COMPANY_SEARCH_DESCRIPTION = `Recherche des sociétés (clients, prospects, fournisseurs…) dans BoondManager avec filtres serveur.

Cas d'usage courants :
• **Mes comptes** sans connaître son propre ID : \`perimeterDynamic: ["data"]\`. Pour "comptes gérés par X" : \`perimeterManagers: [<X_id>]\`.
• **États** : \`states: [<id>]\` (dictionnaire \`setting.state.company\`). IDs entiers.
• **Segmentation métier** : \`expertiseAreas\` (dictionnaire \`setting.expertiseArea\`), \`origins\`, \`influencers\`.
• **Période** : \`period: "created"|"updated"|"withActions"|"withoutActions"|"noAction"\` + \`startDate\`/\`endDate\`.
• **Recherche** : \`keywords\` + \`keywordsType\` ('default' = nom/ville/pays/expertise/info, ou 'name', 'phones', 'emails', 'socialNetworks'). Pour cibler une société par ID : \`keywords: "CSOC<id>"\`.

Tri : \`sort\` + \`order\`.

Note : il n'y a PAS de filtre \`typeOf\` pour les sociétés dans l'API search. Le type (client/prospect/fournisseur) doit être inféré via le détail de la société (\`boond_companies_get\`).

Returns : liste paginée des sociétés. Utiliser \`boond_companies_get\` ou les outils d'onglets pour le détail.`;

export function registerCompanyTools(server: McpServer): void {
  registerSearchTool(server, OPTS, {
    schema: CompanySearchSchema,
    description: COMPANY_SEARCH_DESCRIPTION,
  });
  registerGetTool(server, OPTS);

  registerCreateTool(server, OPTS, CompanyCreateSchema, (params) => {
    const { ...attrs } = params;
    return buildJsonApiBody("company", attrs);
  });

  // Updates go through PUT /companies/{id}/information — the base resource
  // returns 405 on PATCH (issue #134, same root cause as #124). buildJsonApiBody
  // drops undefined values, so PUT still only touches the supplied fields.
  registerUpdateTool(
    server,
    OPTS,
    CompanyUpdateSchema,
    (params) => {
      const { id, ...attrs } = params;
      return buildJsonApiBody("company", attrs, id as string);
    },
    { method: "PUT", pathSuffix: "information" }
  );

  registerDeleteTool(server, OPTS);

  registerTabTools(server, { ...OPTS, prefix: OPTS.prefix }, COMPANY_TABS);
}
