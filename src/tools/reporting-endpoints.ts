import { z } from "zod";
import {
  ReportingCompaniesSchema,
  ReportingProjectsSchema,
  ReportingResourcesSchema,
  ReportingSynthesisSchema,
  ReportingProductionPlansSchema,
} from "../schemas/index.js";

/**
 * The five BoondManager reporting endpoints, described once.
 *
 * Two consumers share this table:
 * - `reporting.ts` registers one `boond_reporting_{name}` tool per entry;
 * - `reporting-dashboard.ts` registers the single MCP Apps tool that fans out
 *   to any of them, and needs `filterKeys` to drop filters the selected
 *   endpoint does not accept.
 *
 * `filterKeys` is derived from the endpoint's own Zod schema rather than
 * hand-listed: the dashboard's input schema is deliberately a superset of all
 * five (see `ReportingDashboardSchema`), and the intersection is what keeps a
 * `projectStates` meant for `/reporting-projects` from being posted to
 * `/reporting-companies`, where the API would ignore it silently.
 */
export interface ReportingEndpoint {
  name: string;
  path: string;
  title: string;
  description: string;
  entity: string;
  /** Full strict ZodObject (preserves rejection of unknown filter names — see CLAUDE.md). */
  schema: z.ZodObject<z.ZodRawShape>;
  /** When true, the API rejects requests without `startDate` + `endDate` (422). */
  datesRequired: boolean;
  /** Endpoint-specific filters surfaced in the tool description. */
  filters: string;
  /**
   * Name of the "entities per page" parameter, when the endpoint has one.
   * The dashboard exposes it uniformly as `max`.
   */
  maxParam?: string;
}

export const REPORTING_ENDPOINTS: readonly ReportingEndpoint[] = [
  {
    name: "companies",
    path: "/reporting-companies",
    title: "Reporting sociétés",
    description: "Reporting des sociétés (CA, marge, activité...).",
    entity: "reporting société",
    schema: ReportingCompaniesSchema,
    datesRequired: true,
    filters: "companiesStates, companies, maxCompanies, showPercentage",
    maxParam: "maxCompanies",
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
    maxParam: "maxProjects",
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
    maxParam: "maxResources",
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

/** Endpoint lookup by the `report` value of the dashboard tool. */
export function reportingEndpoint(name: string): ReportingEndpoint | undefined {
  return REPORTING_ENDPOINTS.find((ep) => ep.name === name);
}

/** Filter keys the endpoint's own search schema accepts. */
export function reportingFilterKeys(ep: ReportingEndpoint): string[] {
  return Object.keys(ep.schema.shape);
}
