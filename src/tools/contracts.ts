import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ContractCreateSchema, ContractSearchSchema, ContractUpdateSchema } from "../schemas/index.js";
import type { ContractSearchInput } from "../schemas/index.js";
import { apiRequest, apiSearch, buildSearchQuery, formatListResponse } from "../services/boond-client.js";
import { renderAttributeValue } from "../services/format/summary.js";
import { progressReporterFrom } from "../services/progress.js";
import type { JsonApiResource, JsonApiResponse } from "../types.js";
import {
  buildJsonApiBody,
  buildListStructured,
  registerCreateTool,
  registerGetTool,
  registerUpdateTool,
  SearchOutputSchema,
} from "./crud-factory.js";
import { composeDescription } from "./description-builders.js";

const OPTS = { entityName: "contrat", entityNamePlural: "contrats", apiPath: "/contracts", prefix: "boond_contracts" };

/**
 * `/contracts` payload: the resource id becomes the `resource` relationship,
 * `note` the `informationComments` attribute (`models.contract` has no `note`),
 * and `id` — present on update — lands on `data.id`.
 */
export function buildContractBody(params: Record<string, unknown>): unknown {
  const { id, resourceId, note, ...attrs } = params;
  return buildJsonApiBody(
    "contract",
    { ...attrs, ...(note !== undefined ? { informationComments: note } : {}) },
    typeof id === "string" ? id : undefined,
    {
      resource: resourceId ? { id: String(resourceId), type: "resource" } : undefined,
    }
  );
}

/**
 * The contracts of one resource, as `/resources/{id}/administrative` includes
 * them (issue #253). Neither `GET /contracts` (WAF 403 page — the RAML only
 * documents `post`) nor `GET /resources/{id}/contracts` (404) exists, probed
 * live on 2026-09-26: the administrative tab is the only read path, and its
 * `included` carries the full contract objects. Each contract is tagged with
 * the resource it belongs to so a list spanning several resources stays
 * readable.
 */
export async function contractsOfResource(resourceId: string, label?: string): Promise<JsonApiResource[]> {
  const response = await apiRequest(`/resources/${resourceId}/administrative`);
  const included = Array.isArray(response.included) ? response.included : [];
  return included
    .filter((item) => item.type === "contract")
    .map((contract) => ({
      ...contract,
      attributes: { ...contract.attributes, resource: label ? `${label} (#${resourceId})` : `#${resourceId}` },
    }));
}

function dateOf(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined;
}

/** A contract with no `endDate` is open-ended: it runs until further notice. */
function overlaps(start: string | undefined, end: string | undefined, from?: string, to?: string): boolean {
  if (to !== undefined && start !== undefined && start > to) return false;
  if (from !== undefined && end !== undefined && end < from) return false;
  return true;
}

function within(date: string | undefined, from?: string, to?: string): boolean {
  if (date === undefined) return false;
  if (from !== undefined && date < from) return false;
  if (to !== undefined && date > to) return false;
  return true;
}

/** Server-side contract filters of the composed search (type, then period window). */
export function filterContracts(
  contracts: JsonApiResource[],
  filters: Pick<ContractSearchInput, "contractTypes" | "period" | "startDate" | "endDate">
): JsonApiResource[] {
  const { contractTypes, period, startDate: from, endDate: to } = filters;
  return contracts.filter((contract) => {
    const a = contract.attributes;
    if (contractTypes && contractTypes.length > 0 && !contractTypes.includes(Number(a.typeOf))) return false;
    if (!period) return true;
    const start = dateOf(a.startDate);
    const end = dateOf(a.endDate);
    switch (period) {
      case "running":
        return overlaps(start, end, from, to);
      case "ending":
        return within(end, from, to);
      case "starting":
        return within(start, from, to);
      case "probationEnding":
        return within(dateOf(a.probationEndDate), from, to) || within(dateOf(a.renewalProbationEndDate), from, to);
      default:
        return true;
    }
  });
}

/** One line per contract: who, which type, which dates, where the probation stands. */
export function contractSummary(contract: JsonApiResource): string {
  const a = contract.attributes;
  const parts = [`[contract #${contract.id}]`];
  if (a.resource !== undefined) parts.push(`Ressource: ${renderAttributeValue(a.resource)}`);
  if (a.typeOf !== undefined) parts.push(`Type: ${renderAttributeValue(a.typeOf)}`);
  const start = dateOf(a.startDate);
  const end = dateOf(a.endDate);
  if (start || end) parts.push(`${start ?? "?"} → ${end ?? "en cours"}`);
  const probation = dateOf(a.renewalProbationEndDate) ?? dateOf(a.probationEndDate);
  if (probation)
    parts.push(
      `Fin PE: ${probation}${a.probationState !== undefined ? ` (état ${renderAttributeValue(a.probationState)})` : ""}`
    );
  if (a.endReason !== undefined && a.endReason !== null && a.endReason !== "") {
    parts.push(`Motif fin: ${renderAttributeValue(a.endReason)}`);
  }
  return parts.join(" | ");
}

function resourceLabel(resource: JsonApiResource): string {
  const a = resource.attributes;
  const name = [a.firstName, a.lastName].filter((v) => typeof v === "string" && v.length > 0).join(" ");
  return name.length > 0 ? name : `ressource ${resource.id}`;
}

/** Bounded fan-out: a handful of administrative reads in flight, never the whole page at once. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      if (item === undefined) break;
      results[index] = await fn(item, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

const ADMINISTRATIVE_CONCURRENCY = 4;

export function registerContractTools(server: McpServer): void {
  // Composed search (issue #253): BoondManager has no contract list endpoint.
  server.registerTool(
    "boond_contracts_search",
    {
      title: "Rechercher des contrats de travail",
      description: composeDescription({
        purpose:
          "Recherche les contrats de travail (CDI, CDD, freelance…) des ressources d'un périmètre, avec filtres de type et de période (fins de contrat, périodes d'essai qui expirent).",
        when: "pour « contrats qui se terminent ce mois », « périodes d'essai qui expirent », « CDD à renouveler », ou les contrats d'une ressource.",
        instead:
          "`boond_resources_contracts` pour les contrats d'une seule ressource connue, `boond_contracts_get` pour la fiche complète d'un contrat.",
        behaviour: [
          "Recherche **composée** : BoondManager n'a pas de liste de contrats (`GET /contracts` n'existe pas). L'outil sélectionne les ressources (`keywords`, `perimeter*`, `resourceStates` ; `page` / `pageSize` portent sur les ressources parcourues) puis lit l'onglet administratif de chacune : une requête par ressource — préférer des pages modestes —, progression notifiée.",
          "`contractTypes` et `period` + `startDate` / `endDate` sont appliqués côté serveur sur les contrats lus ; un contrat sans `endDate` compte comme en cours.",
          "`resourceId` court-circuite la sélection : seuls les contrats de cette ressource sont lus.",
        ],
        returns:
          "une ligne par contrat (ressource, type, dates, fin de période d'essai, motif de fin) et `structuredContent.items[]` ; `total` = nombre de contrats retenus.",
      }),
      inputSchema: ContractSearchSchema,
      outputSchema: SearchOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params, extra: unknown) => {
      const p = params as ContractSearchInput & { fields?: string[] };
      const report = progressReporterFrom(extra);
      let targets: Array<{ id: string; label?: string }>;
      if (p.resourceId) {
        targets = [{ id: p.resourceId }];
      } else {
        const {
          resourceId: _skip,
          contractTypes: _t,
          period: _p,
          startDate: _s,
          endDate: _e,
          fields: _f,
          ...resourceParams
        } = p;
        const resources = await apiSearch("/resources", buildSearchQuery(resourceParams), report);
        const rows = Array.isArray(resources.data) ? resources.data : resources.data ? [resources.data] : [];
        targets = rows.map((row) => ({ id: row.id, label: resourceLabel(row) }));
      }
      const total = targets.length;
      let done = 0;
      const perResource = await mapWithConcurrency(targets, ADMINISTRATIVE_CONCURRENCY, async (target) => {
        const contracts = await contractsOfResource(target.id, target.label);
        done += 1;
        report(done, total, `${done}/${total} ressource(s) lue(s)`);
        return contracts;
      });
      const contracts = filterContracts(perResource.flat(), p);
      const response: JsonApiResponse = { data: contracts, meta: { totals: { rows: contracts.length } } };
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "contrat", p.fields, contractSummary) }],
        structuredContent: buildListStructured(response, p.fields, contractSummary),
      };
    }
  );

  registerGetTool(server, OPTS, {
    withTab: false,
    title: "Détails d'un contrat",
    description: composeDescription({
      purpose: "Récupère la fiche complète d'un contrat de travail par son ID numérique.",
      when: "après `boond_contracts_search` ou `boond_resources_contracts`, qui listent les contrats avec leurs IDs.",
      instead:
        "`boond_resources_contracts` pour tous les contrats d'une ressource en un appel — cet outil n'accepte pas de nom.",
      behaviour: [
        "Un ID inconnu remonte l'erreur BoondManager telle quelle — l'ID doit venir d'une liste de contrats, jamais d'une supposition.",
      ],
      returns: "JSON du contrat (attributs + relations) tel que renvoyé par l'API. Lecture seule.",
    }),
  });

  registerCreateTool(server, OPTS, ContractCreateSchema, buildContractBody, {
    title: "Créer un contrat",
    description: composeDescription({
      purpose: "Crée un contrat de travail rattaché à une ressource.",
      when: "pour enregistrer un nouveau contrat (embauche, avenant, renouvellement).",
      instead:
        "`boond_resources_contracts` d'abord, pour vérifier qu'un contrat couvrant la même période n'existe pas déjà.",
      behaviour: [
        "Écriture non idempotente : deux appels identiques créent deux contrats.",
        "`typeOf` est un ID entier de `boond://dictionary/typeOf/contracts`, pas un libellé.",
      ],
      returns: "confirmation et fiche du contrat créé, avec son ID dans `structuredContent.id`.",
    }),
  });

  // PUT /contracts/{id}: attributes only (issue #252). The RAML has no
  // information.raml for contracts, so the base resource is the PUT target —
  // the pattern /actions/{id} and /times-reports/{id} follow.
  registerUpdateTool(server, OPTS, ContractUpdateSchema, buildContractBody, { method: "PUT" });
}
