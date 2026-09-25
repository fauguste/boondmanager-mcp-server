import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AdvantageSearchSchema, IdSchema } from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";
import { defaultGetDescription } from "./description-builders.js";

export function registerAdvantageTools(server: McpServer): void {
  // Search advantages
  server.registerTool(
    "boond_advantages_search",
    {
      title: "Rechercher des avantages",
      description: `Liste les avantages (tickets restaurant, mutuelle, véhicule, primes...) d'une ressource.

\`resourceId\` est obligatoire : l'API n'a pas de recherche globale des avantages (\`GET /advantages\` n'existe pas), la liste est servie par \`GET /resources/{id}/avantages\`. \`advantageTypes\` restreint aux types \`<reference>_<agencyId>\`.

Returns: Liste des avantages de la ressource.`,
      inputSchema: AdvantageSearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const { resourceId, ...rest } = params;
      const query = buildSearchQuery(rest);
      const response = await apiRequest(`/resources/${resourceId}/advantages`, "GET", undefined, query);
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
      description: defaultGetDescription({
        ...{ entityName: "avantage", entityNamePlural: "avantages", prefix: "boond_advantages" },
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
      const response = await apiRequest(`/advantages/${params.id}`);
      return {
        content: [{ type: "text" as const, text: formatDetailResponse(response) }],
      };
    }
  );
}
