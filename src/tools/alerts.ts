import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AlertSearchSchema } from "../schemas/index.js";
import { apiSearch, formatListResponse } from "../services/boond-client.js";
import { renderAttributeValue } from "../services/format/summary.js";
import { progressReporterFrom } from "../services/progress.js";
import type { JsonApiResource } from "../types.js";
import { buildListStructured, SearchOutputSchema } from "./crud-factory.js";
import { composeDescription } from "./description-builders.js";

/**
 * The user's dashboard alerts (issue #255). Observed live on 2026-09-26
 * (issue #311): `GET /alerts` returns the **configuration** of the user's
 * dashboard indicators, not computed occurrences — one row per indicator
 * (`module`: actions | activityExpenses | resources…, `indicator`:
 * `contractsEndedUpcoming`, `resourcesProbationaryDateUpcoming`,
 * `timesReportsWithNoValidation`, `actionsUpcoming`…) with its `params`
 * (`period` in days or `-1` = last month, `X` / `Y` = state or type ids,
 * `perimeter` such as `dynamic_data`) and the daily / weekly report flags.
 * There is no `/alerts/{id}` (404). So the list says *what* to watch and with
 * which thresholds; the matching `*_search` gives the items — which is what
 * the `attention_du_jour` prompt does.
 */
export function alertSummary(alert: JsonApiResource): string {
  const a = alert.attributes ?? {};
  const parts = [`[alert #${alert.id}]`];
  if (a.module !== undefined) parts.push(`Module: ${renderAttributeValue(a.module)}`);
  if (a.indicator !== undefined) parts.push(`Indicateur: ${renderAttributeValue(a.indicator)}`);
  if (a.state !== undefined) parts.push(`État: ${renderAttributeValue(a.state)}`);
  const cadence = [a.isDaily ? "quotidien" : undefined, a.isWeekly ? "hebdomadaire" : undefined].filter(Boolean);
  if (cadence.length) parts.push(`Rapport: ${cadence.join(" + ")}`);
  const params = a.params && typeof a.params === "object" ? (a.params as Record<string, unknown>) : undefined;
  if (params) {
    const bits: string[] = [];
    if (params.period !== undefined) bits.push(`period=${String(params.period)}`);
    for (const key of ["X", "Y", "Z"]) {
      const v = params[key];
      if (Array.isArray(v) && v.length > 0) bits.push(`${key}=[${v.map(String).join(",")}]`);
    }
    if (Array.isArray(params.perimeter) && params.perimeter.length > 0) {
      bits.push(`perimeter=${params.perimeter.map(String).join(",")}`);
    }
    if (bits.length) parts.push(`Paramètres: ${bits.join(" ")}`);
  } else if (a.params !== undefined && a.params !== null && a.params !== "") {
    parts.push(`Paramètres: ${renderAttributeValue(a.params)}`);
  }
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
          "Liste les indicateurs d'alerte configurés sur le tableau de bord de l'utilisateur (fins de contrat, périodes d'essai, CRA / notes / absences non validés, actions à venir…) avec leurs seuils : période en jours, états visés, périmètre.",
        when: "en premier, pour « qu'est-ce qui demande mon attention aujourd'hui ? » — la liste dit *quoi* surveiller et avec quels seuils ; l'outil `*_search` du module donne les éléments.",
        instead:
          "la ressource `boond://alerts/me` (même contenu en JSON) ; le prompt `attention_du_jour` enchaîne indicateur → recherche.",
        behaviour: [
          "`GET /alerts` renvoie la **configuration** des indicateurs, pas des occurrences (vérifié le 2026-09-26) : une ligne par indicateur, `params.period` en jours (`-1` = mois précédent), `X` / `Y` = IDs d'états ou de types, `perimeter` (`dynamic_data` = mes données). Aucun filtre, aucune pagination, pas de `/alerts/{id}`.",
          'Correspondances : `contractsEndedUpcoming` → `boond_contracts_search` `period: "ending"` ; `resourcesProbationaryDateUpcoming` → `period: "probationEnding"` ; `timesReportsWithNoValidation` / `expensesReportsWithNoValidation` / `absencesReportsWithNoValidation` → `boond_validations_search` (`documentTypes`, `waitingForValidation`) ; `actionsUpcoming` → `boond_actions_search` `period: "started"`.',
        ],
        returns:
          "une ligne par indicateur (`module`, `indicator`, paramètres, cadence de rapport) et `structuredContent.items[]`. Lecture seule.",
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
