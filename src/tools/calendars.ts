import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTool, registerGetTool } from "./crud-factory.js";

const OPTS = {
  entityName: "calendrier",
  entityNamePlural: "calendriers",
  apiPath: "/calendars",
  prefix: "boond_calendars",
};

export function registerCalendarTools(server: McpServer): void {
  registerSearchTool(server, OPTS);
  registerGetTool(server, OPTS, { withTab: false });
}
