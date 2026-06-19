import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OrderSearchSchema, OrderCreateSchema, OrderUpdateSchema } from "../schemas/index.js";
import {
  buildJsonApiBody,
  registerSearchTool,
  registerGetTool,
  registerCreateTool,
  registerUpdateTool,
  registerDeleteTool,
} from "./crud-factory.js";

const OPTS = {
  entityName: "bon de commande",
  entityNamePlural: "bons de commande",
  apiPath: "/orders",
  prefix: "boond_orders",
};

/** Maps the companyId/projectId convenience inputs to JSON:API relationships. */
function buildOrderBody(params: Record<string, unknown>): unknown {
  const { id, companyId, projectId, ...attrs } = params;
  return buildJsonApiBody("order", attrs, id as string | undefined, {
    company: companyId ? { id: String(companyId), type: "company" } : undefined,
    project: projectId ? { id: String(projectId), type: "project" } : undefined,
  });
}

export function registerOrderTools(server: McpServer): void {
  registerSearchTool(server, OPTS, {
    schema: OrderSearchSchema,
    description: `Recherche des bons de commande dans BoondManager avec filtres par société et projet.

Args:
  - keywords (string, optional): Termes de recherche
  - companyId, projectId (string, optional): Filtrer par entité liée
  - page, pageSize: Pagination

Returns: Liste des bons de commande correspondants.`,
  });
  registerGetTool(server, OPTS, { withTab: false });
  registerCreateTool(server, OPTS, OrderCreateSchema, buildOrderBody);
  registerUpdateTool(server, OPTS, OrderUpdateSchema, buildOrderBody);
  registerDeleteTool(server, OPTS, {
    title: "Supprimer un bon de commande",
    description: `Supprime un bon de commande de BoondManager. ⚠️ Action irréversible. Si le client MCP supporte l'élicitation, une confirmation est demandée avant la suppression.`,
  });
}
