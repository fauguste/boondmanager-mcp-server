import type { DomainName } from "../constants.js";

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
