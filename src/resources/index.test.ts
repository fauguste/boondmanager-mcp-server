import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllResources, REGISTERED_RESOURCES } from "./index.js";
import * as boondClient from "../services/boond-client.js";

function createMockServer() {
  return { registerResource: vi.fn() } as unknown as McpServer;
}

describe("registerAllResources", () => {
  let server: McpServer;
  beforeEach(() => {
    server = createMockServer();
    vi.restoreAllMocks();
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
      expect(r.uri).toMatch(/^boond:\/\/dictionary\/[a-zA-Z]+\/[a-zA-Z]+$|^boond:\/\/dictionary\/[a-zA-Z]+$/);
    }
  });

  it("exposes the current-user resource", () => {
    expect(REGISTERED_RESOURCES.find((r) => r.uri === "boond://application/current-user")).toBeDefined();
  });

  it("exposes the search-tool dictionaries the prompts depend on", () => {
    // Prompts in src/prompts/index.ts and the tool descriptions reference
    // these dict slugs — make sure they're all surfaced as resources so the
    // model can resolve state/typeOf integers without a tool call.
    const slugs = REGISTERED_RESOURCES.map((r) => r.uri.replace(/^boond:\/\/dictionary\//, ""));
    expect(slugs).toEqual(expect.arrayContaining([
      "states/resources",
      "states/candidates",
      "states/contacts",
      "states/companies",
      "states/opportunities",
      "states/projects",
      "states/invoices",
      "typeOf/resources",
      "typeOf/candidates",
      "typeOf/projects",
      "typeOf/actions",
    ]));
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

  it("dictionary read callback hits /application/dictionaries/<slug>", async () => {
    const apiSpy = vi.spyOn(boondClient, "apiRequest").mockResolvedValue({
      data: [{ id: "1", type: "dictionary", attributes: { value: "Actif" } }],
    });
    registerAllResources(server);
    const call = vi.mocked(server.registerResource).mock.calls.find((c) => c[0] === "dictionary/states/resources");
    expect(call).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = call![3] as any;
    const result = await cb(new URL("boond://dictionary/states/resources"));
    expect(apiSpy).toHaveBeenCalledWith("/application/dictionaries/states/resources");
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].uri).toBe("boond://dictionary/states/resources");
    expect(result.contents[0].mimeType).toBe("application/json");
    expect(JSON.parse(result.contents[0].text).data[0].attributes.value).toBe("Actif");
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
