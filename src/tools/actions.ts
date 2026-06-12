import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ActionSearchSchema, ActionCreateSchema, IdSchema } from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody, registerDeleteTool } from "./crud-factory.js";
import { availableLabels, formatOverridesSummary, resolveLabel } from "../config/dictionary-overrides.js";

/** Display labels for the five entities an action can be attached to. */
const ACTION_ENTITY_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["Contact", "contact"],
  ["Candidat", "candidate"],
  ["Ressource", "resource"],
  ["Opportunité", "opportunity"],
  ["Projet", "project"],
];

/**
 * Append the custom typeOf labels (BOOND_DICTIONARY_OVERRIDES) to the create
 * tool description, as one compact block. Without overrides the base
 * description is returned unchanged (byte-for-byte).
 */
function buildActionCreateDescription(base: string): string {
  const parts: string[] = [];
  for (const [label, entity] of ACTION_ENTITY_LABELS) {
    const summary = formatOverridesSummary("action", entity);
    if (summary !== null) parts.push(`${label} : ${summary}`);
  }
  if (parts.length === 0) return base;
  return `${base}\nLibellés personnalisés acceptés pour typeOf (résolus automatiquement) : ${parts.join(" / ")}`;
}

export function registerActionTools(server: McpServer): void {
  // Search actions
  server.registerTool(
    "boond_actions_search",
    {
      title: "Rechercher des actions",
      description: `Recherche des actions (appels, emails, RDV, notes) dans BoondManager avec filtres optionnels par candidat, ressource, contact ou société.

Args:
  - keywords (string, optional): Termes de recherche
  - candidateId, resourceId, contactId, companyId (string, optional): Filtrer par entité liée
  - page, pageSize: Pagination

Returns: Liste des actions correspondantes.`,
      inputSchema: ActionSearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const query = buildSearchQuery(params);
      const response = await apiRequest("/actions", "GET", undefined, query);
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "action") }],
      };
    }
  );

  // Get action details
  server.registerTool(
    "boond_actions_get",
    {
      title: "Détails d'une action",
      description: `Récupère les détails d'une action par son ID.`,
      inputSchema: IdSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const response = await apiRequest(`/actions/${params.id}`);
      return {
        content: [{ type: "text" as const, text: formatDetailResponse(response) }],
      };
    }
  );

  // Create action
  server.registerTool(
    "boond_actions_create",
    {
      title: "Créer une action",
      description:
        buildActionCreateDescription(`Crée une nouvelle action (appel, email, RDV, note) dans BoondManager, rattachée à un contact, candidat, ressource, opportunité ou projet (relation dependsOn, obligatoire).

Args:
  - typeOf (number, requis): ID numérique du type d'action (dictionnaire setting.action.*, via boond_application_dictionary)
  - title, text (string, optional): Titre et contenu de l'action
  - startDate, endDate (string, optional): Dates ISO avec timezone (ex: 2026-06-05T10:00:00+0200)
  - contactId | candidateId | resourceId | opportunityId | projectId (string, un requis): Entité de rattachement
  - companyId (string, optional): Société, uniquement en complément d'un contactId

Returns: L'action créée avec son ID.`),
      inputSchema: ActionCreateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const { candidateId, resourceId, contactId, opportunityId, projectId, companyId, ...attrs } = params;
      // The API requires a polymorphic `dependsOn` relationship pointing to the
      // entity the action is attached to (422 "Missing required relationship"
      // otherwise). `company` is only accepted alongside a contact `dependsOn`.
      const dependsOnCandidates: Array<{ id: string | undefined; type: string }> = [
        { id: contactId, type: "contact" },
        { id: candidateId, type: "candidate" },
        { id: resourceId, type: "resource" },
        { id: opportunityId, type: "opportunity" },
        { id: projectId, type: "project" },
      ];
      const dependsOn = dependsOnCandidates.find((c) => c.id);
      if (!dependsOn) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "❌ L'API BoondManager exige de rattacher l'action à une entité (dependsOn). Fournissez l'un des paramètres : contactId, candidateId, resourceId, opportunityId ou projectId. (companyId seul ne suffit pas : une action ne peut pas être rattachée directement à une société, passez par un contact.)",
            },
          ],
        };
      }
      // Resolve a custom typeOf label (BOOND_DICTIONARY_OVERRIDES) to its
      // numeric dictionary id. The labels are declared per attached entity
      // (setting.action.<entity>), hence the resolution after dependsOn.
      if (typeof attrs.typeOf === "string") {
        const resolved = resolveLabel("action", dependsOn.type, attrs.typeOf);
        if (resolved === undefined) {
          const labels = availableLabels("action", dependsOn.type);
          const hint =
            labels.length > 0
              ? `Libellés personnalisés disponibles pour ${dependsOn.type} : ${labels.join(", ")}. Sinon, utilisez l'ID numérique du dictionnaire (setting.action.*, via boond_application_dictionary).`
              : `Aucun libellé personnalisé n'est configuré pour ${dependsOn.type} : utilisez l'ID numérique du dictionnaire (setting.action.*, via boond_application_dictionary), ou déclarez vos libellés via BOOND_DICTIONARY_OVERRIDES (voir docs/dictionary-overrides.md).`;
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `❌ Type d'action inconnu : "${attrs.typeOf}". ${hint}`,
              },
            ],
          };
        }
        attrs.typeOf = resolved;
      }
      const body = buildJsonApiBody("action", attrs);
      const relationships: Record<string, unknown> = {
        dependsOn: { data: { id: dependsOn.id, type: dependsOn.type } },
      };
      if (companyId && dependsOn.type === "contact") {
        relationships.company = { data: { id: companyId, type: "company" } };
      }
      (body as Record<string, Record<string, unknown>>).data.relationships = relationships;
      const response = await apiRequest("/actions", "POST", body);
      const entity = Array.isArray(response.data) ? response.data[0] : response.data;
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Action créée avec succès.\nID: ${entity?.id}\n\n${formatDetailResponse(response)}`,
          },
        ],
      };
    }
  );

  // Delete action — via la factory pour l'élicitation de confirmation + structuredContent
  registerDeleteTool(
    server,
    { entityName: "action", entityNamePlural: "actions", apiPath: "/actions", prefix: "boond_actions" },
    {
      title: "Supprimer une action",
      description: `Supprime une action de BoondManager. ⚠️ Action irréversible. Si le client MCP supporte l'élicitation, une confirmation est demandée avant la suppression.`,
    }
  );
}
