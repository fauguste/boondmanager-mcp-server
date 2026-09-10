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
import { progressReporterFrom } from "../services/progress.js";
import { composeDescription } from "./description-builders.js";

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
  /**
   * The tool to reach for instead when the caller wants the underlying rows
   * rather than the aggregate. Named per endpoint because it is not derivable:
   * there is no `boond_synthesis_search` nor `boond_production_plans_search`.
   */
  alternative: string;
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
      alternative: "`boond_companies_search`",
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
      alternative: "`boond_projects_search`",
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
      alternative: "`boond_resources_search`",
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
      alternative: "un `boond_reporting_*` plus ciblé (sociétés, projets, ressources)",
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
      alternative: "`boond_positionings_search`",
    },
  ];

  for (const ep of reportingEndpoints) {
    server.registerTool(
      `boond_reporting_${ep.name}`,
      {
        title: ep.title,
        description: composeDescription({
          purpose: ep.description,
          when: "pour obtenir des agrégats (CA, marge, taux, volumes) sur un périmètre et une période.",
          instead:
            `${ep.alternative} pour la liste des enregistrements eux-mêmes : ` +
            "ce reporting renvoie des totaux calculés, pas les lignes qui les composent.",
          details:
            "Filtres clés : périmètre (`perimeterDynamic` / `perimeterManagers` / `perimeterAgencies`…), " +
            `période (\`period\`, \`periodDynamic\`), ${ep.filters}.`,
          behaviour: [
            ...(ep.datesRequired
              ? ["⚠️ `startDate` + `endDate` (YYYY-MM-DD) sont REQUIS : l'API répond 422 sans eux."]
              : []),
            "Sans filtre de périmètre, l'agrégation porte sur **tout** le périmètre autorisé du compte — " +
              "un total « entreprise » là où l'utilisateur attendait souvent son équipe.",
            "Les états et types sont des ID entiers du dictionnaire (`boond_application_dictionary`), pas des libellés.",
            "Une agrégation large peut durer plusieurs dizaines de secondes ; l'avancement est signalé via " +
              "`notifications/progress` quand le client fournit un `progressToken`.",
          ],
          returns: "tableau d'indicateurs agrégés, rendu en texte. Lecture seule.",
        }),
        inputSchema: ep.schema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (params: unknown, extra: unknown) => {
        const query = buildSearchQuery(params as SearchParams);
        // One underlying request, but an aggregation over a wide perimeter can
        // take tens of seconds. Unlike a plain search (which apiSearch leaves
        // silent on its single-call fast path), the "started" step is what
        // separates "slow" from "hung" here — the only signal the client gets.
        const progress = progressReporterFrom(extra);
        progress(0, 1, `${ep.title} — calcul en cours…`);
        const response = await apiRequest(ep.path, "GET", undefined, query);
        progress(1, 1, `${ep.title} — terminé`);
        return {
          content: [{ type: "text" as const, text: formatListResponse(response, ep.entity) }],
        };
      }
    );
  }
}
