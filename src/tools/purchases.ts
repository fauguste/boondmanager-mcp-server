import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toKeywordReferences } from "./linked-entity-filters.js";
import { EntityIdSchema, IdSchema, paginationShape } from "../schemas/index.js";
import {
  apiRequest,
  apiSearch,
  buildSearchQuery,
  formatListResponse,
  formatDetailResponse,
} from "../services/boond-client.js";
import { progressReporterFrom } from "../services/progress.js";
import { buildJsonApiBody, registerDeleteTool } from "./crud-factory.js";
import { z } from "zod";
import { composeDescription, defaultGetDescription } from "./description-builders.js";

const PurchaseSearchSchema = z
  .object({
    keywords: z.string().optional().describe("Mots-clés de recherche"),
    companyId: EntityIdSchema.optional().describe("Filtrer par ID société (référence keywords CSOC<id>)"),
    projectId: EntityIdSchema.optional().describe("Filtrer par ID projet (référence keywords PRJ<id>)"),
    ...paginationShape,
  })
  .strict();

const PurchaseCreateSchema = z
  .object({
    title: z.string().optional().describe("Titre de l'achat/sous-traitance"),
    companyId: EntityIdSchema.optional().describe("ID de la société fournisseur"),
    contactId: EntityIdSchema.optional().describe("ID du contact fournisseur"),
    projectId: EntityIdSchema.optional().describe("ID du projet associé"),
    state: z.number().int().optional().describe("État de l'achat"),
    startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
    note: z.string().optional().describe("Notes / commentaires"),
  })
  .strict();

export function registerPurchaseTools(server: McpServer): void {
  server.registerTool(
    "boond_purchases_search",
    {
      title: "Rechercher des achats/sous-traitance",
      description: `Recherche des achats et sous-traitances dans BoondManager, avec filtres par société et projet.

\`companyId\` / \`projectId\` sont convertis en références \`keywords\` (CSOC<id> / PRJ<id>) : l'API n'a pas de paramètre dédié.

Returns: Liste des achats correspondants.`,
      inputSchema: PurchaseSearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params, extra: unknown) => {
      const query = buildSearchQuery(toKeywordReferences(params));
      const response = await apiSearch("/purchases", query, progressReporterFrom(extra));
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "achat", params.fields) }],
      };
    }
  );

  server.registerTool(
    "boond_purchases_get",
    {
      title: "Détails d'un achat/sous-traitance",
      description: defaultGetDescription({
        ...{ entityName: "achat", entityNamePlural: "achats", prefix: "boond_purchases" },
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
      const response = await apiRequest(`/purchases/${params.id}`);
      return {
        content: [{ type: "text" as const, text: formatDetailResponse(response) }],
      };
    }
  );

  server.registerTool(
    "boond_purchases_create",
    {
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
        returns: "confirmation et fiche de l'achat créé.",
      }),
      inputSchema: PurchaseCreateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const { companyId, contactId, projectId, ...attrs } = params;
      const body = buildJsonApiBody("purchase", attrs);
      const relationships: Record<string, unknown> = {};
      if (companyId) relationships.company = { data: { id: companyId, type: "company" } };
      if (contactId) relationships.contact = { data: { id: contactId, type: "contact" } };
      if (projectId) relationships.project = { data: { id: projectId, type: "project" } };
      if (Object.keys(relationships).length > 0) {
        (body as Record<string, Record<string, unknown>>).data.relationships = relationships;
      }
      const response = await apiRequest("/purchases", "POST", body);
      const entity = Array.isArray(response.data) ? response.data[0] : response.data;
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Achat créé avec succès.\nID: ${entity?.id}\n\n${formatDetailResponse(response)}`,
          },
        ],
      };
    }
  );

  // Delete purchase — via la factory pour l'élicitation de confirmation + structuredContent
  registerDeleteTool(
    server,
    { entityName: "achat", entityNamePlural: "achats", apiPath: "/purchases", prefix: "boond_purchases" },
    {
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
    }
  );
}
