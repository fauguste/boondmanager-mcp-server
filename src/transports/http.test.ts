import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveHttpOptions, startHttpTransport, type HttpServerHandle } from "./http.js";
import { createMcpServer } from "../server.js";

const ENV_KEYS = [
  "MCP_HTTP_PORT",
  "MCP_HTTP_HOST",
  "MCP_HTTP_PATH",
  "MCP_HTTP_STATEFUL",
  "MCP_HTTP_BEARER_TOKEN",
  "MCP_HTTP_JSON_RESPONSE",
];

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("resolveHttpOptions", () => {
  beforeEach(() => clearEnv());
  afterEach(() => clearEnv());

  it("returns sensible defaults when no env vars are set", () => {
    const opts = resolveHttpOptions();
    expect(opts.host).toBe("127.0.0.1");
    expect(opts.port).toBe(3000);
    expect(opts.path).toBe("/mcp");
    expect(opts.stateless).toBe(true);
    expect(opts.enableJsonResponse).toBe(false);
    expect(opts.bearerToken).toBeUndefined();
  });

  it("reads configuration from environment variables", () => {
    process.env["MCP_HTTP_PORT"] = "4242";
    process.env["MCP_HTTP_HOST"] = "0.0.0.0";
    process.env["MCP_HTTP_PATH"] = "/api/mcp";
    process.env["MCP_HTTP_STATEFUL"] = "true";
    process.env["MCP_HTTP_BEARER_TOKEN"] = "sekret";
    process.env["MCP_HTTP_JSON_RESPONSE"] = "true";

    const opts = resolveHttpOptions();
    expect(opts.port).toBe(4242);
    expect(opts.host).toBe("0.0.0.0");
    expect(opts.path).toBe("/api/mcp");
    expect(opts.stateless).toBe(false);
    expect(opts.bearerToken).toBe("sekret");
    expect(opts.enableJsonResponse).toBe(true);
  });

  it("ignores unresolved ${...} placeholders", () => {
    process.env["MCP_HTTP_HOST"] = "${user_config.host}";
    const opts = resolveHttpOptions();
    expect(opts.host).toBe("127.0.0.1");
  });

  it("throws on an invalid port value", () => {
    process.env["MCP_HTTP_PORT"] = "not-a-port";
    expect(() => resolveHttpOptions()).toThrow(/Invalid MCP_HTTP_PORT/);
  });
});

describe("startHttpTransport (integration)", () => {
  let handle: HttpServerHandle | undefined;

  afterEach(async () => {
    if (handle) await handle.close();
    handle = undefined;
  });

  it("returns 404 for unknown paths", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 34567,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
    });
    const res = await fetch(`http://127.0.0.1:${handle.address.port}/not-mcp`);
    expect(res.status).toBe(404);
  });

  it("rejects GET in stateless mode with 405", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 34568,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
    });
    const res = await fetch(`http://127.0.0.1:${handle.address.port}/mcp`);
    expect(res.status).toBe(405);
  });

  it("rejects unauthorized requests when a bearer token is configured", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 34569,
      path: "/mcp",
      stateless: true,
      bearerToken: "sekret",
      enableJsonResponse: true,
    });
    const res = await fetch(`http://127.0.0.1:${handle.address.port}/mcp`, {
      method: "POST",
      body: "{}",
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("responds to an MCP initialize request in stateless mode", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 34570,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
    });
    const res = await fetch(`http://127.0.0.1:${handle.address.port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "vitest", version: "1.0.0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      result?: { serverInfo?: { name?: string } };
    };
    expect(json.result?.serverInfo?.name).toBe("boondmanager-mcp-server");
  });
});
