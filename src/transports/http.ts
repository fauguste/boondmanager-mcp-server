import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger, generateCorrelationId } from "../services/logger.js";

export interface HttpTransportOptions {
  host: string;
  port: number;
  path: string;
  stateless: boolean;
  bearerToken?: string;
  enableJsonResponse: boolean;
  /** Idle timeout for stateful sessions, in ms. Defaults to 30 min. */
  sessionTtlMs?: number;
  /** How often to sweep idle sessions, in ms. Defaults to 5 min. */
  sessionSweepIntervalMs?: number;
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

export function resolveHttpOptions(): HttpTransportOptions {
  const portRaw = readEnv("MCP_HTTP_PORT");
  const port = portRaw ? Number.parseInt(portRaw, 10) : 3000;
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid MCP_HTTP_PORT: ${portRaw}`);
  }

  const stateless = (readEnv("MCP_HTTP_STATEFUL") ?? "false").toLowerCase() !== "true";
  const enableJsonResponse = (readEnv("MCP_HTTP_JSON_RESPONSE") ?? "false").toLowerCase() === "true";

  return {
    host: readEnv("MCP_HTTP_HOST") ?? "127.0.0.1",
    port,
    path: readEnv("MCP_HTTP_PATH") ?? "/mcp",
    stateless,
    bearerToken: readEnv("MCP_HTTP_BEARER_TOKEN"),
    enableJsonResponse,
    sessionTtlMs: readPositiveInt("MCP_HTTP_SESSION_TTL_MS", DEFAULT_SESSION_TTL_MS),
    sessionSweepIntervalMs: readPositiveInt(
      "MCP_HTTP_SESSION_SWEEP_INTERVAL_MS",
      DEFAULT_SESSION_SWEEP_INTERVAL_MS
    ),
  };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
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
}

async function destroySession(entry: SessionEntry): Promise<void> {
  // Close transport and server independently so a failure in one still lets
  // the other release its resources. We swallow errors because the caller
  // already lost interest in this session.
  await Promise.allSettled([
    Promise.resolve().then(() => entry.transport.close()),
    Promise.resolve().then(() => entry.server.close()),
  ]);
}

export async function startHttpTransport(
  createServerFactory: () => McpServer,
  options: HttpTransportOptions
): Promise<HttpServerHandle> {
  const sessions = new Map<string, SessionEntry>();
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const sessionSweepIntervalMs =
    options.sessionSweepIntervalMs ?? DEFAULT_SESSION_SWEEP_INTERVAL_MS;

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

  const httpServer = createServer(async (req, res) => {
    const corrId = generateCorrelationId();
    const reqLogger = logger.child({ corrId, method: req.method, path: req.url });

    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (url.pathname !== options.path) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      if (options.bearerToken) {
        const auth = req.headers["authorization"];
        if (auth !== `Bearer ${options.bearerToken}`) {
          res.statusCode = 401;
          res.setHeader("WWW-Authenticate", "Bearer");
          res.end("Unauthorized");
          return;
        }
      }

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
          // Server is closed by destroySession — but if the transport's own
          // close path already disposed it, the second call is a no-op.
          void entry.server.close().catch(() => undefined);
        }
      };

      const server = createServerFactory();
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
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
