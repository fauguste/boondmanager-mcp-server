import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IdSchema, ValidationSearchSchema } from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";

export function registerValidationTools(server: McpServer): void {
  server.registerTool(
    "boond_validations_search",
    {
      title: "Rechercher des validations",
      description: `Recherche des validations en attente dans BoondManager (absences, notes de frais, feuilles de temps...).

⚠️ \`startMonth\` et \`endMonth\` (YYYY-MM) sont requis par l'API.

Args:
  - startMonth (string, requis): YYYY-MM (ex: '2025-01')
  - endMonth (string, requis): YYYY-MM
  - documentTypes (string[], optional): 'absencesReport' | 'timesReport' | 'expensesReport'
  - validationStates (string[], optional): 'waitingForValidation' | 'validated' | 'rejected'
  - resourceTypes (number[], optional)
  - keywords (string, optional): préfixes 'TPS', 'EXP', 'ABS', 'COMP'

Returns: Liste des validations correspondantes.`,
      inputSchema: ValidationSearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const query = buildSearchQuery(params);
      const response = await apiRequest("/validations", "GET", undefined, query);
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "validation") }],
      };
    }
  );

  server.registerTool(
    "boond_validations_get",
    {
      title: "Détails d'une validation",
      description: `Récupère les informations détaillées d'une validation par son ID.`,
      inputSchema: IdSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const response = await apiRequest(`/validations/${params.id}`);
      return {
        content: [{ type: "text" as const, text: formatDetailResponse(response) }],
      };
    }
  );
}
