import { readFileSync } from "node:fs";
import { z } from "zod";
import { logger } from "../services/logger.js";

/**
 * Dictionary overrides: let operators whose BoondManager instance uses
 * customised dictionary labels (e.g. English action types or states) declare
 * a label→id mapping, so the model can pass human labels instead of opaque
 * numeric dictionary ids.
 *
 * Env var (optional):
 *  - `BOOND_DICTIONARY_OVERRIDES` Either inline JSON (the value starts with
 *    `{`) or a path to a UTF-8 JSON file. Expected shape:
 *
 *    {
 *      "action": { "contact": { "Call": 61, "Email": 63 }, "candidate": { ... } },
 *      "state":  { "candidate": { "Interviewed": 2 }, "opportunity": { ... } }
 *    }
 *
 * Both sections are optional. Unknown entity keys are warned-and-ignored.
 * Any hard error (unreadable file, invalid JSON, invalid structure) is logged
 * as a warning and the overrides are simply disabled: the server ALWAYS
 * starts (fail-open, same philosophy as services/update-checker.ts).
 *
 * This is a pure input-side convenience: it never translates API responses.
 */

/** Entities that can carry an action `typeOf` (see `setting.action.*`). */
export const ACTION_ENTITIES = ["contact", "candidate", "resource", "opportunity", "project"] as const;

/** Entities that carry a `state` attribute (see `setting.state.*`). */
export const STATE_ENTITIES = [
  "candidate",
  "resource",
  "contact",
  "company",
  "opportunity",
  "project",
  "positioning",
  "quotation",
  "product",
  "invoice",
  "order",
  "absence",
] as const;

export type OverrideSection = "action" | "state";

/** Custom label → numeric dictionary id. */
export type LabelMap = Record<string, number>;

export interface DictionaryOverrides {
  action: Partial<Record<string, LabelMap>>;
  state: Partial<Record<string, LabelMap>>;
}

// Values must be numeric dictionary ids (>= 0).
const LabelMapSchema = z.record(z.string().min(1), z.number().int().min(0));

// Top-level shape. `.strict()` so a typo like "actions" fails loudly (warn +
// disabled) instead of being silently dropped.
const OverridesFileSchema = z
  .object({
    action: z.record(z.string(), LabelMapSchema).optional(),
    state: z.record(z.string(), LabelMapSchema).optional(),
  })
  .strict();

// --- Env parsing helper (mirroring config/access-policy.ts) ---

function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  // Ignore unresolved placeholders like "${SOMETHING}" (same guard as http.ts).
  if (raw.startsWith("${")) return undefined;
  if (raw.trim().length === 0) return undefined;
  return raw;
}

/** Keep only known entity keys; warn-and-ignore the rest (never fatal). */
function filterKnownEntities(
  section: OverrideSection,
  raw: Record<string, LabelMap>,
  known: readonly string[],
  log: typeof logger
): Partial<Record<string, LabelMap>> {
  const out: Partial<Record<string, LabelMap>> = {};
  for (const [entity, labels] of Object.entries(raw)) {
    if (known.includes(entity)) {
      if (Object.keys(labels).length > 0) out[entity] = labels;
    } else {
      log.warn(
        { section, entity, known: [...known] },
        `BOOND_DICTIONARY_OVERRIDES: unknown ${section} entity "${entity}" ignored`
      );
    }
  }
  return out;
}

/**
 * Load and validate the overrides from the environment. Resilient: any error
 * is logged as a warning and `null` is returned — the server always starts.
 */
export function loadDictionaryOverrides(env: NodeJS.ProcessEnv = process.env): DictionaryOverrides | null {
  const log = logger.child({ component: "dictionary-overrides" });
  const raw = readEnv(env, "BOOND_DICTIONARY_OVERRIDES");
  if (raw === undefined) return null;

  // Inline JSON if the value starts with "{", otherwise a file path.
  let text = raw;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) {
    try {
      text = readFileSync(trimmed, "utf-8");
    } catch (err) {
      log.warn(
        { path: trimmed, err: err instanceof Error ? err.message : String(err) },
        "BOOND_DICTIONARY_OVERRIDES: cannot read overrides file; custom labels disabled"
      );
      return null;
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "BOOND_DICTIONARY_OVERRIDES: invalid JSON; custom labels disabled"
    );
    return null;
  }

  const result = OverridesFileSchema.safeParse(parsed);
  if (!result.success) {
    log.warn({ issues: result.error.issues }, "BOOND_DICTIONARY_OVERRIDES: invalid structure; custom labels disabled");
    return null;
  }

  const overrides: DictionaryOverrides = {
    action: filterKnownEntities("action", result.data.action ?? {}, ACTION_ENTITIES, log),
    state: filterKnownEntities("state", result.data.state ?? {}, STATE_ENTITIES, log),
  };

  if (Object.keys(overrides.action).length === 0 && Object.keys(overrides.state).length === 0) {
    log.warn("BOOND_DICTIONARY_OVERRIDES: no usable entry after validation; custom labels disabled");
    return null;
  }

  log.info(
    {
      actionEntities: Object.keys(overrides.action),
      stateEntities: Object.keys(overrides.state),
    },
    "Dictionary overrides active: custom labels will be resolved to numeric ids"
  );
  return overrides;
}

// --- Lazy singleton over process.env ---
// Loaded on first use (NOT at import time) so tests can set the env var after
// importing modules that depend on this one.

let cached: DictionaryOverrides | null = null;
let loaded = false;

export function getDictionaryOverrides(): DictionaryOverrides | null {
  if (!loaded) {
    cached = loadDictionaryOverrides(process.env);
    loaded = true;
  }
  return cached;
}

/** Reset the singleton (tests only). */
export function resetDictionaryOverridesForTests(): void {
  cached = null;
  loaded = false;
}

// --- Resolution helpers ---

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

function labelMapFor(section: OverrideSection, entity: string): LabelMap | undefined {
  const overrides = getDictionaryOverrides();
  return overrides?.[section][entity];
}

/**
 * Resolve a custom label to its numeric dictionary id. Matching is
 * case-insensitive and ignores leading/trailing whitespace.
 */
export function resolveLabel(section: OverrideSection, entity: string, label: string): number | undefined {
  const map = labelMapFor(section, entity);
  if (!map) return undefined;
  const wanted = normalizeLabel(label);
  for (const [key, id] of Object.entries(map)) {
    if (normalizeLabel(key) === wanted) return id;
  }
  return undefined;
}

/** Labels declared for a section/entity (original casing), or [] if none. */
export function availableLabels(section: OverrideSection, entity: string): string[] {
  const map = labelMapFor(section, entity);
  return map ? Object.keys(map) : [];
}

/** Compact "Label=id, Label=id" summary for a section/entity, or null if none. */
export function formatOverridesSummary(section: OverrideSection, entity: string): string | null {
  const map = labelMapFor(section, entity);
  if (!map) return null;
  const entries = Object.entries(map);
  if (entries.length === 0) return null;
  return entries.map(([label, id]) => `${label}=${id}`).join(", ");
}

/**
 * Append the accepted custom labels to a schema/tool description. Returns the
 * base string unchanged (byte-for-byte) when no override is configured for
 * this section/entity.
 */
export function appendOverridesToDescription(base: string, section: OverrideSection, entity: string): string {
  const summary = formatOverridesSummary(section, entity);
  if (summary === null) return base;
  return `${base}\nLibellés personnalisés acceptés (résolus automatiquement) : ${summary}`;
}
