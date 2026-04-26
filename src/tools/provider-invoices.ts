import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IdSchema } from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";
import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_SEARCH_PAGE } from "../constants.js";

const ProviderInvoiceSearchSchema = z.object({
  keywords: z.string().optional().describe("Mots-clés de recherche"),
  companyId: z.string().optional().describe("Filtrer par ID société fournisseur"),
  page: z.number().int().min(1).max(MAX_SEARCH_PAGE).default(1).describe(`Numéro de page (max: ${MAX_SEARCH_PAGE})`),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Résultats par page"),
}).strict();

export function registerProviderInvoiceTools(server: McpServer): void {
  server.registerTool(
    "boond_provider_invoices_search",
    {
      title: "Rechercher des factures fournisseur",
      description: `Recherche des factures fournisseur dans BoondManager.

Returns: Liste des factures fournisseur correspondantes.`,
      inputSchema: ProviderInvoiceSearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const query = buildSearchQuery(params);
      const response = await apiRequest("/provider-invoices", "GET", undefined, query);
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "facture fournisseur") }],
      };
    }
  );

  server.registerTool(
    "boond_provider_invoices_get",
    {
      title: "Détails d'une facture fournisseur",
      description: `Récupère les informations détaillées d'une facture fournisseur par son ID.`,
      inputSchema: IdSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const response = await apiRequest(`/provider-invoices/${params.id}`);
      return {
        content: [{ type: "text" as const, text: formatDetailResponse(response) }],
      };
    }
  );
}
