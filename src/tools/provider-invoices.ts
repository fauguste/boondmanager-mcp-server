import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ProviderInvoiceCreateSchema, ProviderInvoiceSearchSchema } from "../schemas/index.js";
import { buildJsonApiBody, registerCreateTool, registerGetTool, registerSearchTool } from "./crud-factory.js";
import { composeDescription } from "./description-builders.js";

const OPTS = {
  entityName: "facture fournisseur",
  entityNamePlural: "factures fournisseur",
  apiPath: "/provider-invoices",
  prefix: "boond_provider_invoices",
};

/** `/provider-invoices` payload: `resource` is mandatory, `providerCompany` / `providerContact` optional. */
export function buildProviderInvoiceBody(params: Record<string, unknown>): unknown {
  const { companyId, contactId, resourceId, ...attrs } = params;
  return buildJsonApiBody("providerinvoice", attrs, undefined, {
    resource: { id: String(resourceId), type: "resource" },
    providerCompany: companyId ? { id: String(companyId), type: "company" } : undefined,
    providerContact: contactId ? { id: String(contactId), type: "contact" } : undefined,
  });
}

export function registerProviderInvoiceTools(server: McpServer): void {
  registerCreateTool(server, OPTS, ProviderInvoiceCreateSchema, buildProviderInvoiceBody, {
    title: "Créer une facture fournisseur",
    description: composeDescription({
      purpose: "Crée une facture fournisseur (facture reçue d'un prestataire).",
      when: "pour enregistrer la facture émise par un sous-traitant.",
      instead:
        "`boond_invoices_create` pour une facture de vente adressée à un client — les deux sens ne partagent pas d'endpoint.",
      behaviour: [
        "`resource`, `providerCompany` et `providerContact` sont attendus sous forme d'ID numériques.",
        "Écriture non idempotente.",
      ],
      returns: "confirmation et fiche de la facture fournisseur créée, avec son ID dans `structuredContent.id`.",
    }),
  });

  registerSearchTool(server, OPTS, {
    schema: ProviderInvoiceSearchSchema,
    description: composeDescription({
      purpose: "Liste et recherche les factures fournisseur (factures reçues des prestataires).",
      when: "pour suivre les factures d'achat, par fournisseur, état ou période.",
      instead:
        "`boond_invoices_search` pour les factures de vente adressées aux clients — sens opposé, endpoint distinct.",
      returns: "page de résumés de factures fournisseur (référence, date, montants). Lecture seule.",
    }),
  });

  registerGetTool(server, OPTS, { withTab: false, title: "Détails d'une facture fournisseur" });
}
