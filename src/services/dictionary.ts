import { apiRequest } from "./boond-client.js";
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
 */

export type DictionaryLanguage = "fr" | "en" | "es";

interface CacheEntry {
  payload: JsonApiResponse;
  fetchedAt: number;
  language: DictionaryLanguage;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

function resolveTtlMs(): number {
  const raw = process.env["BOOND_DICTIONARY_TTL_MS"];
  if (!raw) return DEFAULT_TTL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_MS;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<CacheEntry> | null = null;

export interface GetDictionaryOptions {
  language?: DictionaryLanguage;
  /** Bypass the cache and re-fetch. */
  force?: boolean;
}

/**
 * Returns the full BoondManager dictionary payload, fetching once per TTL.
 * Concurrent calls share the same in-flight request.
 */
export async function getDictionary(opts: GetDictionaryOptions = {}): Promise<CacheEntry> {
  const language: DictionaryLanguage = opts.language ?? "fr";
  const now = Date.now();

  if (!opts.force && cache !== null && cache.language === language && now - cache.fetchedAt < resolveTtlMs()) {
    return cache;
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const payload = await apiRequest("/application/dictionary", "GET", undefined, {
        language,
      });
      cache = { payload, fetchedAt: Date.now(), language };
      return cache;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
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

/** Reset the cache. Exposed for tests. */
export function resetDictionaryCacheForTests(): void {
  cache = null;
  inFlight = null;
}
