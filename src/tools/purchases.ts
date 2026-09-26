import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PurchaseCreateSchema, PurchaseSearchSchema, PurchaseUpdateSchema } from "../schemas/index.js";
import {
  buildJsonApiBody,
  registerCreateTool,
  registerDeleteTool,
  registerGetTool,
  registerSearchTool,
  registerUpdateTool,
} from "./crud-factory.js";
import { composeDescription } from "./description-builders.js";

import { registerTabTools } from "./tab-tools.js";
import type { TabDefinition } from "./tab-tools.js";

const OPTS = { entityName: "achat", entityNamePlural: "achats", apiPath: "/purchases", prefix: "boond_purchases" };

// `ENTITY_TABS.purchases` — `/purchases/{id}/information` verified live on
// 2026-09-26 (issue #258); `/actions` answers 404 on this entity.
const PURCHASE_TABS: TabDefinition[] = [
  {
    name: "information",
    tab: "information",
    title: "Informations complètes d'un achat/sous-traitance",
    subject: "les informations complètes",
    content: "période, quantité, montants, taux de TVA, conditions de paiement, ressource, projet et prestation liés",
    returns: "Fiche complète de l'achat (relations ressource, agence, projet, prestation incluses).",
  },
];

/** `/purchases` payload: the three optional ids become relationships; `id` (update) lands on `data.id`. */
export function buildPurchaseBody(params: Record<string, unknown>): unknown {
  const { id, companyId, contactId, projectId, note, ...attrs } = params;
  return buildJsonApiBody(
    "purchase",
    { ...attrs, ...(note !== undefined ? { informationComments: note } : {}) },
    typeof id === "string" ? id : undefined,
    {
      company: companyId ? { id: String(companyId), type: "company" } : undefined,
      contact: contactId ? { id: String(contactId), type: "contact" } : undefined,
      project: projectId ? { id: String(projectId), type: "project" } : undefined,
    }
  );
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

  // PUT /purchases/{id}/information (RAML `purchases/information.raml`, issue #252).
  registerUpdateTool(server, OPTS, PurchaseUpdateSchema, buildPurchaseBody, {
    method: "PUT",
    pathSuffix: "information",
    title: "Modifier un achat/sous-traitance",
  });

  registerDeleteTool(server, OPTS, {
    title: "Supprimer un achat/sous-traitance",
    description: composeDescription({
      purpose: "Supprime définitivement un achat / sous-traitance de BoondManager.",
      when: "uniquement sur demande explicite de l'utilisateur, et après avoir vérifié l'ID avec `boond_purchases_get`.",
      instead:
        "`boond_purchases_update` pour corriger un montant, une période ou un état — vérifier avec `boond_payments_search` (`purchaseId`) qu'aucun règlement n'y est adossé avant de détruire.",
      behaviour: [
        "⚠️ Irréversible, sans corbeille côté API.",
        "Si le client MCP annonce la capacité `elicitation`, une confirmation est demandée à l'utilisateur final et un refus annule l'appel (`structuredContent.deleted: false` + `reason`) ; sinon la suppression part directement.",
      ],
      returns: "`{ id, deleted, reason? }` — vérifier `deleted`, qui vaut `false` en cas de refus utilisateur.",
    }),
  });

  registerTabTools(server, OPTS, PURCHASE_TABS);
}
