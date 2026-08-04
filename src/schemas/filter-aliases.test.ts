import { describe, it, expect } from "vitest";
import {
  GLOBAL_FILTER_ALIASES,
  ENDPOINT_FILTER_ALIASES,
  resolveFilterAlias,
  closestKey,
  unknownFilterMessage,
} from "./filter-aliases.js";

const RESOURCE_KEYS = ["keywords", "keywordsType", "perimeterManagers", "resourceStates", "page", "pageSize"];

describe("resolveFilterAlias", () => {
  it("maps the documented perimeter confusions", () => {
    expect(resolveFilterAlias("mainManagers")?.correct).toBe("perimeterManagers");
    expect(resolveFilterAlias("agencies")?.correct).toBe("perimeterAgencies");
    expect(resolveFilterAlias("poles")?.correct).toBe("perimeterPoles");
    expect(resolveFilterAlias("businessUnits")?.correct).toBe("perimeterBusinessUnits");
  });

  it("maps the API pagination name to the tool input name", () => {
    expect(resolveFilterAlias("maxResults")?.correct).toBe("pageSize");
    expect(resolveFilterAlias("limit")?.correct).toBe("pageSize");
    expect(resolveFilterAlias("offset")?.correct).toBe("page");
  });

  it("is insensitive to case and separators", () => {
    for (const variant of ["mainmanagers", "MAINMANAGERS", "main_managers", "main-managers"]) {
      expect(resolveFilterAlias(variant)?.correct).toBe("perimeterManagers");
    }
  });

  it("resolves `states` to the endpoint's own filter name", () => {
    expect(resolveFilterAlias("states", "resources")?.correct).toBe("resourceStates");
    expect(resolveFilterAlias("states", "candidates")?.correct).toBe("candidateStates");
    expect(resolveFilterAlias("states", "opportunities")?.correct).toBe("opportunityStates");
    expect(resolveFilterAlias("states", "projects")?.correct).toBe("projectStates");
    // On /contacts and /companies `states` IS the correct name — no alias.
    expect(resolveFilterAlias("states", "contacts")).toBeUndefined();
    expect(resolveFilterAlias("states", "companies")).toBeUndefined();
  });

  it("resolves the typeOf/typesOf trap per endpoint", () => {
    expect(resolveFilterAlias("typeOf", "contacts")?.correct).toBe("typesOf");
    expect(resolveFilterAlias("typeOf", "resources")?.correct).toBe("resourceTypes");
    // /companies has no type filter at all: an alias with no `correct`.
    const companies = resolveFilterAlias("typeOf", "companies");
    expect(companies).toBeDefined();
    expect(companies?.correct).toBeUndefined();
    expect(companies?.hint).toContain("aucun filtre de type");
  });

  it("carries a dictionary resource URI for state/type corrections", () => {
    expect(resolveFilterAlias("states", "resources")?.dictionary).toBe("boond://dictionary/states/resources");
    expect(resolveFilterAlias("typeOf", "contacts")?.dictionary).toBe("boond://dictionary/typeOf/contacts");
  });

  it("returns undefined for a name it has no opinion about", () => {
    expect(resolveFilterAlias("keywords")).toBeUndefined();
    expect(resolveFilterAlias("zzz")).toBeUndefined();
  });
});

describe("alias table hygiene", () => {
  it("keys are already normalised (lowercase, no separators) so lookups can't miss", () => {
    const tables = [GLOBAL_FILTER_ALIASES, ...Object.values(ENDPOINT_FILTER_ALIASES)];
    for (const table of tables) {
      for (const key of Object.keys(table)) {
        expect(key).toBe(key.toLowerCase());
        expect(key).not.toMatch(/[-_\s]/);
      }
    }
  });

  it("every entry says something actionable", () => {
    const tables = [GLOBAL_FILTER_ALIASES, ...Object.values(ENDPOINT_FILTER_ALIASES)];
    for (const table of tables) {
      for (const [key, alias] of Object.entries(table)) {
        expect(alias.hint.length, key).toBeGreaterThan(5);
      }
    }
  });
});

describe("closestKey", () => {
  it("catches a typo within two edits", () => {
    expect(closestKey("pagesize", RESOURCE_KEYS)).toBe("pageSize");
    expect(closestKey("keywordType", RESOURCE_KEYS)).toBe("keywordsType");
  });

  it("returns undefined when nothing is close", () => {
    expect(closestKey("completelyUnrelated", RESOURCE_KEYS)).toBeUndefined();
  });
});

describe("unknownFilterMessage", () => {
  it("names the correct filter and why", () => {
    const msg = unknownFilterMessage(["mainManagers"], RESOURCE_KEYS, "resources");
    expect(msg).toContain("mainManagers");
    expect(msg).toContain("perimeterManagers");
    expect(msg).toContain("perimeterDynamic");
  });

  it("points at the dictionary resource for a state filter", () => {
    const msg = unknownFilterMessage(["states"], RESOURCE_KEYS, "resources");
    expect(msg).toContain("resourceStates");
    expect(msg).toContain("boond://dictionary/states/resources");
  });

  it("suggests the nearest accepted key for a plain typo", () => {
    const msg = unknownFilterMessage(["pagesize"], RESOURCE_KEYS);
    expect(msg).toContain("pageSize");
  });

  it("says so plainly when the filter simply is not supported", () => {
    const msg = unknownFilterMessage(["totallyUnknownFilter"], RESOURCE_KEYS);
    expect(msg).toContain("non supporté");
  });

  it("reports every unknown key, one line each, then the accepted list", () => {
    const msg = unknownFilterMessage(["mainManagers", "maxResults"], RESOURCE_KEYS, "resources");
    const lines = msg.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("mainManagers");
    expect(lines[1]).toContain("maxResults");
    expect(lines[2]).toContain("Filtres acceptés");
    expect(lines[2]).toContain("keywords");
  });

  it("truncates a long accepted-key list instead of dumping the whole schema", () => {
    const many = Array.from({ length: 40 }, (_, i) => `filter${i}`);
    const msg = unknownFilterMessage(["nope"], many);
    expect(msg).toContain("(40 au total)");
    expect(msg).not.toContain("filter39");
  });

  it("stays a single short block (it is read mid-call, not in docs)", () => {
    const msg = unknownFilterMessage(["mainManagers"], RESOURCE_KEYS, "resources");
    expect(msg.length).toBeLessThan(600);
  });
});
