import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTool, registerGetTool } from "./crud-factory.js";

const OPTS = {
  entityName: "business unit",
  entityNamePlural: "business units",
  apiPath: "/business-units",
  prefix: "boond_business_units",
};

export function registerBusinessUnitTools(server: McpServer): void {
  registerSearchTool(server, OPTS);
  registerGetTool(server, OPTS, { withTab: false });
}
