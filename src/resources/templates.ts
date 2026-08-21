import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { MAX_RESOURCE_BYTES, type DomainName } from "../constants.js";
import { apiRequest, projectEntity } from "../services/boond-client.js";
import { progressReporterFrom } from "../services/progress.js";
import { EntityIdSchema } from "../schemas/index.js";
import type { JsonApiResource, JsonApiResponse } from "../types.js";

/**
 * Entity resource templates — `boond://candidate/{id}` and friends.
 *
 * ## Why a resource and not (only) a tool
 *
 * Reading one candidate's full picture costs 2–3 tool calls today
 * (`boond_candidates_get`, then `_information`, then `_technical_data`), each
 * paying a full tool_use / tool_result round-trip. A resource read returns the
 * aggregate in one `resources/read`, and many MCP hosts cache a resource body
 * for the length of a conversation — which they do not do for tool results.
 * The 2026-07-28 revision adds `ttlMs` / `cacheScope` to `resources/read`
 * (SEP-2549, see issue #170), i.e. the resource path is the one the spec is
 * pushing towards caching.
 *
 * ## What this is NOT for
 *
 * It does not power Claude Desktop's `@` mention picker. That selector is fed
 * by `resources/list`, and a template is deliberately not enumerable here:
 * listing candidates would mean paginating the whole Boond database into a
 * `resources/list` response, on every connection, for every client. Assisted
 * entry goes through `completions/complete` instead (see `completeIdFor` in
 * `index.ts`), whose client support is uneven — hence a bonus, never a
 * justification.
 *
 * ## Scope: the cheap, bounded tabs only
 *
 * A resource is read whole or not at all — there is no `pageSize` and the model
 * cannot ask for less. So only tabs with a bounded size are aggregated.
 * `actions`, `positionings`, `invoices`, `times-reports`… stay tools: folding
 * 200 actions in here would make the read size unpredictable.
 *
 * ## URI naming: singular here, plural in the dictionaries
 *
 * Dictionary slugs are plural (`boond://dictionary/states/candidates`) because
 * they name a *collection* of labels. An entity template names *one* entity, so
 * it is singular (`boond://candidate/{id}`). The inconsistency is deliberate:
 * do NOT "fix" either side to match the other — both forms are published URIs
 * that clients may have stored.
 */
export interface EntityTemplate {
  /** Registration name (also the key of the SDK's template map). */
  name: string;
  /** RFC 6570 URI template, exactly as advertised in `resources/templates/list`. */
  uriTemplate: string;
  /**
   * Business domain this template belongs to. Entity templates ARE filtered by
   * the access policy: with `BOOND_MCP_PROFILE=finance`, `candidates` is gone
   * from `tools/list`, and leaving `boond://candidate/{id}` readable would
   * reopen exactly what the operator closed. Reference dictionaries stay
   * unfiltered — they are a lookup substrate, not business data.
   */
  domain: DomainName;
  /** French entity label, used in error messages. */
  entityName: string;
  /** Base API path of the entity (`/candidates`). */
  apiPath: string;
  /** Tab endpoints aggregated into the body, in output order. */
  tabs: readonly string[];
  title: string;
  description: string;
}

/** Tabs cheap enough to aggregate: an identity/detail pair, never a collection. */
const IDENTITY_TABS = ["information"] as const;
const IDENTITY_AND_SKILLS_TABS = ["information", "technical-data"] as const;

export const ENTITY_TEMPLATES: readonly EntityTemplate[] = [
  {
    name: "entity/candidate",
    uriTemplate: "boond://candidate/{id}",
    domain: "candidates",
    entityName: "candidat",
    apiPath: "/candidates",
    tabs: IDENTITY_AND_SKILLS_TABS,
    title: "Fiche candidat",
    description:
      "Fiche complète d'un candidat (identité, informations, compétences/technical-data) en une seule lecture. " +
      "L'id est numérique. Les actions et positionnements restent des outils (`boond_candidates_actions`, `_positionings`).",
  },
  {
    name: "entity/resource",
    uriTemplate: "boond://resource/{id}",
    domain: "resources",
    entityName: "ressource",
    apiPath: "/resources",
    tabs: IDENTITY_AND_SKILLS_TABS,
    title: "Fiche ressource (collaborateur)",
    description:
      "Fiche complète d'une ressource/collaborateur (identité, informations, compétences) en une seule lecture. " +
      "L'id est numérique. Temps, absences et positionnements restent des outils.",
  },
  {
    name: "entity/contact",
    uriTemplate: "boond://contact/{id}",
    domain: "contacts",
    entityName: "contact",
    apiPath: "/contacts",
    tabs: IDENTITY_TABS,
    title: "Fiche contact",
    description:
      "Fiche complète d'un contact client (identité, informations) en une seule lecture. L'id est numérique.",
  },
  {
    name: "entity/company",
    uriTemplate: "boond://company/{id}",
    domain: "companies",
    entityName: "société",
    apiPath: "/companies",
    tabs: IDENTITY_TABS,
    title: "Fiche société",
    description:
      "Fiche complète d'une société cliente (identité, informations) en une seule lecture. L'id est numérique.",
  },
  {
    name: "entity/opportunity",
    uriTemplate: "boond://opportunity/{id}",
    domain: "opportunities",
    entityName: "opportunité",
    apiPath: "/opportunities",
    tabs: IDENTITY_TABS,
    title: "Fiche opportunité",
    description:
      "Fiche complète d'une opportunité commerciale (identité, informations) en une seule lecture. L'id est numérique.",
  },
  {
    name: "entity/project",
    uriTemplate: "boond://project/{id}",
    domain: "projects",
    entityName: "projet",
    apiPath: "/projects",
    tabs: IDENTITY_TABS,
    title: "Fiche projet",
    description:
      "Fiche complète d'un projet/mission (identité, informations) en une seule lecture. L'id est numérique.",
  },
];

/** Exposed for tests and the catalogue generator; mirrors `REGISTERED_RESOURCES`. */
export const REGISTERED_RESOURCE_TEMPLATES = ENTITY_TEMPLATES.map((t) => ({
  name: t.name,
  uriTemplate: t.uriTemplate,
  title: t.title,
  domain: t.domain,
}));

// ---- Aggregated read ---------------------------------------------------

/**
 * Read one entity and its declared tabs, and render them as a single JSON body.
 *
 * Three properties this function exists to guarantee:
 *
 * 1. **The id never reaches the API unvalidated.** The SDK compiles `{id}` to
 *    the RFC 6570 default pattern `([^/,]+)` — NOT to a numeric one. So
 *    `boond://candidate/1?x=2`, `boond://candidate/1#f` and
 *    `boond://candidate/..%2Fresources%2F9` all match the template and land
 *    here as `variables.id`, from where they would be interpolated straight
 *    into an API path. `EntityIdSchema` (`/^\d+$/`) is the wall; same class of
 *    problem as the document-id path guard (#186).
 * 2. **A failing tab does not lose the record.** `apiRequest` throws on any
 *    non-2xx, and a partial record (a contact with no `information` payload)
 *    is normal in Boond. Tabs are settled independently and a failure becomes
 *    an `_errors` entry, not a failed read. The base record is the exception:
 *    without it there is nothing to return, so its error propagates.
 * 3. **The body is always parseable JSON.** The size ceiling drops whole
 *    sections and names them in `_omitted`; it never cuts the serialised text.
 *    A resource has no `pageSize` and cannot be asked for less, so the ceiling
 *    has to be enforced here — but handing back a truncated JSON document
 *    would break every client that does the one thing the mime type promises.
 */
export interface EntityAggregate {
  uri: string;
  entity: Pick<JsonApiResource, "id" | "type" | "attributes" | "relationships">;
  /** One key per successfully read tab, in declaration order. */
  sections: Record<string, unknown>;
  /** Tabs whose read failed, mapped to the error message. Absent when none did. */
  _errors?: Record<string, string>;
  /** Sections dropped to fit MAX_RESOURCE_BYTES. Absent when nothing was dropped. */
  _omitted?: { sections: string[]; reason: string };
}

/** Project a tab response: an object stays an object, a collection stays a list. */
function projectTab(response: JsonApiResponse): unknown {
  if (Array.isArray(response.data)) return response.data.map(projectEntity);
  return response.data ? projectEntity(response.data) : null;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Serialise, and if the body is over the ceiling drop sections until it fits.
 *
 * Order of sacrifice, least to most informative: declared tabs from the last
 * to the first (so `information` outlives `technical-data`), then the base
 * record's `relationships`, then its `attributes`. In practice only the first
 * rung is ever reached; the others exist so the ceiling is a guarantee rather
 * than an intention.
 */
function serializeWithinBudget(aggregate: EntityAggregate, tabOrder: readonly string[]): string {
  const dropped: string[] = [];
  const reason = `Corps au-delà de MAX_RESOURCE_BYTES (${MAX_RESOURCE_BYTES} octets) : sections abandonnées pour garder un JSON valide.`;

  const render = (): string => {
    const body: EntityAggregate = { ...aggregate };
    if (dropped.length > 0) body._omitted = { sections: [...dropped], reason };
    return JSON.stringify(body, null, 2);
  };

  const overBudget = (json: string): boolean => Buffer.byteLength(json, "utf8") > MAX_RESOURCE_BYTES;

  let json = render();
  if (!overBudget(json)) return json;

  for (const tab of [...tabOrder].reverse()) {
    if (!(tab in aggregate.sections)) continue;
    delete aggregate.sections[tab];
    dropped.push(tab);
    json = render();
    if (!overBudget(json)) return json;
  }

  for (const field of ["relationships", "attributes"] as const) {
    if (aggregate.entity[field] === undefined) continue;
    delete aggregate.entity[field];
    dropped.push(`entity.${field}`);
    json = render();
    if (!overBudget(json)) return json;
  }

  return json;
}

export async function readEntityAggregate(
  template: EntityTemplate,
  rawId: unknown,
  uri: string,
  extra?: unknown
): Promise<string> {
  // `Variables` is `string | string[]`: a repeated URI segment would arrive as
  // an array, which `EntityIdSchema` rejects rather than silently join.
  const parsed = EntityIdSchema.safeParse(rawId);
  if (!parsed.success) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Identifiant de ${template.entityName} invalide dans « ${uri} » : attendu un id numérique (ex. ${template.uriTemplate.replace("{id}", "1234")}).`
    );
  }
  const id = parsed.data;

  const report = progressReporterFrom(extra);
  const total = 1 + template.tabs.length;
  let done = 0;
  const step = (label: string): void => {
    done += 1;
    report(done, total, `${template.entityName} ${id} : ${label} (${done}/${total})`);
  };

  const base = apiRequest(`${template.apiPath}/${id}`).finally(() => step("fiche"));
  const tabs = template.tabs.map((tab) => apiRequest(`${template.apiPath}/${id}/${tab}`).finally(() => step(tab)));

  // The base record is awaited through allSettled together with the tabs so a
  // tab failure cannot leave an unhandled rejection behind, then rethrown: with
  // no record there is nothing to aggregate.
  const [baseResult, ...tabResults] = await Promise.allSettled([base, ...tabs]);
  if (baseResult.status === "rejected") throw baseResult.reason;

  const entity = Array.isArray(baseResult.value.data) ? baseResult.value.data[0] : baseResult.value.data;
  if (!entity) {
    throw new McpError(ErrorCode.InvalidParams, `${template.entityName} ${id} introuvable.`);
  }

  const aggregate: EntityAggregate = { uri, entity: projectEntity(entity), sections: {} };
  const errors: Record<string, string> = {};
  template.tabs.forEach((tab, i) => {
    const result = tabResults[i];
    if (result.status === "fulfilled") aggregate.sections[tab] = projectTab(result.value);
    else errors[tab] = errorMessage(result.reason);
  });
  if (Object.keys(errors).length > 0) aggregate._errors = errors;

  return serializeWithinBudget(aggregate, template.tabs);
}
