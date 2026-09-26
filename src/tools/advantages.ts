import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AdvantageCreateSchema, AdvantageDefaultSchema, AdvantageSearchSchema, IdSchema } from "../schemas/index.js";
import type { AdvantageDefaultInput } from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody, registerCreateTool } from "./crud-factory.js";
import { composeDescription, defaultGetDescription } from "./description-builders.js";

const OPTS = {
  entityName: "avantage",
  entityNamePlural: "avantages",
  apiPath: "/advantages",
  prefix: "boond_advantages",
};

/** `/advantages` payload (issue #254): the four ids become relationships, `note` → `informationComments` (`models.advantage`). */
export function buildAdvantageBody(params: Record<string, unknown>): unknown {
  const { resourceId, contractId, projectId, deliveryId, note, ...attrs } = params;
  return buildJsonApiBody(
    "advantage",
    { ...attrs, ...(note !== undefined ? { informationComments: note } : {}) },
    undefined,
    {
      resource: { id: String(resourceId), type: "resource" },
      contract: contractId ? { id: String(contractId), type: "contract" } : undefined,
      project: projectId ? { id: String(projectId), type: "project" } : undefined,
      delivery: deliveryId ? { id: String(deliveryId), type: "delivery" } : undefined,
    }
  );
}

export function registerAdvantageTools(server: McpServer): void {
  // Search advantages
  server.registerTool(
    "boond_advantages_search",
    {
      title: "Rechercher des avantages",
      description: `Liste les avantages (tickets restaurant, mutuelle, véhicule, primes...) d'une ressource.

\`resourceId\` est obligatoire : l'API n'a pas de recherche globale des avantages (\`GET /advantages\` n'existe pas), la liste est servie par \`GET /resources/{id}/avantages\`. \`advantageTypes\` restreint aux types \`<reference>_<agencyId>\`.

Returns: Liste des avantages de la ressource.`,
      inputSchema: AdvantageSearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const { resourceId, ...rest } = params;
      const query = buildSearchQuery(rest);
      const response = await apiRequest(`/resources/${resourceId}/advantages`, "GET", undefined, query);
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "avantage", params.fields) }],
      };
    }
  );

  // Issue #254: `GET /advantages/default?resource=&contract=&project=&delivery=`
  // (advantages/default.raml) — the advantage types and the amounts the agency
  // pre-fills, to read before creating.
  server.registerTool(
    "boond_advantages_default",
    {
      title: "Référentiels d'un avantage",
      description: composeDescription({
        purpose:
          "Renvoie les valeurs par défaut d'un avantage pour une ressource (types d'avantage de l'agence, montants pré-remplis, devise) avant sa création.",
        when: "AVANT `boond_advantages_create` — les types (`advantageType`) et leurs quotas viennent de là.",
        instead: "`boond_advantages_search` pour les avantages déjà attribués à la ressource.",
        behaviour: ["Lecture seule (`GET /advantages/default`) ; la réponse est rendue telle quelle."],
        returns: "JSON de l'avantage vide pré-rempli, avec les types d'avantage inclus.",
      }),
      inputSchema: AdvantageDefaultSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params: AdvantageDefaultInput) => {
      const query: Record<string, string | undefined> = { resource: params.resourceId };
      if (params.contractId) query.contract = params.contractId;
      if (params.projectId) query.project = params.projectId;
      if (params.deliveryId) query.delivery = params.deliveryId;
      const response = await apiRequest("/advantages/default", "GET", undefined, query);
      return { content: [{ type: "text" as const, text: formatDetailResponse(response) }] };
    }
  );

  // Issue #254: `POST /advantages` is documented (advantages/search.raml: post only), its body is not — not exercised.
  registerCreateTool(server, OPTS, AdvantageCreateSchema, buildAdvantageBody, {
    title: "Créer un avantage",
    description: composeDescription({
      purpose: "Attribue un avantage (tickets restaurant, mutuelle, véhicule, prime…) à une ressource.",
      when: "après `boond_advantages_default` pour connaître les types et montants de l'agence.",
      instead: "`boond_advantages_search` d'abord : l'API ne déduplique pas.",
      behaviour: [
        "Corps déduit de `models.advantage` (`date`, `quantity`, `advantageType`, montants, relations `resource` / `contract` / `project` / `delivery`) — non éprouvé sur un tenant de test.",
        "Écriture non idempotente.",
      ],
      returns: "confirmation et ID de l'avantage (`structuredContent.id`).",
    }),
  });

  // Get advantage details
  server.registerTool(
    "boond_advantages_get",
    {
      title: "Détails d'un avantage",
      description: defaultGetDescription({
        ...{ entityName: "avantage", entityNamePlural: "avantages", prefix: "boond_advantages" },
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
      const response = await apiRequest(`/advantages/${params.id}`);
      return {
        content: [{ type: "text" as const, text: formatDetailResponse(response) }],
      };
    }
  );
}
