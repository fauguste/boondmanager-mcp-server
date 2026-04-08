import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InvoiceSearchSchema, InvoiceCreateSchema, InvoiceUpdateSchema, IdSchema } from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody } from "./crud-factory.js";

export function registerInvoiceTools(server: McpServer): void {
  // Search invoices
  server.registerTool(
    "boond_invoices_search",
    {
      title: "Rechercher des factures",
      description: `Recherche des factures dans BoondManager avec filtres par société, projet et période.

Args:
  - keywords (string, optional): Termes de recherche (référence, société...)
  - companyId, projectId (string, optional): Filtrer par entité liée
  - startDate, endDate (string, optional): Période (YYYY-MM-DD)
  - page, pageSize: Pagination

Returns: Liste des factures correspondantes.`,
      inputSchema: InvoiceSearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const query = buildSearchQuery(params);
      if (params.startDate) query["startDate"] = params.startDate;
      if (params.endDate) query["endDate"] = params.endDate;
      query["period"] = params.period || "period";
      const response = await apiRequest("/invoices", "GET", undefined, query);
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "facture") }],
      };
    }
  );

  // Get invoice details
  server.registerTool(
    "boond_invoices_get",
    {
      title: "Détails d'une facture",
      description: `Récupère les informations détaillées d'une facture par son ID.`,
      inputSchema: IdSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const response = await apiRequest(`/invoices/${params.id}`);
      return {
        content: [{ type: "text" as const, text: formatDetailResponse(response) }],
      };
    }
  );

  // Create invoice
  server.registerTool(
    "boond_invoices_create",
    {
      title: "Créer une facture",
      description: `Crée une nouvelle facture dans BoondManager, optionnellement liée à une société et un projet.`,
      inputSchema: InvoiceCreateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const { companyId, projectId, ...attrs } = params;
      const body = buildJsonApiBody("invoice", attrs);
      const relationships: Record<string, unknown> = {};
      if (companyId) relationships.company = { data: { id: companyId, type: "company" } };
      if (projectId) relationships.project = { data: { id: projectId, type: "project" } };
      if (Object.keys(relationships).length > 0) {
        (body as Record<string, Record<string, unknown>>).data.relationships = relationships;
      }
      const response = await apiRequest("/invoices", "POST", body);
      const entity = Array.isArray(response.data) ? response.data[0] : response.data;
      return {
        content: [{
          type: "text" as const,
          text: `✅ Facture créée avec succès.\nID: ${entity?.id}\n\n${formatDetailResponse(response)}`,
        }],
      };
    }
  );

  // Update invoice
  server.registerTool(
    "boond_invoices_update",
    {
      title: "Modifier une facture",
      description: `Met à jour une facture existante. Seuls les champs fournis sont modifiés.`,
      inputSchema: InvoiceUpdateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const { id, ...attrs } = params;
      const body = buildJsonApiBody("invoice", attrs, id);
      const response = await apiRequest(`/invoices/${id}`, "PATCH", body);
      return {
        content: [{
          type: "text" as const,
          text: `✅ Facture #${id} mise à jour.\n\n${formatDetailResponse(response)}`,
        }],
      };
    }
  );

  // Delete invoice
  server.registerTool(
    "boond_invoices_delete",
    {
      title: "Supprimer une facture",
      description: `Supprime une facture de BoondManager. ⚠️ Action irréversible.`,
      inputSchema: IdSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      await apiRequest(`/invoices/${params.id}`, "DELETE");
      return {
        content: [{ type: "text" as const, text: `🗑️ Facture #${params.id} supprimée.` }],
      };
    }
  );
}
