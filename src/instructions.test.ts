import { describe, it, expect } from "vitest";
import type { ZodObject, ZodRawShape } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { TOOL_REGISTRARS } from "./server.js";
import {
  CandidateSearchSchema,
  CompanySearchSchema,
  ContactSearchSchema,
  OpportunitySearchSchema,
  ProjectSearchSchema,
  ResourceSearchSchema,
  SearchSchema,
} from "./schemas/index.js";

/**
 * `SERVER_INSTRUCTIONS` is sent once at `initialize` and the model treats it as
 * ground truth for every one of the ~180 tools. A rule stated there as universal
 * that only holds for some endpoints has two failure modes, both bad:
 *
 * - the schema is `.strict()`, so the call is rejected — and the instructions
 *   themselves tell the model a rejection means a *wrong filter name*, sending
 *   it into retry loops over spellings that cannot work;
 * - or the filter is free text (`keywords`), so nothing rejects it, the API
 *   returns zero rows, and the model reports a confident wrong answer.
 *
 * These tests pin the instructions to the schemas they describe, so the two
 * cannot drift apart silently.
 */
function keysOf(schema: ZodObject<ZodRawShape>): string[] {
  return Object.keys(schema.shape);
}

const PERIMETER_SEARCH_SCHEMAS = {
  resources: ResourceSearchSchema,
  candidates: CandidateSearchSchema,
  contacts: ContactSearchSchema,
  companies: CompanySearchSchema,
  opportunities: OpportunitySearchSchema,
  projects: ProjectSearchSchema,
} as const;

describe("SERVER_INSTRUCTIONS ↔ schema consistency", () => {
  it("scopes the perimeter filters to the endpoints that actually accept them", () => {
    for (const [domain, schema] of Object.entries(PERIMETER_SEARCH_SCHEMAS)) {
      const keys = keysOf(schema as ZodObject<ZodRawShape>);
      for (const filter of [
        "perimeterDynamic",
        "perimeterManagers",
        "perimeterAgencies",
        "perimeterPoles",
        "perimeterBusinessUnits",
        "narrowPerimeter",
      ]) {
        expect(keys, `${domain} should accept ${filter}`).toContain(filter);
      }
      // The instructions name these six by tool name; if one is renamed the
      // sentence must be updated with it.
      expect(SERVER_INSTRUCTIONS).toContain(`\`${domain}\``);
    }

    // The reference/admin domains fall back to the bare SearchSchema. Stating
    // the perimeter filters as universal is what made the model emit
    // `boond_products_search {perimeterDynamic: ["agencies"]}` and get rejected.
    expect(keysOf(SearchSchema as ZodObject<ZodRawShape>)).not.toContain("perimeterDynamic");
    expect(SERVER_INSTRUCTIONS).toMatch(/pas sur les domaines de référence/);
  });

  it("does not offer `typesOf` for companies (the schema has no type filter)", () => {
    expect(keysOf(ContactSearchSchema as ZodObject<ZodRawShape>)).toContain("typesOf");
    expect(keysOf(CompanySearchSchema as ZodObject<ZodRawShape>)).not.toContain("typesOf");
    expect(keysOf(CompanySearchSchema as ZodObject<ZodRawShape>)).toContain("states");
    // The claim must be attributed to contacts, and companies flagged as
    // states-only — the previous wording said "contacts *et sociétés*".
    expect(SERVER_INSTRUCTIONS).toMatch(/`typesOf` \(contacts\)/);
    expect(SERVER_INSTRUCTIONS).toMatch(/`states` seul \(sociétés/);
  });

  it("restricts `keywordsType` to the schemas that declare it", () => {
    const withKeywordsType = Object.entries(PERIMETER_SEARCH_SCHEMAS)
      .filter(([, schema]) => keysOf(schema as ZodObject<ZodRawShape>).includes("keywordsType"))
      .map(([domain]) => domain);
    expect(withKeywordsType).toEqual(["resources", "candidates", "contacts", "companies"]);

    // Instructions must name exactly that set — `opportunities` / `projects`
    // reject the key outright.
    const sentence = SERVER_INSTRUCTIONS.split("\n").find((l) => l.includes("`keywordsType`"));
    expect(sentence).toBeDefined();
    for (const domain of withKeywordsType) {
      expect(sentence).toContain(`\`${domain}\``);
    }
    expect(sentence).not.toContain("`opportunities`");
    expect(sentence).not.toContain("`projects`");
  });

  it("warns that `keywords` prefixes are a per-endpoint subset", () => {
    // `keywords` is a free `z.string()` everywhere, so an unsupported prefix is
    // never rejected — it silently full-texts and returns 0 rows. The model
    // must not read that as "nothing is linked".
    for (const schema of Object.values(PERIMETER_SEARCH_SCHEMAS)) {
      expect(keysOf(schema as ZodObject<ZodRawShape>)).toContain("keywords");
    }
    expect(SERVER_INSTRUCTIONS).toMatch(/sous-ensemble/);
    expect(SERVER_INSTRUCTIONS).toMatch(/0 résultat/);
  });

  it("tells the model a rejection can also mean an unsupported filter", () => {
    // Without this, `.strict()` rejections on reference domains read as
    // misspellings and trigger retry loops.
    expect(SERVER_INSTRUCTIONS).toMatch(/non supporté par cet endpoint/);
  });

  it("does not duplicate the cross-cutting rules it centralises", () => {
    // The whole justification for this block is stating these rules *once*.
    // Leaving the same boilerplate in the 180 tool descriptions makes it a net
    // context cost, and lets the two copies contradict each other (which is how
    // the companies/`typesOf` claim above went wrong in the first place).
    const descriptions: string[] = [];
    const mockServer = {
      registerTool: (_name: string, config: { description?: string }) => {
        if (config.description) descriptions.push(config.description);
      },
      registerPrompt: () => {},
      registerResource: () => {},
    } as unknown as McpServer;
    for (const [, register] of TOOL_REGISTRARS) register(mockServer);
    expect(descriptions.length).toBeGreaterThan(100);

    // The org-perimeter triplet and the "exact API parameter names" warning now
    // live only in SERVER_INSTRUCTIONS.
    expect(SERVER_INSTRUCTIONS).toContain("perimeterAgencies");
    const duplicated = descriptions.filter(
      (d) => d.includes("Périmètre orga") || d.includes("Utilisez les filtres structurés")
    );
    expect(duplicated).toEqual([]);
  });
});
