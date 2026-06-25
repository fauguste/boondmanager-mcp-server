import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PaymentSearchSchema, IdSchema } from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody } from "./crud-factory.js";
import { z } from "zod";

const PaymentCreateSchema = z
  .object({
    purchaseId: z.string().min(1).describe("ID de l'achat regle"),
    paymentDate: z.string().optional().describe("Date du paiement (YYYY-MM-DD), mappee vers date"),
    performedDate: z.string().optional().describe("Date de paiement effectif (YYYY-MM-DD)"),
    expectedDate: z.string().optional().describe("Date de paiement attendu (YYYY-MM-DD)"),
    startDate: z.string().optional().describe("Date de debut couverte (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("Date de fin couverte (YYYY-MM-DD)"),
    amount: z.number().optional().describe("Montant HT du paiement, mappe vers amountExcludingTax"),
    amountExcludingTax: z.number().optional().describe("Montant HT du paiement"),
    state: z.number().int().optional().describe("Etat du paiement / achat"),
    paymentMethod: z.number().int().optional().describe("Methode de paiement"),
    taxRates: z.array(z.number()).optional().describe("Taux de taxes Boond"),
    reference: z.string().optional().describe("Reference bancaire ou reglement"),
    note: z.string().optional().describe("Note interne, mappee vers informationComments"),
  })
  .strict();

export function registerPaymentTools(server: McpServer): void {
  server.registerTool(
    "boond_payments_create",
    {
      title: "Creer un paiement",
      description: "Cree un paiement fournisseur lie a un achat. L'API Boond /payments requiert une relation purchase.",
      inputSchema: PaymentCreateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const { purchaseId, paymentDate, amount, reference, note, ...attrs } = params;
      const apiAttrs = {
        ...attrs,
        ...(paymentDate ? { date: paymentDate } : {}),
        ...(amount !== undefined && attrs.amountExcludingTax === undefined ? { amountExcludingTax: amount } : {}),
        ...(reference ? { number: reference } : {}),
        ...(note ? { informationComments: note } : {}),
      };
      const body = buildJsonApiBody("payment", apiAttrs);
      (body as Record<string, Record<string, unknown>>).data.relationships = {
        purchase: { data: { id: purchaseId, type: "purchase" } },
      };
      const response = await apiRequest("/payments", "POST", body);
      const entity = Array.isArray(response.data) ? response.data[0] : response.data;
      return {
        content: [
          {
            type: "text" as const,
            text: `Paiement cree avec succes.\nID: ${entity?.id}\n\n${formatDetailResponse(response)}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "boond_payments_search",
    {
      title: "Rechercher des paiements",
      description: `Recherche des paiements / reglements dans BoondManager.

Args:
  - keywords (string, optional): Termes de recherche. Utiliser ACH<id>, CSOC<id>, PRJ<id> selon la doc Boond pour filtrer par achat, societe ou projet.
  - invoiceId, companyId (string, optional): Conserves pour compatibilite, transmis comme query params si fournis.
  - startDate, endDate (string, optional): Periode (YYYY-MM-DD)
  - page, pageSize: Pagination

Returns: Liste des paiements correspondants.`,
      inputSchema: PaymentSearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const { purchaseId, companyId, projectId, resourceId, keywords, ...rest } = params;
      const tokens: string[] = [];
      if (keywords) tokens.push(keywords);
      if (purchaseId) tokens.push(`ACH${purchaseId}`);
      if (companyId) tokens.push(`CSOC${companyId}`);
      if (projectId) tokens.push(`PRJ${projectId}`);
      if (resourceId) tokens.push(`COMP${resourceId}`);
      const query = buildSearchQuery(tokens.length > 0 ? { ...rest, keywords: tokens.join(" ") } : rest);
      const response = await apiRequest("/payments", "GET", undefined, query);
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "paiement") }],
      };
    }
  );

  server.registerTool(
    "boond_payments_get",
    {
      title: "Details d'un paiement",
      description: "Recupere les informations detaillees d'un paiement / reglement par son ID.",
      inputSchema: IdSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const response = await apiRequest(`/payments/${params.id}`);
      return {
        content: [{ type: "text" as const, text: formatDetailResponse(response) }],
      };
    }
  );
}
