import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IdSchema, NotificationSearchSchema } from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";

export function registerNotificationTools(server: McpServer): void {
  server.registerTool(
    "boond_notifications_search",
    {
      title: "Rechercher des notifications",
      description: `Recherche des notifications dans BoondManager.

⚠️ Le paramètre \`category\` est REQUIS par l'API (singulier, pas de tableau).

Args:
  - category (string, requis): 'activity' | 'thread' | 'corporate'
  - state (string, optional): 'new' | 'read'
  - parentType (string[], optional): types de modules parents (ex: 'contract', 'global')

Returns: Liste des notifications correspondantes.`,
      inputSchema: NotificationSearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const query = buildSearchQuery(params);
      const response = await apiRequest("/notifications", "GET", undefined, query);
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "notification") }],
      };
    }
  );

  server.registerTool(
    "boond_notifications_get",
    {
      title: "Détails d'une notification",
      description: `Récupère les informations détaillées d'une notification par son ID.`,
      inputSchema: IdSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const response = await apiRequest(`/notifications/${params.id}`);
      return {
        content: [{ type: "text" as const, text: formatDetailResponse(response) }],
      };
    }
  );
}
