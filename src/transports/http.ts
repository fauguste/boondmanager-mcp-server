import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger, generateCorrelationId } from "../services/logger.js";
import { SERVER_VERSION } from "../server.js";
import {
  buildProtectedResourceMetadata,
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
   * protection. Empty array = validation disabled. Use `["*"]` to opt out
   * explicitly. When undefined, a localhost default is applied if bound
   * to a loopback interface.
   */
  allowedHosts?: string[];
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
   */
  staticAuth?: boolean;
}

export interface HttpServerHandle {
  close: () => Promise<void>;
  address: { host: string; port: number; path: string };
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

// Loopback addresses that should default to the localhost host allow-list.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const LOCALHOST_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function readEnv(key: string): string | undefined {
  const v = process.env[key];
  if (!v || v.startsWith("${")) return undefined;
  return v;
}

function readPositiveInt(key: string, fallback: number): number {
  const raw = readEnv(key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function readAllowedHosts(): string[] | undefined {
  const raw = readEnv("MCP_HTTP_ALLOWED_HOSTS");
  if (raw === undefined) return undefined;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts;
}

/**
 * Resolves the effective Host header allow-list given user options and the
 * bound listen interface. Returns an empty array when validation is disabled
 * (either explicitly via `["*"]` or implicitly when bound to a non-loopback
 * interface without an explicit list).
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
  const portRaw = readEnv("MCP_HTTP_PORT");
  const port = portRaw ? Number.parseInt(portRaw, 10) : 3000;
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid MCP_HTTP_PORT: ${portRaw}`);
  }

  const stateless = (readEnv("MCP_HTTP_STATEFUL") ?? "false").toLowerCase() !== "true";
  const enableJsonResponse = (readEnv("MCP_HTTP_JSON_RESPONSE") ?? "false").toLowerCase() === "true";

  const staticAuthRaw = (readEnv("BOOND_HTTP_STATIC_AUTH") ?? "").toLowerCase();
  const staticAuth = staticAuthRaw === "true" || staticAuthRaw === "1" || staticAuthRaw === "yes";

  return {
    host: readEnv("MCP_HTTP_HOST") ?? "127.0.0.1",
    port,
    path: readEnv("MCP_HTTP_PATH") ?? "/mcp",
    stateless,
    enableJsonResponse,
    sessionTtlMs: readPositiveInt("MCP_HTTP_SESSION_TTL_MS", DEFAULT_SESSION_TTL_MS),
    sessionSweepIntervalMs: readPositiveInt("MCP_HTTP_SESSION_SWEEP_INTERVAL_MS", DEFAULT_SESSION_SWEEP_INTERVAL_MS),
    maxSessions: readPositiveInt("MCP_HTTP_MAX_SESSIONS", DEFAULT_MAX_SESSIONS),
    allowedHosts: readAllowedHosts(),
    publicUrl: readEnv("MCP_HTTP_PUBLIC_URL"),
    staticAuth,
  };
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
const MAX_BODY_BYTES = 1024 * 1024;

class PayloadTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the maximum allowed size");
    this.name = "PayloadTooLargeError";
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      req.destroy();
      throw new PayloadTooLargeError();
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function writeJsonRpcError(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message },
      id: null,
    })
  );
}

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastActivityAt: number;
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
  const sessions = new Map<string, SessionEntry>();
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const sessionSweepIntervalMs = options.sessionSweepIntervalMs ?? DEFAULT_SESSION_SWEEP_INTERVAL_MS;
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const allowedHosts = resolveAllowedHosts(options.allowedHosts, options.host);
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
  const metadataUrl = `${resourceOrigin}/.well-known/oauth-protected-resource${options.path}`;
  const wwwAuthenticate = `Bearer realm="${resourceUrl}", resource_metadata="${metadataUrl}"`;

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

  /** RFC 6750 §3.1 challenge for missing/invalid bearer tokens. */
  const writeOAuthChallenge = (res: ServerResponse, status: number, message: string): void => {
    res.statusCode = status;
    res.setHeader("WWW-Authenticate", wwwAuthenticate);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32001, message },
        id: null,
      })
    );
  };

  const httpServer = createServer(async (req, res) => {
    const corrId = generateCorrelationId();
    const reqLogger = logger.child({ corrId, method: req.method, path: req.url });

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
          writeJsonRpcError(res, 403, "Missing or invalid Host header");
          return;
        }
        if (!allowedHosts.includes(hostname)) {
          writeJsonRpcError(res, 403, `Invalid Host: ${hostname}`);
          return;
        }
      }

      // Reject oversized payloads up front when the client advertises the
      // length, before buffering anything. The streaming guard in
      // readJsonBody still covers chunked / lying Content-Length cases.
      const contentLength = Number(req.headers["content-length"]);
      if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
        writeJsonRpcError(res, 413, "Request body too large");
        return;
      }

      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      // Public OAuth2 discovery endpoint (RFC 9728). Not served in static-auth
      // mode — exposing it would cause OAuth-aware clients (mcp-remote, etc.)
      // to attempt a full OAuth dance that will never complete.
      if (
        !options.staticAuth &&
        req.method === "GET" &&
        (url.pathname === "/.well-known/oauth-protected-resource" ||
          url.pathname === `/.well-known/oauth-protected-resource${options.path}`)
      ) {
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
        if (options.stateless) {
          if (req.method !== "POST") {
            writeJsonRpcError(res, 405, "Only POST is supported in stateless mode");
            return;
          }
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
          await transport.handleRequest(req, res);
          return;
        }

        // Stateful mode: route by Mcp-Session-Id header
        const sessionIdHeader = req.headers["mcp-session-id"];
        const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

        if (sessionId && sessions.has(sessionId)) {
          const entry = sessions.get(sessionId)!;
          entry.lastActivityAt = Date.now();
          await entry.transport.handleRequest(req, res);
          return;
        }

        if (req.method !== "POST") {
          writeJsonRpcError(res, 400, "Missing or invalid session ID");
          return;
        }

        // Parse body to detect initialization
        const body = await readJsonBody(req);
        if (!isInitializeRequest(body)) {
          writeJsonRpcError(res, 400, "First request must be an MCP initialize message");
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
            writeJsonRpcError(res, 503, "Server session limit reached; retry later");
            return;
          }
        }

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: options.enableJsonResponse,
          onsessioninitialized: (id) => {
            sessions.set(id, { transport, server, lastActivityAt: Date.now() });
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
        // initClient(). No Bearer token required from the MCP client.
        await dispatchMcpRequest();
      } else {
        // OAuth2 Bearer is mandatory on the MCP endpoint. The token is opaque
        // to us — we forward it to BoondManager, which is authoritative.
        const accessToken = extractBearerToken(req.headers["authorization"]);
        if (!accessToken) {
          writeOAuthChallenge(
            res,
            401,
            "Missing Bearer token. Authenticate against BoondManager and include `Authorization: Bearer <access_token>`."
          );
          return;
        }
        // Wrap in AsyncLocalStorage so boond-client's oauthContextAuth can pull
        // the token out when issuing API calls.
        await oauthContext.run({ accessToken }, dispatchMcpRequest);
      }
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        if (!res.headersSent) {
          writeJsonRpcError(res, 413, "Request body too large");
        } else {
          res.end();
        }
        return;
      }
      reqLogger.error({ err: error }, "HTTP transport error");
      if (!res.headersSent) {
        writeJsonRpcError(res, 500, "Internal server error");
      } else {
        res.end();
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port, options.host, () => {
      httpServer.removeListener("error", reject);
      resolve();
    });
  });

  return {
    address: { host: options.host, port: options.port, path: options.path },
    sessionCount: () => sessions.size,
    sweepIdleSessions,
    close: async () => {
      if (sweepTimer) clearInterval(sweepTimer);
      const entries = Array.from(sessions.values());
      sessions.clear();
      await Promise.all(entries.map((e) => destroySession(e)));
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
