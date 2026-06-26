import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OrderSearchSchema, OrderCreateSchema, OrderUpdateSchema } from "../schemas/index.js";
import {
  buildJsonApiBody,
  registerSearchTool,
  registerGetTool,
  registerCreateTool,
  registerUpdateTool,
  registerDeleteTool,
} from "./crud-factory.js";

const OPTS = {
  entityName: "bon de commande",
  entityNamePlural: "bons de commande",
  apiPath: "/orders",
  prefix: "boond_orders",
};

/** Maps convenience inputs and schedule shortcuts to the Boond JSON:API body. */
function buildOrderBody(params: Record<string, unknown>): unknown {
  const { id, companyId, projectId, ...rest } = params;
  return buildJsonApiBody("order", orderAttributes(rest), id as string | undefined, {
    company: companyId ? { id: String(companyId), type: "company" } : undefined,
    project: projectId ? { id: String(projectId), type: "project" } : undefined,
  });
}

function normalizeSchedules(schedules?: Array<Record<string, unknown>>): Array<Record<string, unknown>> | undefined {
  return schedules?.map((schedule) => {
    const amount =
      typeof schedule.amountExcludingTax === "number"
        ? schedule.amountExcludingTax
        : typeof schedule.turnoverTermOfPaymentExcludingTax === "number"
          ? schedule.turnoverTermOfPaymentExcludingTax
          : undefined;
    return {
      ...(typeof schedule.id === "string" ? { id: schedule.id } : {}),
      date: schedule.date ?? schedule.endDate ?? schedule.startDate,
      title: schedule.title ?? "Echeance",
      turnoverQuotaExcludingTax: schedule.turnoverQuotaExcludingTax ?? amount ?? 0,
      turnoverTermOfPaymentExcludingTax: schedule.turnoverTermOfPaymentExcludingTax ?? amount ?? 0,
      forceTermOfPaymentExcludingTax: schedule.forceTermOfPaymentExcludingTax ?? true,
    };
  });
}

function orderAttributes(params: Record<string, unknown>): Record<string, unknown> {
  const { reference, orderDate, amountExcludingTax, schedules, note, ...attrs } = params;
  return {
    ...attrs,
    ...(reference ? { number: reference } : {}),
    ...(orderDate ? { date: orderDate } : {}),
    ...(amountExcludingTax !== undefined ? { turnoverOrderedExcludingTax: amountExcludingTax } : {}),
    ...(Array.isArray(schedules) ? { schedules: normalizeSchedules(schedules as Array<Record<string, unknown>>) } : {}),
    ...(note ? { informationComments: note } : {}),
  };
}

export function registerOrderTools(server: McpServer): void {
  registerSearchTool(server, OPTS, {
    schema: OrderSearchSchema,
    description: `Recherche des bons de commande dans BoondManager avec filtres par société et projet.

Args:
  - keywords (string, optional): Termes de recherche
  - companyId, projectId (string, optional): Filtrer par entité liée
  - page, pageSize: Pagination

Returns: Liste des bons de commande correspondants.`,
  });
  registerGetTool(server, OPTS, { withTab: false });
  registerCreateTool(server, OPTS, OrderCreateSchema, buildOrderBody);
  // Updates go through PUT /orders/{id}/information — the base resource
  // returns 405 on PATCH (issue #134, same root cause as #124).
  registerUpdateTool(server, OPTS, OrderUpdateSchema, buildOrderBody, {
    method: "PUT",
    pathSuffix: "information",
  });
  registerDeleteTool(server, OPTS, {
    title: "Supprimer un bon de commande",
    description: `Supprime un bon de commande de BoondManager. ⚠️ Action irréversible. Si le client MCP supporte l'élicitation, une confirmation est demandée avant la suppression.`,
  });
}
