import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTool, registerGetTool } from "./crud-factory.js";

const OPTS = {
  entityName: "todolist",
  entityNamePlural: "todolists",
  apiPath: "/todolists",
  prefix: "boond_todolists",
};

export function registerTodolistTools(server: McpServer): void {
  registerSearchTool(server, OPTS);
  registerGetTool(server, OPTS, { withTab: false });
}
