import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllResources, REGISTERED_RESOURCES } from "./index.js";
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

  it("registers exactly the resources declared in REGISTERED_RESOURCES", () => {
    registerAllResources(server);
    expect(server.registerResource).toHaveBeenCalledTimes(REGISTERED_RESOURCES.length);
  });

  it("each resource has a unique URI", () => {
    const uris = REGISTERED_RESOURCES.map((r) => r.uri);
    expect(new Set(uris).size).toBe(uris.length);
  });

  it("every dictionary URI uses the boond:// scheme under /dictionary/", () => {
    const dicts = REGISTERED_RESOURCES.filter((r) => r.name.startsWith("dictionary/"));
    expect(dicts.length).toBeGreaterThan(10);
    for (const r of dicts) {
      expect(r.uri).toMatch(/^boond:\/\/dictionary\/[a-zA-Z]+(\/[a-zA-Z]+)?$/);
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
      const [name, uri, config] = call;
      expect(typeof name).toBe("string");
      expect(typeof uri).toBe("string");
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
