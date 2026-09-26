import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toKeywordReferences } from "./linked-entity-filters.js";
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
import { defaultDeleteDescription } from "./description-builders.js";
import { registerTabTools } from "./tab-tools.js";
import type { TabDefinition } from "./tab-tools.js";

const OPTS = {
  entityName: "facture",
  entityNamePlural: "factures",
  apiPath: "/invoices",
  prefix: "boond_invoices",
};

// `ENTITY_TABS.invoices` — verified live on 2026-09-26 (issue #258).
const INVOICE_TABS: TabDefinition[] = [
  {
    name: "information",
    tab: "information",
    title: "Informations complètes d'une facture",
    subject: "les informations complètes",
    content:
      "lignes facturées, coordonnées de facturation et bancaires, échéance, état d'envoi, commande et projet liés",
    returns: "Fiche complète de la facture (relations société, contact, commande, projet, prestation incluses).",
  },
  {
    name: "actions",
    tab: "actions",
    title: "Actions liées à une facture",
    subject: "les actions",
    content: "envois, relances, notes",
    returns: "Liste des actions rattachées à la facture, la plus récente en premier.",
    behaviour: ["Un envoi de facture par e-mail apparaît ici comme une action, avec ses destinataires dans `text`."],
  },
];

/** Maps convenience inputs and simple amount fields to the Boond JSON:API body. */
function buildInvoiceBody(params: Record<string, unknown>): unknown {
  const { id, orderId, companyId, projectId, ...rest } = params;
  return buildJsonApiBody("invoice", invoiceAttributes(rest), id as string | undefined, {
    order: orderId ? { id: String(orderId), type: "order" } : undefined,
    company: companyId ? { id: String(companyId), type: "company" } : undefined,
    project: projectId ? { id: String(projectId), type: "project" } : undefined,
  });
}

function invoiceRecordFromAmount(amount: number, taxRate?: number, note?: string): Record<string, unknown> {
  return {
    invoiceRecordType: null,
    description: note ?? "Prestation",
    amountExcludingTax: amount,
    quantity: 1,
    taxRates: [taxRate ?? 0],
    taxes: [taxRate ?? 0],
  };
}

function invoiceAttributes(params: Record<string, unknown>): Record<string, unknown> {
  const { invoiceDate, amountExcludingTax, taxRate, note, ...attrs } = params;
  return {
    ...attrs,
    ...(invoiceDate ? { date: invoiceDate } : {}),
    ...(amountExcludingTax !== undefined && !Array.isArray(attrs.invoiceRecords)
      ? {
          invoiceRecords: [
            invoiceRecordFromAmount(
              Number(amountExcludingTax),
              typeof taxRate === "number" ? taxRate : undefined,
              note as string | undefined
            ),
          ],
        }
      : {}),
    ...(note ? { informationComments: note } : {}),
  };
}

export function registerInvoiceTools(server: McpServer): void {
  // Search invoices — kept hand-rolled: it applies a `period` default and
  // forwards the startDate/endDate period window, which the generic factory
  // search does not model.
  server.registerTool(
    "boond_invoices_search",
    {
      title: "Rechercher des factures",
      description: `Liste et recherche les factures client, par société, projet, état ou période.

\`companyId\` / \`projectId\` sont convertis en références \`keywords\` (\`CSOC<id>\`, \`PRJ<id>\`) — l'API n'a pas de paramètre dédié et ignorerait un \`companyId\` brut.

Returns : page de résumés (référence, date, montants HT/TTC, état). Lecture seule.`,
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
      const query = buildSearchQuery(toKeywordReferences(params));
      if (params.startDate) query["startDate"] = params.startDate;
      if (params.endDate) query["endDate"] = params.endDate;
      query["period"] = params.period || "period";
      const response = await apiRequest("/invoices", "GET", undefined, query);
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "facture", params.fields) }],
        structuredContent: buildListStructured(response, params.fields),
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
    description: defaultDeleteDescription({
      entityName: "facture",
      entityNamePlural: "factures",
      prefix: "boond_invoices",
    }),
  });

  registerTabTools(server, OPTS, INVOICE_TABS);
}
