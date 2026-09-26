import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toKeywordReferences } from "./linked-entity-filters.js";
import {
  PositioningSearchSchema,
  PositioningCreateSchema,
  PositioningUpdateSchema,
  IdSchema,
} from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody, registerDeleteTool, MutationOutputSchema } from "./crud-factory.js";
import { composeDescription, defaultDeleteDescription, defaultGetDescription } from "./description-builders.js";

export function registerPositioningTools(server: McpServer): void {
  // Search positionings
  server.registerTool(
    "boond_positionings_search",
    {
      title: "Rechercher des positionnements",
      description: `Recherche des positionnements (placement de candidats/ressources sur des projets/opportunités) dans BoondManager.

L'API ne propose pas de paramètres de filtre dédiés : le filtrage par entité liée passe par des références dans \`keywords\` (AO<id>=opportunité, CAND<id>=candidat, COMP<id>=ressource, CSOC<id>=société, CCON<id>=contact, PROD<id>=produit). Les filtres *Id du schéma sont convertis automatiquement en ces références.

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
      // L'API GET /positionings n'a pas de paramètres candidateId/resourceId/... :
      // le filtrage par entité passe par des références dans `keywords`
      // (cf. RAML officiel). Les paramètres bruts seraient silencieusement ignorés.
      const query = buildSearchQuery(toKeywordReferences(params));
      const response = await apiRequest("/positionings", "GET", undefined, query);
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "positionnement", params.fields) }],
      };
    }
  );

  // Get positioning details
  server.registerTool(
    "boond_positionings_get",
    {
      title: "Détails d'un positionnement",
      description: defaultGetDescription({
        ...{ entityName: "positionnement", entityNamePlural: "positionnements", prefix: "boond_positionings" },
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
      description: composeDescription({
        purpose: "Crée un positionnement : place un candidat ou une ressource sur une opportunité ou un projet.",
        when: "pour matérialiser une proposition de profil au client.",
        instead:
          "`boond_positionings_update` pour faire avancer l'état d'un positionnement existant (proposé → retenu → refusé) plutôt que d'en créer un second.",
        behaviour: [
          "Écriture non idempotente : rien n'empêche deux positionnements du même profil sur la même affaire.",
          "L'état est un ID entier du dictionnaire (`boond://dictionary/states/positionings`), pas un libellé.",
        ],
        returns: "confirmation et fiche du positionnement créé.",
      }),
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
      const relationships: Record<string, { id: string; type: string } | undefined> = {};
      if (candidateId) relationships.dependsOn = { id: candidateId, type: "candidate" };
      if (resourceId) relationships.dependsOn = { id: resourceId, type: "resource" };
      if (projectId) relationships.project = { id: projectId, type: "project" };
      if (opportunityId) relationships.opportunity = { id: opportunityId, type: "opportunity" };
      const body = buildJsonApiBody("positioning", attrs, undefined, relationships);
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
      description: `Met à jour un positionnement existant dans BoondManager (PUT /positionings/{id}). Seuls les champs fournis sont modifiés ; \`stateReasonTypeOf\` / \`stateReasonDetail\` sont repliés en \`stateReason: { typeOf, detail }\`.

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
      description: defaultDeleteDescription({
        entityName: "positionnement",
        entityNamePlural: "positionnements",
        prefix: "boond_positionings",
      }),
    }
  );
}
