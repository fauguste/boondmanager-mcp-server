import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ReportingDateOptionalSchema, ReportingDateRequiredSchema } from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse } from "../services/boond-client.js";

interface ReportingEndpoint {
  name: string;
  path: string;
  title: string;
  description: string;
  entity: string;
  /** When true, the API rejects requests without `startDate` + `endDate` (422). */
  datesRequired: boolean;
}

export function registerReportingTools(server: McpServer): void {
  const reportingEndpoints: ReportingEndpoint[] = [
    {
      name: "companies",
      path: "/reporting-companies",
      title: "Reporting sociétés",
      description: "Recherche le reporting des sociétés (CA, marge, activité...).",
      entity: "reporting société",
      datesRequired: true,
    },
    {
      name: "projects",
      path: "/reporting-projects",
      title: "Reporting projets",
      description: "Recherche le reporting des projets (CA, marge, rentabilité...).",
      entity: "reporting projet",
      datesRequired: false,
    },
    {
      name: "resources",
      path: "/reporting-resources",
      title: "Reporting ressources",
      description: "Recherche le reporting des ressources (taux d'occupation, CA, productivité...).",
      entity: "reporting ressource",
      datesRequired: true,
    },
    {
      name: "synthesis",
      path: "/reporting-synthesis",
      title: "Reporting synthèse",
      description: "Recherche le reporting de synthèse globale.",
      entity: "reporting synthèse",
      datesRequired: true,
    },
    {
      name: "production_plans",
      path: "/reporting-production-plans",
      title: "Reporting plans de production",
      description: "Recherche le reporting des plans de production.",
      entity: "reporting plan de production",
      datesRequired: true,
    },
  ];

  for (const ep of reportingEndpoints) {
    const schema = ep.datesRequired ? ReportingDateRequiredSchema : ReportingDateOptionalSchema;
    const datesNote = ep.datesRequired ? "\n⚠️ `startDate` + `endDate` (YYYY-MM-DD) sont REQUIS par l'API." : "";
    server.registerTool(
      `boond_reporting_${ep.name}`,
      {
        title: ep.title,
        description: `${ep.description}${datesNote}

Args:
  - startDate, endDate (string${ep.datesRequired ? ", requis" : ", optional"}): YYYY-MM-DD
  - keywords (string, optional): Termes de recherche
  - page, pageSize: Pagination

Returns: Données de reporting.`,
        inputSchema: schema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (params: { startDate?: string; endDate?: string; keywords?: string; page?: number; pageSize?: number }) => {
        const query = buildSearchQuery(params);
        const response = await apiRequest(ep.path, "GET", undefined, query);
        return {
          content: [{ type: "text" as const, text: formatListResponse(response, ep.entity) }],
        };
      }
    );
  }
}
