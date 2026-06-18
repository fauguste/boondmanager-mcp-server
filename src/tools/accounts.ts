import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTool, registerGetTool } from "./crud-factory.js";

const OPTS = {
  entityName: "compte utilisateur",
  entityNamePlural: "comptes utilisateurs",
  apiPath: "/accounts",
  prefix: "boond_accounts",
};

export function registerAccountTools(server: McpServer): void {
  registerSearchTool(server, OPTS);
  registerGetTool(server, OPTS, { withTab: false });
}
