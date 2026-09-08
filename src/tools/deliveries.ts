import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DeliverySearchSchema, IdSchema } from "../schemas/index.js";
import {
  apiRequest,
  apiSearch,
  buildSearchQuery,
  formatListResponse,
  formatDetailResponse,
} from "../services/boond-client.js";
import { progressReporterFrom } from "../services/progress.js";
import { buildJsonApiBody } from "./crud-factory.js";
import { z } from "zod";
import { composeDescription, defaultGetDescription } from "./description-builders.js";

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
      description: composeDescription({
        purpose: "Crée une prestation (livraison) rattachée à un projet et à une ressource.",
        when: "pour ouvrir la ligne de mission qui rendra la ressource facturable sur ce projet.",
        instead: "`boond_projects_deliveries_groupments` pour lister les prestations déjà en place sur le projet.",
        behaviour: [
          "`project` et `resource` sont obligatoires et attendent des ID numériques.",
          "L'ID de prestation retourné est celui qu'exigent les lignes de note de frais (`boond_expenses_create`).",
          "Écriture non idempotente.",
        ],
        returns: "confirmation et fiche de la prestation créée.",
      }),
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
    async (params, extra: unknown) => {
      const query = buildSearchQuery(params);
      const response = await apiSearch("/deliveries-groupments", query, progressReporterFrom(extra));
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "livraison", params.fields) }],
      };
    }
  );

  server.registerTool(
    "boond_deliveries_get",
    {
      title: "Details d'une livraison / CRA",
      description: defaultGetDescription({
        ...{ entityName: "livraison (CRA)", entityNamePlural: "livraisons", prefix: "boond_deliveries" },
        withTab: false,
      }),
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
