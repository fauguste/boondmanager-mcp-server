import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodType } from "zod";
import type { SearchParams } from "../types.js";
import {
  ReportingCompaniesSchema,
  ReportingProjectsSchema,
  ReportingResourcesSchema,
  ReportingSynthesisSchema,
  ReportingProductionPlansSchema,
} from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse } from "../services/boond-client.js";

interface ReportingEndpoint {
  name: string;
  path: string;
  title: string;
  description: string;
  entity: string;
  // Full strict ZodObject (preserves rejection of unknown filter names — see CLAUDE.md).
  schema: ZodType;
  /** When true, the API rejects requests without `startDate` + `endDate` (422). */
  datesRequired: boolean;
  /** Endpoint-specific filters surfaced in the tool description. */
  filters: string;
}

export function registerReportingTools(server: McpServer): void {
  const reportingEndpoints: ReportingEndpoint[] = [
    {
      name: "companies",
      path: "/reporting-companies",
      title: "Reporting sociétés",
      description: "Reporting des sociétés (CA, marge, activité...).",
      entity: "reporting société",
      schema: ReportingCompaniesSchema,
      datesRequired: true,
      filters: "companiesStates, companies, maxCompanies, showPercentage",
    },
    {
      name: "projects",
      path: "/reporting-projects",
      title: "Reporting projets",
      description: "Reporting des projets (CA, marge, rentabilité...).",
      entity: "reporting projet",
      schema: ReportingProjectsSchema,
      datesRequired: false,
      filters: "projectTypes, projectStates, resources, projects, contacts, companies, maxProjects",
    },
    {
      name: "resources",
      path: "/reporting-resources",
      title: "Reporting ressources",
      description: "Reporting des ressources (taux d'occupation, CA, productivité...).",
      entity: "reporting ressource",
      schema: ReportingResourcesSchema,
      datesRequired: false,
      filters:
        "reportingCategory, resourceTypes, resourceStates, period, resources/projects/contacts/companies, maxResources",
    },
    {
      name: "synthesis",
      path: "/reporting-synthesis",
      title: "Reporting synthèse",
      description: "Reporting de synthèse globale (commercial, RH, recrutement, facturation...).",
      entity: "reporting synthèse",
      schema: ReportingSynthesisSchema,
      datesRequired: true,
      filters: "reportingType, reportingCategory, period, resources/projects/contacts/companies, compareIndicators",
    },
    {
      name: "production_plans",
      path: "/reporting-production-plans",
      title: "Reporting plans de production",
      description: "Reporting des plans de production (disponibilités, positionnements...).",
      entity: "reporting plan de production",
      schema: ReportingProductionPlansSchema,
      datesRequired: true,
      filters:
        "resourceTypes, resourceStates, positioningStates, positioningPeriod, showContracts, projects/contacts/companies",
    },
  ];

  for (const ep of reportingEndpoints) {
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
}
