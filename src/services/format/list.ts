/**
 * Text rendering of a search page: one summary line per row, a `Total:`
 * header when the API reports one, and truncation on line boundaries under
 * `CHARACTER_LIMIT` (a mid-line cut used to hide the row count).
 */
import { CHARACTER_LIMIT } from "../../constants.js";
import type { JsonApiResource, JsonApiResponse } from "../../types.js";
import { formatEntitySummary, formatProjectedSummary } from "./summary.js";

export function formatListResponse(
  response: JsonApiResponse,
  entityType: string,
  fields?: string[],
  summaryFn: (entity: JsonApiResource) => string = formatEntitySummary
): string {
  // `data: null` is what BoondManager answers on some empty windows
  // (`/times-reports` on a month with no report, #243); it used to become
  // `[null]` and crash the per-row summary.
  const data = Array.isArray(response.data) ? response.data : response.data ? [response.data] : [];
  const total = response.meta?.totals?.rows;

  if (data.length === 0) {
    return `Aucun(e) ${entityType} trouvé(e).`;
  }

  const projected = fields !== undefined && fields.length > 0;
  const lines = data.map((item) => (projected ? formatProjectedSummary(item, fields) : summaryFn(item)));
  const header = total !== undefined ? `Total: ${total} ${entityType}(s)\n\n` : "";
  const body = lines.join("\n");

  if (header.length + body.length <= CHARACTER_LIMIT) return header + body;

  // Cut on line boundaries and say how many rows were dropped. A mid-line cut
  // produced a half-row indistinguishable from a complete one, and the count
  // is what tells the model to narrow the query (or use `fields`/`pageSize`)
  // instead of trusting an implicitly complete page.
  const notice = (shown: number) =>
    `\n\n[Résultats tronqués : ${shown}/${lines.length} ligne(s) affichée(s) (limite de ${CHARACTER_LIMIT} caractères). ` +
    `Affinez les filtres, réduisez pageSize, ou utilisez 'fields' pour raccourcir chaque ligne.]`;
  const budget = CHARACTER_LIMIT - header.length - notice(lines.length).length;

  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const cost = kept.length === 0 ? line.length : line.length + 1;
    if (used + cost > budget) break;
    used += cost;
    kept.push(line);
  }

  // A single row longer than the whole budget still has to show something.
  if (kept.length === 0) return header + body.substring(0, Math.max(budget, 0)) + notice(0);

  return header + kept.join("\n") + notice(kept.length);
}
