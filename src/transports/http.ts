import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface HttpTransportOptions {
  host: string;
  port: number;
  path: string;
  stateless: boolean;
  bearerToken?: string;
  enableJsonResponse: boolean;
}

export interface HttpServerHandle {
  close: () => Promise<void>;
  address: { host: string; port: number; path: string };
}

function readEnv(key: string): string | undefined {
  const v = process.env[key];
  if (!v || v.startsWith("${")) return undefined;
  return v;
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

export async function startHttpTransport(
  createServerFactory: () => McpServer,
  options: HttpTransportOptions
): Promise<HttpServerHandle> {
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req, res) => {
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
        await sessions.get(sessionId)!.handleRequest(req, res);
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
          sessions.set(id, transport);
        },
        onsessionclosed: (id) => {
          sessions.delete(id);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };

      const server = createServerFactory();
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      console.error("HTTP transport error:", error);
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
    close: async () => {
      await Promise.all(Array.from(sessions.values()).map((t) => t.close()));
      sessions.clear();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
