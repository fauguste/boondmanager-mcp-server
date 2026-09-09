import { describe, it, expect } from "vitest";
import {
  composeDescription,
  defaultSearchDescription,
  defaultGetDescription,
  defaultCreateDescription,
  defaultUpdateDescription,
  defaultDeleteDescription,
  tabDescription,
  PAGINATION_DISCLOSURE,
  FIELDS_DISCLOSURE,
} from "./description-builders.js";
import { withParameterDisclosure } from "./parameter-disclosure.js";
import { PAGINATION_INERT_DISCLOSURE } from "./description-builders.js";
import { TOOLS_IGNORING_PAGINATION } from "../constants.js";
import { USAGE_GUIDANCE, injectUsageGuidance, withUsageGuidance } from "./usage-guidance.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_SEARCH_PAGE } from "../constants.js";

const WORDING = { entityName: "pôle", entityNamePlural: "pôles", prefix: "boond_poles" };

describe("composeDescription", () => {
  it("front-loads the purpose and closes on Returns", () => {
    const d = composeDescription({ purpose: "But.", when: "quand.", returns: "un truc." });
    expect(d.startsWith("But.")).toBe(true);
    expect(d.trimEnd().endsWith("Returns : un truc.")).toBe(true);
  });

  it("omits empty sections rather than emitting blank ones", () => {
    const d = composeDescription({ purpose: "But.", returns: "un truc." });
    expect(d).toBe("But.\n\nReturns : un truc.");
    expect(d).not.toMatch(/Quand|Plutôt que/);
  });

  it("drops behaviour entries that are blank", () => {
    const d = composeDescription({ purpose: "But.", behaviour: ["  ", "réel"], returns: "x." });
    expect(d).toContain("- réel");
    expect(d).not.toMatch(/^- $/m);
  });
});

describe("pagination and projection disclosures", () => {
  // The whole point of interpolating from constants.ts: the hand-typed
  // predecessor claimed "défaut: 20, max: 100" against a schema enforcing
  // 30/500, and shipped that to 11 domains.
  it("quote the enforced ceilings, not literals", () => {
    expect(PAGINATION_DISCLOSURE).toContain(String(MAX_PAGE_SIZE));
    expect(PAGINATION_DISCLOSURE).toContain(String(DEFAULT_PAGE_SIZE));
    expect(PAGINATION_DISCLOSURE).toContain(String(MAX_SEARCH_PAGE));
  });

  it("say that the page ceiling rejects rather than clamps", () => {
    expect(PAGINATION_DISCLOSURE).toMatch(/refus/);
  });

  it("say that `fields` never reaches the BoondManager API", () => {
    expect(FIELDS_DISCLOSURE).toMatch(/jamais transmise/);
    expect(FIELDS_DISCLOSURE).toMatch(/ignorés/);
  });

  it("stay short enough to be repeated across dozens of tools", () => {
    // Paid 38 and 32 times respectively in `tools/list`, so a wasted sentence
    // here costs ~10 KiB of every client's context.
    expect(PAGINATION_DISCLOSURE.length).toBeLessThan(120);
    expect(FIELDS_DISCLOSURE.length).toBeLessThan(180);
  });
});

describe("the five CRUD templates", () => {
  const all = [
    defaultSearchDescription(WORDING),
    defaultGetDescription({ ...WORDING, withTab: false }),
    defaultCreateDescription(WORDING),
    defaultUpdateDescription(WORDING),
    defaultDeleteDescription(WORDING),
  ];

  it("leaves the pagination and `fields` contracts to the central disclosure", () => {
    // Single-sourced in `withParameterDisclosure`, because the correct
    // pagination sentence depends on the route.
    expect(defaultSearchDescription(WORDING)).not.toContain("Pagination");
    expect(defaultSearchDescription(WORDING)).not.toContain("`fields`");
  });

  it("all name a concrete sibling to prefer", () => {
    for (const d of all) {
      expect(d).toMatch(/^Plutôt que : /m);
      expect(d).toMatch(/`boond_poles_\w+`/);
    }
  });

  it("all state what comes back", () => {
    for (const d of all) expect(d).toMatch(/^Returns : /m);
  });

  it("never paraphrases the schema with an Args block", () => {
    // Restating `.describe()`-d parameters costs bytes and earns nothing; the
    // templates deliberately dropped the Args sections they used to carry.
    for (const d of all) expect(d).not.toMatch(/^Args:/m);
  });

  it("discloses the tab parameter only when the tool accepts one", () => {
    expect(defaultGetDescription({ ...WORDING, withTab: true })).toContain("`tab`");
    expect(defaultGetDescription({ ...WORDING, withTab: false })).not.toContain("`tab`");
  });

  it("warns that deletes are irreversible and may be declined by the user", () => {
    const d = defaultDeleteDescription(WORDING);
    expect(d).toMatch(/Irréversible/i);
    expect(d).toContain("elicitation");
    expect(d).toContain("deleted");
  });

  it("warns that creates are not idempotent", () => {
    expect(defaultCreateDescription(WORDING)).toMatch(/non idempotente/);
  });

  it("warns that array fields are replaced on update, not merged", () => {
    expect(defaultUpdateDescription(WORDING)).toMatch(/remplacés/);
  });
});

describe("tabDescription", () => {
  const spec = { ...WORDING, subject: "les actions", content: "appels, emails", returns: "Liste des actions." };

  it("names both the base record tool and the search tool", () => {
    const d = tabDescription(spec);
    expect(d).toContain("`boond_poles_get`");
    expect(d).toContain("`boond_poles_search`");
  });

  it("folds `content` into the purpose sentence, and omits the parentheses without it", () => {
    expect(tabDescription(spec)).toContain("les actions (appels, emails)");
    expect(tabDescription({ ...spec, content: undefined })).toContain("les actions d'un(e)");
  });
});

describe("withParameterDisclosure", () => {
  const base = { description: "But.\n\nReturns : x." };

  it("adds nothing when the tool declares neither parameter", () => {
    const out = withParameterDisclosure({ ...base, inputSchema: { shape: { id: {} } } });
    expect(out.description).toBe(base.description);
  });

  it("states the ceiling for a normal search tool", () => {
    const out = withParameterDisclosure({ ...base, inputSchema: { shape: { pageSize: {} } } }, "boond_accounts_search");
    expect(out.description).toContain("Pagination : ");
    expect(out.description).not.toContain(PAGINATION_INERT_DISCLOSURE);
  });

  it("states the opposite for a route that discards maxResults", () => {
    // /poles, /agencies, /calendars and /webhooks answer maxResults=2 with
    // their whole table (verified live). Promising the ceiling there would be
    // the very defect this contract exists to prevent.
    for (const name of TOOLS_IGNORING_PAGINATION) {
      const out = withParameterDisclosure({ ...base, inputSchema: { shape: { pageSize: {} } } }, name);
      expect(out.description, name).toContain(PAGINATION_INERT_DISCLOSURE);
      expect(out.description, name).not.toContain(`1–${MAX_PAGE_SIZE}`);
    }
    expect(TOOLS_IGNORING_PAGINATION.size).toBeGreaterThan(0);
  });

  it("discloses only what the schema actually declares", () => {
    const out = withParameterDisclosure({ ...base, inputSchema: { shape: { fields: {} } } });
    expect(out.description).toContain("jamais transmise");
    expect(out.description).not.toContain("Pagination :");
  });

  it("stays silent when the description already covers the parameter", () => {
    // Conciseness is a scored dimension: a duplicated paragraph is worse than
    // an absent one, so a hand-written explanation wins.
    const hand = { description: "But. `fields` fait ceci.\n\nReturns : x.", inputSchema: { shape: { fields: {} } } };
    expect(withParameterDisclosure(hand).description).toBe(hand.description);
  });

  it("leaves a config with no description untouched", () => {
    const out = withParameterDisclosure({ inputSchema: { shape: { fields: {} } } });
    expect(out.description).toBeUndefined();
  });
});

describe("usage guidance table", () => {
  it("places the guidance after the purpose, above the rest", () => {
    const d = injectUsageGuidance("But.\n\nDétails.", { when: "maintenant.", instead: "`autre_outil`." });
    expect(d).toBe("But.\n\nQuand : maintenant.\nPlutôt que : `autre_outil`.\n\nDétails.");
  });

  it("appends when the description is a single paragraph", () => {
    const d = injectUsageGuidance("But.", { instead: "`autre`." });
    expect(d).toBe("But.\n\nPlutôt que : `autre`.");
  });

  it("does not override guidance the description already carries", () => {
    const cfg = { description: "But.\n\nQuand : déjà dit." };
    const name = Object.keys(USAGE_GUIDANCE)[0];
    expect(withUsageGuidance(name, cfg).description).toBe(cfg.description);
  });

  it("cannot be tricked by an Object.prototype member name", () => {
    const cfg = { description: "But." };
    expect(withUsageGuidance("constructor", cfg).description).toBe("But.");
    expect(withUsageGuidance("toString", cfg).description).toBe("But.");
  });

  it("never points at a sibling with a vague 'see the other tools'", () => {
    // A named alternative is the whole value of the section; "voir les autres
    // outils" costs bytes and resolves nothing.
    for (const [name, g] of Object.entries(USAGE_GUIDANCE)) {
      if (g.instead === undefined) continue;
      const namesATool = /`boond_[a-z_]+`|`boond:\/\//.test(g.instead);
      const saysThereIsNone = /aucune alternative|rien d'autre|pas de chemin alternatif/.test(g.instead);
      expect(namesATool || saysThereIsNone, `${name}: \`instead\` names nothing`).toBe(true);
    }
  });
});
