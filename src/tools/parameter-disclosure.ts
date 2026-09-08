import { FIELDS_DISCLOSURE, PAGINATION_DISCLOSURE } from "./description-builders.js";

/**
 * Central, drift-proof disclosure of the two parameters whose *semantics* live
 * outside their schema entry.
 *
 * `fields` is applied client-side and never forwarded to BoondManager;
 * `page` / `pageSize` are **rejected** past their ceilings rather than clamped.
 * Neither fact is derivable from the JSON Schema the client receives, and both
 * were missing from ~32 tool descriptions — including the two lowest-scoring
 * tools in the catalogue, whose only real defect was that.
 *
 * Applied from `registration-decorators.ts` for the same reason the filter
 * hints are: 182 tools are registered across 38 files, and a rule that has to
 * be remembered in each of them is a rule that decays. Adding a search tool
 * now discloses `fields` whether or not its author thought about it.
 *
 * Two properties keep this from becoming boilerplate:
 *
 * - it appends **only what the tool actually declares** (a tool with no
 *   `fields` key gets no `fields` paragraph), read off the advertised schema
 *   shape rather than off the tool name; and
 * - it appends nothing when the description already covers the parameter, so a
 *   hand-written description that explains `fields` in its own words is left
 *   alone instead of repeating itself. Conciseness is a scored dimension, and
 *   a duplicated paragraph is worse than an absent one.
 */

/** Zod object schemas expose their keys through `.shape`; raw shapes are plain objects. */
function declaredKeys(inputSchema: unknown): Set<string> {
  if (inputSchema === null || typeof inputSchema !== "object") return new Set();
  const shape = (inputSchema as { shape?: unknown }).shape ?? inputSchema;
  const resolved = typeof shape === "function" ? (shape as () => unknown)() : shape;
  if (resolved === null || typeof resolved !== "object") return new Set();
  return new Set(Object.keys(resolved as Record<string, unknown>));
}

/**
 * Whether the description already says something substantive about `name`.
 * Deliberately a mention test, not an equality test: the point is to avoid
 * saying the same thing twice, and any sentence that names the parameter has
 * already claimed that job.
 */
function alreadyDiscloses(description: string, name: string): boolean {
  return new RegExp(`\`?\\b${name}\\b`, "i").test(description);
}

export function withParameterDisclosure<T extends { description?: string; inputSchema?: unknown }>(config: T): T {
  const description = config.description;
  if (typeof description !== "string" || description.length === 0) return config;

  const keys = declaredKeys(config.inputSchema);
  const additions: string[] = [];

  if (keys.has("fields") && !alreadyDiscloses(description, "fields")) {
    additions.push(FIELDS_DISCLOSURE);
  }
  // One paragraph covers both keys; `pageSize` is the one whose ceiling gets
  // exceeded in practice, so it decides.
  if (keys.has("pageSize") && !alreadyDiscloses(description, "pageSize")) {
    additions.push(PAGINATION_DISCLOSURE);
  }

  if (additions.length === 0) return config;

  return {
    ...config,
    description: `${description}\n\n${additions.map((a) => `- ${a}`).join("\n")}`,
  };
}
