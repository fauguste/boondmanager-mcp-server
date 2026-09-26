import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllResources, REGISTERED_RESOURCES } from "./index.js";
import { REGISTERED_RESOURCE_TEMPLATES } from "./templates.js";
import * as boondClient from "../services/boond-client.js";
import * as dictionaryService from "../services/dictionary.js";

function createMockServer() {
  return { registerResource: vi.fn() } as unknown as McpServer;
}

describe("registerAllResources", () => {
  let server: McpServer;
  beforeEach(() => {
    server = createMockServer();
    vi.restoreAllMocks();
    dictionaryService.resetDictionaryCacheForTests();
  });

  it("registers exactly the resources and templates it declares", () => {
    registerAllResources(server);
    expect(server.registerResource).toHaveBeenCalledTimes(
      REGISTERED_RESOURCES.length + REGISTERED_RESOURCE_TEMPLATES.length
    );
  });

  it("each resource has a unique URI", () => {
    const uris = REGISTERED_RESOURCES.map((r) => r.uri);
    expect(new Set(uris).size).toBe(uris.length);
  });

  it("every dictionary URI uses the boond:// scheme under /dictionary/", () => {
    const dicts = REGISTERED_RESOURCES.filter((r) => r.name.startsWith("dictionary/"));
    expect(dicts.length).toBeGreaterThan(10);
    for (const r of dicts) {
      // Hyphens: `states/provider-invoices` mirrors the `provider-invoices` domain name.
      expect(r.uri).toMatch(/^boond:\/\/dictionary\/[a-zA-Z-]+(\/[a-zA-Z-]+)?$/);
    }
  });

  it("exposes the current-user resource", () => {
    expect(REGISTERED_RESOURCES.find((r) => r.uri === "boond://application/current-user")).toBeDefined();
  });

  it("exposes the search-tool dictionaries the prompts depend on", () => {
    // Prompts in src/prompts/index.ts and tool descriptions reference these
    // dict slugs — make sure they're all surfaced as resources so the model
    // can resolve state/typeOf integers without a tool call. Slugs that
    // don't map to a real BoondManager dictionary path (states/absences,
    // typeOf/candidates, typeOf/actions, typeOf/absences) are intentionally
    // excluded.
    const slugs = REGISTERED_RESOURCES.map((r) => r.uri.replace(/^boond:\/\/dictionary\//, ""));
    expect(slugs).toEqual(
      expect.arrayContaining([
        "states/resources",
        "states/candidates",
        "states/contacts",
        "states/companies",
        "states/opportunities",
        "states/projects",
        "states/invoices",
        "states/orders",
        "states/positionings",
        "typeOf/resources",
        "typeOf/contacts",
        "typeOf/projects",
        // Issue #261 — finance / delivery states, contract types, per-entity
        // action types, origins and the finance settings.
        "states/deliveries",
        "states/payments",
        "states/purchases",
        "states/provider-invoices",
        "states/products",
        "states/quotations",
        "states/probations",
        "typeOf/contracts",
        "typeOf/deliveries",
        "typeOf/purchases",
        "typeOf/activities",
        "actions/candidates",
        "actions/contacts",
        "actions/resources",
        "actions/opportunities",
        "actions/projects",
        "actions/invoices",
        "actions/orders",
        "sources",
        "origins",
        "paymentMethods",
        "paymentTerms",
        "taxRates",
        "contractEndReasons",
        "tools",
        "expertiseAreas",
        "countries",
        "currencies",
        "languages",
      ])
    );
  });

  it("declares JSON mime type and a non-empty title/description on every resource", () => {
    registerAllResources(server);
    for (const call of vi.mocked(server.registerResource).mock.calls) {
      const [name, uriOrTemplate, config] = call;
      expect(typeof name).toBe("string");
      // A fixed URI is a string; an entity template is a ResourceTemplate whose
      // `uriTemplate` stringifies to the advertised pattern.
      const uri = typeof uriOrTemplate === "string" ? uriOrTemplate : String(uriOrTemplate.uriTemplate);
      expect(uri).toMatch(/^boond:\/\//);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = config as any;
      expect(meta.mimeType).toBe("application/json");
      expect(meta.title).toBeTruthy();
      expect(meta.description).toBeTruthy();
    }
  });

  it("dictionary read callback resolves the slug → setting path against the cached dictionary", async () => {
    // Single mocked /application/dictionary response with a setting.state.resource
    // sub-tree. The resource read callback should fetch the dict once via the
    // dictionary service and extract the right sub-tree.
    const apiSpy = vi.spyOn(boondClient, "apiRequest").mockResolvedValue({
      data: {
        setting: {
          state: {
            resource: [
              { id: 1, value: "Actif" },
              { id: 2, value: "Inactif" },
            ],
          },
        },
      },
    } as never);
    registerAllResources(server);
    const call = vi.mocked(server.registerResource).mock.calls.find((c) => c[0] === "dictionary/states/resources");
    expect(call).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = call![3] as any;
    const result = await cb(new URL("boond://dictionary/states/resources"));
    expect(apiSpy).toHaveBeenCalledWith("/application/dictionary", "GET", undefined, { language: "fr" });
    const body = JSON.parse(result.contents[0].text);
    expect(body).toEqual([
      { id: 1, value: "Actif" },
      { id: 2, value: "Inactif" },
    ]);
  });

  it("dictionary callbacks share the cached dictionary across reads (single API call)", async () => {
    const apiSpy = vi.spyOn(boondClient, "apiRequest").mockResolvedValue({
      data: {
        setting: {
          state: { resource: [{ id: 1, value: "A" }], candidate: [{ id: 9, value: "Z" }] },
          tool: [{ id: 42, value: "Java" }],
        },
        country: [{ id: "FR", value: "France" }],
      },
    } as never);
    registerAllResources(server);
    const calls = vi.mocked(server.registerResource).mock.calls;
    const findCb = (n: string) =>
      calls.find((c) => c[0] === n)![3] as (uri: URL) => Promise<{ contents: { text: string }[] }>;

    const r1 = await findCb("dictionary/states/resources")(new URL("boond://dictionary/states/resources"));
    const r2 = await findCb("dictionary/states/candidates")(new URL("boond://dictionary/states/candidates"));
    const r3 = await findCb("dictionary/tools")(new URL("boond://dictionary/tools"));
    const r4 = await findCb("dictionary/countries")(new URL("boond://dictionary/countries"));

    expect(apiSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(r1.contents[0].text)).toEqual([{ id: 1, value: "A" }]);
    expect(JSON.parse(r2.contents[0].text)).toEqual([{ id: 9, value: "Z" }]);
    expect(JSON.parse(r3.contents[0].text)).toEqual([{ id: 42, value: "Java" }]);
    expect(JSON.parse(r4.contents[0].text)).toEqual([{ id: "FR", value: "France" }]);
  });

  it("dictionary callback returns an explicit error body when the path is missing from the API response", async () => {
    vi.spyOn(boondClient, "apiRequest").mockResolvedValue({
      data: { setting: {} }, // no setting.tool
    } as never);
    registerAllResources(server);
    const call = vi.mocked(server.registerResource).mock.calls.find((c) => c[0] === "dictionary/tools");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = call![3] as any;
    const result = await cb(new URL("boond://dictionary/tools"));
    const body = JSON.parse(result.contents[0].text);
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/setting\.tool/);
  });

  it("exposes the current-user rights view (issue #261)", () => {
    expect(REGISTERED_RESOURCES.map((r) => r.uri)).toContain("boond://application/current-user/rights");
  });

  it("current-user/rights read callback condenses advancedRights and the included agencies / poles", async () => {
    const apiSpy = vi.spyOn(boondClient, "apiRequest").mockResolvedValue({
      data: {
        id: "18081",
        type: "currentuser",
        attributes: {
          login: "f@example.com",
          level: "manager",
          isOwner: false,
          narrowPerimeter: false,
          advancedRights: {
            resources: {
              entity: {
                authorizations: { creation: true, deletion: false },
                fields: [{ name: "mainManager", writeAccess: { always: true } }],
              },
              search: { perimeter: { allAgencies: true, myAgencies: false, agencies: [], managers: ["12"] } },
            },
            notifications: { isEnabled: true, search: { perimeter: { allGroup: true } } },
            version: "1",
          },
        },
      },
      included: [
        { id: "645", type: "customer", attributes: { name: "SILAMIR" } },
        { id: "1", type: "agency", attributes: { name: "Paris" } },
        { id: "7", type: "pole", attributes: { name: "Data" } },
        { id: "1002", type: "app", attributes: { name: "Quotations" } },
      ],
    });
    registerAllResources(server);
    const call = vi.mocked(server.registerResource).mock.calls.find((c) => c[0] === "application/current-user/rights");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = call![3] as any;
    const result = await cb(new URL("boond://application/current-user/rights"));
    expect(apiSpy).toHaveBeenCalledWith("/application/current-user");
    const body = JSON.parse(result.contents[0].text);
    expect(body).toEqual({
      id: "18081",
      login: "f@example.com",
      level: "manager",
      isOwner: false,
      narrowPerimeter: false,
      customer: { id: "645", name: "SILAMIR" },
      agencies: [{ id: "1", name: "Paris" }],
      poles: [{ id: "7", name: "Data" }],
      businessUnits: [],
      apps: ["Quotations"],
      rights: {
        // field-level detail dropped, false perimeter flags and empty lists dropped
        resources: { creation: true, deletion: false, perimeter: { allAgencies: true, managers: ["12"] } },
        notifications: { isEnabled: true, perimeter: { allGroup: true } },
      },
    });
    // No field-level detail leaks through.
    expect(result.contents[0].text).not.toContain("writeAccess");
  });

  it("current-user read callback hits /application/current-user", async () => {
    const apiSpy = vi.spyOn(boondClient, "apiRequest").mockResolvedValue({
      data: { id: "18081", type: "resource", attributes: { firstName: "Frédéric" } },
    });
    registerAllResources(server);
    const call = vi.mocked(server.registerResource).mock.calls.find((c) => c[0] === "application/current-user");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = call![3] as any;
    const result = await cb(new URL("boond://application/current-user"));
    expect(apiSpy).toHaveBeenCalledWith("/application/current-user");
    expect(JSON.parse(result.contents[0].text).data.attributes.firstName).toBe("Frédéric");
  });
});
