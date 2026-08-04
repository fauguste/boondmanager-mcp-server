import { describe, it, expect, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DOMAIN_ICONS, iconsForDomain, iconsForPrompt, identityIcons, referenceIcons, iconsByteSize } from "./icons.js";
import { REGISTERED_DOMAINS } from "./constants.js";
import { PROMPTS } from "./prompts/index.js";
import { createMcpServer } from "./server.js";

/**
 * Per-icon ceiling. Every tool of a domain carries a copy, so a fat glyph is
 * multiplied by ~30 in `tools/list`. The cumulative budget lives in
 * `tools/descriptions.test.ts` next to the other context-budget caps.
 */
const MAX_ICON_JSON_BYTES = 320;

afterEach(() => {
  delete process.env.BOOND_MCP_ICONS;
});

describe("DOMAIN_ICONS", () => {
  it("covers every registered domain", () => {
    for (const domain of REGISTERED_DOMAINS) {
      expect(iconsForDomain(domain), domain).toBeDefined();
      expect(iconsForDomain(domain)?.length, domain).toBeGreaterThan(0);
    }
    expect(Object.keys(DOMAIN_ICONS).sort()).toEqual([...REGISTERED_DOMAINS].sort());
  });

  it("ships self-contained data URIs (no network fetch, no hosted asset)", () => {
    for (const [domain, icons] of Object.entries(DOMAIN_ICONS)) {
      for (const icon of icons) {
        expect(icon.src.startsWith("data:image/svg+xml,"), domain).toBe(true);
        expect(icon.src, domain).toContain("%3Csvg");
      }
    }
  });

  it("percent-encodes everything a URI can't carry literally", () => {
    for (const [domain, icons] of Object.entries(DOMAIN_ICONS)) {
      for (const icon of icons) {
        // A raw space, angle bracket or '#' would make the data URI invalid
        // (and '#' would truncate it at the fragment).
        expect(icon.src, domain).not.toMatch(/[ <>#]/);
      }
    }
  });

  it("stays within the per-icon byte ceiling", () => {
    const oversized = Object.entries(DOMAIN_ICONS)
      .map(([domain, icons]) => ({ domain, bytes: iconsByteSize(icons) }))
      .filter((e) => e.bytes > MAX_ICON_JSON_BYTES);
    expect(oversized).toEqual([]);
  });

  it("reuses glyph objects across domains (same shape ⇒ same string)", () => {
    expect(DOMAIN_ICONS.companies[0].src).toBe(DOMAIN_ICONS.agencies[0].src);
    expect(DOMAIN_ICONS.candidates[0].src).not.toBe(DOMAIN_ICONS.companies[0].src);
  });
});

describe("iconsForPrompt", () => {
  it("resolves every prompt to its subject domain's icon", () => {
    for (const prompt of PROMPTS) {
      expect(iconsForPrompt(prompt.name), prompt.name).toBeDefined();
    }
  });

  it("returns undefined for an unknown prompt", () => {
    expect(iconsForPrompt("nope")).toBeUndefined();
  });
});

describe("BOOND_MCP_ICONS opt-out", () => {
  it.each(["0", "false", "no", "off", "OFF"])("drops all icons when set to %s", (value) => {
    process.env.BOOND_MCP_ICONS = value;
    expect(iconsForDomain("candidates")).toBeUndefined();
    expect(iconsForPrompt(PROMPTS[0].name)).toBeUndefined();
    expect(referenceIcons()).toBeUndefined();
    expect(identityIcons()).toBeUndefined();
  });

  it("keeps icons for any other value (absent, 1, true)", () => {
    expect(iconsForDomain("candidates")).toBeDefined();
    process.env.BOOND_MCP_ICONS = "1";
    expect(iconsForDomain("candidates")).toBeDefined();
    process.env.BOOND_MCP_ICONS = "true";
    expect(referenceIcons()).toBeDefined();
  });
});

/**
 * End-to-end through a real client: the SDK (1.30) does not emit `icons` for
 * tools and prompts on its own, so `installProtocolIcons` decorates the list
 * responses. These are the tests that fail loudly if the shim breaks — or if a
 * future SDK starts emitting icons itself and makes it redundant.
 */
describe("icons over the wire", () => {
  async function connect() {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer();
    const client = new Client({ name: "vitest", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return { client, server, close: async () => Promise.all([client.close(), server.close()]) };
  }

  it("attaches the domain icon to every tool, prompt and resource", async () => {
    const { client, close } = await connect();
    try {
      const tools = (await client.listTools()).tools;
      expect(tools.length).toBeGreaterThan(150);
      expect(tools.filter((t) => t.icons === undefined)).toEqual([]);
      // The icon follows the domain, not the name prefix.
      const invoiceTool = tools.find((t) => t.name === "boond_invoices_search");
      const providerTool = tools.find((t) => t.name === "boond_provider_invoices_search");
      expect(invoiceTool?.icons?.[0]?.src).toBe(DOMAIN_ICONS.invoices[0].src);
      expect(providerTool?.icons?.[0]?.src).toBe(DOMAIN_ICONS["provider-invoices"][0].src);
      const candidateTool = tools.find((t) => t.name === "boond_candidates_search");
      expect(candidateTool?.icons?.[0]?.src).toBe(DOMAIN_ICONS.candidates[0].src);

      const prompts = (await client.listPrompts()).prompts;
      expect(prompts.filter((p) => p.icons === undefined)).toEqual([]);

      const resources = (await client.listResources()).resources;
      expect(resources.filter((r) => r.icons === undefined)).toEqual([]);
    } finally {
      await close();
    }
  });

  it("leaves the rest of each entry untouched (name, description, schema)", async () => {
    const { client, close } = await connect();
    try {
      const tool = (await client.listTools()).tools.find((t) => t.name === "boond_candidates_search");
      expect(tool?.description).toBeTruthy();
      expect(tool?.inputSchema).toMatchObject({ type: "object" });
      expect(tool?.annotations?.readOnlyHint).toBe(true);
    } finally {
      await close();
    }
  });

  it("emits no icons at all when the opt-out is set", async () => {
    process.env.BOOND_MCP_ICONS = "0";
    const { client, close } = await connect();
    try {
      const tools = (await client.listTools()).tools;
      expect(tools.filter((t) => t.icons !== undefined)).toEqual([]);
      const prompts = (await client.listPrompts()).prompts;
      expect(prompts.filter((p) => p.icons !== undefined)).toEqual([]);
      const resources = (await client.listResources()).resources;
      expect(resources.filter((r) => r.icons !== undefined)).toEqual([]);
    } finally {
      await close();
    }
  });
});
