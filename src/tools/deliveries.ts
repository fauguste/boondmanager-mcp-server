import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DeliverySearchSchema, IdSchema } from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody } from "./crud-factory.js";
import { z } from "zod";

const DeliveryCreateSchema = z
  .object({
    projectId: z.string().min(1).describe("ID du projet"),
    resourceId: z.string().min(1).describe("ID de la ressource portee par la prestation"),
    title: z.string().optional().describe("Titre de la prestation/livraison"),
    typeOf: z.number().int().optional().describe("Type de prestation"),
    state: z.number().int().optional().describe("Etat"),
    startDate: z.string().optional().describe("Date de debut (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
    quantity: z.number().optional().describe("Nombre de jours / quantite"),
    unitPrice: z.number().optional().describe("Prix journalier HT"),
    averageDailyCost: z.number().optional().describe("Cout journalier moyen"),
    forceAverageDailyPriceExcludingTax: z.boolean().optional().describe("Forcer le prix journalier HT"),
    note: z.string().optional().describe("Notes, mappees vers informationComments"),
  })
  .strict();

export function registerDeliveryTools(server: McpServer): void {
  server.registerTool(
    "boond_deliveries_create",
    {
      title: "Creer une prestation/livraison",
      description: "Cree une prestation Boond via POST /deliveries, liee a un projet et une ressource.",
      inputSchema: DeliveryCreateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const { projectId, resourceId, quantity, unitPrice, note, ...attrs } = params;
      const apiAttrs = {
        ...attrs,
        ...(quantity !== undefined ? { numberOfDaysInvoicedOrQuantity: quantity } : {}),
        ...(unitPrice !== undefined ? { averageDailyPriceExcludingTax: unitPrice } : {}),
        ...(unitPrice !== undefined ? { forceAverageDailyPriceExcludingTax: true } : {}),
        ...(note ? { informationComments: note } : {}),
      };
      const body = buildJsonApiBody("delivery", apiAttrs);
      (body as Record<string, Record<string, unknown>>).data.relationships = {
        project: { data: { id: projectId, type: "project" } },
        dependsOn: { data: { id: resourceId, type: "resource" } },
      };
      const response = await apiRequest("/deliveries", "POST", body);
      const entity = Array.isArray(response.data) ? response.data[0] : response.data;
      return {
        content: [
          {
            type: "text" as const,
            text: `Prestation/livraison creee avec succes.\nID: ${entity?.id}\n\n${formatDetailResponse(response)}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "boond_deliveries_search",
    {
      title: "Rechercher des livraisons / CRA",
      description: `Recherche des livraisons (comptes rendus d'activite) dans BoondManager avec filtres par projet, societe et periode.

Args:
  - keywords (string, optional): Termes de recherche
  - projectId, companyId (string, optional): Filtrer par entite liee
  - startDate, endDate (string, optional): Periode (YYYY-MM-DD)
  - page, pageSize: Pagination

Returns: Liste des livraisons correspondantes.`,
      inputSchema: DeliverySearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const query = buildSearchQuery(params);
      const response = await apiRequest("/deliveries-groupments", "GET", undefined, query);
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "livraison") }],
      };
    }
  );

  server.registerTool(
    "boond_deliveries_get",
    {
      title: "Details d'une livraison / CRA",
      description: "Recupere les informations detaillees d'une livraison (CRA) par son ID.",
      inputSchema: IdSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const response = await apiRequest(`/deliveries/${params.id}`);
      return {
        content: [{ type: "text" as const, text: formatDetailResponse(response) }],
      };
    }
  );
}
