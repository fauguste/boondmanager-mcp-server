import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PurchaseCreateSchema, PurchaseSearchSchema } from "../schemas/index.js";
import {
  buildJsonApiBody,
  registerCreateTool,
  registerDeleteTool,
  registerGetTool,
  registerSearchTool,
} from "./crud-factory.js";
import { composeDescription } from "./description-builders.js";

const OPTS = { entityName: "achat", entityNamePlural: "achats", apiPath: "/purchases", prefix: "boond_purchases" };

/** `/purchases` payload: the three optional ids become relationships. */
export function buildPurchaseBody(params: Record<string, unknown>): unknown {
  const { companyId, contactId, projectId, ...attrs } = params;
  return buildJsonApiBody("purchase", attrs, undefined, {
    company: companyId ? { id: String(companyId), type: "company" } : undefined,
    contact: contactId ? { id: String(contactId), type: "contact" } : undefined,
    project: projectId ? { id: String(projectId), type: "project" } : undefined,
  });
}

export function registerPurchaseTools(server: McpServer): void {
  registerSearchTool(server, OPTS, {
    schema: PurchaseSearchSchema,
    title: "Rechercher des achats/sous-traitance",
    description: `Recherche des achats et sous-traitances dans BoondManager, avec filtres par société et projet.

\`companyId\` / \`projectId\` sont convertis en références \`keywords\` (CSOC<id> / PRJ<id>) : l'API n'a pas de paramètre dédié.

Returns: Liste des achats correspondants.`,
  });

  registerGetTool(server, OPTS, { withTab: false, title: "Détails d'un achat/sous-traitance" });

  registerCreateTool(server, OPTS, PurchaseCreateSchema, buildPurchaseBody, {
    title: "Créer un achat/sous-traitance",
    description: composeDescription({
      purpose: "Crée un achat ou une ligne de sous-traitance.",
      when: "pour engager une dépense fournisseur, généralement rattachée à un projet.",
      instead:
        "`boond_provider_invoices_create` pour la facture reçue du fournisseur — l'achat est l'engagement, la facture fournisseur en est le règlement attendu.",
      behaviour: [
        "Écriture non idempotente.",
        "Les ID de société, contact et projet sont des ID numériques BoondManager, à résoudre au préalable via les recherches correspondantes.",
      ],
      returns: "confirmation et fiche de l'achat créé, avec son ID dans `structuredContent.id`.",
    }),
  });

  registerDeleteTool(server, OPTS, {
    title: "Supprimer un achat/sous-traitance",
    // Not `defaultDeleteDescription`: its "Plutôt que" names `${prefix}_update`,
    // and this domain has no update tool (#229).
    description: composeDescription({
      purpose: "Supprime définitivement un achat / sous-traitance de BoondManager.",
      when: "uniquement sur demande explicite de l'utilisateur, et après avoir vérifié l'ID avec `boond_purchases_get`.",
      instead:
        "aucun outil de mise à jour n'existe pour les achats : corriger un montant ou une période passe par cette suppression puis `boond_purchases_create` — vérifier avec `boond_payments_search` (`purchaseId`) qu'aucun règlement n'y est adossé avant de détruire.",
      behaviour: [
        "⚠️ Irréversible, sans corbeille côté API.",
        "Si le client MCP annonce la capacité `elicitation`, une confirmation est demandée à l'utilisateur final et un refus annule l'appel (`structuredContent.deleted: false` + `reason`) ; sinon la suppression part directement.",
      ],
      returns: "`{ id, deleted, reason? }` — vérifier `deleted`, qui vaut `false` en cas de refus utilisateur.",
    }),
  });
}
