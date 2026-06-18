import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTool, registerGetTool } from "./crud-factory.js";

const OPTS = {
  entityName: "drapeau",
  entityNamePlural: "drapeaux",
  apiPath: "/flags",
  prefix: "boond_flags",
};

export function registerFlagTools(server: McpServer): void {
  registerSearchTool(server, OPTS);
  registerGetTool(server, OPTS, { withTab: false });
}
