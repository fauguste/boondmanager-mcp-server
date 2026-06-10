import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PositioningSearchSchema, PositioningCreateSchema, IdSchema } from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody, registerDeleteTool } from "./crud-factory.js";

export function registerPositioningTools(server: McpServer): void {
  // Search positionings
  server.registerTool(
    "boond_positionings_search",
    {
      title: "Rechercher des positionnements",
      description: `Recherche des positionnements (placement de candidats/ressources sur des projets/opportunités) dans BoondManager.

Args:
  - keywords (string, optional): Termes de recherche
  - candidateId, resourceId, projectId, opportunityId (string, optional): Filtrer par entité liée
  - page, pageSize: Pagination

Returns: Liste des positionnements correspondants.`,
      inputSchema: PositioningSearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const query = buildSearchQuery(params);
      const response = await apiRequest("/positionings", "GET", undefined, query);
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "positionnement") }],
      };
    }
  );

  // Get positioning details
  server.registerTool(
    "boond_positionings_get",
    {
      title: "Détails d'un positionnement",
      description: `Récupère les informations détaillées d'un positionnement par son ID.`,
      inputSchema: IdSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const response = await apiRequest(`/positionings/${params.id}`);
      return {
        content: [{ type: "text" as const, text: formatDetailResponse(response) }],
      };
    }
  );

  // Create positioning
  server.registerTool(
    "boond_positionings_create",
    {
      title: "Créer un positionnement",
      description: `Crée un nouveau positionnement pour placer un candidat ou une ressource sur un projet ou une opportunité.`,
      inputSchema: PositioningCreateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const { candidateId, resourceId, projectId, opportunityId, ...attrs } = params;
      const body = buildJsonApiBody("positioning", attrs);
      const relationships: Record<string, unknown> = {};
      if (candidateId) relationships.candidate = { data: { id: candidateId, type: "candidate" } };
      if (resourceId) relationships.resource = { data: { id: resourceId, type: "resource" } };
      if (projectId) relationships.project = { data: { id: projectId, type: "project" } };
      if (opportunityId) relationships.opportunity = { data: { id: opportunityId, type: "opportunity" } };
      if (Object.keys(relationships).length > 0) {
        (body as Record<string, Record<string, unknown>>).data.relationships = relationships;
      }
      const response = await apiRequest("/positionings", "POST", body);
      const entity = Array.isArray(response.data) ? response.data[0] : response.data;
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Positionnement créé avec succès.\nID: ${entity?.id}\n\n${formatDetailResponse(response)}`,
          },
        ],
      };
    }
  );

  // Delete positioning — via la factory pour l'élicitation de confirmation + structuredContent
  registerDeleteTool(
    server,
    {
      entityName: "positionnement",
      entityNamePlural: "positionnements",
      apiPath: "/positionings",
      prefix: "boond_positionings",
    },
    {
      title: "Supprimer un positionnement",
      description: `Supprime un positionnement de BoondManager. ⚠️ Action irréversible. Si le client MCP supporte l'élicitation, une confirmation est demandée avant la suppression.`,
    }
  );
}
