import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { registerAllResources } from "./index.js";
import { ENTITY_TEMPLATES, REGISTERED_RESOURCE_TEMPLATES, readEntityAggregate } from "./templates.js";
import { resolveAccessPolicy } from "../config/access-policy.js";
import { MAX_RESOURCE_BYTES } from "../constants.js";
import * as boondClient from "../services/boond-client.js";
import { connectMcpClient, useDefaultServerSurface } from "../tools/test-helpers.js";
import type { JsonApiResponse } from "../types.js";

function createMockServer() {
  return { registerResource: vi.fn() } as unknown as McpServer;
}

function entityResponse(id: string, type: string, attributes: Record<string, unknown> = {}): JsonApiResponse {
  return { data: { id, type, attributes } };
}

const CANDIDATE = ENTITY_TEMPLATES.find((t) => t.uriTemplate === "boond://candidate/{id}")!;

describe("entity resource templates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("catalogue", () => {
    it("declares the six entity templates from the issue's scope", () => {
      expect(REGISTERED_RESOURCE_TEMPLATES.map((t) => t.uriTemplate)).toEqual([
        "boond://candidate/{id}",
        "boond://resource/{id}",
        "boond://contact/{id}",
        "boond://company/{id}",
        "boond://opportunity/{id}",
        "boond://project/{id}",
      ]);
    });

    it("aggregates only bounded tabs — never a collection endpoint", () => {
      // A resource is read whole or not at all: folding `actions` or
      // `positionings` in would make the read size unpredictable.
      const COLLECTION_TABS = ["actions", "positionings", "invoices", "orders", "times-reports", "projects"];
      for (const template of ENTITY_TEMPLATES) {
        expect(template.tabs.length).toBeGreaterThan(0);
        for (const tab of template.tabs) expect(COLLECTION_TABS).not.toContain(tab);
      }
    });

    it("uses singular URIs while the dictionaries stay plural", () => {
      // Both forms are published URIs. Aligning either on the other breaks
      // clients that stored them — hence a test, not just a comment.
      for (const t of REGISTERED_RESOURCE_TEMPLATES) {
        expect(t.uriTemplate).toMatch(/^boond:\/\/[a-z]+\/\{id\}$/);
        expect(t.uriTemplate).not.toMatch(/s\/\{id\}$/);
      }
    });
  });

  describe("advertised over the wire", () => {
    useDefaultServerSurface();

    it("lists the six templates in resources/templates/list", async () => {
      const { client, close } = await connectMcpClient();
      try {
        const { resourceTemplates } = await client.listResourceTemplates();
        expect(resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual(
          REGISTERED_RESOURCE_TEMPLATES.map((t) => t.uriTemplate).sort()
        );
        for (const t of resourceTemplates) {
          expect(t.mimeType).toBe("application/json");
          expect(t.description).toBeTruthy();
          // SEP-973: no shim needed — `templates/list` spreads the metadata.
          expect(t.icons?.length).toBeGreaterThan(0);
        }
      } finally {
        await close();
      }
    });

    it("serves an aggregated read through the SDK's template matching", async () => {
      // The one path the unit tests cannot reach: `new URL(uri)` normalisation
      // in the SDK's ReadResource handler, then `uriTemplate.match()` against
      // the *normalised* string, then dispatch to our callback.
      vi.spyOn(boondClient, "apiRequest").mockImplementation((path: string) =>
        Promise.resolve(entityResponse("42", "candidate", { path }))
      );
      const { client, close } = await connectMcpClient();
      try {
        const result = await client.readResource({ uri: "boond://candidate/42" });
        expect(result.contents).toHaveLength(1);
        expect(result.contents[0]?.mimeType).toBe("application/json");
        const body = JSON.parse(String(result.contents[0]?.text)) as { entity: { id: string } };
        expect(body.entity.id).toBe("42");
      } finally {
        await close();
      }
    });

    it("rejects a hostile id through the SDK rather than reaching the API", async () => {
      const spy = vi.spyOn(boondClient, "apiRequest");
      const { client, close } = await connectMcpClient();
      try {
        // Matches the template (`([^/,]+)` swallows the query string) and is
        // refused by the handler, not by the router.
        await expect(client.readResource({ uri: "boond://candidate/1?x=2" })).rejects.toThrow(/numérique/);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        await close();
      }
    });

    it("keeps the templates out of resources/list (they are not enumerable)", async () => {
      const { client, close } = await connectMcpClient();
      try {
        const uris = (await client.listResources()).resources.map((r) => r.uri);
        expect(uris).toContain("boond://dictionary/states/candidates");
        for (const t of REGISTERED_RESOURCE_TEMPLATES) {
          expect(uris).not.toContain(t.uriTemplate);
          expect(uris.some((u) => u.startsWith(t.uriTemplate.replace("{id}", "")))).toBe(false);
        }
      } finally {
        await close();
      }
    });
  });

  describe("read", () => {
    it("hits the entity path and each declared tab exactly once", async () => {
      const spy = vi
        .spyOn(boondClient, "apiRequest")
        .mockImplementation((path: string) => Promise.resolve(entityResponse("42", "candidate", { path })));

      const text = await readEntityAggregate(CANDIDATE, "42", "boond://candidate/42");

      expect(spy.mock.calls.map((c) => c[0])).toEqual([
        "/candidates/42",
        "/candidates/42/information",
        "/candidates/42/technical-data",
      ]);
      const body = JSON.parse(text) as Record<string, unknown>;
      expect(body["uri"]).toBe("boond://candidate/42");
      expect(Object.keys(body["sections"] as object)).toEqual(["information", "technical-data"]);
    });

    it("returns the record even when a tab fails, and names the failure", async () => {
      vi.spyOn(boondClient, "apiRequest").mockImplementation((path: string) =>
        path.endsWith("/technical-data")
          ? Promise.reject(new Error("HTTP 404 — onglet absent"))
          : Promise.resolve(entityResponse("42", "candidate", { lastName: "Dupont" }))
      );

      const body = JSON.parse(await readEntityAggregate(CANDIDATE, "42", "boond://candidate/42")) as {
        entity: { id: string };
        sections: Record<string, unknown>;
        _errors?: Record<string, string>;
      };

      expect(body.entity.id).toBe("42");
      expect(Object.keys(body.sections)).toEqual(["information"]);
      expect(body._errors?.["technical-data"]).toContain("404");
    });

    it("propagates the error when the base record itself fails", async () => {
      vi.spyOn(boondClient, "apiRequest").mockImplementation((path: string) =>
        path === "/candidates/42" ? Promise.reject(new Error("HTTP 404")) : Promise.resolve(entityResponse("42", "x"))
      );
      // With no record there is nothing to aggregate: a shell of empty tabs
      // would read as "this candidate exists and is blank".
      await expect(readEntityAggregate(CANDIDATE, "42", "boond://candidate/42")).rejects.toThrow("HTTP 404");
    });

    it("keeps a tab collection as a list", async () => {
      vi.spyOn(boondClient, "apiRequest").mockImplementation((path: string) =>
        path.endsWith("/information")
          ? Promise.resolve({ data: [{ id: "1", type: "info", attributes: {} }] } as JsonApiResponse)
          : Promise.resolve(entityResponse("42", "candidate"))
      );
      const body = JSON.parse(await readEntityAggregate(CANDIDATE, "42", "boond://candidate/42")) as {
        sections: { information: unknown };
      };
      expect(Array.isArray(body.sections.information)).toBe(true);
    });
  });

  describe("id validation", () => {
    // The SDK compiles `{id}` to RFC 6570's default `([^/,]+)`, NOT to a
    // numeric pattern, so all of these genuinely reach the read callback and
    // would otherwise be interpolated into an API path.
    const HOSTILE_IDS = ["1?x=2", "1#f", "..%2Fresources%2F9", "42/information", "", "abc", "1 2"];

    it.each(HOSTILE_IDS)("refuses %j before any API call", async (id) => {
      const spy = vi.spyOn(boondClient, "apiRequest");
      await expect(readEntityAggregate(CANDIDATE, id, `boond://candidate/${id}`)).rejects.toThrow(McpError);
      expect(spy).not.toHaveBeenCalled();
    });

    it("refuses an array id rather than silently joining it", async () => {
      const spy = vi.spyOn(boondClient, "apiRequest");
      // `Variables` is `string | string[]`; a repeated segment arrives as an array.
      await expect(readEntityAggregate(CANDIDATE, ["1", "2"], "boond://candidate/1,2")).rejects.toThrow(McpError);
      expect(spy).not.toHaveBeenCalled();
    });

    it("names the expected shape in the rejection", async () => {
      await expect(readEntityAggregate(CANDIDATE, "abc", "boond://candidate/abc")).rejects.toThrow(
        /boond:\/\/candidate\/1234/
      );
    });
  });

  describe("size ceiling", () => {
    /** A tab payload big enough to blow the ceiling on its own. */
    function bulky(): JsonApiResponse {
      return entityResponse("42", "candidate", { blob: "x".repeat(MAX_RESOURCE_BYTES) });
    }

    it("stays under MAX_RESOURCE_BYTES and stays parseable JSON", async () => {
      vi.spyOn(boondClient, "apiRequest").mockImplementation((path: string) =>
        Promise.resolve(path === "/candidates/42" ? entityResponse("42", "candidate", { lastName: "Dupont" }) : bulky())
      );

      const text = await readEntityAggregate(CANDIDATE, "42", "boond://candidate/42");

      expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(MAX_RESOURCE_BYTES);
      // The whole point of dropping sections instead of cutting the text: a
      // truncated JSON document breaks the one thing the mime type promises.
      const body = JSON.parse(text) as {
        entity: { attributes?: { lastName?: string } };
        _omitted?: { sections: string[]; reason: string };
      };
      expect(body.entity.attributes?.lastName).toBe("Dupont");
      expect(body._omitted?.sections).toEqual(["technical-data", "information"]);
      expect(body._omitted?.reason).toContain("MAX_RESOURCE_BYTES");
    });

    it("sacrifices the last declared tab first", async () => {
      // One oversized tab: `information` must outlive `technical-data`.
      vi.spyOn(boondClient, "apiRequest").mockImplementation((path: string) =>
        Promise.resolve(path.endsWith("/technical-data") ? bulky() : entityResponse("42", "candidate"))
      );
      const body = JSON.parse(await readEntityAggregate(CANDIDATE, "42", "boond://candidate/42")) as {
        sections: Record<string, unknown>;
        _omitted?: { sections: string[] };
      };
      expect(body._omitted?.sections).toEqual(["technical-data"]);
      expect(Object.keys(body.sections)).toEqual(["information"]);
    });

    it("adds no _omitted marker when nothing was dropped", async () => {
      vi.spyOn(boondClient, "apiRequest").mockResolvedValue(entityResponse("42", "candidate"));
      const body = JSON.parse(await readEntityAggregate(CANDIDATE, "42", "boond://candidate/42")) as Record<
        string,
        unknown
      >;
      expect(body).not.toHaveProperty("_omitted");
      expect(body).not.toHaveProperty("_errors");
    });
  });

  describe("access policy", () => {
    let server: McpServer;
    beforeEach(() => {
      server = createMockServer();
    });

    function registeredTemplateUris(): string[] {
      return vi
        .mocked(server.registerResource)
        .mock.calls.map(([, uriOrTemplate]) => uriOrTemplate)
        .filter((u) => typeof u !== "string")
        .map((t) => String(t.uriTemplate));
    }

    function registeredStaticUris(): string[] {
      return vi
        .mocked(server.registerResource)
        .mock.calls.map(([, uriOrTemplate]) => uriOrTemplate)
        .filter((u): u is string => typeof u === "string");
    }

    it("drops boond://candidate/{id} under the finance profile but keeps the dictionaries", () => {
      const policy = resolveAccessPolicy({ BOOND_MCP_PROFILE: "finance" } as NodeJS.ProcessEnv);
      registerAllResources(server, policy);

      expect(registeredTemplateUris()).not.toContain("boond://candidate/{id}");
      // The rule this feature deliberately breaks applies only to code tables.
      expect(registeredStaticUris()).toContain("boond://dictionary/states/candidates");
      expect(registeredStaticUris()).toContain("boond://application/current-user");
    });

    it("honours an explicit deny-list", () => {
      const policy = resolveAccessPolicy({ BOOND_MCP_EXCLUDE_DOMAINS: "candidates" } as NodeJS.ProcessEnv);
      registerAllResources(server, policy);

      const uris = registeredTemplateUris();
      expect(uris).not.toContain("boond://candidate/{id}");
      expect(uris).toContain("boond://resource/{id}");
    });

    it("exposes every template when no policy is passed", () => {
      registerAllResources(server);
      expect(registeredTemplateUris().sort()).toEqual(REGISTERED_RESOURCE_TEMPLATES.map((t) => t.uriTemplate).sort());
    });
  });

  describe("id completion", () => {
    function completerFor(uriTemplate: string): (value: string) => Promise<string[]> {
      const server = createMockServer();
      registerAllResources(server);
      const call = vi
        .mocked(server.registerResource)
        .mock.calls.find(([, u]) => typeof u !== "string" && String(u.uriTemplate) === uriTemplate)!;
      const template = call[1] as {
        completeCallback: (v: string) => ((value: string) => Promise<string[]>) | undefined;
      };
      return template.completeCallback("id")!;
    }

    it("returns the ids the domain search finds", async () => {
      const spy = vi.spyOn(boondClient, "apiSearch").mockResolvedValue({
        data: [
          { id: "12", type: "candidate", attributes: {} },
          { id: "34", type: "candidate", attributes: {} },
        ],
      } as JsonApiResponse);

      const values = await completerFor("boond://candidate/{id}")("dupont");

      expect(values).toEqual(["12", "34"]);
      expect(spy).toHaveBeenCalledWith("/candidates", expect.objectContaining({ keywords: "dupont" }));
    });

    it("does not call the API on an empty prefix", async () => {
      const spy = vi.spyOn(boondClient, "apiSearch");
      expect(await completerFor("boond://candidate/{id}")("   ")).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    });

    it("degrades to no suggestion when the search fails", async () => {
      // Keystroke-rate call: a 429 or a network blip must not surface as an
      // error in the client's picker.
      vi.spyOn(boondClient, "apiSearch").mockRejectedValue(new Error("HTTP 429"));
      expect(await completerFor("boond://candidate/{id}")("dupont")).toEqual([]);
    });
  });

  describe("progress", () => {
    it("reports one step per settled request when the client sent a token", async () => {
      vi.spyOn(boondClient, "apiRequest").mockResolvedValue(entityResponse("42", "candidate"));
      const sent: Array<{ progress: number; total?: number }> = [];
      const extra = {
        _meta: { progressToken: "t1" },
        sendNotification: (n: { params: { progress: number; total?: number } }) => {
          sent.push(n.params);
          return Promise.resolve();
        },
      };

      await readEntityAggregate(CANDIDATE, "42", "boond://candidate/42", extra);

      expect(sent.map((s) => s.progress)).toEqual([1, 2, 3]);
      expect(new Set(sent.map((s) => s.total))).toEqual(new Set([3]));
    });

    it("is byte-for-byte identical without a progressToken", async () => {
      vi.spyOn(boondClient, "apiRequest").mockResolvedValue(entityResponse("42", "candidate"));
      const withToken = await readEntityAggregate(CANDIDATE, "42", "boond://candidate/42", {
        _meta: { progressToken: "t1" },
        sendNotification: () => Promise.resolve(),
      });
      const without = await readEntityAggregate(CANDIDATE, "42", "boond://candidate/42");
      expect(without).toBe(withToken);
    });
  });
});
