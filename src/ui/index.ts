import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppResource,
  getUiCapability,
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
} from "@modelcontextprotocol/ext-apps/server";
import { isDomainAllowed, type AccessPolicy } from "../config/access-policy.js";
import { DEFAULT_BASE_URL } from "../constants.js";
import { dashboardIcons } from "../icons.js";
import { logger } from "../services/logger.js";

/**
 * MCP Apps (`io.modelcontextprotocol/ui`) — interactive UIs served as `ui://`
 * resources and attached to tools through `_meta.ui`.
 *
 * ## Everything that touches `@modelcontextprotocol/ext-apps` lives here
 *
 * The extension is young (1.7.x at time of writing) and moves fast. Domain
 * files never import it: they call `appToolMeta()` and the tool handlers build
 * plain `structuredContent`. A breaking change upstream is therefore confined
 * to this directory plus the HTML asset.
 *
 * ## Capability negotiation: declare statically, degrade in the handler
 *
 * Client capabilities are only known after `initialize`, while registration
 * happens when the server is constructed — and in HTTP stateless mode a brand
 * new `McpServer` is built per POST, so there is no session to re-register
 * into. So the UI tool is registered **unconditionally** and always returns a
 * usable text + `structuredContent` payload; `_meta.ui.resourceUri` is inert
 * for a host that does not implement the extension. `clientSupportsUi()` is
 * used only for the *additive* part (attaching the `ui://` resource link to the
 * result), never to decide whether the tool exists.
 *
 * ## The asset is a file, not a template literal
 *
 * `assets/reporting.html` is self-contained (inline CSS + JS, no fetch, no CDN)
 * because the host renders it in a sandboxed iframe whose baseline CSP is
 * `default-src 'none'`. It is copied into `dist/ui/assets/` by
 * `scripts/copy-ui-assets.mjs` (wired into `npm run build`), so the same
 * relative path resolves from `src/` under vitest and from `dist/` at runtime.
 * `ui/index.test.ts` fails the build if the asset ever gains an external
 * reference.
 */

/**
 * `McpUiResourceMeta` / `McpUiToolMeta`, restated locally.
 *
 * `@modelcontextprotocol/ext-apps@1.7.5` re-exports its spec types through an
 * **extensionless** `export * from "./types"` in `dist/src/app.d.ts`. Under this
 * project's `Node16` module resolution that specifier does not resolve, so the
 * whole type surface silently collapses to `any` — importing `McpUiResourceMeta`
 * from the package is a hard error, and deriving it from
 * `registerAppResource`'s parameter type type-checks *anything* (verified: an
 * object with a bogus key is accepted). Values would ship unchecked either way.
 *
 * So the two objects this server actually emits are typed here instead, from
 * the 2026-01-26 spec. They are small and frozen by the spec; `index.test.ts`
 * pins the emitted values field by field. Delete this block once upstream ships
 * extensioned re-exports.
 */
export interface UiResourceCsp {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
}

export interface UiResourcePermissions {
  camera?: Record<string, never>;
  microphone?: Record<string, never>;
  geolocation?: Record<string, never>;
  clipboardWrite?: Record<string, never>;
}

export interface UiResourceMeta {
  csp?: UiResourceCsp;
  permissions?: UiResourcePermissions;
  domain?: string;
  prefersBorder?: boolean;
}

export interface UiToolMeta {
  resourceUri?: string;
  visibility?: Array<"model" | "app">;
}

/** URI of the reporting dashboard app. */
export const REPORTING_UI_URI = "ui://boond/reporting";

/** Re-exported so tools/tests never import the extension package directly. */
export { RESOURCE_MIME_TYPE };

interface UiResourceEntry {
  /** Registration name (also the human-readable resource name). */
  name: string;
  uri: string;
  title: string;
  description: string;
  /** Asset file under `assets/`, relative to this module. */
  asset: string;
  /** Domain the UI belongs to — gates registration against the access policy. */
  domain: "reporting";
}

/**
 * Exposed for tests and the TOOLS.md generator; lets both assert the catalogue
 * without booting a server.
 */
export const UI_RESOURCES: readonly UiResourceEntry[] = [
  {
    name: "ui/reporting",
    uri: REPORTING_UI_URI,
    title: "Tableau de bord reporting",
    description:
      "Interface interactive (MCP Apps) du reporting BoondManager : tableau triable, graphe, " +
      "changement de reporting et de période sans repasser par le modèle. " +
      "Rendue par les clients qui implémentent l'extension io.modelcontextprotocol/ui.",
    asset: "reporting.html",
    domain: "reporting",
  },
];

/**
 * `_meta` for a tool that participates in MCP Apps.
 *
 * Mirrors what `registerAppTool` does — set the modern `_meta.ui` *and* the
 * deprecated `_meta["ui/resourceUri"]` alias for older hosts — without routing
 * the registration through the extension. Going through `server.registerTool`
 * directly keeps these tools on the exact same path as the other 179 (the
 * per-domain proxy in `registration-decorators.ts` that installs filter hints
 * and records the tool→domain mapping for icons).
 */
export function appToolMeta(ui: UiToolMeta): Record<string, unknown> {
  return {
    ui,
    ...(ui.resourceUri === undefined ? {} : { [RESOURCE_URI_META_KEY]: ui.resourceUri }),
  };
}

/**
 * True when the connected client advertises MCP Apps support for the HTML
 * profile. Safe to call from a tool handler (capabilities are known by then);
 * returns `false` for stub servers and before `initialize`.
 */
export function clientSupportsUi(server: McpServer): boolean {
  try {
    const capabilities = server.server?.getClientCapabilities?.();
    return getUiCapability(capabilities)?.mimeTypes?.includes(RESOURCE_MIME_TYPE) === true;
  } catch {
    return false;
  }
}

/**
 * Security posture of every UI resource this server ships, in one place.
 *
 * - `csp`: all four domain lists empty. The app never fetches anything; its
 *   data arrives exclusively through `tools/call` over the host bridge. An
 *   empty list is the secure default in the spec (`connect-src 'none'` etc.),
 *   but it is declared explicitly so the intent survives a copy-paste.
 * - `permissions`: none requested — no camera, microphone, geolocation or
 *   clipboard.
 * - `prefersBorder`: the dashboard is a dense data surface, not an inline
 *   widget; hosts' defaults vary, so it is stated rather than left implicit.
 */
export const UI_RESOURCE_META: UiResourceMeta = {
  csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
  permissions: {},
  prefersBorder: true,
};

/**
 * Origin of the BoondManager *web app* (not the API), so an app can offer
 * "open the record in BoondManager" through `ui/open-link`.
 *
 * Derived from `BOOND_BASE_URL` by dropping the trailing `/api` — the two live
 * on the same host (`https://ui.boondmanager.com/api` → `https://ui.boondmanager.com`),
 * and deriving it means a customer on a dedicated instance gets working links
 * with no extra configuration. Same "empty means unconfigured" rule as
 * `readEnv` / `envOrUndefined` elsewhere: a blank or unsubstituted value must
 * fall back to the default, never become the URL.
 */
export function resolveWebAppBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env["BOOND_BASE_URL"];
  const base = !raw || raw.startsWith("${") || raw.trim().length === 0 ? DEFAULT_BASE_URL : raw.trim();
  return base.replace(/\/+$/, "").replace(/\/api$/i, "");
}

const ASSET_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "assets");

/** Read a UI asset from disk. Exported for the CSP guard test. */
export function readUiAsset(asset: string): string {
  return readFileSync(resolve(ASSET_DIR, asset), "utf8");
}

/**
 * Register the `ui://` resources.
 *
 * **Deliberately policy-filtered, unlike every other resource.** CLAUDE.md
 * states that resources are never filtered — that rule is about the *lookup
 * substrate* (dictionaries, current user), which stays useful whatever tools
 * are exposed. A `ui://` resource is not substrate: it is the render surface of
 * one specific tool, and advertising it while `BOOND_MCP_DOMAINS` hides the
 * reporting tools would list a UI that can never be populated. So it follows
 * its domain.
 */
export function registerUiResources(server: McpServer, policy?: AccessPolicy): void {
  for (const entry of UI_RESOURCES) {
    if (policy !== undefined && !isDomainAllowed(policy, entry.domain)) continue;

    let html: string;
    try {
      html = readUiAsset(entry.asset);
    } catch (error) {
      // A missing asset must not take the server down: the tool still returns
      // text + structuredContent, the host just has no UI to render.
      logger.warn(
        { event: "ui_asset_missing", uri: entry.uri, asset: entry.asset, err: String(error) },
        "UI asset unavailable — the MCP App will not be advertised"
      );
      continue;
    }

    registerAppResource(
      server,
      entry.name,
      entry.uri,
      {
        title: entry.title,
        description: entry.description,
        mimeType: RESOURCE_MIME_TYPE,
        icons: dashboardIcons(),
        // Listing-level default; the read result below repeats it because the
        // content item is what hosts actually enforce.
        _meta: { ui: UI_RESOURCE_META },
      },
      () => ({
        contents: [
          {
            uri: entry.uri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: { ui: UI_RESOURCE_META },
          },
        ],
      })
    );
  }
}
