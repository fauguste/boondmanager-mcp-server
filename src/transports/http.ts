import { createServer, IncomingMessage, ServerResponse, type Server } from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger, generateCorrelationId } from "../services/logger.js";
import { runWithRequestContext } from "../services/request-context.js";
import { apiRequest, BoondApiError } from "../services/boond-client.js";
import { readBool, readCsv, readPositiveInt, readString, readUrl } from "../config/env.js";
import { SERVER_VERSION } from "../server.js";
import {
  buildProtectedResourceMetadata,
  currentAuthIdentity,
  extractBearerToken,
  oauthContext,
  resolveAdvertisedScopes,
  resolveAuthorizationServer,
} from "../services/oauth.js";

export interface HttpTransportOptions {
  host: string;
  port: number;
  path: string;
  stateless: boolean;
  enableJsonResponse: boolean;
  /** Idle timeout for stateful sessions, in ms. Defaults to 30 min. */
  sessionTtlMs?: number;
  /** How often to sweep idle sessions, in ms. Defaults to 5 min. */
  sessionSweepIntervalMs?: number;
  /** Max concurrent stateful sessions before new inits are rejected with 503. */
  maxSessions?: number;
  /**
   * Allow-list of Host header hostnames (port-agnostic) for DNS rebinding
   * protection. Use `["*"]` to opt out explicitly. When undefined **or empty**
   * (an unset / blank env var), a localhost default is applied if bound to a
   * loopback interface, and validation is off otherwise — a blank value never
   * silently disables the check, `*` is the explicit opt-out.
   */
  allowedHosts?: string[];
  /**
   * Allow-list of `Origin` header values (scheme + host + port) accepted from
   * browser-based clients. A request with **no** `Origin` is always accepted
   * (curl, gateways, non-browser MCP clients); a request carrying an `Origin`
   * outside this list gets a `403` (MCP 2025-11-25 requirement). Use `["*"]` to
   * opt out explicitly. When undefined **or empty** (an unset / blank env var),
   * the loopback default of `resolveOriginPolicy` applies — same rationale as
   * `allowedHosts`: blank does not mean "disabled".
   */
  allowedOrigins?: string[];
  /**
   * Public URL clients use to reach this MCP endpoint — used as the
   * `resource` field of the protected-resource metadata and in the
   * `WWW-Authenticate` challenge. Defaults to `http://{host}:{port}{path}`
   * which is only correct for local / loopback deployments. Behind a
   * reverse proxy, set `MCP_HTTP_PUBLIC_URL` explicitly.
   */
  publicUrl?: string;
  /**
   * Skip the OAuth2 Bearer check and use the env-based credentials configured
   * via `initClient()` (BOOND_USER_TOKEN + BOOND_CLIENT_TOKEN + BOOND_CLIENT_KEY,
   * or BOOND_API_TOKEN, or BasicAuth). Intended for single-tenant / self-hosted
   * deployments where the operator owns both the server and the credentials.
   * Set `BOOND_HTTP_STATIC_AUTH=true` to enable via `resolveHttpOptions()`.
   *
   * In this mode **nothing** authenticates the MCP client: whoever reaches the
   * port acts with the operator's BoondManager rights. `apiKey` is what closes
   * that (issue #230), and `assertStaticAuthPolicy` refuses to start without
   * one on a non-loopback bind.
   */
  staticAuth?: boolean;
  /**
   * Shared secret the MCP client must present in static-auth mode, as
   * `Authorization: Bearer <key>` or `X-Api-Key: <key>`. Compared in constant
   * time. Set via `MCP_HTTP_API_KEY`. Ignored (with a warning) in OAuth mode,
   * where the Bearer is the BoondManager access token.
   */
  apiKey?: string;
  /**
   * Explicit opt-out of the "static auth off loopback requires an API key"
   * start-up refusal — for a deployment whose network is the boundary (a
   * private gateway). Set via `MCP_HTTP_INSECURE_STATIC_AUTH=1`.
   */
  insecureStaticAuth?: boolean;
  /**
   * Node `server.keepAliveTimeout`: how long an idle keep-alive connection is
   * kept open. Must exceed the idle timeout of any load balancer in front
   * (60 s AWS ALB, 75 s nginx by default) — Node's 5 s default is below both,
   * which is how a LB reuses a connection Node just closed and answers `502`
   * (issue #237). Default 65 s; env `MCP_HTTP_KEEP_ALIVE_TIMEOUT_MS`.
   */
  keepAliveTimeoutMs?: number;
  /**
   * Node `server.headersTimeout`: budget to receive a request's headers. Node
   * requires it above `keepAliveTimeout`; a lower value is bumped to
   * `keepAliveTimeoutMs + 1000` with a warning. Default 66 s; env
   * `MCP_HTTP_HEADERS_TIMEOUT_MS`.
   */
  headersTimeoutMs?: number;
  /**
   * Node `server.requestTimeout`: budget to receive a whole request (headers +
   * body). Generous because it also bounds slow clients on long tool calls.
   * Default 5 min; env `MCP_HTTP_REQUEST_TIMEOUT_MS`.
   */
  requestTimeoutMs?: number;
  /**
   * OAuth mode only (issue #234): validate each Bearer against BoondManager
   * (`GET /application/current-user`, cached per token for
   * `tokenValidationTtlMs`) **before** dispatching, so an expired or revoked
   * token is answered with HTTP `401` + `WWW-Authenticate: … error="invalid_token"`
   * (RFC 6750 §3.1) — the signal a spec-compliant MCP client turns into a new
   * authorization flow. Without it the 401 only surfaces inside a `tools/call`
   * result, which no client re-authorizes from. Off by default because it
   * costs one BoondManager call per token per TTL; env `MCP_HTTP_VALIDATE_TOKEN`.
   */
  validateToken?: boolean;
  /** Positive/negative cache lifetime of a token validation, in ms. Default 60 s; env `MCP_HTTP_TOKEN_VALIDATION_TTL_MS`. */
  tokenValidationTtlMs?: number;
  /**
   * Grace period `close()` gives in-flight connections (an open SSE stream, a
   * request mid-body) before destroying them with `closeAllConnections()`.
   * Idle keep-alive connections are closed immediately. Default 10 s; env
   * `MCP_HTTP_SHUTDOWN_TIMEOUT_MS`.
   */
  shutdownTimeoutMs?: number;
}

export interface HttpServerHandle {
  /**
   * Stop accepting connections, close idle ones now and in-flight ones after
   * `shutdownTimeoutMs`, then resolve. Idempotent: a second call (a second
   * SIGTERM) returns the same promise instead of failing on an already-closed
   * server (issue #237).
   */
  close: () => Promise<void>;
  address: { host: string; port: number; path: string };
  /** The underlying Node server — for observability (applied timeouts) and tests. */
  server: Server;
  /** Current count of live stateful sessions (always 0 in stateless mode). */
  sessionCount: () => number;
  /** Manually trigger an idle sweep; returns the number of sessions reaped. */
  sweepIdleSessions: () => Promise<number>;
}

// Defaults: a half-hour idle window matches typical MCP gateway behaviour, and
// a 5-minute sweep keeps memory bounded without hammering the event loop.
const DEFAULT_SESSION_TTL_MS = 30 * 60_000;
const DEFAULT_SESSION_SWEEP_INTERVAL_MS = 5 * 60_000;
// Ceiling on concurrent stateful sessions. Each session holds a live
// McpServer + transport until its TTL sweep, so without a cap an authenticated
// client could spin up unbounded `initialize` requests and exhaust memory.
const DEFAULT_MAX_SESSIONS = 1000;
// Server socket timeouts (issue #237). Keep-alive above the usual load-balancer
// idle timeouts (60 s ALB, 75 s nginx) so the LB never reuses a connection Node
// has just closed; headers a second above keep-alive (Node's own requirement);
// request generous because reporting calls are long.
export const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 65_000;
export const DEFAULT_HEADERS_TIMEOUT_MS = 66_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
/** How often `close()` re-reaps idle keep-alive sockets while draining. */
const IDLE_REAP_INTERVAL_MS = 100;
// Token validation (issue #234): one BoondManager round-trip per token per
// minute is the cost of turning an expired token into a real 401.
export const DEFAULT_TOKEN_VALIDATION_TTL_MS = 60_000;
export const MAX_TOKEN_VALIDATION_ENTRIES = 500;

// Loopback addresses that should default to the localhost host allow-list.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const LOCALHOST_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function readAllowedHosts(): string[] | undefined {
  return readCsv("MCP_HTTP_ALLOWED_HOSTS");
}

function readAllowedOrigins(): string[] | undefined {
  return readCsv("MCP_HTTP_ALLOWED_ORIGINS");
}

/**
 * Resolves the effective Host header allow-list given user options and the
 * bound listen interface. Returns an empty array when validation is disabled
 * (either explicitly via `["*"]` or implicitly when bound to a non-loopback
 * interface without an explicit list).
 *
 * An empty `configured` array is treated as *unconfigured*, not as "disabled":
 * `MCP_HTTP_ALLOWED_HOSTS=` (or a value of only commas) must not quietly turn a
 * security control off. `["*"]` is the explicit opt-out.
 */
export function resolveAllowedHosts(configured: string[] | undefined, host: string): string[] {
  if (configured && configured.length > 0) {
    // `*` disables validation, but only when it is the *sole* entry — a bare
    // `*` mixed with real hostnames (`"mcp.example.com,*"`) is almost always a
    // mistake, so we keep validation on and warn rather than silently opening
    // up to every Host. (A glob like `*.example.com` stays a literal token and
    // is treated as a normal allow-list entry.)
    if (configured.includes("*")) {
      if (configured.length === 1) return [];
      logger.warn(
        { allowedHosts: configured },
        "MCP_HTTP_ALLOWED_HOSTS contains '*' alongside other hosts; ignoring '*' and keeping Host validation enabled. Set it to exactly '*' to disable validation."
      );
      return configured.filter((h) => h !== "*");
    }
    return configured;
  }
  if (LOOPBACK_HOSTS.has(host)) return LOCALHOST_ALLOWED_HOSTS;
  return [];
}

/**
 * Canonical form of an origin for comparison: lowercased (scheme and host are
 * case-insensitive) and without a trailing slash (some clients send
 * `http://localhost:3000/`, the spec form has no path).
 *
 * The trailing slashes are stripped with an index scan rather than a
 * `/\/+$/` replace: this runs on the caller-supplied `Origin` header, and an
 * anchored quantifier over a long run of `/` backtracks quadratically
 * (js/polynomial-redos). The scan below is linear whatever the input.
 */
function normalizeOrigin(value: string): string {
  const trimmed = value.trim();
  let end = trimmed.length;
  while (end > 0 && trimmed.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return trimmed.slice(0, end).toLowerCase();
}

/**
 * Whether a normalised origin is a browser page served from the local machine.
 *
 * Matching is on the *hostname literal*, not on resolution: `http://127.0.0.1.
 * nip.io` resolves to a loopback address but its hostname is not in the set, so
 * it is correctly rejected — that indirection is exactly the DNS rebinding
 * vector `Origin` validation exists to stop.
 */
const LOOPBACK_ORIGIN_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLoopbackOrigin(normalizedOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(normalizedOrigin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return LOOPBACK_ORIGIN_HOSTNAMES.has(url.hostname);
}

/** Resolved `Origin` validation policy — see `resolveOriginPolicy`. */
export interface OriginPolicy {
  /** `false` = validation disabled; every `Origin` is accepted. */
  enabled: boolean;
  /** Exact-match allow-list, normalised (see `normalizeOrigin`). */
  origins: string[];
  /**
   * Also accept any `http`/`https` origin whose hostname is a loopback literal,
   * **on any port**. Set only by the loopback default, never by an explicit
   * allow-list (an operator who enumerates origins gets exact matching).
   */
  allowAnyLoopback: boolean;
}

const VALIDATION_DISABLED: OriginPolicy = { enabled: false, origins: [], allowAnyLoopback: false };

/**
 * Resolves the effective `Origin` policy, mirroring `resolveAllowedHosts`: an
 * explicit list wins (exact match, port-sensitive), a sole `*` disables
 * validation, a `*` mixed with real origins is dropped with a warning
 * (validation stays on), and the default only applies when bound to a loopback
 * interface. An empty `configured` array counts as unconfigured, not disabled.
 *
 * The loopback default accepts **any loopback origin on any port**, plus the
 * origin of `publicUrl` when one is configured. Pinning the bound port instead
 * (the obvious reading of "origins are port-sensitive") would 403 every real
 * browser client: nothing is ever *served* from this port — it answers JSON-RPC
 * — so the origins that legitimately show up are other local ports (MCP
 * Inspector on `:6274`, a dev server on `:5173`) or the proxy's public URL.
 * The anti-DNS-rebinding property is untouched: a remote page still gets a 403,
 * and an attacker already running code on the loopback interface can simply
 * omit the header, which is always accepted.
 */
export function resolveOriginPolicy(configured: string[] | undefined, host: string, publicUrl?: string): OriginPolicy {
  if (configured && configured.length > 0) {
    if (configured.includes("*")) {
      if (configured.length === 1) return VALIDATION_DISABLED;
      logger.warn(
        { allowedOrigins: configured },
        "MCP_HTTP_ALLOWED_ORIGINS contains '*' alongside other origins; ignoring '*' and keeping Origin validation enabled. Set it to exactly '*' to disable validation."
      );
      return {
        enabled: true,
        origins: configured.filter((o) => o !== "*").map(normalizeOrigin),
        allowAnyLoopback: false,
      };
    }
    return { enabled: true, origins: configured.map(normalizeOrigin), allowAnyLoopback: false };
  }
  if (!LOOPBACK_HOSTS.has(host)) return VALIDATION_DISABLED;
  return { enabled: true, origins: originOf(publicUrl), allowAnyLoopback: true };
}

/**
 * The scheme+host+port of a configured public URL, as a 0- or 1-element list.
 * A server bound to loopback behind a reverse proxy is reached by the browser
 * under that URL, so its origin belongs in the default allow-list — otherwise
 * the documented proxy deployment 403s until the operator discovers
 * `MCP_HTTP_ALLOWED_ORIGINS`.
 */
function originOf(publicUrl: string | undefined): string[] {
  if (!publicUrl) return [];
  try {
    return [normalizeOrigin(new URL(publicUrl).origin)];
  } catch {
    return [];
  }
}

/** Applies a resolved policy to one `Origin` header value. */
export function isOriginAllowed(policy: OriginPolicy, origin: string): boolean {
  if (!policy.enabled) return true;
  const normalized = normalizeOrigin(origin);
  if (policy.origins.includes(normalized)) return true;
  return policy.allowAnyLoopback && isLoopbackOrigin(normalized);
}

/** RFC 9728 §3.2: bare metadata path, plus the resource-path-suffixed variant. */
const OAUTH_METADATA_PATH = "/.well-known/oauth-protected-resource";

/**
 * Whether a request targets the public protected-resource metadata document.
 * Shared by the `Origin` exemption and the handler itself so the two cannot
 * drift apart. Takes the raw `req.url` — it runs before the `URL` parse.
 */
export function isDiscoveryPath(reqUrl: string | undefined, mcpPath: string): boolean {
  const pathname = (reqUrl ?? "").split("?")[0];
  return pathname === OAUTH_METADATA_PATH || pathname === `${OAUTH_METADATA_PATH}${mcpPath}`;
}

/**
 * Extracts the hostname (without port) from a Host header. Returns
 * `undefined` if the header is missing or malformed.
 */
function extractHostname(hostHeader: string | string[] | undefined): string | undefined {
  if (!hostHeader) return undefined;
  const value = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (!value) return undefined;
  try {
    return new URL(`http://${value}`).hostname;
  } catch {
    return undefined;
  }
}

export function resolveHttpOptions(): HttpTransportOptions {
  const portRaw = readString("MCP_HTTP_PORT")?.trim();
  const port = portRaw ? Number.parseInt(portRaw, 10) : 3000;
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid MCP_HTTP_PORT: ${portRaw}`);
  }

  const stateless = !readBool("MCP_HTTP_STATEFUL", false);
  const enableJsonResponse = readBool("MCP_HTTP_JSON_RESPONSE", false);

  const staticAuth = readBool("BOOND_HTTP_STATIC_AUTH", false);
  const insecureStaticAuth = readBool("MCP_HTTP_INSECURE_STATIC_AUTH", false);
  // A blank key is "not configured", never an empty secret that every request matches.
  const apiKey = readString("MCP_HTTP_API_KEY")?.trim();

  return {
    host: readString("MCP_HTTP_HOST")?.trim() ?? "127.0.0.1",
    port,
    path: readString("MCP_HTTP_PATH")?.trim() ?? "/mcp",
    stateless,
    enableJsonResponse,
    sessionTtlMs: readPositiveInt("MCP_HTTP_SESSION_TTL_MS", DEFAULT_SESSION_TTL_MS),
    sessionSweepIntervalMs: readPositiveInt("MCP_HTTP_SESSION_SWEEP_INTERVAL_MS", DEFAULT_SESSION_SWEEP_INTERVAL_MS),
    maxSessions: readPositiveInt("MCP_HTTP_MAX_SESSIONS", DEFAULT_MAX_SESSIONS),
    allowedHosts: readAllowedHosts(),
    allowedOrigins: readAllowedOrigins(),
    publicUrl: readUrl("MCP_HTTP_PUBLIC_URL"),
    staticAuth,
    apiKey,
    insecureStaticAuth,
    keepAliveTimeoutMs: readPositiveInt("MCP_HTTP_KEEP_ALIVE_TIMEOUT_MS", DEFAULT_KEEP_ALIVE_TIMEOUT_MS),
    headersTimeoutMs: readPositiveInt("MCP_HTTP_HEADERS_TIMEOUT_MS", DEFAULT_HEADERS_TIMEOUT_MS),
    requestTimeoutMs: readPositiveInt("MCP_HTTP_REQUEST_TIMEOUT_MS", DEFAULT_REQUEST_TIMEOUT_MS),
    shutdownTimeoutMs: readPositiveInt("MCP_HTTP_SHUTDOWN_TIMEOUT_MS", DEFAULT_SHUTDOWN_TIMEOUT_MS),
    validateToken: readBool("MCP_HTTP_VALIDATE_TOKEN", false),
    tokenValidationTtlMs: readPositiveInt("MCP_HTTP_TOKEN_VALIDATION_TTL_MS", DEFAULT_TOKEN_VALIDATION_TTL_MS),
  };
}

/**
 * The socket timeouts applied to the Node server, with the one invariant Node
 * itself enforces made explicit: `headersTimeout` must be strictly greater
 * than `keepAliveTimeout`, otherwise a kept-alive connection can be timed out
 * while waiting for its next request's headers. A configuration that breaks it
 * is repaired (headers = keep-alive + 1 s) and logged rather than refused.
 */
export function resolveServerTimeouts(
  options: Pick<HttpTransportOptions, "keepAliveTimeoutMs" | "headersTimeoutMs" | "requestTimeoutMs">
): { keepAliveTimeout: number; headersTimeout: number; requestTimeout: number; coerced: boolean } {
  const keepAliveTimeout = options.keepAliveTimeoutMs ?? DEFAULT_KEEP_ALIVE_TIMEOUT_MS;
  const requestedHeaders = options.headersTimeoutMs ?? DEFAULT_HEADERS_TIMEOUT_MS;
  const coerced = requestedHeaders <= keepAliveTimeout;
  const headersTimeout = coerced ? keepAliveTimeout + 1_000 : requestedHeaders;
  const requestTimeout = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  return { keepAliveTimeout, headersTimeout, requestTimeout, coerced };
}

/**
 * Refuses a static-auth deployment that would expose the operator's
 * BoondManager credentials to anyone who can reach the port (issue #230).
 *
 * Static auth skips the Bearer check entirely, and off loopback the `Host` /
 * `Origin` validations are disabled too — the Docker image binds `0.0.0.0` by
 * default — so with no `apiKey` the endpoint is an anonymous proxy carrying
 * the operator's read *and* write rights. Loopback is exempt (only local
 * processes can connect), and `insecureStaticAuth` is the explicit,
 * named opt-out for a deployment whose network is the boundary. Throwing here
 * rather than warning is deliberate: a warning on stderr is exactly what an
 * operator running `docker run -e BOOND_HTTP_STATIC_AUTH=true` does not read.
 */
export function assertStaticAuthPolicy(options: HttpTransportOptions): void {
  if (!options.staticAuth || options.apiKey) return;
  if (LOOPBACK_HOSTS.has(options.host)) return;
  if (options.insecureStaticAuth) return;
  throw new Error(
    `BOOND_HTTP_STATIC_AUTH=true on a non-loopback interface (${options.host}) requires MCP_HTTP_API_KEY: ` +
      "without it, anyone who can reach the port acts with the operator's BoondManager credentials. " +
      "Set MCP_HTTP_API_KEY=<secret> (clients send `Authorization: Bearer <secret>` or `X-Api-Key: <secret>`), " +
      "bind to 127.0.0.1 behind an authenticating proxy, or set MCP_HTTP_INSECURE_STATIC_AUTH=1 to accept the exposure explicitly."
  );
}

/**
 * Constant-time comparison of a presented API key against the configured one.
 *
 * `timingSafeEqual` throws on buffers of different lengths, so a length
 * mismatch is answered by comparing the expected key against itself first —
 * the call still costs one full comparison — and then returning `false`. The
 * key's *length* is therefore observable, which is acceptable: it is not
 * secret for a random key (the README generates 32 random bytes), and the
 * alternative — hashing both sides to equalise lengths — reads to static
 * analysers as a password stored under a fast hash, which it is not.
 */
export function isApiKeyMatch(presented: string | null | undefined, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** The key a request presents: `Authorization: Bearer <key>` first, then `X-Api-Key`. */
function presentedApiKey(req: IncomingMessage): string | null {
  const bearer = extractBearerToken(req.headers["authorization"]);
  if (bearer) return bearer;
  const raw = req.headers["x-api-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Build the canonical "resource" URL advertised in the OAuth2 protected
 * resource metadata and in the `WWW-Authenticate` challenge. Behind a
 * reverse proxy, the operator must set `MCP_HTTP_PUBLIC_URL` so clients
 * receive the externally-reachable URL, not the loopback default.
 */
function resolveResourceUrl(options: HttpTransportOptions): string {
  if (options.publicUrl) return options.publicUrl.replace(/\/$/, "") || options.publicUrl;
  return `http://${options.host}:${options.port}${options.path}`;
}

/** Max accepted request body size (1 MiB). MCP initialize payloads are tiny;
 *  this caps the memory a single authenticated request can force us to buffer. */
export const MAX_BODY_BYTES = 1024 * 1024;

class PayloadTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the maximum allowed size");
    this.name = "PayloadTooLargeError";
  }
}

/** Outcome of `readJsonBody`: the SDK must never be left to re-read a stream we drained. */
type ReadBody = { kind: "json"; value: unknown } | { kind: "invalid" };

/**
 * Buffer a request body under `MAX_BODY_BYTES`, then parse it as JSON.
 *
 * This is the **only** body reader on the MCP endpoint (issue #227). Every
 * POST — stateless, existing stateful session, or `initialize` — goes through
 * it and the parsed value is handed to `transport.handleRequest(req, res,
 * parsedBody)`, so the SDK (which reads without a ceiling) never touches the
 * stream. The `Content-Length` precheck upstream only covers clients that
 * announce their size; a chunked transfer (no `Content-Length`, which is also
 * what a reverse proxy that re-encodes produces) is caught here, by counting
 * bytes as they arrive.
 *
 * On overflow the loop stops without `req.destroy()`: destroying the socket
 * would tear down the response along with the request, and the client would
 * see a reset instead of the `413` (the caller answers with `Connection:
 * close`, and Node closes the socket once that response is flushed).
 *
 * An unparseable body is reported as `invalid` rather than `undefined`: a
 * `parsedBody` of `undefined` makes the SDK fall back to `req.json()` on a
 * stream that has already been consumed.
 */
async function readJsonBody(req: IncomingMessage): Promise<ReadBody> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return { kind: "json", value: JSON.parse(raw) as unknown };
  } catch {
    return { kind: "invalid" };
  }
}

/** JSON-RPC 2.0 reserved code for a body that is not parseable JSON. */
const JSON_RPC_PARSE_ERROR = -32700;

function writeJsonRpcError(res: ServerResponse, status: number, message: string, code = -32000): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code, message },
      id: null,
    })
  );
}

/**
 * `413` for a body that blew through `MAX_BODY_BYTES` mid-stream. The request
 * stream is left unread past the overflow point, so the response must not be
 * reused on a keep-alive connection: `Connection: close` makes Node destroy
 * the socket right after this response is flushed, instead of draining (and
 * therefore fully receiving) whatever the client still has to send.
 */
function writePayloadTooLarge(res: ServerResponse): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.setHeader("Connection", "close");
  writeJsonRpcError(res, 413, "Request body too large");
}

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastActivityAt: number;
  /**
   * `currentAuthIdentity()` of the `initialize` request that opened the
   * session (issue #232). A later request naming this session with another
   * identity is answered exactly like an unknown session — `404 Session not
   * found` — so a leaked `Mcp-Session-Id` (log, proxy) plus any Bearer cannot
   * attach to someone else's GET stream, read their notifications, or answer
   * their delete elicitations. In static-auth mode every caller shares the
   * `env` identity and this collapses to the previous behaviour.
   */
  ownerIdentity: string;
  /** Memoised teardown — set on first destroy so concurrent callers share it. */
  closing?: Promise<void>;
}

/**
 * Tear down a session's transport + server exactly once. Several paths can race
 * to dispose the same entry (idle sweep, the transport's own `onclose`, the
 * SDK's `onsessionclosed`, and server shutdown); memoising the teardown promise
 * on the entry makes `transport.close()` / `server.close()` fire at most once
 * and lets every caller await the same completion. Errors are swallowed because
 * the caller has already lost interest in the session.
 */
function destroySession(entry: SessionEntry): Promise<void> {
  if (entry.closing) return entry.closing;
  entry.closing = Promise.allSettled([
    Promise.resolve().then(() => entry.transport.close()),
    Promise.resolve().then(() => entry.server.close()),
  ]).then(() => undefined);
  return entry.closing;
}

export async function startHttpTransport(
  createServerFactory: () => McpServer,
  options: HttpTransportOptions
): Promise<HttpServerHandle> {
  assertStaticAuthPolicy(options);
  if (options.staticAuth) {
    logger.warn(
      {
        host: options.host,
        apiKey: options.apiKey ? "configured" : "none",
        insecureStaticAuth: options.insecureStaticAuth === true,
      },
      "Static auth mode: every MCP request runs with the operator's BoondManager credentials" +
        (options.apiKey
          ? "; clients must present MCP_HTTP_API_KEY"
          : LOOPBACK_HOSTS.has(options.host)
            ? "; no client authentication (loopback bind only)"
            : "; NO CLIENT AUTHENTICATION on a non-loopback bind (MCP_HTTP_INSECURE_STATIC_AUTH)")
    );
  } else if (options.apiKey) {
    logger.warn(
      "MCP_HTTP_API_KEY is set but BOOND_HTTP_STATIC_AUTH is not: ignored. In OAuth mode the Bearer is the BoondManager access token."
    );
  }

  const sessions = new Map<string, SessionEntry>();
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const sessionSweepIntervalMs = options.sessionSweepIntervalMs ?? DEFAULT_SESSION_SWEEP_INTERVAL_MS;
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const allowedHosts = resolveAllowedHosts(options.allowedHosts, options.host);
  const originPolicy = resolveOriginPolicy(options.allowedOrigins, options.host, options.publicUrl);
  const resourceUrl = resolveResourceUrl(options);
  const authorizationServer = resolveAuthorizationServer();
  const advertisedScopes = resolveAdvertisedScopes();
  // Per RFC 9728 §3.2 the metadata URL is `/.well-known/oauth-protected-resource`
  // optionally suffixed with the resource path so multiple resources can
  // coexist on one host. We serve both for compatibility. Strip the path as a
  // *suffix* (not an arbitrary substring) so a hostname that happens to embed
  // the path string isn't mangled.
  const resourceOrigin = resourceUrl.endsWith(options.path)
    ? resourceUrl.slice(0, resourceUrl.length - options.path.length)
    : resourceUrl;
  const metadataUrl = `${resourceOrigin}${OAUTH_METADATA_PATH}${options.path}`;
  const wwwAuthenticate = `Bearer realm="${resourceUrl}", resource_metadata="${metadataUrl}"`;

  // Bearer validation cache (issue #234): sha256(token) → verdict + expiry,
  // LRU-bounded like the other per-identity maps. The token itself is never
  // stored. A negative verdict is cached too, so a client retrying with a
  // dead token does not turn into a BoondManager call per retry.
  const tokenValidationTtlMs = options.tokenValidationTtlMs ?? DEFAULT_TOKEN_VALIDATION_TTL_MS;
  const tokenVerdicts = new Map<string, { valid: boolean; expiresAt: number }>();
  const validateAccessToken = async (accessToken: string): Promise<"valid" | "invalid" | "unknown"> => {
    const key = createHash("sha256").update(accessToken).digest("hex");
    const now = Date.now();
    const cached = tokenVerdicts.get(key);
    if (cached && cached.expiresAt > now) {
      // Refresh LRU position.
      tokenVerdicts.delete(key);
      tokenVerdicts.set(key, cached);
      return cached.valid ? "valid" : "invalid";
    }
    let verdict: "valid" | "invalid" | "unknown";
    try {
      await oauthContext.run({ accessToken }, () => apiRequest("/application/current-user"));
      verdict = "valid";
    } catch (error) {
      if (error instanceof BoondApiError && error.status === 401) {
        verdict = "invalid";
      } else {
        // BoondManager down, rate-limited, network error: not a verdict on
        // the token. Fail open — the tool call will surface the real error —
        // and cache nothing.
        logger.warn({ err: error }, "Token validation could not reach BoondManager; letting the request through");
        verdict = "unknown";
      }
    }
    if (verdict !== "unknown") {
      tokenVerdicts.set(key, { valid: verdict === "valid", expiresAt: now + tokenValidationTtlMs });
      while (tokenVerdicts.size > MAX_TOKEN_VALIDATION_ENTRIES) {
        const oldest = tokenVerdicts.keys().next().value;
        if (oldest === undefined) break;
        tokenVerdicts.delete(oldest);
      }
    }
    return verdict;
  };

  const sweepIdleSessions = async (): Promise<number> => {
    const cutoff = Date.now() - sessionTtlMs;
    const expired: Array<[string, SessionEntry]> = [];
    for (const [id, entry] of sessions) {
      if (entry.lastActivityAt < cutoff) {
        expired.push([id, entry]);
      }
    }
    for (const [id] of expired) sessions.delete(id);
    await Promise.all(expired.map(([, entry]) => destroySession(entry)));
    return expired.length;
  };

  // Periodic sweep — only meaningful in stateful mode. `unref()` lets the
  // process exit naturally even when the timer is pending.
  let sweepTimer: NodeJS.Timeout | undefined;
  if (!options.stateless) {
    sweepTimer = setInterval(() => {
      void sweepIdleSessions();
    }, sessionSweepIntervalMs);
    sweepTimer.unref?.();
  }

  /** Write the RFC 9728 protected-resource metadata document. */
  const writeProtectedResourceMetadata = (res: ServerResponse): void => {
    const doc = buildProtectedResourceMetadata({
      resource: resourceUrl,
      authorizationServers: [authorizationServer],
      scopesSupported: advertisedScopes,
    });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.end(JSON.stringify(doc));
  };

  /**
   * RFC 6750 §3.1 challenge. `error` is omitted when no token was presented
   * (the RFC says a bare challenge is the right answer there) and set to
   * `invalid_token` when one was and BoondManager rejected it — that value is
   * what an MCP client keys its "start a new authorization" logic on.
   */
  const writeOAuthChallenge = (res: ServerResponse, status: number, message: string, error?: string): void => {
    res.statusCode = status;
    res.setHeader(
      "WWW-Authenticate",
      error
        ? `${wwwAuthenticate}, error="${error}", error_description="${message.replace(/"/g, "'")}"`
        : wwwAuthenticate
    );
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32001, message },
        id: null,
      })
    );
  };

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const corrId = generateCorrelationId();
    // Path only: the query string of a request is never logged (#236).
    const path = req.url?.split("?")[0];
    const reqLogger = logger.child({ corrId, method: req.method, path });
    const startedAt = Date.now();
    let rejection: string | undefined;

    // Access log (#236): one line per request when the response is finished,
    // or when the client went away before that. 401 / 403 / 413 (and the
    // other rejections this handler writes itself) are `warn` with their
    // reason; 5xx is `error`; the liveness probe stays at `debug` so a
    // 10-second Kubernetes probe does not fill the log.
    let accessLogged = false;
    const writeAccessLog = (): void => {
      if (accessLogged) return;
      accessLogged = true;
      const status = res.statusCode;
      const fields = {
        status,
        durationMs: Date.now() - startedAt,
        ...(rejection !== undefined ? { reason: rejection } : {}),
        ...(res.writableFinished ? {} : { aborted: true }),
      };
      if (path === "/healthz") reqLogger.debug(fields, "http request");
      else if (status >= 500) reqLogger.error(fields, "http request");
      else if (rejection !== undefined || status === 401 || status === 403 || status === 413) {
        reqLogger.warn(fields, "http request");
      } else reqLogger.info(fields, "http request");
    };
    res.on("finish", writeAccessLog);
    res.on("close", writeAccessLog);

    const reject = (status: number, message: string, code?: number): void => {
      rejection = message;
      writeJsonRpcError(res, status, message, code);
    };
    const challenge = (status: number, message: string, error?: string): void => {
      rejection = message;
      writeOAuthChallenge(res, status, message, error);
    };

    try {
      // Liveness probe — served before Host validation so Docker/Kubernetes
      // probes (which often send the pod IP as Host) always succeed. GET only,
      // no auth: it exposes nothing beyond the server version.
      if (req.method === "GET" && req.url?.split("?")[0] === "/healthz") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            status: "ok",
            version: SERVER_VERSION,
            mode: options.stateless ? "stateless" : "stateful",
            sessions: sessions.size,
          })
        );
        return;
      }

      // DNS rebinding protection: validate the Host header against the
      // configured allow-list before doing anything else. See CVE-2025-66414.
      if (allowedHosts.length > 0) {
        const hostname = extractHostname(req.headers.host);
        if (!hostname) {
          reject(403, "Missing or invalid Host header");
          return;
        }
        if (!allowedHosts.includes(hostname)) {
          reject(403, `Invalid Host: ${hostname}`);
          return;
        }
      }

      // Origin validation (MCP 2025-11-25): a browser-initiated request coming
      // from an unexpected origin must be rejected with 403. A *missing* Origin
      // is allowed — non-browser clients (curl, gateways, MCP CLI clients)
      // never send one, and the Host check above already covers DNS rebinding.
      // Like the Host check, this runs after /healthz so probes stay unaffected,
      // and it skips the RFC 9728 discovery document: that document is public,
      // credential-free and read-only, and a browser client only fetches it
      // *because* we pointed it there from a 401 challenge — 403ing it would
      // dead-end the OAuth bootstrap the challenge just started.
      if (originPolicy.enabled && !isDiscoveryPath(req.url, options.path)) {
        const originHeader = req.headers.origin;
        const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
        if (origin && !isOriginAllowed(originPolicy, origin)) {
          reject(403, `Invalid Origin: ${origin}`);
          return;
        }
      }

      // Reject oversized payloads up front when the client advertises the
      // length, before buffering anything. The streaming guard in
      // readJsonBody still covers chunked / lying Content-Length cases.
      const contentLength = Number(req.headers["content-length"]);
      if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
        // Plain 413, deliberately *without* `Connection: close`: Node drains
        // the announced body itself (`req._dump()`), so the connection is
        // reusable — and closing it early makes a client still uploading see
        // a reset instead of the 413 (undici's fetch rejects). The mid-stream
        // overflow below is different: its stream is left unread.
        reject(413, "Request body too large");
        return;
      }

      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      // Public OAuth2 discovery endpoint (RFC 9728). Not served in static-auth
      // mode — exposing it would cause OAuth-aware clients (mcp-remote, etc.)
      // to attempt a full OAuth dance that will never complete.
      if (!options.staticAuth && req.method === "GET" && isDiscoveryPath(url.pathname, options.path)) {
        writeProtectedResourceMetadata(res);
        return;
      }

      if (url.pathname !== options.path) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      // Core MCP dispatch — shared between OAuth and static-auth paths.
      const dispatchMcpRequest = async (): Promise<void> => {
        if (options.stateless && req.method !== "POST") {
          reject(405, "Only POST is supported in stateless mode");
          return;
        }

        // The body is read *here*, once, under the 1 MiB streaming cap, and
        // handed to the SDK pre-parsed on every path below — the SDK's own
        // reader has no ceiling, so letting it read on any path would leave
        // that path uncapped (#227). GET (SSE stream) and DELETE carry no body
        // and the SDK never reads one for them.
        let parsedBody: unknown;
        if (req.method === "POST") {
          const read = await readJsonBody(req);
          if (read.kind === "invalid") {
            reject(400, "Parse error: Invalid JSON", JSON_RPC_PARSE_ERROR);
            return;
          }
          parsedBody = read.value;
        }

        if (options.stateless) {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: options.enableJsonResponse,
          });
          const server = createServerFactory();
          res.on("close", () => {
            void transport.close();
            void server.close();
          });
          await server.connect(transport);
          await transport.handleRequest(req, res, parsedBody);
          return;
        }

        // Stateful mode: route by Mcp-Session-Id header
        const sessionIdHeader = req.headers["mcp-session-id"];
        const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
        const identity = currentAuthIdentity();

        if (sessionId) {
          const entry = sessions.get(sessionId);
          if (entry && entry.ownerIdentity === identity) {
            entry.lastActivityAt = Date.now();
            await entry.transport.handleRequest(req, res, parsedBody);
            return;
          }
          // Unknown session, or a session opened under another identity: one
          // answer for both, so the probe does not learn whether the id exists
          // (#232). A POST `initialize` carrying a stale id still opens a new
          // session below, as it always did.
          if (!(req.method === "POST" && isInitializeRequest(parsedBody))) {
            if (entry) {
              reqLogger.warn({ sessionId }, "Session ownership mismatch; answering as unknown session");
            }
            reject(404, "Session not found", -32001);
            return;
          }
        }

        if (req.method !== "POST") {
          reject(400, "Missing or invalid session ID");
          return;
        }

        // First request of a session must be `initialize`
        const body = parsedBody;
        if (!isInitializeRequest(body)) {
          reject(400, "First request must be an MCP initialize message");
          return;
        }

        // Cap concurrent sessions. Try a sweep first in case the ceiling is
        // hit purely by idle-but-not-yet-reaped sessions, then reject.
        if (sessions.size >= maxSessions) {
          await sweepIdleSessions();
          if (sessions.size >= maxSessions) {
            reqLogger.warn(
              { sessionCount: sessions.size, maxSessions },
              "Session limit reached; rejecting new initialize"
            );
            reject(503, "Server session limit reached; retry later");
            return;
          }
        }

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: options.enableJsonResponse,
          onsessioninitialized: (id) => {
            sessions.set(id, { transport, server, lastActivityAt: Date.now(), ownerIdentity: identity });
            reqLogger.info({ sessionId: id, sessionCount: sessions.size }, "MCP session initialized");
          },
          onsessionclosed: (id) => {
            const entry = sessions.get(id);
            if (entry) {
              sessions.delete(id);
              void destroySession(entry);
              reqLogger.info({ sessionId: id, sessionCount: sessions.size }, "MCP session closed");
            }
          },
        });
        transport.onclose = () => {
          const id = transport.sessionId;
          if (!id) return;
          const entry = sessions.get(id);
          if (entry) {
            sessions.delete(id);
            // Idempotent: if the sweep / onsessionclosed already started the
            // teardown, this shares the same memoised promise rather than
            // re-closing.
            void destroySession(entry);
          }
        };

        const server = createServerFactory();
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
      };

      if (options.staticAuth) {
        // Static-auth mode: env-based JWT credentials configured at startup via
        // initClient(). The MCP client authenticates with the shared API key
        // when one is configured (#230) — never with a BoondManager token.
        if (options.apiKey && !isApiKeyMatch(presentedApiKey(req), options.apiKey)) {
          res.setHeader("WWW-Authenticate", `Bearer realm="${resourceUrl}"`);
          reject(
            401,
            "Missing or invalid API key. Send `Authorization: Bearer <MCP_HTTP_API_KEY>` or `X-Api-Key: <MCP_HTTP_API_KEY>`.",
            -32001
          );
          return;
        }
        await runWithRequestContext({ corrId }, dispatchMcpRequest);
      } else {
        // OAuth2 Bearer is mandatory on the MCP endpoint. The token is opaque
        // to us — we forward it to BoondManager, which is authoritative.
        const accessToken = extractBearerToken(req.headers["authorization"]);
        if (!accessToken) {
          challenge(
            401,
            "Missing Bearer token. Authenticate against BoondManager and include `Authorization: Bearer <access_token>`."
          );
          return;
        }
        if (options.validateToken && (await validateAccessToken(accessToken)) === "invalid") {
          reqLogger.info("Bearer rejected by BoondManager; answering 401 invalid_token");
          challenge(
            401,
            "BoondManager rejected the access token (expired or revoked). Re-authorize and retry.",
            "invalid_token"
          );
          return;
        }
        // Wrap in AsyncLocalStorage so boond-client's oauthContextAuth can pull
        // the token out when issuing API calls.
        await oauthContext.run({ accessToken }, () => runWithRequestContext({ corrId }, dispatchMcpRequest));
      }
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        writePayloadTooLarge(res);
        return;
      }
      reqLogger.error({ err: error }, "HTTP transport error");
      if (!res.headersSent) {
        writeJsonRpcError(res, 500, "Internal server error");
      } else {
        res.end();
      }
    }
  };

  // `createServer` takes a sync listener: an async callback's rejection would
  // be an unhandled promise, invisible to the client (issue #237). The handler
  // catches everything it can above; this is the last net.
  const httpServer = createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      logger.error({ err: error }, "Unhandled HTTP transport error");
      if (!res.headersSent) {
        writeJsonRpcError(res, 500, "Internal server error");
      } else {
        res.end();
      }
    });
  });

  const timeouts = resolveServerTimeouts(options);
  if (timeouts.coerced) {
    logger.warn(
      { requested: options.headersTimeoutMs, applied: timeouts.headersTimeout, keepAlive: timeouts.keepAliveTimeout },
      "MCP_HTTP_HEADERS_TIMEOUT_MS must exceed the keep-alive timeout; raised to keep-alive + 1 s"
    );
  }
  httpServer.keepAliveTimeout = timeouts.keepAliveTimeout;
  httpServer.headersTimeout = timeouts.headersTimeout;
  httpServer.requestTimeout = timeouts.requestTimeout;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port, options.host, () => {
      httpServer.removeListener("error", reject);
      resolve();
    });
  });

  // Report the port the OS actually bound. When options.port is 0 (ephemeral),
  // the kernel picks a free port and only server.address() knows which one.
  const bound = httpServer.address();
  const boundPort = bound && typeof bound === "object" ? bound.port : options.port;

  // Memoised so a second close() — a second SIGTERM, or a caller's cleanup
  // racing the signal handler — waits on the same shutdown instead of calling
  // `server.close()` on a closed server (ERR_SERVER_NOT_RUNNING, unhandled).
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      if (sweepTimer) clearInterval(sweepTimer);
      const entries = Array.from(sessions.values());
      sessions.clear();
      await Promise.all(entries.map((e) => destroySession(e)));
      await new Promise<void>((resolve, reject) => {
        // `server.close()` stops accepting, reaps idle keep-alive sockets once
        // (Node's `httpServerPreClose` → `closeIdleConnections()`), and
        // resolves when every remaining connection has ended. Two things
        // never end on their own: an open SSE stream / a request stuck
        // mid-headers (destroyed after the grace period), and a keep-alive
        // socket that was still draining a body at that single reap — Node
        // never re-checks it, and with a 65 s keep-alive it would hold the
        // close for the whole grace period. So idle reaping is repeated until
        // the server is closed.
        const force = setTimeout(() => {
          logger.warn({ shutdownTimeoutMs }, "Shutdown grace period elapsed; destroying remaining connections");
          httpServer.closeAllConnections();
        }, shutdownTimeoutMs);
        force.unref();
        const reapIdle = setInterval(() => httpServer.closeIdleConnections(), IDLE_REAP_INTERVAL_MS);
        reapIdle.unref();
        httpServer.close((err) => {
          clearTimeout(force);
          clearInterval(reapIdle);
          if (err) reject(err);
          else resolve();
        });
      });
    })();
    return closing;
  };

  return {
    address: { host: options.host, port: boundPort, path: options.path },
    server: httpServer,
    sessionCount: () => sessions.size,
    sweepIdleSessions,
    close,
  };
}
