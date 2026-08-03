import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SearchSchema } from "../schemas/index.js";
import { apiSearch, buildSearchQuery, formatListResponse } from "../services/boond-client.js";

export function registerPlanningAbsenceTools(server: McpServer): void {
  server.registerTool(
    "boond_planning_absences_search",
    {
      title: "Rechercher le planning des absences",
      description: `Recherche le planning des absences dans BoondManager (vue globale des absences prévues).

Returns: Planning des absences.`,
      inputSchema: SearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const query = buildSearchQuery(params);
      const response = await apiSearch("/planning-absences", query);
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "planning absence", params.fields) }],
      };
    }
  );
}
