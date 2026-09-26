import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PaymentCreateSchema, PaymentSearchSchema } from "../schemas/index.js";
import { buildJsonApiBody, registerCreateTool, registerGetTool, registerSearchTool } from "./crud-factory.js";
import { composeDescription } from "./description-builders.js";

const OPTS = { entityName: "paiement", entityNamePlural: "paiements", apiPath: "/payments", prefix: "boond_payments" };

/** `/payments` payload: convenience names → API attributes, `purchaseId` → the mandatory `purchase` relationship. */
export function buildPaymentBody(params: Record<string, unknown>): unknown {
  const { purchaseId, paymentDate, amount, reference, note, ...attrs } = params;
  const apiAttrs = {
    ...attrs,
    ...(paymentDate ? { date: paymentDate } : {}),
    ...(amount !== undefined && attrs.amountExcludingTax === undefined ? { amountExcludingTax: amount } : {}),
    ...(reference ? { number: reference } : {}),
    ...(note ? { informationComments: note } : {}),
  };
  return buildJsonApiBody("payment", apiAttrs, undefined, {
    purchase: { id: String(purchaseId), type: "purchase" },
  });
}

export function registerPaymentTools(server: McpServer): void {
  registerCreateTool(server, OPTS, PaymentCreateSchema, buildPaymentBody, {
    title: "Créer un paiement",
    description: composeDescription({
      purpose: "Enregistre un paiement / règlement fournisseur adossé à un achat.",
      when: "pour solder tout ou partie d'un achat existant.",
      instead:
        "`boond_purchases_create` si l'achat lui-même n'existe pas encore — un paiement ne peut pas être orphelin.",
      behaviour: [
        "L'API `/payments` **exige** une relation `purchase` : sans ID d'achat valide, l'appel est refusé.",
        "Écriture non idempotente : deux appels identiques enregistrent deux règlements.",
      ],
      returns: "confirmation et fiche du paiement créé, avec son ID dans `structuredContent.id`.",
    }),
  });

  registerSearchTool(server, OPTS, {
    schema: PaymentSearchSchema,
    description: composeDescription({
      purpose: "Recherche des paiements / règlements fournisseur dans BoondManager.",
      when: "pour retrouver les règlements adossés à un achat, une société, un projet ou une ressource, ou ceux d'une période.",
      instead:
        "`boond_purchases_search` pour les achats eux-mêmes, `boond_provider_invoices_search` pour les factures fournisseur.",
      behaviour: [
        "`purchaseId`, `companyId`, `projectId` et `resourceId` sont convertis en préfixes `keywords` (`ACH<id>`, `CSOC<id>`, `PRJ<id>`, `COMP<id>`) et concaténés aux `keywords` fournis — l'API n'a pas de paramètre dédié. Pas de filtre par facture : `/payments` ne connaît pas de référence `FACT<id>`.",
      ],
      returns: "page de résumés des paiements (ID + libellé principal). Lecture seule.",
    }),
  });

  registerGetTool(server, OPTS, { withTab: false });
}
