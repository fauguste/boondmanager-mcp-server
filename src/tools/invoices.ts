import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InvoiceSearchSchema, InvoiceCreateSchema, InvoiceUpdateSchema } from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse } from "../services/boond-client.js";
import {
  buildJsonApiBody,
  buildListStructured,
  SearchOutputSchema,
  registerGetTool,
  registerCreateTool,
  registerUpdateTool,
  registerDeleteTool,
} from "./crud-factory.js";

const OPTS = {
  entityName: "facture",
  entityNamePlural: "factures",
  apiPath: "/invoices",
  prefix: "boond_invoices",
};

/** Maps the companyId/projectId convenience inputs to JSON:API relationships. */
function buildInvoiceBody(params: Record<string, unknown>): unknown {
  const { id, companyId, projectId, ...attrs } = params;
  return buildJsonApiBody("invoice", attrs, id as string | undefined, {
    company: companyId ? { id: String(companyId), type: "company" } : undefined,
    project: projectId ? { id: String(projectId), type: "project" } : undefined,
  });
}

export function registerInvoiceTools(server: McpServer): void {
  // Search invoices — kept hand-rolled: it applies a `period` default and
  // forwards the startDate/endDate period window, which the generic factory
  // search does not model.
  server.registerTool(
    "boond_invoices_search",
    {
      title: "Rechercher des factures",
      description: `Recherche des factures dans BoondManager avec filtres par société, projet et période.

Args:
  - keywords (string, optional): Termes de recherche (référence, société...)
  - companyId, projectId (string, optional): Filtrer par entité liée
  - startDate, endDate (string, optional): Période (YYYY-MM-DD)
  - page, pageSize: Pagination

Returns: Liste des factures correspondantes.`,
      inputSchema: InvoiceSearchSchema,
      outputSchema: SearchOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const query = buildSearchQuery(params);
      if (params.startDate) query["startDate"] = params.startDate;
      if (params.endDate) query["endDate"] = params.endDate;
      query["period"] = params.period || "period";
      const response = await apiRequest("/invoices", "GET", undefined, query);
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "facture") }],
        structuredContent: buildListStructured(response),
      };
    }
  );

  registerGetTool(server, OPTS, { withTab: false });
  registerCreateTool(server, OPTS, InvoiceCreateSchema, buildInvoiceBody);
  // Updates go through PUT /invoices/{id}/information — the base resource
  // returns 405 on PATCH (issue #134, same root cause as #124).
  registerUpdateTool(server, OPTS, InvoiceUpdateSchema, buildInvoiceBody, {
    method: "PUT",
    pathSuffix: "information",
  });
  registerDeleteTool(server, OPTS, {
    title: "Supprimer une facture",
    description: `Supprime une facture de BoondManager. ⚠️ Action irréversible. Si le client MCP supporte l'élicitation, une confirmation est demandée avant la suppression.`,
  });
}
