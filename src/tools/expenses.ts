import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ExpenseSearchSchema, ExpenseCreateSchema, ExpenseUpdateSchema, IdSchema } from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody, registerDeleteTool } from "./crud-factory.js";

export function registerExpenseTools(server: McpServer): void {
  // Search expenses
  server.registerTool(
    "boond_expenses_search",
    {
      title: "Rechercher des notes de frais",
      description: `Recherche des notes de frais dans BoondManager avec filtres par ressource, projet et période.

Args:
  - keywords (string, optional): Termes de recherche
  - resourceId, projectId (string, optional): Filtrer par entité liée
  - startDate, endDate (string, optional): Période (YYYY-MM-DD)
  - page, pageSize: Pagination

Returns: Liste des notes de frais correspondantes.`,
      inputSchema: ExpenseSearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const query = buildSearchQuery(params);
      const response = await apiRequest("/expenses", "GET", undefined, query);
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "note de frais") }],
      };
    }
  );

  // Get expense details
  server.registerTool(
    "boond_expenses_get",
    {
      title: "Détails d'une note de frais",
      description: `Récupère les informations détaillées d'une note de frais par son ID.`,
      inputSchema: IdSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const response = await apiRequest(`/expenses-reports/${params.id}`);
      return {
        content: [{ type: "text" as const, text: formatDetailResponse(response) }],
      };
    }
  );

  // Create expense
  server.registerTool(
    "boond_expenses_create",
    {
      title: "Créer une note de frais",
      description: `Crée une nouvelle note de frais dans BoondManager, liée à une ressource et optionnellement un projet.`,
      inputSchema: ExpenseCreateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const { resourceId, projectId, ...attrs } = params;
      const body = buildJsonApiBody("expense", attrs);
      const relationships: Record<string, unknown> = {};
      if (resourceId) relationships.resource = { data: { id: resourceId, type: "resource" } };
      if (projectId) relationships.project = { data: { id: projectId, type: "project" } };
      if (Object.keys(relationships).length > 0) {
        (body as Record<string, Record<string, unknown>>).data.relationships = relationships;
      }
      const response = await apiRequest("/expenses-reports", "POST", body);
      const entity = Array.isArray(response.data) ? response.data[0] : response.data;
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Note de frais créée avec succès.\nID: ${entity?.id}\n\n${formatDetailResponse(response)}`,
          },
        ],
      };
    }
  );

  // Update expense
  server.registerTool(
    "boond_expenses_update",
    {
      title: "Modifier une note de frais",
      description: `Met à jour une note de frais existante. Seuls les champs fournis sont modifiés.`,
      inputSchema: ExpenseUpdateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const { id, ...attrs } = params;
      const body = buildJsonApiBody("expense", attrs, id);
      const response = await apiRequest(`/expenses-reports/${id}`, "PUT", body);
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Note de frais #${id} mise à jour.\n\n${formatDetailResponse(response)}`,
          },
        ],
      };
    }
  );

  // Delete expense — via la factory pour l'élicitation de confirmation + structuredContent
  registerDeleteTool(
    server,
    {
      entityName: "note de frais",
      entityNamePlural: "notes de frais",
      apiPath: "/expenses-reports",
      prefix: "boond_expenses",
    },
    {
      title: "Supprimer une note de frais",
      description: `Supprime une note de frais de BoondManager. ⚠️ Action irréversible. Si le client MCP supporte l'élicitation, une confirmation est demandée avant la suppression.`,
    }
  );
}
