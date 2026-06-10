import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OrderSearchSchema, OrderCreateSchema, OrderUpdateSchema, IdSchema } from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody, registerDeleteTool } from "./crud-factory.js";

export function registerOrderTools(server: McpServer): void {
  // Search orders
  server.registerTool(
    "boond_orders_search",
    {
      title: "Rechercher des bons de commande",
      description: `Recherche des bons de commande dans BoondManager avec filtres par société et projet.

Args:
  - keywords (string, optional): Termes de recherche
  - companyId, projectId (string, optional): Filtrer par entité liée
  - page, pageSize: Pagination

Returns: Liste des bons de commande correspondants.`,
      inputSchema: OrderSearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const query = buildSearchQuery(params);
      const response = await apiRequest("/orders", "GET", undefined, query);
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "bon de commande") }],
      };
    }
  );

  // Get order details
  server.registerTool(
    "boond_orders_get",
    {
      title: "Détails d'un bon de commande",
      description: `Récupère les informations détaillées d'un bon de commande par son ID.`,
      inputSchema: IdSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const response = await apiRequest(`/orders/${params.id}`);
      return {
        content: [{ type: "text" as const, text: formatDetailResponse(response) }],
      };
    }
  );

  // Create order
  server.registerTool(
    "boond_orders_create",
    {
      title: "Créer un bon de commande",
      description: `Crée un nouveau bon de commande dans BoondManager, optionnellement lié à une société et un projet.`,
      inputSchema: OrderCreateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const { companyId, projectId, ...attrs } = params;
      const body = buildJsonApiBody("order", attrs);
      const relationships: Record<string, unknown> = {};
      if (companyId) relationships.company = { data: { id: companyId, type: "company" } };
      if (projectId) relationships.project = { data: { id: projectId, type: "project" } };
      if (Object.keys(relationships).length > 0) {
        (body as Record<string, Record<string, unknown>>).data.relationships = relationships;
      }
      const response = await apiRequest("/orders", "POST", body);
      const entity = Array.isArray(response.data) ? response.data[0] : response.data;
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Bon de commande créé avec succès.\nID: ${entity?.id}\n\n${formatDetailResponse(response)}`,
          },
        ],
      };
    }
  );

  // Update order
  server.registerTool(
    "boond_orders_update",
    {
      title: "Modifier un bon de commande",
      description: `Met à jour un bon de commande existant. Seuls les champs fournis sont modifiés.`,
      inputSchema: OrderUpdateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const { id, ...attrs } = params;
      const body = buildJsonApiBody("order", attrs, id);
      const response = await apiRequest(`/orders/${id}`, "PATCH", body);
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Bon de commande #${id} mis à jour.\n\n${formatDetailResponse(response)}`,
          },
        ],
      };
    }
  );

  // Delete order — via la factory pour l'élicitation de confirmation + structuredContent
  registerDeleteTool(
    server,
    { entityName: "bon de commande", entityNamePlural: "bons de commande", apiPath: "/orders", prefix: "boond_orders" },
    {
      title: "Supprimer un bon de commande",
      description: `Supprime un bon de commande de BoondManager. ⚠️ Action irréversible. Si le client MCP supporte l'élicitation, une confirmation est demandée avant la suppression.`,
    }
  );
}
