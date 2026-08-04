import type { DomainName } from "../constants.js";

/**
 * Wrong-filter-name → correction table, used to turn a `.strict()` schema
 * rejection into something the model can act on in one turn (SEP-1303: input
 * validation failures must surface as *tool* errors so the model can
 * self-correct, not as opaque protocol errors).
 *
 * Why this exists: the six main search endpoints take filter names that must
 * match the BoondManager API query parameters verbatim (see CLAUDE.md
 * §*Search Filter Naming*). The schemas are `.strict()`, so a wrong name is
 * rejected rather than silently ignored — but "Unrecognized key:
 * \"mainManagers\"" tells the model *that* it was wrong, never *what to use
 * instead*. Every entry below is a confusion we have actually seen (or that
 * the API's own naming invites), mapped to the correct name plus the one-line
 * reason the correct name behaves differently.
 *
 * The messages are consumed by `unknownFilterMessage()`, which the search
 * schemas install as their unrecognized-key error (see
 * `src/tools/validation-wrapper.ts`). Keep them short: they are read by a
 * model mid-call, not by a human reading docs.
 */

export interface FilterAlias {
  /** Input name to use instead. Absent when the filter simply does not exist on that endpoint. */
  correct?: string;
  /** One-line reason / usage note. Should say what the correct filter *does*, not just its name. */
  hint: string;
  /** Dictionary resource URI to read when the value is a state/type id. */
  dictionary?: string;
}

/**
 * Endpoints whose filter vocabulary differs (states/types are named after the
 * entity). Everything else only gets the global table.
 */
export type SearchEndpoint = Extract<
  DomainName,
  "resources" | "candidates" | "contacts" | "companies" | "opportunities" | "projects"
>;

const PERIMETER_DYNAMIC_NOTE = 'pour « mes données / mon équipe », `perimeterDynamic: ["data"|"managers"]`';

/** Confusions that are wrong on every endpoint. */
export const GLOBAL_FILTER_ALIASES: Readonly<Record<string, FilterAlias>> = {
  mainmanagers: {
    correct: "perimeterManagers",
    hint: `IDs des managers dont on veut l'équipe (${PERIMETER_DYNAMIC_NOTE})`,
  },
  managers: {
    correct: "perimeterManagers",
    hint: `IDs des managers dont on veut l'équipe (${PERIMETER_DYNAMIC_NOTE})`,
  },
  agencies: { correct: "perimeterAgencies", hint: "IDs d'agences ; combiner avec `narrowPerimeter: true` pour un ET" },
  poles: { correct: "perimeterPoles", hint: "IDs de pôles" },
  businessunits: { correct: "perimeterBusinessUnits", hint: "IDs de business units" },
  // Pagination: `maxResults` is the *API* name; the tools expose `pageSize`.
  maxresults: { correct: "pageSize", hint: "le nom API `maxResults` est dérivé côté serveur" },
  limit: { correct: "pageSize", hint: "nombre de résultats par page" },
  perpage: { correct: "pageSize", hint: "nombre de résultats par page" },
  offset: { correct: "page", hint: "pagination par numéro de page, pas par offset" },
  start: { correct: "page", hint: "pagination par numéro de page, pas par offset" },
  sortby: { correct: "sort", hint: "nom du champ de tri" },
  orderby: { correct: "order", hint: '"asc" ou "desc"' },
  q: { correct: "keywords", hint: "recherche plein texte" },
  query: { correct: "keywords", hint: "recherche plein texte" },
  search: { correct: "keywords", hint: "recherche plein texte" },
  name: { correct: "keywords", hint: 'cibler un champ précis via `keywordsType` (ex: "lastName", "fullName")' },
  fullname: { correct: "keywords", hint: '`keywordsType: "fullName"` avec `keywords: "NOM#PRENOM"`' },
  lastname: { correct: "keywords", hint: '`keywordsType: "lastName"`' },
  firstname: { correct: "keywords", hint: '`keywordsType: "firstName"`' },
  email: { correct: "keywords", hint: '`keywordsType: "emails"`' },
  emails: { correct: "keywords", hint: '`keywordsType: "emails"`' },
  // Linked-entity lookups go through the `keywords` prefix syntax.
  companyid: {
    correct: "keywords",
    hint: 'entité liée : `keywords: "CSOC<id>"` (projets : filtre `companies: [<id>]`)',
  },
  contactid: { correct: "keywords", hint: 'entité liée : `keywords: "CCON<id>"`' },
  candidateid: { correct: "keywords", hint: 'entité liée : `keywords: "CAND<id>"`' },
  resourceid: { correct: "keywords", hint: 'entité liée : `keywords: "COMP<id>"`' },
  opportunityid: { correct: "keywords", hint: 'entité liée : `keywords: "AO<id>"`' },
  projectid: { correct: "keywords", hint: 'entité liée : `keywords: "PRJ<id>"`' },
};

const STATES_URI = (entity: string) => `boond://dictionary/states/${entity}`;
const TYPEOF_URI = (entity: string) => `boond://dictionary/typeOf/${entity}`;

/**
 * Endpoint-specific confusions. `states` and `typeOf` are the two names the
 * model reaches for by default; on four of the six endpoints they are prefixed
 * with the entity, on `/contacts` it is `typesOf` (with the s), and
 * `/companies` has no type filter at all.
 */
export const ENDPOINT_FILTER_ALIASES: Readonly<Record<SearchEndpoint, Readonly<Record<string, FilterAlias>>>> = {
  resources: {
    states: { correct: "resourceStates", hint: "IDs d'états (entiers)", dictionary: STATES_URI("resources") },
    excludestates: {
      correct: "excludeResourceStates",
      hint: "IDs d'états à exclure",
      dictionary: STATES_URI("resources"),
    },
    typeof: { correct: "resourceTypes", hint: "IDs de types (entiers)", dictionary: TYPEOF_URI("resources") },
    types: { correct: "resourceTypes", hint: "IDs de types (entiers)", dictionary: TYPEOF_URI("resources") },
    typesof: { correct: "resourceTypes", hint: "IDs de types (entiers)", dictionary: TYPEOF_URI("resources") },
  },
  candidates: {
    states: { correct: "candidateStates", hint: "IDs d'états (entiers)", dictionary: STATES_URI("candidates") },
    typeof: { correct: "candidateTypes", hint: "IDs de types (entiers)", dictionary: TYPEOF_URI("resources") },
    types: { correct: "candidateTypes", hint: "IDs de types (entiers)", dictionary: TYPEOF_URI("resources") },
    typesof: { correct: "candidateTypes", hint: "IDs de types (entiers)", dictionary: TYPEOF_URI("resources") },
  },
  contacts: {
    typeof: {
      correct: "typesOf",
      hint: "avec un `s` : `typesOf` (IDs entiers)",
      dictionary: TYPEOF_URI("contacts"),
    },
    types: { correct: "typesOf", hint: "IDs de types de contact (entiers)", dictionary: TYPEOF_URI("contacts") },
    contactstates: {
      correct: "states",
      hint: "sur /contacts le filtre s'appelle `states`",
      dictionary: STATES_URI("contacts"),
    },
  },
  companies: {
    typeof: {
      hint: "/companies n'expose aucun filtre de type — filtrer sur `states`, `activityAreas` ou après lecture",
    },
    types: {
      hint: "/companies n'expose aucun filtre de type — filtrer sur `states`, `activityAreas` ou après lecture",
    },
    companystates: {
      correct: "states",
      hint: "sur /companies le filtre s'appelle `states`",
      dictionary: STATES_URI("companies"),
    },
  },
  opportunities: {
    states: { correct: "opportunityStates", hint: "IDs d'états (entiers)", dictionary: STATES_URI("opportunities") },
    typeof: { correct: "opportunityTypes", hint: "IDs de types", dictionary: TYPEOF_URI("projects") },
    types: { correct: "opportunityTypes", hint: "IDs de types", dictionary: TYPEOF_URI("projects") },
  },
  projects: {
    states: { correct: "projectStates", hint: "IDs d'états (entiers)", dictionary: STATES_URI("projects") },
    typeof: { correct: "projectTypes", hint: "IDs de types (entiers)", dictionary: TYPEOF_URI("projects") },
    types: { correct: "projectTypes", hint: "IDs de types (entiers)", dictionary: TYPEOF_URI("projects") },
    company: { correct: "companies", hint: "tableau d'IDs de sociétés, ex: `companies: [42]`" },
  },
};

/**
 * Lookup key: lowercase, separators stripped. So `max_results`, `maxResults`
 * and `MAXRESULTS` all resolve to the same entry — the model's mistakes are
 * about the *word*, not its casing.
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, "");
}

/** Resolve a wrong filter name to its correction, endpoint-specific table first. */
export function resolveFilterAlias(key: string, endpoint?: SearchEndpoint): FilterAlias | undefined {
  const norm = normalizeKey(key);
  if (endpoint) {
    const specific = ENDPOINT_FILTER_ALIASES[endpoint][norm];
    if (specific) return specific;
  }
  return GLOBAL_FILTER_ALIASES[norm];
}

/** Levenshtein distance, capped: we only care about "is it within 2 edits". */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * Closest accepted key within 2 edits (case/separator-insensitive), for typos
 * the alias table doesn't know about (`pagesize`, `keywordType`, …).
 */
export function closestKey(key: string, validKeys: readonly string[]): string | undefined {
  const norm = normalizeKey(key);
  let best: { key: string; distance: number } | undefined;
  for (const candidate of validKeys) {
    const distance = editDistance(norm, normalizeKey(candidate), 2);
    if (distance <= 2 && (best === undefined || distance < best.distance)) {
      best = { key: candidate, distance };
    }
  }
  return best?.key;
}

/** Cap the accepted-filters list so one bad key can't produce a wall of text. */
const MAX_ACCEPTED_KEYS_LISTED = 25;

/**
 * Build the text returned to the model when a search call carries unknown
 * filter names. Shape, per unknown key:
 *
 *   Filtre inconnu « mainManagers » → utiliser `perimeterManagers` (…).
 *
 * plus, when the correction is a state/type filter, the dictionary resource to
 * read for the ids. Ends with the accepted filter list so the model can retry
 * from the error alone rather than re-reading the whole tool schema.
 */
export function unknownFilterMessage(
  keys: readonly string[],
  validKeys: readonly string[],
  endpoint?: SearchEndpoint
): string {
  const lines: string[] = [];
  for (const key of keys) {
    const alias = resolveFilterAlias(key, endpoint);
    if (alias?.correct) {
      const dict = alias.dictionary ? ` — IDs via ${alias.dictionary}` : "";
      lines.push(`Filtre inconnu « ${key} » → utiliser \`${alias.correct}\` : ${alias.hint}${dict}.`);
      continue;
    }
    if (alias) {
      lines.push(`Filtre inconnu « ${key} » : ${alias.hint}.`);
      continue;
    }
    const near = closestKey(key, validKeys);
    lines.push(
      near !== undefined
        ? `Filtre inconnu « ${key} » → vouliez-vous dire \`${near}\` ?`
        : `Filtre inconnu « ${key} » : non supporté par cet endpoint (ne pas le renvoyer).`
    );
  }

  const listed = validKeys.slice(0, MAX_ACCEPTED_KEYS_LISTED);
  const suffix = validKeys.length > listed.length ? `, … (${validKeys.length} au total)` : "";
  if (listed.length > 0) {
    lines.push(`Filtres acceptés : ${listed.join(", ")}${suffix}.`);
  }
  return lines.join("\n");
}
