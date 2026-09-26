/**
 * One-line summaries of a JSON:API row for list output: the standard summary
 * (`formatEntitySummary`, with its business-identifier fallback) and the
 * `fields` projection. The named-row output is pinned byte-for-byte in tests.
 */
import { textExcerpt } from "./html.js";

/**
 * Business identifiers used as a last resort when a list row has no
 * human-readable identity (no name, no title, no dictionary `value`).
 *
 * Transactional endpoints (`/invoices`, `/orders`, `/actions`,
 * `/deliveries-groupments`, `/projects`…) key their rows on a reference, a
 * number or a date rather than on a name, so the standard summary rendered
 * them as a bare `[order #1234] | Statut: 1` — a line the model cannot act on
 * without a follow-up `_get` per row.
 *
 * These are deliberately NOT appended unconditionally: `/resources` and
 * `/opportunities` also carry `reference` and amount attributes, and their
 * rows already read well (name, title). Enriching them too would only inflate
 * every line. See `hasIdentity` in formatEntitySummary.
 */
const AMOUNT_FALLBACK_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["turnoverInvoicedExcludingTax", "CA facturé HT"],
  ["turnoverOrderedExcludingTax", "CA commandé HT"],
  ["turnoverSimulatedExcludingTax", "CA simulé HT"],
  ["averageDailyPriceExcludingTax", "TJM HT"],
];

/** Max amount entries appended to a fallback line, to keep it scannable. */
const MAX_FALLBACK_AMOUNTS = 2;

/**
 * Single rendering rule for a raw JSON:API attribute value, shared by the
 * fallback summary and the `fields` projection — some Boond amounts come back
 * as `{ amount, currency }` objects, and the two paths used to disagree
 * (`[object Object]` on one side, JSON on the other).
 */
export function renderAttributeValue(value: unknown): string {
  return value === null || typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * A row is considered to name itself through `value` only when that value is a
 * non-empty string once rendered. `value: null` / `value: ""` used to both
 * print a bogus token *and* suppress the business-identifier fallback.
 */
function hasValueIdentity(value: unknown): boolean {
  return value !== undefined && value !== null && renderAttributeValue(value) !== "";
}

/**
 * Secondary identifiers for rows that have no name/title/value. Order is
 * chosen so the most identifying token comes first (number, then reference,
 * then when it happened, then how much).
 */
function fallbackIdentityParts(attrs: Record<string, unknown>): string[] {
  const parts: string[] = [];

  if (attrs.number) parts.push(`N°: ${attrs.number}`);
  if (attrs.reference) parts.push(`Réf: ${attrs.reference}`);

  if (attrs.date) {
    parts.push(`Date: ${attrs.date}`);
  } else if (attrs.startDate && attrs.endDate) {
    parts.push(`Du ${attrs.startDate} au ${attrs.endDate}`);
  } else if (attrs.startDate) {
    parts.push(`Début: ${attrs.startDate}`);
  } else if (attrs.endDate) {
    parts.push(`Fin: ${attrs.endDate}`);
  }

  let amounts = 0;
  for (const [field, label] of AMOUNT_FALLBACK_FIELDS) {
    if (amounts >= MAX_FALLBACK_AMOUNTS) break;
    const value = attrs[field];
    // 0 is meaningful here (an order with no turnover yet), so only
    // undefined/null are skipped.
    if (value === undefined || value === null) continue;
    parts.push(`${label}: ${renderAttributeValue(value)}`);
    amounts++;
  }

  // `typeOf` is an integer resolved through boond://dictionary/typeOf/* — on
  // its own it is weak, but on an action it is often the only discriminator.
  if (attrs.typeOf !== undefined && attrs.typeOf !== null) parts.push(`Type: ${attrs.typeOf}`);

  // End-user-authored free text: labelled and quoted so the model reads it as
  // a data field of the row and not as server-authored instructions.
  if (typeof attrs.text === "string") {
    const excerpt = textExcerpt(attrs.text);
    if (excerpt !== undefined) parts.push(`Note: "${excerpt}"`);
  }

  return parts;
}

export function formatEntitySummary(entity: unknown): string {
  // A few BoondManager endpoints (e.g. `/calendars`, `/application/dictionary`)
  // return reference items as flat objects without a JSON:API `attributes`
  // wrapper. Treating the whole entity as the attribute bag in that case
  // keeps `formatListResponse` from crashing on `attrs.firstName` and yields
  // a still-useful summary.
  const e = (entity ?? {}) as Record<string, unknown>;
  const hasAttrs = e.attributes !== undefined && e.attributes !== null && typeof e.attributes === "object";
  const attrs: Record<string, unknown> = hasAttrs ? (e.attributes as Record<string, unknown>) : e;

  const id = e.id !== undefined ? String(e.id) : undefined;
  const type = e.type !== undefined ? String(e.type) : undefined;
  const header =
    id !== undefined && type !== undefined
      ? `[${type} #${id}]`
      : id !== undefined
        ? `[#${id}]`
        : type !== undefined
          ? `[${type}]`
          : "[item]";
  const parts: string[] = [header];

  // Common name fields
  if (attrs.firstName || attrs.lastName) {
    parts.push(`${attrs.firstName || ""} ${attrs.lastName || ""}`.trim());
  }
  if (attrs.name) parts.push(String(attrs.name));
  // `value` covers the `/calendars` and dictionary-style payloads. `0` is a
  // legitimate label there, so only null/undefined/"" are skipped.
  if (!attrs.firstName && !attrs.lastName && !attrs.name && hasValueIdentity(attrs.value)) {
    parts.push(renderAttributeValue(attrs.value));
  }
  if (attrs.email1) parts.push(`Email: ${attrs.email1}`);
  if (attrs.phone1) parts.push(`Tel: ${attrs.phone1}`);
  if (attrs.city) parts.push(`Ville: ${attrs.city}`);
  if (attrs.state !== undefined) parts.push(`Statut: ${attrs.state}`);
  if (attrs.title) parts.push(`Titre: ${attrs.title}`);
  if (attrs.iso !== undefined && String(attrs.iso) !== id) parts.push(`ISO: ${attrs.iso}`);

  // Rows that named themselves are already useful — leave them untouched.
  // Only the ones reduced to `[type #id]` (+ maybe a status integer) get the
  // business identifiers appended.
  const hasIdentity =
    Boolean(attrs.firstName) ||
    Boolean(attrs.lastName) ||
    Boolean(attrs.name) ||
    Boolean(attrs.title) ||
    hasValueIdentity(attrs.value);
  if (!hasIdentity) {
    parts.push(...fallbackIdentityParts(attrs));
  }

  return parts.join(" | ");
}

/**
 * One result line restricted to the caller-selected attribute names.
 * Unknown names are skipped silently (the schemas document this), so a typo
 * degrades to a shorter line rather than an error. Non-primitive values are
 * JSON-serialised — some Boond attributes are nested objects.
 */
export function formatProjectedSummary(entity: unknown, fields: string[]): string {
  const e = (entity ?? {}) as Record<string, unknown>;
  const attrs = (e.attributes ?? e) as Record<string, unknown>;
  // Reference endpoints return flat rows keyed on something else than `id`
  // (`/calendars` keys countries on `iso`), so a missing id renders as the same
  // `[item]` token the standard summary uses — not as a `[#?]` that reads like
  // a formatting bug.
  const parts: string[] = [e.id !== undefined ? `[#${String(e.id)}]` : "[item]"];
  for (const field of fields) {
    const value = attrs[field];
    if (value === undefined) continue;
    parts.push(`${field}: ${renderAttributeValue(value)}`);
  }
  return parts.join(" | ");
}
