import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

/**
 * OAuth2 plumbing for the HTTP transport.
 *
 * Architecture (corrected): the MCP server is a **OAuth2 protected resource**,
 * not an OAuth client. The MCP client (Claude Desktop, Claude Code, an MCP
 * gateway, …) performs the OAuth dance against BoondManager directly,
 * receives an access token, and forwards it as `Authorization: Bearer <token>`
 * on every MCP request. This server:
 *
 *   1. Validates the presence of a Bearer token on every request.
 *   2. Stores it in a per-request AsyncLocalStorage context.
 *   3. Forwards it verbatim when calling the BoondManager API
 *      (boond-client.ts reads the context via `oauthContextAuth`).
 *   4. Publishes RFC 9728 protected-resource metadata at
 *      `/.well-known/oauth-protected-resource` so MCP clients can discover
 *      the authorization server (BoondManager) automatically.
 *
 * The server holds **no secrets** related to OAuth: no client_secret, no
 * refresh token, no token store. Each user's session lives entirely on the
 * MCP client side. Multi-tenant by construction — each MCP user's Boond
 * actions are attributed to *that* user in Boond's audit log.
 */

export interface OAuthRequestContext {
  /** Bearer access token received from the MCP client (forwarded verbatim to Boond). */
  accessToken: string;
}

/**
 * Per-request context, populated by the HTTP transport before dispatching
 * to the MCP SDK and read by `oauthContextAuth` (boond-client) when an API
 * call is about to be issued. Stdio transport never uses this — it relies
 * on env-var credentials.
 */
export const oauthContext = new AsyncLocalStorage<OAuthRequestContext>();

/**
 * Identity of the caller, as far as this process can tell — the key every
 * per-user structure is partitioned on (dictionary cache #226, rate-limit
 * buckets and session ownership #232).
 *
 * - OAuth (HTTP transport): the request's Bearer token, hashed so the raw
 *   credential never sits in a long-lived structure. Two users of the same
 *   tenant get two identities — the price of not decoding an opaque token.
 * - Everything else (stdio, HTTP static auth): the credentials are process
 *   wide, so a single constant identity is exact.
 */
export function currentAuthIdentity(): string {
  const ctx = oauthContext.getStore();
  if (!ctx) return "env";
  return `oauth:${createHash("sha256").update(ctx.accessToken).digest("hex")}`;
}

/**
 * Extract a Bearer token from an HTTP `Authorization` header.
 * Returns `null` for missing, malformed, or non-Bearer auth schemes.
 *
 * Implemented with plain string operations rather than a regex to stay
 * O(n) on hostile inputs (e.g. an `Authorization` header full of spaces).
 * A naive `/^Bearer\s+(.+)$/i` is flagged by CodeQL `js/polynomial-redos`
 * because the greedy `\s+` and `.+` can backtrack against each other on
 * adversarial whitespace-only suffixes. The implementation below has no
 * backtracking surface.
 */
export function extractBearerToken(header: string | string[] | undefined): string | null {
  if (!header) return null;
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // "Bearer x" minimum length — scheme (6) + separator (1) + 1-char token.
  if (trimmed.length < 8) return null;
  if (trimmed.slice(0, 6).toLowerCase() !== "bearer") return null;
  // RFC 6750 §2.1 specifies a single space, but be liberal: accept tab too
  // since plenty of clients tab-separate. Reject anything else (covers
  // "Bearer-something" and other accidental matches of the prefix).
  const sep = trimmed.charCodeAt(6);
  if (sep !== 0x20 /* SP */ && sep !== 0x09 /* HT */) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
}

/** Default BoondManager OAuth authorization server (issuer). */
export const DEFAULT_AUTHORIZATION_SERVER = "https://ui.boondmanager.com";

export interface ProtectedResourceMetadataOptions {
  /** Canonical URL of this protected resource — e.g. `https://mcp.example.com/mcp`. */
  resource: string;
  /** Issuer URL(s) of the authorization server — e.g. `https://ui.boondmanager.com`. */
  authorizationServers: string[];
  /** Optional scope hints exposed to MCP clients. */
  scopesSupported?: string[];
}

/**
 * Build an RFC 9728 *OAuth 2.0 Protected Resource Metadata* document.
 * Served at `/.well-known/oauth-protected-resource` (and the path-suffixed
 * variant matching MCP_HTTP_PATH) so MCP clients can auto-discover where
 * to send the user for authorization.
 */
export function buildProtectedResourceMetadata(opts: ProtectedResourceMetadataOptions): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    resource: opts.resource,
    authorization_servers: opts.authorizationServers,
    bearer_methods_supported: ["header"],
  };
  if (opts.scopesSupported && opts.scopesSupported.length > 0) {
    doc["scopes_supported"] = opts.scopesSupported;
  }
  return doc;
}

function envOrUndefined(key: string): string | undefined {
  const v = process.env[key];
  if (!v || v.startsWith("${")) return undefined;
  return v;
}

/**
 * Resolve the authorization server URL surfaced in the discovery metadata.
 * Configurable so dedicated BoondManager instances (custom hostnames) can
 * advertise the right issuer.
 */
export function resolveAuthorizationServer(): string {
  return envOrUndefined("BOOND_OAUTH_AUTHORIZATION_SERVER") ?? DEFAULT_AUTHORIZATION_SERVER;
}

/**
 * Optional scope list advertised in the discovery metadata. Lets the MCP
 * client request appropriate scopes when initiating the OAuth flow.
 */
export function resolveAdvertisedScopes(): string[] {
  const raw = envOrUndefined("BOOND_OAUTH_SCOPES");
  if (!raw) return [];
  return raw.split(/[\s,]+/).filter((s) => s.length > 0);
}
