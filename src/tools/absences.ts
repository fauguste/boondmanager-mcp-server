import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AbsenceSearchSchema, AbsenceCreateSchema, AbsenceUpdateSchema, IdSchema } from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody, registerDeleteTool } from "./crud-factory.js";

export function registerAbsenceTools(server: McpServer): void {
  // Search absences
  server.registerTool(
    "boond_absences_search",
    {
      title: "Rechercher des absences",
      description: `Recherche des absences (congés, RTT, maladie...) dans BoondManager avec filtres par ressource et période.

Args:
  - keywords (string, optional): Termes de recherche
  - resourceId (string, optional): Filtrer par ID ressource
  - startDate, endDate (string, optional): Période (YYYY-MM-DD)
  - page, pageSize: Pagination

Returns: Liste des absences correspondantes.`,
      inputSchema: AbsenceSearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const query = buildSearchQuery(params);
      const response = await apiRequest("/absences", "GET", undefined, query);
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "absence") }],
      };
    }
  );

  // Get absence details
  server.registerTool(
    "boond_absences_get",
    {
      title: "Détails d'une absence",
      description: `Récupère les informations détaillées d'une absence par son ID.`,
      inputSchema: IdSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const response = await apiRequest(`/absences-reports/${params.id}`);
      return {
        content: [{ type: "text" as const, text: formatDetailResponse(response) }],
      };
    }
  );

  // Create absence
  server.registerTool(
    "boond_absences_create",
    {
      title: "Créer une absence",
      description: `Crée une nouvelle demande d'absence dans BoondManager, liée à une ressource.`,
      inputSchema: AbsenceCreateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const { resourceId, ...attrs } = params;
      const body = buildJsonApiBody("absence", attrs);
      if (resourceId) {
        (body as Record<string, Record<string, unknown>>).data.relationships = {
          resource: { data: { id: resourceId, type: "resource" } },
        };
      }
      const response = await apiRequest("/absences-reports", "POST", body);
      const entity = Array.isArray(response.data) ? response.data[0] : response.data;
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Absence créée avec succès.\nID: ${entity?.id}\n\n${formatDetailResponse(response)}`,
          },
        ],
      };
    }
  );

  // Update absence
  server.registerTool(
    "boond_absences_update",
    {
      title: "Modifier une absence",
      description: `Met à jour une absence existante. Seuls les champs fournis sont modifiés.`,
      inputSchema: AbsenceUpdateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const { id, ...attrs } = params;
      const body = buildJsonApiBody("absence", attrs, id);
      const response = await apiRequest(`/absences-reports/${id}`, "PUT", body);
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Absence #${id} mise à jour.\n\n${formatDetailResponse(response)}`,
          },
        ],
      };
    }
  );

  // Delete absence — via la factory pour l'élicitation de confirmation + structuredContent
  registerDeleteTool(
    server,
    { entityName: "absence", entityNamePlural: "absences", apiPath: "/absences-reports", prefix: "boond_absences" },
    {
      title: "Supprimer une absence",
      description: `Supprime une absence de BoondManager. ⚠️ Action irréversible. Si le client MCP supporte l'élicitation, une confirmation est demandée avant la suppression.`,
    }
  );
}
