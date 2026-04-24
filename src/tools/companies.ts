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
import { apiRequest, formatDetailResponse } from "../services/boond-client.js";

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

const COMPANY_SEARCH_DESCRIPTION = `Recherche des sociétés (clients, prospects, fournisseurs...) dans BoondManager avec filtres avancés.

⚠️ Privilégier les filtres structurés plutôt que de paginer toute la base.

Filtres utiles :
• \`mainManagers\` : ID(s) des commerciaux responsables (utile pour "mes comptes" → passer votre userId via \`boond_application_current_user\`).
• \`states\` : états de société.
• \`typeOf\` : types de société (client, prospect, fournisseur...).
• \`activityAreas\` : secteurs d'activité.
• \`origins\` : sources / origines.
• \`agencies\`, \`poles\`, \`businessUnits\` : périmètre organisationnel.
• \`keywords\` : recherche plein texte (nom, SIRET, email), en complément.

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
        const text = formatDetailResponse(response);
        return {
          content: [{ type: "text" as const, text }],
        };
      }
    );
  }
}
