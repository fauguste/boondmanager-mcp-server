import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AttachedFlagSchema, AttachedFlagsListSchema, FlagCreateSchema } from "../schemas/index.js";
import type { AttachedFlagEntity, AttachedFlagInput } from "../schemas/index.js";
import { apiRequest, formatListResponse } from "../services/boond-client.js";
import { buildJsonApiBody, registerCreateTool, registerGetTool, registerSearchTool } from "./crud-factory.js";
import { composeDescription } from "./description-builders.js";

const OPTS = {
  entityName: "drapeau",
  entityNamePlural: "drapeaux",
  apiPath: "/flags",
  prefix: "boond_flags",
};

/** API collection of each entity `attachedFlags.raml` covers. */
const ENTITY_PATH: Record<AttachedFlagEntity, string> = {
  candidate: "/candidates",
  resource: "/resources",
  contact: "/contacts",
  company: "/companies",
  opportunity: "/opportunities",
  project: "/projects",
  order: "/orders",
  product: "/products",
  purchase: "/purchases",
  action: "/actions",
  positioning: "/positionings",
  invoice: "/invoices",
};

const AttachOutputSchema = z.object({
  entity: z.string(),
  id: z.string(),
  flagId: z.string(),
  attached: z.boolean(),
});

/** `/flags` payload (issue #254): `name` + optional `mainManager` relationship (`models.flag`). */
export function buildFlagBody(params: Record<string, unknown>): unknown {
  const { mainManagerId, ...attrs } = params;
  return buildJsonApiBody("flag", attrs, undefined, {
    mainManager: mainManagerId ? { id: String(mainManagerId), type: "resource" } : undefined,
  });
}

/** `POST /attached-flags` payload: the flag and the flagged record, both as relationships (`dependsOn` is the polymorphic pattern of `models.task`). */
export function buildAttachedFlagBody(params: AttachedFlagInput): unknown {
  return buildJsonApiBody("attachedflag", {}, undefined, {
    flag: { id: params.flagId, type: "flag" },
    dependsOn: { id: params.id, type: params.entity },
  });
}

export function registerFlagTools(server: McpServer): void {
  registerSearchTool(server, OPTS);
  registerGetTool(server, OPTS, { withTab: false });

  // Issue #254: writes. `POST /flags` and `POST|DELETE /attached-flags` are
  // documented in the RAML (flags/search.raml, attachedFlags/search.raml);
  // the POST bodies are not, and neither was exercised (production tenant).
  registerCreateTool(server, OPTS, FlagCreateSchema, buildFlagBody, {
    title: "Créer un drapeau",
    description: composeDescription({
      purpose: "Crée un drapeau (tag) réutilisable — « vivier Java Q4 », « à rappeler », « VIP ».",
      when: "avant `boond_flags_attach` quand aucun drapeau existant ne convient (`boond_flags_search` d'abord).",
      instead: "`boond_flags_attach` pour poser un drapeau existant sur un enregistrement.",
      behaviour: [
        "Écriture non idempotente : deux appels créent deux drapeaux homonymes.",
        "Corps déduit de `models.flag` (`name`, `mainManager`) — non éprouvé sur un tenant de test.",
      ],
      returns: "confirmation et ID du drapeau (`structuredContent.id`).",
    }),
  });

  server.registerTool(
    "boond_flags_attached",
    {
      title: "Drapeaux posés sur un enregistrement",
      description: composeDescription({
        purpose:
          "Liste les drapeaux (tags) posés sur un candidat, une ressource, un contact, une société, une opportunité, un projet, une commande, un produit, un achat, une action, un positionnement ou une facture.",
        when: "pour savoir comment un enregistrement est tagué avant d'ajouter ou retirer un drapeau.",
        instead: "`boond_flags_search` pour le catalogue des drapeaux existants (pas leurs rattachements).",
        returns: "une ligne par drapeau posé (`GET /{entité}/{id}/attached-flags`). Lecture seule.",
      }),
      inputSchema: AttachedFlagsListSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const { entity, id } = params;
      const response = await apiRequest(`${ENTITY_PATH[entity]}/${id}/attached-flags`);
      return { content: [{ type: "text" as const, text: formatListResponse(response, "drapeau posé") }] };
    }
  );

  server.registerTool(
    "boond_flags_attach",
    {
      title: "Poser un drapeau sur un enregistrement",
      description: composeDescription({
        purpose: "Pose un drapeau existant sur un enregistrement (tagging) — `POST /attached-flags`.",
        when: "pour marquer un lot de fiches après un tri (« ces 12 candidats → vivier Java Q4 ») : un appel par fiche.",
        instead: "`boond_flags_create` si le drapeau n'existe pas encore ; `boond_flags_detach` pour le retirer.",
        behaviour: [
          "Corps JSON:API `{ relationships: { flag, dependsOn } }` déduit du modèle — la RAML ne documente que la route ; non éprouvé sur un tenant de test.",
          "Idempotent côté intention : reposer un drapeau déjà présent ne doit rien changer.",
        ],
        returns: "`{ entity, id, flagId, attached: true }`.",
      }),
      inputSchema: AttachedFlagSchema,
      outputSchema: AttachOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const p = params;
      await apiRequest("/attached-flags", "POST", buildAttachedFlagBody(p));
      return {
        content: [{ type: "text" as const, text: `✅ Drapeau #${p.flagId} posé sur ${p.entity} #${p.id}.` }],
        structuredContent: { entity: p.entity, id: p.id, flagId: p.flagId, attached: true },
      };
    }
  );

  server.registerTool(
    "boond_flags_detach",
    {
      title: "Retirer un drapeau d'un enregistrement",
      description: composeDescription({
        purpose:
          "Retire un drapeau d'un enregistrement — `DELETE /attached-flags?flag=&<entité>=` (route et paramètres documentés dans la RAML).",
        when: "pour dé-taguer une fiche ; réversible par `boond_flags_attach`, le drapeau lui-même n'est pas supprimé.",
        instead: "aucun outil ne supprime un drapeau du catalogue : un drapeau se retire fiche par fiche.",
        behaviour: [
          "Idempotent : retirer un drapeau absent n'échoue pas côté intention (l'erreur API éventuelle est remontée telle quelle).",
        ],
        returns: "`{ entity, id, flagId, attached: false }`.",
      }),
      inputSchema: AttachedFlagSchema,
      outputSchema: AttachOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const p = params;
      await apiRequest("/attached-flags", "DELETE", undefined, { flag: p.flagId, [p.entity]: p.id });
      return {
        content: [{ type: "text" as const, text: `✅ Drapeau #${p.flagId} retiré de ${p.entity} #${p.id}.` }],
        structuredContent: { entity: p.entity, id: p.id, flagId: p.flagId, attached: false },
      };
    }
  );
}
