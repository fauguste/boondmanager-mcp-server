import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IdSchema, fieldsField } from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody } from "./crud-factory.js";
import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_SEARCH_PAGE } from "../constants.js";
import { composeDescription, defaultGetDescription } from "./description-builders.js";

const ProviderInvoiceSearchSchema = z
  .object({
    keywords: z.string().optional().describe("Mots-cles de recherche"),
    companyId: z.string().optional().describe("Filtrer par ID societe fournisseur"),
    resourceId: z.string().optional().describe("Filtrer par ID ressource via mot-cle COMP<id>"),
    page: z.number().int().min(1).max(MAX_SEARCH_PAGE).default(1).describe(`Numero de page (max: ${MAX_SEARCH_PAGE})`),
    pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Resultats par page"),
    fields: fieldsField,
  })
  .strict();

const ProviderInvoiceCreateSchema = z
  .object({
    reference: z.string().min(1).describe("Reference de la facture fournisseur"),
    resourceId: z.string().min(1).describe("ID de la ressource portee par la facture fournisseur"),
    companyId: z.string().optional().describe("ID de la societe fournisseur, mappe vers providerCompany"),
    contactId: z.string().optional().describe("ID du contact fournisseur, mappe vers providerContact"),
    invoiceDate: z.string().optional().describe("Date de facture (YYYY-MM-DD)"),
    startDate: z.string().min(1).describe("Date de debut de periode (YYYY-MM-DD)"),
    endDate: z.string().min(1).describe("Date de fin de periode (YYYY-MM-DD)"),
    amountExcludingTax: z.number().optional().describe("Montant HT"),
    amountIncludingTax: z.number().optional().describe("Montant TTC"),
    currency: z.number().optional().describe("Devise Boond"),
    exchangeRate: z.number().optional().describe("Taux de change"),
    currencyAgency: z.number().optional().describe("Devise agence"),
    exchangeRateAgency: z.number().optional().describe("Taux de change agence"),
    state: z.number().int().optional().describe("Etat de la facture fournisseur"),
  })
  .strict();

export function registerProviderInvoiceTools(server: McpServer): void {
  server.registerTool(
    "boond_provider_invoices_create",
    {
      title: "Creer une facture fournisseur",
      description: composeDescription({
        purpose: "Crée une facture fournisseur (facture reçue d'un prestataire).",
        when: "pour enregistrer la facture émise par un sous-traitant.",
        instead:
          "`boond_invoices_create` pour une facture de vente adressée à un client — les deux sens ne partagent pas d'endpoint.",
        behaviour: [
          "`resource`, `providerCompany` et `providerContact` sont attendus sous forme d'ID numériques.",
          "Écriture non idempotente.",
        ],
        returns: "confirmation et fiche de la facture fournisseur créée.",
      }),
      inputSchema: ProviderInvoiceCreateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const { companyId, contactId, resourceId, ...attrs } = params;
      const body = buildJsonApiBody("providerinvoice", attrs);
      const relationships: Record<string, unknown> = {
        resource: { data: { id: resourceId, type: "resource" } },
      };
      if (companyId) relationships.providerCompany = { data: { id: companyId, type: "company" } };
      if (contactId) relationships.providerContact = { data: { id: contactId, type: "contact" } };
      (body as Record<string, Record<string, unknown>>).data.relationships = relationships;
      const response = await apiRequest("/provider-invoices", "POST", body);
      const entity = Array.isArray(response.data) ? response.data[0] : response.data;
      return {
        content: [
          {
            type: "text" as const,
            text: `Facture fournisseur creee avec succes.\nID: ${entity?.id}\n\n${formatDetailResponse(response)}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "boond_provider_invoices_search",
    {
      title: "Rechercher des factures fournisseur",
      description: composeDescription({
        purpose: "Liste et recherche les factures fournisseur (factures reçues des prestataires).",
        when: "pour suivre les factures d'achat, par fournisseur, état ou période.",
        instead:
          "`boond_invoices_search` pour les factures de vente adressées aux clients — sens opposé, endpoint distinct.",
        returns: "page de résumés de factures fournisseur (référence, date, montants). Lecture seule.",
      }),
      inputSchema: ProviderInvoiceSearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const { resourceId, companyId, keywords, ...rest } = params;
      const tokens: string[] = [];
      if (keywords) tokens.push(keywords);
      if (resourceId) tokens.push(`COMP${resourceId}`);
      if (companyId) tokens.push(`CSOC${companyId}`);
      const query = buildSearchQuery(tokens.length > 0 ? { ...rest, keywords: tokens.join(" ") } : rest);
      const response = await apiRequest("/provider-invoices", "GET", undefined, query);
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "facture fournisseur", params.fields) }],
      };
    }
  );

  server.registerTool(
    "boond_provider_invoices_get",
    {
      title: "Details d'une facture fournisseur",
      description: defaultGetDescription({
        ...{
          entityName: "facture fournisseur",
          entityNamePlural: "factures fournisseur",
          prefix: "boond_provider_invoices",
        },
        withTab: false,
      }),
      inputSchema: IdSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const response = await apiRequest(`/provider-invoices/${params.id}`);
      return {
        content: [{ type: "text" as const, text: formatDetailResponse(response) }],
      };
    }
  );
}
