import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTool, registerGetTool } from "./crud-factory.js";

const OPTS = {
  entityName: "agence",
  entityNamePlural: "agences",
  apiPath: "/agencies",
  prefix: "boond_agencies",
};

export function registerAgencyTools(server: McpServer): void {
  registerSearchTool(server, OPTS);
  registerGetTool(server, OPTS, { withTab: false });
}
