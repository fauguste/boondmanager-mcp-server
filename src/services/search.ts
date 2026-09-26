/**
 * Collection search: query building from a tool's params and the per-route
 * `maxResults` ceiling with transparent chunking (see `ROUTE_MAX_RESULTS`).
 */
import { DEFAULT_MAX_RESULTS, DEFAULT_PAGE_SIZE, ROUTE_MAX_RESULTS } from "../constants.js";
import type { JsonApiResource, JsonApiResponse, SearchParams } from "../types.js";
import { apiRequest, type QueryValue } from "./http/transport.js";
import type { ProgressReporter } from "./progress.js";

export function buildSearchQuery(params: SearchParams): Record<string, QueryValue> {
  const query: Record<string, QueryValue> = {};

  if (params.keywords) query["keywords"] = params.keywords;
  if (params.page !== undefined) query["page"] = params.page;
  if (params.pageSize !== undefined) query["maxResults"] = params.pageSize;

  // Forward any additional filter params (strings, numbers, or arrays).
  // `fields` is a client-side projection consumed by formatListResponse,
  // never a BoondManager query parameter.
  for (const [key, value] of Object.entries(params)) {
    if (["keywords", "page", "pageSize", "fields"].includes(key)) continue;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      // Pass arrays through so apiRequest emits repeated bracket notation
      query[key] = value as Array<string | number>;
    } else if (typeof value === "string" || typeof value === "number") {
      query[key] = value;
    } else {
      query[key] = String(value);
    }
  }

  return query;
}

/**
 * Search wrapper around `apiRequest` that enforces BoondManager's per-route
 * `maxResults` ceiling (see `ROUTE_MAX_RESULTS`). When the caller requests more
 * results than the route allows, the request is transparently split into
 * chunks of `cap` records and the pages are merged into a single JSON:API
 * response — the caller still receives the full page, but BoondManager never
 * sees `maxResults` above the cap (which overflows memory on `/actions`).
 *
 * Routes whose ceiling already covers the requested page size take the fast
 * path: a single `apiRequest`, byte-for-byte identical to calling it directly.
 * The chunk count is bounded by `ceil((offset + requested) / cap)`, so there is
 * no unbounded loop; the loop also stops early once a page comes back short
 * (end of the result set on the server).
 *
 * `onProgress` (optional, last position — no existing caller had to change) is
 * invoked **only on the chunked path**: one step per BoondManager page. The
 * fast path stays silent on purpose — a single API call has nothing to report
 * and a "1/1" notification would be pure noise. The reporter is a no-op unless
 * the client sent a `progressToken` (see `services/progress.ts`).
 */
export async function apiSearch(
  path: string,
  query: Record<string, QueryValue>,
  onProgress?: ProgressReporter
): Promise<JsonApiResponse> {
  const cap = ROUTE_MAX_RESULTS[path] ?? DEFAULT_MAX_RESULTS;
  const requested = typeof query["maxResults"] === "number" ? query["maxResults"] : DEFAULT_PAGE_SIZE;
  const page = typeof query["page"] === "number" ? query["page"] : 1;

  // Fast path: one call, maxResults left exactly as the caller built it.
  if (requested <= cap) {
    return apiRequest(path, "GET", undefined, query);
  }

  // Chunked path: fetch `requested` records starting at the absolute offset
  // implied by (page, requested), in BoondManager pages of `cap` records.
  const startRow = (page - 1) * requested;
  const firstBoondPage = Math.floor(startRow / cap) + 1;
  const offsetInFirstChunk = startRow % cap;
  const needed = offsetInFirstChunk + requested;

  const collected: JsonApiResource[] = [];
  let meta: JsonApiResponse["meta"];
  // Upper bound of the loop, and the `total` advertised to the client. It stays
  // constant across the notifications of one call, as the spec requires.
  const totalChunks = Math.ceil(needed / cap);
  let fetchedChunks = 0;

  for (let i = 0; collected.length < needed; i++) {
    const chunkQuery: Record<string, QueryValue> = { ...query, page: firstBoondPage + i, maxResults: cap };
    const response = await apiRequest(path, "GET", undefined, chunkQuery);
    if (meta === undefined) meta = response.meta;
    const chunk = Array.isArray(response.data) ? response.data : response.data ? [response.data] : [];
    collected.push(...chunk);
    fetchedChunks = i + 1;
    onProgress?.(fetchedChunks, totalChunks, `Récupération ${path} — page ${fetchedChunks}/${totalChunks}`);
    // A short page means there is no more data on the server — stop early.
    if (chunk.length < cap) break;
  }

  const data = collected.slice(offsetInFirstChunk, offsetInFirstChunk + requested);
  // Early stop (result set exhausted): close the bar rather than leaving the
  // client at 2/5 forever. Skipped when the last page already reported `total`,
  // which would repeat a value instead of increasing it.
  if (fetchedChunks < totalChunks) {
    onProgress?.(totalChunks, totalChunks, `Récupération ${path} — terminé (${data.length} résultat(s))`);
  }
  return meta !== undefined ? { data, meta } : { data };
}
