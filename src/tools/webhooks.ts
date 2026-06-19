import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTool, registerGetTool } from "./crud-factory.js";

const OPTS = {
  entityName: "webhook",
  entityNamePlural: "webhooks",
  apiPath: "/webhooks",
  prefix: "boond_webhooks",
};

export function registerWebhookTools(server: McpServer): void {
  registerSearchTool(server, OPTS);
  registerGetTool(server, OPTS, { withTab: false });
}
