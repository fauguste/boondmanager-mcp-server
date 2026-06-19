import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ExpenseSearchSchema, ExpenseCreateSchema, ExpenseUpdateSchema } from "../schemas/index.js";
import {
  buildJsonApiBody,
  registerSearchTool,
  registerGetTool,
  registerCreateTool,
  registerUpdateTool,
  registerDeleteTool,
} from "./crud-factory.js";

// Expense reports are searched on /expenses but read/written on /expenses-reports.
const SEARCH_OPTS = {
  entityName: "note de frais",
  entityNamePlural: "notes de frais",
  apiPath: "/expenses",
  prefix: "boond_expenses",
};
const REPORT_OPTS = { ...SEARCH_OPTS, apiPath: "/expenses-reports" };

/** Maps the resourceId/projectId convenience inputs to JSON:API relationships. */
function buildExpenseBody(params: Record<string, unknown>): unknown {
  const { id, resourceId, projectId, ...attrs } = params;
  return buildJsonApiBody("expense", attrs, id as string | undefined, {
    resource: resourceId ? { id: String(resourceId), type: "resource" } : undefined,
    project: projectId ? { id: String(projectId), type: "project" } : undefined,
  });
}

export function registerExpenseTools(server: McpServer): void {
  registerSearchTool(server, SEARCH_OPTS, {
    schema: ExpenseSearchSchema,
    description: `Recherche des notes de frais dans BoondManager avec filtres par ressource, projet et période.

Args:
  - keywords (string, optional): Termes de recherche
  - resourceId, projectId (string, optional): Filtrer par entité liée
  - startDate, endDate (string, optional): Période (YYYY-MM-DD)
  - page, pageSize: Pagination

Returns: Liste des notes de frais correspondantes.`,
  });
  registerGetTool(server, REPORT_OPTS, { withTab: false });
  registerCreateTool(server, REPORT_OPTS, ExpenseCreateSchema, buildExpenseBody);
  // BoondManager expects PUT (not PATCH) on /expenses-reports.
  registerUpdateTool(server, REPORT_OPTS, ExpenseUpdateSchema, buildExpenseBody, { method: "PUT" });
  registerDeleteTool(server, REPORT_OPTS, {
    title: "Supprimer une note de frais",
    description: `Supprime une note de frais de BoondManager. ⚠️ Action irréversible. Si le client MCP supporte l'élicitation, une confirmation est demandée avant la suppression.`,
  });
}
