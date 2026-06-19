import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTool, registerGetTool } from "./crud-factory.js";

const OPTS = {
  entityName: "log",
  entityNamePlural: "logs",
  apiPath: "/logs",
  prefix: "boond_logs",
};

export function registerLogTools(server: McpServer): void {
  registerSearchTool(server, OPTS, {
    description: `Recherche des logs d'audit dans BoondManager (historique des actions utilisateurs).

Returns: Liste des logs correspondants.`,
  });
  registerGetTool(server, OPTS, { withTab: false });
}
