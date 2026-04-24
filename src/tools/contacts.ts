import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ContactCreateSchema, ContactUpdateSchema, ContactSearchSchema, IdSchema } from "../schemas/index.js";
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
  entityName: "contact",
  entityNamePlural: "contacts",
  apiPath: "/contacts",
  prefix: "boond_contacts",
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

const CONTACT_TABS: TabDefinition[] = [
  {
    name: "information",
    tab: "information",
    title: "Informations générales d'un contact",
    description: `Récupère les informations générales d'un contact (coordonnées, société, fonction, tags...).

Args:
  - id (string): ID du contact

Returns: Données personnelles et professionnelles du contact.`,
  },
  {
    name: "actions",
    tab: "actions",
    title: "Actions liées à un contact",
    description: `Récupère les actions (appels, emails, RDV, notes) associées à un contact.

Args:
  - id (string): ID du contact

Returns: Liste des actions liées au contact.`,
  },
  {
    name: "opportunities",
    tab: "opportunities",
    title: "Opportunités d'un contact",
    description: `Récupère les opportunités commerciales associées à un contact.

Args:
  - id (string): ID du contact

Returns: Liste des opportunités du contact.`,
  },
  {
    name: "projects",
    tab: "projects",
    title: "Projets d'un contact",
    description: `Récupère les projets associés à un contact.

Args:
  - id (string): ID du contact

Returns: Liste des projets du contact.`,
  },
  {
    name: "orders",
    tab: "orders",
    title: "Bons de commande d'un contact",
    description: `Récupère les bons de commande associés à un contact.

Args:
  - id (string): ID du contact

Returns: Liste des bons de commande du contact.`,
  },
  {
    name: "invoices",
    tab: "invoices",
    title: "Factures d'un contact",
    description: `Récupère les factures associées à un contact.

Args:
  - id (string): ID du contact

Returns: Liste des factures du contact.`,
  },
];

const CONTACT_SEARCH_DESCRIPTION = `Recherche des contacts (interlocuteurs clients / prospects) dans BoondManager avec filtres avancés.

⚠️ Privilégier les filtres structurés plutôt que de paginer toute la base.

Filtres utiles :
• \`mainManagers\` : ID(s) des commerciaux responsables (utile pour "mes contacts" → passer votre userId via \`boond_application_current_user\`).
• \`company\` : tous les contacts d'une société donnée (ID unique).
• \`states\` : états de contact.
• \`typeOf\` : types de contact.
• \`origins\` : sources / origines.
• \`agencies\`, \`poles\`, \`businessUnits\` : périmètre organisationnel.
• \`keywords\` : recherche plein texte, en complément.

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

  registerUpdateTool(server, OPTS, ContactUpdateSchema, (params) => {
    const { id, ...attrs } = params;
    return buildJsonApiBody("contact", attrs, id as string);
  });

  registerDeleteTool(server, OPTS);

  // Register one tool per contact tab
  for (const tab of CONTACT_TABS) {
    server.registerTool(
      `boond_contacts_${tab.name}`,
      {
        title: tab.title,
        description: tab.description,
        inputSchema: IdSchema,
        annotations: TAB_TOOL_ANNOTATIONS,
      },
      async (params: IdInput) => {
        const response = await apiRequest(`/contacts/${params.id}/${tab.tab}`);
        const text = formatDetailResponse(response);
        return {
          content: [{ type: "text" as const, text }],
        };
      }
    );
  }
}
