import { createHash } from "node:crypto";
import { apiRequest } from "./boond-client.js";
import { oauthContext } from "./oauth.js";
import type { JsonApiResponse } from "../types.js";

/**
 * Cache du dictionnaire BoondManager.
 *
 * L'API BoondManager expose **un seul endpoint** `GET /application/dictionary`
 * qui retourne l'intégralité des dictionnaires (états, types, pays, devises,
 * langues, outils, expertises, …) en une seule réponse JSON. La structure
 * pertinente pour les outils du serveur est `data.setting.*` et
 * `data.{country,languages}` (cf. RAML `schemas/application/dictionary.json`).
 *
 * Sans cache, chaque lecture de ressource ou appel à `boond_application_dictionary`
 * forcerait un appel HTTP de plusieurs centaines de Ko, alors que le contenu
 * change rarement (libellés d'états, types métier, …). On cache donc en mémoire
 * pour la durée du process, avec un TTL configurable.
 *
 * Concurrent fetches sont dédupliqués via une promesse partagée pour éviter
 * de marteler l'API quand plusieurs ressources sont lues en parallèle au
 * démarrage d'une session MCP.
 *
 * **Le cache est partitionné par identité d'authentification et par langue**
 * (issue #226). Le dictionnaire n'est pas une table de référence globale : il
 * porte les états, agences, pôles et types *personnalisés* d'un tenant
 * BoondManager. En transport HTTP OAuth chaque requête arrive avec le token
 * d'un utilisateur — potentiellement d'un autre tenant — et le transport ne
 * vérifie que la *présence* du Bearer. Un cache unique par processus servait
 * donc le dictionnaire du premier appelant à tous les suivants, sans appel
 * Boond : une fuite inter-tenants. La clé est `sha256(token) + langue` ; en
 * stdio (credentials env, une seule identité par processus) elle se réduit à
 * `env + langue`, et le comportement mono-utilisateur est inchangé.
 */

export type DictionaryLanguage = "fr" | "en" | "es";

interface CacheEntry {
  payload: JsonApiResponse;
  fetchedAt: number;
  language: DictionaryLanguage;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Upper bound on cached (identity, language) pairs. Each entry is a full
 * dictionary payload (hundreds of KB), so the map is bounded; least recently
 * used entries are evicted first. 50 is plenty for a gateway serving a
 * handful of tenants and keeps the worst case around a few tens of MB.
 */
export const MAX_DICTIONARY_CACHE_ENTRIES = 50;

function resolveTtlMs(): number {
  const raw = process.env["BOOND_DICTIONARY_TTL_MS"];
  if (!raw) return DEFAULT_TTL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_MS;
}

/**
 * Identity half of the cache key.
 *
 * - OAuth (HTTP transport): the request's Bearer token, hashed so the raw
 *   credential never sits in a long-lived structure. Two users of the same
 *   tenant get two entries — a small over-fetch that is the price of not
 *   having to decode an opaque token to find its tenant.
 * - Everything else (stdio, HTTP static auth): the credentials are process
 *   wide, so a single constant identity is exact.
 */
export function currentAuthIdentity(): string {
  const ctx = oauthContext.getStore();
  if (!ctx) return "env";
  return `oauth:${createHash("sha256").update(ctx.accessToken).digest("hex")}`;
}

function cacheKey(language: DictionaryLanguage): string {
  return `${currentAuthIdentity()}|${language}`;
}

/** Insertion-ordered map used as an LRU: a hit re-inserts, an insert past the cap evicts the oldest. */
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry>>();

function touch(key: string, entry: CacheEntry): void {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > MAX_DICTIONARY_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export interface GetDictionaryOptions {
  language?: DictionaryLanguage;
  /** Bypass the cache and re-fetch. */
  force?: boolean;
}

/**
 * Returns the full BoondManager dictionary payload, fetching once per TTL
 * per (auth identity, language). Concurrent calls for the same key share
 * the same in-flight request; calls for different keys never do — an `en`
 * request must not be answered with the `fr` payload still loading.
 */
export async function getDictionary(opts: GetDictionaryOptions = {}): Promise<CacheEntry> {
  const language: DictionaryLanguage = opts.language ?? "fr";
  const key = cacheKey(language);
  const now = Date.now();

  if (!opts.force) {
    const hit = cache.get(key);
    if (hit !== undefined && now - hit.fetchedAt < resolveTtlMs()) {
      touch(key, hit);
      return hit;
    }
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const payload = await apiRequest("/application/dictionary", "GET", undefined, {
        language,
      });
      const entry: CacheEntry = { payload, fetchedAt: Date.now(), language };
      touch(key, entry);
      return entry;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, request);
  return request;
}

/**
 * Resolves a dotted path inside the dictionary `data` object.
 *
 * Examples:
 *   "setting.state.resource"       → array of resource states
 *   "setting.tool"                 → array of tools / technos
 *   "country"                      → array of countries
 *   "languages"                    → array of UI languages
 *   "setting.state.resource[0]"    → not supported (no bracket notation; pass plain dotted path)
 *
 * Returns `undefined` if any segment is missing.
 */
export function resolveDictionaryPath(payload: JsonApiResponse, path: string): unknown {
  const trimmed = path.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split(".");
  // The dictionary payload is `{ meta, data: { setting, country, languages, ... } }`.
  // We always look under `data` so callers don't have to repeat it.
  const root = (payload as unknown as { data?: unknown }).data;
  let node: unknown = root ?? payload;
  for (const part of parts) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
    if (node === undefined) return undefined;
  }
  return node;
}

/** Number of cached entries. Exposed for tests. */
export function dictionaryCacheSizeForTests(): number {
  return cache.size;
}

/** Reset the cache. Exposed for tests. */
export function resetDictionaryCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
