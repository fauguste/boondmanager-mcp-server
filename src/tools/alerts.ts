import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AlertSearchSchema } from "../schemas/index.js";
import { apiSearch, formatListResponse } from "../services/boond-client.js";
import { renderAttributeValue } from "../services/format/summary.js";
import { progressReporterFrom } from "../services/progress.js";
import type { JsonApiResource } from "../types.js";
import { buildListStructured, SearchOutputSchema } from "./crud-factory.js";
import { composeDescription } from "./description-builders.js";

/**
 * The user's dashboard alerts (issue #255): what BoondManager itself computes
 * as needing attention (contract ends, probation ends, missing CRA, overdue
 * invoices, deliveries ending, opportunities without action…). Reading it is
 * the right first call for "what needs my attention today?", instead of
 * recomposing those rules with a dozen searches.
 *
 * `models.alert` (dictionary): `id`, `row`, `isAdministrator`, `isDaily`,
 * `isWeekly`, `params`, `module`, `state`, `indicator`. Not exercised live
 * (maintenance window while this was written): the summary prints every one
 * of those it finds and falls back to the generic summary otherwise.
 */
export function alertSummary(alert: JsonApiResource): string {
  const a = alert.attributes ?? {};
  const parts = [`[alert #${alert.id}]`];
  if (a.module !== undefined) parts.push(`Module: ${renderAttributeValue(a.module)}`);
  if (a.indicator !== undefined) parts.push(`Indicateur: ${renderAttributeValue(a.indicator)}`);
  if (a.state !== undefined) parts.push(`État: ${renderAttributeValue(a.state)}`);
  const cadence = [a.isDaily ? "quotidien" : undefined, a.isWeekly ? "hebdomadaire" : undefined].filter(Boolean);
  if (cadence.length) parts.push(`Rapport: ${cadence.join(" + ")}`);
  if (a.params !== undefined && a.params !== null && a.params !== "")
    parts.push(`Paramètres: ${renderAttributeValue(a.params)}`);
  for (const key of ["title", "name", "label", "count", "value"]) {
    if (a[key] !== undefined && a[key] !== null && a[key] !== "") parts.push(`${key}: ${renderAttributeValue(a[key])}`);
  }
  return parts.join(" | ");
}

export function registerAlertTools(server: McpServer): void {
  server.registerTool(
    "boond_alerts_search",
    {
      title: "Alertes du tableau de bord",
      description: composeDescription({
        purpose:
          "Liste les alertes du tableau de bord de l'utilisateur, calculées par BoondManager : fins de contrat et de période d'essai, CRA manquants, factures en retard, prestations qui se terminent, opportunités sans action…",
        when: "en premier, pour « qu'est-ce qui demande mon attention aujourd'hui ? » — avant de recomposer ces règles avec des recherches.",
        instead:
          "la ressource `boond://alerts/me` (même contenu en JSON, lecture cacheable) ; les outils `*_search` du module concerné pour agir.",
        behaviour: [
          "`GET /alerts` ne documente aucun filtre ni pagination : la liste est celle du tableau de bord de l'utilisateur authentifié.",
          "Les attributs rendus (`module`, `indicator`, `state`, `params`, cadence de rapport) sont ceux de `models.alert` ; forme non éprouvée sur un tenant de test.",
        ],
        returns: "une ligne par alerte et `structuredContent.items[]`. Lecture seule.",
      }),
      inputSchema: AlertSearchSchema,
      outputSchema: SearchOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params, extra: unknown) => {
      const { fields } = params as { fields?: string[] };
      const response = await apiSearch("/alerts", {}, progressReporterFrom(extra));
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "alerte", fields, alertSummary) }],
        structuredContent: buildListStructured(response, fields, alertSummary),
      };
    }
  );
}
