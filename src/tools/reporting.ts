import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SearchParams } from "../types.js";
import { apiRequest, buildSearchQuery, formatListResponse } from "../services/boond-client.js";
import { REPORTING_ENDPOINTS } from "./reporting-endpoints.js";
import { registerReportingDashboardTool } from "./reporting-dashboard.js";
import { appToolMeta } from "../ui/index.js";

export function registerReportingTools(server: McpServer): void {
  for (const ep of REPORTING_ENDPOINTS) {
    const datesNote = ep.datesRequired ? "\n⚠️ `startDate` + `endDate` (YYYY-MM-DD) sont REQUIS par l'API." : "";
    server.registerTool(
      `boond_reporting_${ep.name}`,
      {
        title: ep.title,
        description: `${ep.description}${datesNote}

Filtres clés : périmètre (perimeterDynamic/perimeterManagers/perimeterAgencies...), période (period, periodDynamic), ${ep.filters}.
Les états/types sont des IDs entiers issus de boond_application_dictionary. Sans filtre de périmètre, le reporting porte sur tout le périmètre autorisé.

Returns: Données de reporting.`,
        inputSchema: ep.schema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
        // MCP Apps (io.modelcontextprotocol/ui): no UI of their own, but the
        // reporting dashboard app is allowed to re-call them for drill-down
        // without a round-trip through the model. Ignored by hosts that don't
        // implement the extension.
        _meta: appToolMeta({ visibility: ["model", "app"] }),
      },
      async (params: unknown) => {
        const query = buildSearchQuery(params as SearchParams);
        const response = await apiRequest(ep.path, "GET", undefined, query);
        return {
          content: [{ type: "text" as const, text: formatListResponse(response, ep.entity) }],
        };
      }
    );
  }

  registerReportingDashboardTool(server);
}
