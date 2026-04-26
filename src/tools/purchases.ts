import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IdSchema } from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody } from "./crud-factory.js";
import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_SEARCH_PAGE } from "../constants.js";

const PurchaseSearchSchema = z.object({
  keywords: z.string().optional().describe("Mots-clés de recherche"),
  companyId: z.string().optional().describe("Filtrer par ID société"),
  projectId: z.string().optional().describe("Filtrer par ID projet"),
  page: z.number().int().min(1).max(MAX_SEARCH_PAGE).default(1).describe(`Numéro de page (max: ${MAX_SEARCH_PAGE})`),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Résultats par page"),
}).strict();

const PurchaseCreateSchema = z.object({
  companyId: z.string().optional().describe("ID de la société fournisseur"),
  projectId: z.string().optional().describe("ID du projet associé"),
  state: z.number().int().optional().describe("État de l'achat"),
  startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
  endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
  note: z.string().optional().describe("Notes / commentaires"),
}).strict();

export function registerPurchaseTools(server: McpServer): void {
  server.registerTool(
    "boond_purchases_search",
    {
      title: "Rechercher des achats/sous-traitance",
      description: `Recherche des achats et sous-traitances dans BoondManager.

Args:
  - keywords, companyId, projectId: Filtres
  - page, pageSize: Pagination

Returns: Liste des achats correspondants.`,
      inputSchema: PurchaseSearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const query = buildSearchQuery(params);
      const response = await apiRequest("/purchases", "GET", undefined, query);
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "achat") }],
      };
    }
  );

  server.registerTool(
    "boond_purchases_get",
    {
      title: "Détails d'un achat/sous-traitance",
      description: `Récupère les informations détaillées d'un achat par son ID.`,
      inputSchema: IdSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const response = await apiRequest(`/purchases/${params.id}`);
      return {
        content: [{ type: "text" as const, text: formatDetailResponse(response) }],
      };
    }
  );

  server.registerTool(
    "boond_purchases_create",
    {
      title: "Créer un achat/sous-traitance",
      description: `Crée un nouvel achat ou sous-traitance dans BoondManager.`,
      inputSchema: PurchaseCreateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const { companyId, projectId, ...attrs } = params;
      const body = buildJsonApiBody("purchase", attrs);
      const relationships: Record<string, unknown> = {};
      if (companyId) relationships.company = { data: { id: companyId, type: "company" } };
      if (projectId) relationships.project = { data: { id: projectId, type: "project" } };
      if (Object.keys(relationships).length > 0) {
        (body as Record<string, Record<string, unknown>>).data.relationships = relationships;
      }
      const response = await apiRequest("/purchases", "POST", body);
      const entity = Array.isArray(response.data) ? response.data[0] : response.data;
      return {
        content: [{
          type: "text" as const,
          text: `✅ Achat créé avec succès.\nID: ${entity?.id}\n\n${formatDetailResponse(response)}`,
        }],
      };
    }
  );

  server.registerTool(
    "boond_purchases_delete",
    {
      title: "Supprimer un achat/sous-traitance",
      description: `Supprime un achat de BoondManager. ⚠️ Action irréversible.`,
      inputSchema: IdSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      await apiRequest(`/purchases/${params.id}`, "DELETE");
      return {
        content: [{ type: "text" as const, text: `🗑️ Achat #${params.id} supprimé.` }],
      };
    }
  );
}
