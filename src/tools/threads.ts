import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTool, registerGetTool } from "./crud-factory.js";

const OPTS = {
  entityName: "fil de discussion",
  entityNamePlural: "fils de discussion",
  apiPath: "/threads",
  prefix: "boond_threads",
};

export function registerThreadTools(server: McpServer): void {
  registerSearchTool(server, OPTS);
  registerGetTool(server, OPTS, { withTab: false });
}
