import type { DomainName } from "../constants.js";

/**
 * Pre-composed domain sets ("profiles") for `BOOND_MCP_PROFILE`.
 *
 * Why: `BOOND_MCP_DOMAINS` is the precise tool, but composing it means knowing
 * all 38 domain names *and* which ones a job actually needs (a recruiter needs
 * `positionings` and `actions`, not just `candidates`). With on-demand tool
 * discovery in clients, narrowing the surface is still the highest-leverage
 * knob — so it has to be usable in one env var, without a trip to TOOLS.md.
 *
 * Each profile is a job-shaped bundle, not a security tier: see
 * `docs/access-control.md`, this layer hides tools from the model, it does not
 * revoke BoondManager rights. Combine with `BOOND_MCP_READ_ONLY` /
 * `BOOND_MCP_OPERATIONS` (orthogonal axis) to bound what can be written.
 *
 * `application` is in every profile on purpose: it backs dictionary resolution
 * (state/type labels) and `current-user`, which many tools and prompts depend
 * on. `workflows` is listed wherever prompt mirrors make sense; it is not
 * strictly required (workflow tools follow their source prompt's domains, not
 * the allow-list), but keeping it explicit documents the intent and survives a
 * future change of that rule.
 *
 * There is no blanket "`resources` everywhere" rule — the rule is **per
 * profile, check the prompt count**. 8 of the 11 prompts orchestrate
 * `resources` (`synthese_equipe`, `staffing_disponible`, `fiche_consultant`,
 * `recherche_profil_competences`, …) and a prompt is cut as soon as ONE of its
 * domains is filtered out, so leaving `resources` out of `recruiting` / `sales`
 * bought ~10 fewer tools and cost most of their runbooks — the wrong trade for a
 * layer whose whole point is ergonomics. It is also what those jobs actually
 * need: a recruiter matches candidates against internal staff, a salesperson
 * staffs a deal. `finance` and `admin` deliberately do NOT include it: neither
 * has a runbook that touches `resources` (`finance`'s only prompt,
 * `factures_a_relancer`, spans `invoices` + `application`), so it would add
 * tools and no capability. When adding a profile, count the prompts it keeps —
 * not just the tools.
 */
const PROFILE_TABLE = {
  /** Recrutement / sourcing : viviers, positionnements, suivi d'activité. */
  recruiting: [
    "candidates",
    "positionings",
    "opportunities",
    "contacts",
    "companies",
    "documents",
    "actions",
    "resources",
    "application",
    "workflows",
  ],
  /** Avant-vente / commerce : pipeline, comptes, commandes. */
  sales: [
    "opportunities",
    "companies",
    "contacts",
    "actions",
    "projects",
    "orders",
    "products",
    "reporting",
    "resources",
    "application",
    "workflows",
  ],
  /** Gestion / compta : facturation client et fournisseur, encaissements. */
  finance: [
    "invoices",
    "payments",
    "orders",
    "purchases",
    "provider-invoices",
    "expenses",
    "projects",
    "companies",
    "reporting",
    "application",
    "workflows",
  ],
  /** Delivery / staffing : missions, CRA, absences, validations. */
  delivery: [
    "projects",
    "deliveries",
    "resources",
    "timesheets",
    "absences",
    "planning-absences",
    "validations",
    "application",
    "workflows",
  ],
  /** Administration de l'outil : référentiels d'organisation et journaux. */
  admin: ["accounts", "agencies", "business-units", "poles", "roles", "logs", "webhooks", "flags", "application"],
} as const satisfies Record<string, readonly DomainName[]>;

/** Profile name literals (`"recruiting" | "sales" | …`). */
export type ProfileName = keyof typeof PROFILE_TABLE;

/**
 * The profile bundles. Keyed by `string` for iteration/lookup convenience;
 * `ProfileName` above keeps the literal union available for typed callers (an
 * index signature on the exported value would erase it).
 */
export const PROFILES: Readonly<Record<string, readonly DomainName[]>> = PROFILE_TABLE;

/** Canonical list of profile names, for error messages and docs. */
export const PROFILE_NAMES: readonly ProfileName[] = Object.keys(PROFILE_TABLE) as ProfileName[];

/**
 * Case-insensitive profile lookup (`Finance`, `FINANCE` → `finance`).
 *
 * `Object.hasOwn` is what makes this safe: a plain `PROFILES[name]` returns
 * `Object.prototype`'s own properties for `BOOND_MCP_PROFILE=constructor`
 * (`toString`, `valueOf`, `hasOwnProperty`, `__proto__`…) — a truthy non-array
 * that skips the caller's warn-and-ignore branch and then throws
 * `TypeError: … is not iterable` at startup, i.e. a dead server instead of the
 * documented warning.
 */
export function resolveProfile(name: string): readonly DomainName[] | undefined {
  const key = name.toLowerCase().trim();
  return Object.hasOwn(PROFILES, key) ? PROFILES[key] : undefined;
}
