/**
 * Rendering of an entity-tab endpoint (`/resources/{id}/positionings`…).
 */
import { CHARACTER_LIMIT } from "../../constants.js";
import type { JsonApiResponse } from "../../types.js";
import { formatDetailResponse, projectEntity } from "./detail.js";

/**
 * Formate la réponse d'un endpoint d'onglet (ex: /resources/{id}/positionings).
 * Contrairement à formatDetailResponse, un tableau est restitué en entier :
 * certains onglets renvoient plusieurs entités (positionnements, contacts...)
 * et n'afficher que la première masquait les autres.
 */
export function formatTabResponse(response: JsonApiResponse): string {
  if (!Array.isArray(response.data)) {
    return formatDetailResponse(response);
  }

  const entities = response.data.map(projectEntity);

  // Some tabs carry aggregates in `meta.totals` beyond the row count —
  // `/orders/{id}/invoices` publishes the ordered / invoiced / remaining
  // turnover there (issue #258). They are the point of reading that tab, so
  // they are rendered ahead of the rows instead of being dropped.
  const totals = response.meta?.totals;
  const aggregates =
    totals && typeof totals === "object" ? Object.entries(totals).filter(([key]) => key !== "rows") : [];
  const header =
    aggregates.length > 0
      ? `${entities.length} élément(s) — totaux : ${JSON.stringify(Object.fromEntries(aggregates))}`
      : `${entities.length} élément(s)`;

  let result = `${header}\n\n` + JSON.stringify(entities, null, 2);

  if (result.length > CHARACTER_LIMIT) {
    result = result.substring(0, CHARACTER_LIMIT) + "\n\n[Résultat tronqué...]";
  }

  return result;
}
