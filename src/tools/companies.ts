import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CompanyCreateSchema, CompanyUpdateSchema, CompanySearchSchema, IdSchema } from "../schemas/index.js";
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
  entityName: "société",
  entityNamePlural: "sociétés",
  apiPath: "/companies",
  prefix: "boond_companies",
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

const COMPANY_TABS: TabDefinition[] = [
  {
    name: "information",
    tab: "information",
    title: "Informations générales d'une société",
    description: `Récupère les informations générales d'une société (coordonnées, SIRET, site web, secteur, taille, tags...).

Args:
  - id (string): ID de la société

Returns: Données générales de la société.`,
  },
  {
    name: "contacts",
    tab: "contacts",
    title: "Contacts d'une société",
    description: `Récupère les contacts associés à une société.

Args:
  - id (string): ID de la société

Returns: Liste des contacts de la société.`,
  },
  {
    name: "actions",
    tab: "actions",
    title: "Actions liées à une société",
    description: `Récupère les actions (appels, emails, RDV, notes) associées à une société.

Args:
  - id (string): ID de la société

Returns: Liste des actions liées à la société.`,
  },
  {
    name: "opportunities",
    tab: "opportunities",
    title: "Opportunités d'une société",
    description: `Récupère les opportunités commerciales d'une société.

Args:
  - id (string): ID de la société

Returns: Liste des opportunités de la société.`,
  },
  {
    name: "projects",
    tab: "projects",
    title: "Projets d'une société",
    description: `Récupère les projets associés à une société.

Args:
  - id (string): ID de la société

Returns: Liste des projets de la société.`,
  },
  {
    name: "orders",
    tab: "orders",
    title: "Bons de commande d'une société",
    description: `Récupère les bons de commande d'une société.

Args:
  - id (string): ID de la société

Returns: Liste des bons de commande de la société.`,
  },
  {
    name: "invoices",
    tab: "invoices",
    title: "Factures d'une société",
    description: `Récupère les factures d'une société.

Args:
  - id (string): ID de la société

Returns: Liste des factures de la société.`,
  },
  {
    name: "purchases",
    tab: "purchases",
    title: "Achats d'une société",
    description: `Récupère les achats/sous-traitance d'une société.

Args:
  - id (string): ID de la société

Returns: Liste des achats de la société.`,
  },
  {
    name: "provider_invoices",
    tab: "provider-invoices",
    title: "Factures fournisseur d'une société",
    description: `Récupère les factures fournisseur d'une société.

Args:
  - id (string): ID de la société

Returns: Liste des factures fournisseur de la société.`,
  },
];

const COMPANY_SEARCH_DESCRIPTION = `Recherche des sociétés (clients, prospects, fournisseurs…) dans BoondManager avec filtres serveur.

⚠️ Utilisez les filtres structurés plutôt que la pagination intégrale. Les noms de paramètres sont ceux exacts de l'API.

Cas d'usage courants :
• **Mes comptes** sans connaître son propre ID : \`perimeterDynamic: ["data"]\`. Pour "comptes gérés par X" : \`perimeterManagers: [<X_id>]\`.
• **États** : \`states: [<id>]\` (dictionnaire \`setting.state.company\`). IDs entiers.
• **Périmètre orga** : \`perimeterAgencies\`, \`perimeterPoles\`, \`perimeterBusinessUnits\`. \`narrowPerimeter: true\` pour ET.
• **Segmentation métier** : \`expertiseAreas\` (dictionnaire \`setting.expertiseArea\`), \`origins\`, \`influencers\`.
• **Période** : \`period: "created"|"updated"|"withActions"|"withoutActions"|"noAction"\` + \`startDate\`/\`endDate\`.
• **Recherche** : \`keywords\` + \`keywordsType\` ('default' = nom/ville/pays/expertise/info, ou 'name', 'phones', 'emails', 'socialNetworks'). Pour cibler une société par ID : \`keywords: "CSOC<id>"\`.

Pagination : \`page\`, \`pageSize\` (max 500). Tri : \`sort\` + \`order\`.

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

  registerUpdateTool(server, OPTS, CompanyUpdateSchema, (params) => {
    const { id, ...attrs } = params;
    return buildJsonApiBody("company", attrs, id as string);
  });

  registerDeleteTool(server, OPTS);

  // Register one tool per company tab
  for (const tab of COMPANY_TABS) {
    server.registerTool(
      `boond_companies_${tab.name}`,
      {
        title: tab.title,
        description: tab.description,
        inputSchema: IdSchema,
        annotations: TAB_TOOL_ANNOTATIONS,
      },
      async (params: IdInput) => {
        const response = await apiRequest(`/companies/${params.id}/${tab.tab}`);
        const text = formatTabResponse(response);
        return {
          content: [{ type: "text" as const, text }],
        };
      }
    );
  }
}
