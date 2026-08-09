import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerUiResources,
  readUiAsset,
  appToolMeta,
  clientSupportsUi,
  resolveWebAppBaseUrl,
  UI_RESOURCES,
  UI_RESOURCE_META,
  REPORTING_UI_URI,
  RESOURCE_MIME_TYPE,
} from "./index.js";
import type { AccessPolicy } from "../config/access-policy.js";

function createMockServer() {
  return { registerResource: vi.fn() } as unknown as McpServer;
}

function policy(overrides: Partial<AccessPolicy> = {}): AccessPolicy {
  return {
    allowedDomains: null,
    excludedDomains: new Set(),
    operations: new Set(["read", "create", "update", "delete"]),
    ...overrides,
  } as AccessPolicy;
}

describe("registerUiResources", () => {
  let server: McpServer;
  beforeEach(() => {
    server = createMockServer();
  });

  it("registers exactly the resources declared in UI_RESOURCES", () => {
    registerUiResources(server);
    expect(server.registerResource).toHaveBeenCalledTimes(UI_RESOURCES.length);
    const uris = vi.mocked(server.registerResource).mock.calls.map((c) => c[1]);
    expect(uris).toEqual(UI_RESOURCES.map((r) => r.uri));
  });

  it("serves the reporting app under the MCP Apps mime type", () => {
    registerUiResources(server);
    const call = vi.mocked(server.registerResource).mock.calls.find((c) => c[1] === REPORTING_UI_URI);
    expect(call).toBeDefined();
    const config = call![2] as { mimeType?: string; title?: string; description?: string };
    expect(config.mimeType).toBe("text/html;profile=mcp-app");
    expect(RESOURCE_MIME_TYPE).toBe("text/html;profile=mcp-app");
    expect(config.title).toBeTruthy();
    expect(config.description).toBeTruthy();
  });

  it("declares no external origin, no permission, and an explicit border preference", () => {
    // Pinned field by field: the upstream types don't resolve under Node16
    // (see the comment on UiResourceMeta), so this test is what guards the
    // security posture we advertise, not the compiler.
    expect(UI_RESOURCE_META).toEqual({
      csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
      permissions: {},
      prefersBorder: true,
    });
    registerUiResources(server);
    const config = vi.mocked(server.registerResource).mock.calls[0][2] as { _meta?: { ui?: unknown } };
    expect(config._meta?.ui).toEqual(UI_RESOURCE_META);
  });

  it("repeats _meta.ui on the read result (the content item is what hosts enforce)", async () => {
    registerUiResources(server);
    const call = vi.mocked(server.registerResource).mock.calls[0];
    const read = call[3] as () => Promise<{
      contents: Array<{ uri: string; mimeType: string; text: string; _meta?: { ui?: unknown } }>;
    }>;
    const result = await read();
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].uri).toBe(REPORTING_UI_URI);
    expect(result.contents[0].mimeType).toBe(RESOURCE_MIME_TYPE);
    expect(result.contents[0].text.length).toBeGreaterThan(1000);
    expect(result.contents[0]._meta?.ui).toEqual(UI_RESOURCE_META);
  });

  /**
   * A `ui://` resource is not lookup substrate — it is the render surface of one
   * domain's tools. Advertising it while those tools are filtered out would list
   * a UI that can never be populated.
   */
  it("follows its domain through the access policy, unlike the reference resources", () => {
    registerUiResources(server, policy({ excludedDomains: new Set(["reporting"]) }));
    expect(server.registerResource).not.toHaveBeenCalled();

    const allowed = createMockServer();
    registerUiResources(allowed, policy({ allowedDomains: new Set(["reporting"]) }));
    expect(allowed.registerResource).toHaveBeenCalledTimes(UI_RESOURCES.length);

    const other = createMockServer();
    registerUiResources(other, policy({ allowedDomains: new Set(["invoices"]) }));
    expect(other.registerResource).not.toHaveBeenCalled();
  });

  it("registers the full surface when no policy is supplied (catalogue generator path)", () => {
    registerUiResources(server, undefined);
    expect(server.registerResource).toHaveBeenCalledTimes(UI_RESOURCES.length);
  });
});

/**
 * Automated CSP guard. The host renders the asset in a sandboxed iframe whose
 * baseline policy is `default-src 'none'` with script/style limited to `'self'
 * 'unsafe-inline'`, and this server declares *no* allowed origin. Anything the
 * page tries to fetch is therefore blocked at runtime — silently, and only in
 * the client. These assertions move that failure to build time.
 */
describe("UI assets are self-contained", () => {
  // The SVG namespace is an XML identifier, never fetched. Everything else that
  // looks like a URL in the asset is a bug.
  const SVG_NS = "http://www.w3.org/2000/svg";

  for (const entry of UI_RESOURCES) {
    describe(entry.asset, () => {
      const html = readUiAsset(entry.asset);

      it("is a non-empty HTML document", () => {
        expect(html).toMatch(/^<!doctype html>/i);
        expect(html.length).toBeGreaterThan(1000);
      });

      it("loads no external script or stylesheet", () => {
        expect(html).not.toMatch(/<script[^>]+\bsrc\s*=/i);
        expect(html).not.toMatch(/<link[^>]+\bhref\s*=/i);
        expect(html).not.toMatch(/@import/i);
      });

      it("references no remote origin beyond the SVG namespace", () => {
        const urls = html.match(/https?:\/\/[^\s"'<>)]+/gi) ?? [];
        expect(urls.filter((u) => u !== SVG_NS)).toEqual([]);
      });

      it("makes no direct network call — data arrives through tools/call only", () => {
        expect(html).not.toMatch(/\bfetch\s*\(/);
        expect(html).not.toMatch(/XMLHttpRequest/);
        expect(html).not.toMatch(/new\s+WebSocket/);
        expect(html).not.toMatch(/EventSource/);
        expect(html).not.toMatch(/importScripts/);
      });

      /**
       * BoondManager data (company names, project references, CRM notes) is
       * end-user content rendered inside the client. It must reach the DOM as
       * text, never as markup.
       */
      it("never assigns markup", () => {
        expect(html).not.toMatch(/\.innerHTML\s*=/);
        expect(html).not.toMatch(/\.outerHTML\s*=/);
        expect(html).not.toMatch(/insertAdjacentHTML/);
        expect(html).not.toMatch(/document\.write/);
        expect(html).not.toMatch(/\beval\s*\(/);
        expect(html).not.toMatch(/new\s+Function\s*\(/);
      });

      /**
       * Both triggers are required: the OS preference for a host that just
       * embeds the iframe, and `data-theme` for the theme the host declares in
       * `hostContext` — which can disagree with the OS.
       */
      it("styles both colour schemes, from the OS *and* from the host context", () => {
        expect(html).toContain("prefers-color-scheme: dark");
        expect(html).toContain('[data-theme="dark"]');
        expect(html).toContain('[data-theme="light"]');
        expect(html).toContain('setAttribute("data-theme"');
      });

      it("runs the MCP Apps handshake and cleans up on teardown", () => {
        expect(html).toContain("ui/initialize");
        expect(html).toContain("ui/notifications/initialized");
        expect(html).toContain("ui/notifications/tool-result");
        expect(html).toContain("ui/notifications/size-changed");
        expect(html).toContain("ui/resource-teardown");
        expect(html).toContain("removeEventListener");
      });
    });
  }
});

describe("appToolMeta", () => {
  it("sets both the modern and the legacy resource-uri keys", () => {
    expect(appToolMeta({ resourceUri: REPORTING_UI_URI, visibility: ["model", "app"] })).toEqual({
      ui: { resourceUri: REPORTING_UI_URI, visibility: ["model", "app"] },
      "ui/resourceUri": REPORTING_UI_URI,
    });
  });

  it("omits the legacy alias for a tool that has no UI of its own", () => {
    expect(appToolMeta({ visibility: ["model", "app"] })).toEqual({ ui: { visibility: ["model", "app"] } });
  });
});

describe("clientSupportsUi", () => {
  function serverWithCapabilities(capabilities: unknown): McpServer {
    return { server: { getClientCapabilities: () => capabilities } } as unknown as McpServer;
  }

  it("is true when the client advertises the MCP Apps html profile", () => {
    expect(
      clientSupportsUi(
        serverWithCapabilities({
          extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [RESOURCE_MIME_TYPE] } },
        })
      )
    ).toBe(true);
  });

  it("is false without the extension, with another mime type, or before initialize", () => {
    expect(clientSupportsUi(serverWithCapabilities({}))).toBe(false);
    expect(
      clientSupportsUi(serverWithCapabilities({ extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [] } } }))
    ).toBe(false);
    expect(clientSupportsUi(serverWithCapabilities(undefined))).toBe(false);
  });

  it("never throws on a server that has no underlying protocol (stubs, tests)", () => {
    expect(clientSupportsUi({} as McpServer)).toBe(false);
    expect(
      clientSupportsUi({
        server: {
          getClientCapabilities: () => {
            throw new Error("not connected");
          },
        },
      } as unknown as McpServer)
    ).toBe(false);
  });
});

describe("resolveWebAppBaseUrl", () => {
  it("drops the /api suffix of the configured API base", () => {
    expect(resolveWebAppBaseUrl({ BOOND_BASE_URL: "https://ui.boondmanager.com/api" })).toBe(
      "https://ui.boondmanager.com"
    );
    expect(resolveWebAppBaseUrl({ BOOND_BASE_URL: "https://acme.boondmanager.com/api/" })).toBe(
      "https://acme.boondmanager.com"
    );
  });

  it("treats blank and unsubstituted values as unconfigured", () => {
    // Mirrors `envOrUndefined` / `readEnv`: a half-filled packaged install
    // hands over empty strings, which must not become the link base.
    for (const value of ["", "   ", "${user_config.base_url}"]) {
      expect(resolveWebAppBaseUrl({ BOOND_BASE_URL: value })).toBe("https://ui.boondmanager.com");
    }
    expect(resolveWebAppBaseUrl({})).toBe("https://ui.boondmanager.com");
  });
});
