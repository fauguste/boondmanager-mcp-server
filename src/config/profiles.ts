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
 * `resources` is in every profile except `admin` for the same kind of reason: 8
 * of the 11 prompts orchestrate it (`synthese_equipe`, `staffing_disponible`,
 * `fiche_consultant`, `recherche_profil_competences`, …) and a prompt is cut as
 * soon as ONE of its domains is filtered out. Leaving it out of `recruiting` /
 * `sales` bought ~10 fewer tools and cost most of the runbooks — the wrong
 * trade for a layer whose whole point is ergonomics. It is also what those jobs
 * actually need: a recruiter matches candidates against internal staff, a
 * salesperson staffs a deal.
 */
export const PROFILES: Readonly<Record<string, readonly DomainName[]>> = {
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
};

export type ProfileName = keyof typeof PROFILES;

/** Canonical list of profile names, for error messages and docs. */
export const PROFILE_NAMES: readonly string[] = Object.keys(PROFILES);

/** Case-insensitive profile lookup (`Finance`, `FINANCE` → `finance`). */
export function resolveProfile(name: string): readonly DomainName[] | undefined {
  return PROFILES[name.toLowerCase().trim()];
}
