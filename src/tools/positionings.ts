import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  PositioningSearchSchema,
  PositioningCreateSchema,
  PositioningUpdateSchema,
  IdSchema,
} from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody, registerDeleteTool, MutationOutputSchema } from "./crud-factory.js";

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

  // Update positioning — registration dédiée : l'API officielle attend un PUT sur
  // /positionings/{id} (schemas/positionings/bodyPut.json), là où la factory
  // registerUpdateTool envoie un PATCH. Le reste du contrat (annotations,
  // MutationOutputSchema, structuredContent) reproduit celui de la factory.
  server.registerTool(
    "boond_positionings_update",
    {
      title: "Modifier un positionnement",
      description: `Met à jour un positionnement existant dans BoondManager (PUT /positionings/{id}). Seuls les champs fournis sont modifiés.

Args:
  - id (string): ID du positionnement
  - state (number, optional): État du positionnement (ID du dictionnaire setting.state.positioning)
  - stateReasonTypeOf, stateReasonDetail (optional): Motif d'état (repliés en stateReason {typeOf, detail})
  - startDate, endDate (string, optional): Dates au format YYYY-MM-DD (chaîne vide pour effacer)
  - informationComments (string, optional): Commentaires (max 250 caractères)

Returns: Données mises à jour du positionnement.`,
      inputSchema: PositioningUpdateSchema,
      outputSchema: MutationOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const { id, stateReasonTypeOf, stateReasonDetail, ...rest } = params;
      const attrs: Record<string, unknown> = { ...rest };
      if (stateReasonTypeOf !== undefined || stateReasonDetail !== undefined) {
        attrs.stateReason = {
          ...(stateReasonTypeOf !== undefined ? { typeOf: stateReasonTypeOf } : {}),
          ...(stateReasonDetail !== undefined ? { detail: stateReasonDetail } : {}),
        };
      }
      const body = buildJsonApiBody("positioning", attrs, id);
      const response = await apiRequest(`/positionings/${id}`, "PUT", body);
      const entity = Array.isArray(response.data) ? response.data[0] : response.data;
      const ref: { id: string; type?: string } = { id };
      if (entity?.type !== undefined) ref.type = String(entity.type);
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Positionnement #${id} mis à jour.\n\n${formatDetailResponse(response)}`,
          },
        ],
        structuredContent: ref,
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
