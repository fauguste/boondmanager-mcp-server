/**
 * Linked-entity filters → `keywords` references (issue #247).
 *
 * BoondManager's list endpoints have **no** `companyId` / `projectId` /
 * `resourceId` query parameters. A related entity is selected through a
 * prefixed reference inside `keywords` — `CSOC<id>` (company), `PRJ<id>`
 * (project), `COMP<id>` (resource), `CAND<id>` (candidate), `CCON<id>`
 * (contact), `AO<id>` (opportunity), `ACH<id>` (purchase), `BDC<id>` (order),
 * `FACT<id>` (invoice), `MIS<id>` (delivery), `PROD<id>` (product),
 * `CTR<id>` (contract) — documented per endpoint in the RAML and verified
 * against the live API on 2026-09-25: `GET /invoices?companyId=6221` returned
 * the whole table (29 893 rows, same as with no filter at all), while
 * `keywords=CSOC6221` returned 2. An unknown query parameter is ignored
 * silently, so a tool that forwarded `companyId` verbatim answered "the
 * invoices of X" with *every* invoice, presented as filtered.
 *
 * The search schemas keep the `*Id` fields — they are what a model reaches
 * for — and every search handler runs its params through `toKeywordReferences`
 * before building the query, so the conversion cannot be forgotten per domain.
 * Not every endpoint honours every prefix (the RAML lists them); a prefix an
 * endpoint does not know simply matches nothing, which is still a visible
 * "0 results", never a silently unfiltered page.
 */

export const KEYWORD_PREFIX_BY_FILTER = {
  candidateId: "CAND",
  resourceId: "COMP",
  contactId: "CCON",
  companyId: "CSOC",
  projectId: "PRJ",
  opportunityId: "AO",
  purchaseId: "ACH",
  orderId: "BDC",
  invoiceId: "FACT",
  deliveryId: "MIS",
  productId: "PROD",
  contractId: "CTR",
} as const;

export type LinkedEntityFilter = keyof typeof KEYWORD_PREFIX_BY_FILTER;

const FILTER_NAMES = Object.keys(KEYWORD_PREFIX_BY_FILTER) as LinkedEntityFilter[];

/**
 * Move every linked-entity `*Id` filter present in `params` into `keywords`
 * as `<PREFIX><id>` (appended after the caller's own keywords, space
 * separated) and drop the `*Id` keys. Keys that are absent or `undefined` are
 * left alone; other keys pass through untouched.
 */
export function toKeywordReferences<T extends Record<string, unknown>>(
  params: T
): Omit<T, LinkedEntityFilter> & { keywords?: string } {
  const rest: Record<string, unknown> = { ...params };
  const tokens: string[] = [];
  const own = rest.keywords;
  if (typeof own === "string" && own.trim().length > 0) tokens.push(own.trim());
  for (const name of FILTER_NAMES) {
    const value = rest[name];
    delete rest[name];
    if (value === undefined || value === null || value === "") continue;
    tokens.push(`${KEYWORD_PREFIX_BY_FILTER[name]}${String(value)}`);
  }
  if (tokens.length > 0) rest.keywords = tokens.join(" ");
  else delete rest.keywords;
  return rest as Omit<T, LinkedEntityFilter> & { keywords?: string };
}
