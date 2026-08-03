import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AdvantageSearchSchema, IdSchema } from "../schemas/index.js";
import {
  apiRequest,
  apiSearch,
  buildSearchQuery,
  formatListResponse,
  formatDetailResponse,
} from "../services/boond-client.js";

export function registerAdvantageTools(server: McpServer): void {
  // Search advantages
  server.registerTool(
    "boond_advantages_search",
    {
      title: "Rechercher des avantages",
      description: `Recherche des avantages (tickets restaurant, mutuelle, véhicule, primes...) dans BoondManager, avec filtre optionnel par ressource.

Args:
  - keywords (string, optional): Termes de recherche
  - resourceId (string, optional): Filtrer par ID ressource
  - page, pageSize: Pagination

Returns: Liste des avantages correspondants.`,
      inputSchema: AdvantageSearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const query = buildSearchQuery(params);
      const response = await apiSearch("/advantages", query);
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "avantage", params.fields) }],
      };
    }
  );

  // Get advantage details
  server.registerTool(
    "boond_advantages_get",
    {
      title: "Détails d'un avantage",
      description: `Récupère les informations détaillées d'un avantage par son ID.`,
      inputSchema: IdSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const response = await apiRequest(`/advantages/${params.id}`);
      return {
        content: [{ type: "text" as const, text: formatDetailResponse(response) }],
      };
    }
  );
}
