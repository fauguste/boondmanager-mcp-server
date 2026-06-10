import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { request as httpRequest } from "node:http";
import { resolveAllowedHosts, resolveHttpOptions, startHttpTransport, type HttpServerHandle } from "./http.js";
import { createMcpServer } from "../server.js";

/**
 * Performs a low-level HTTP POST so we can override the Host header (which
 * `fetch`/undici treats as a forbidden header and silently overrides).
 */
function postWithHost(
  port: number,
  path: string,
  hostHeader: string,
  body: string,
  extraHeaders: Record<string, string> = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          Host: hostHeader,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...extraHeaders,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk as Buffer));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

const ENV_KEYS = [
  "MCP_HTTP_PORT",
  "MCP_HTTP_HOST",
  "MCP_HTTP_PATH",
  "MCP_HTTP_STATEFUL",
  "MCP_HTTP_JSON_RESPONSE",
  "MCP_HTTP_SESSION_TTL_MS",
  "MCP_HTTP_SESSION_SWEEP_INTERVAL_MS",
  "MCP_HTTP_ALLOWED_HOSTS",
  "MCP_HTTP_PUBLIC_URL",
  "BOOND_OAUTH_AUTHORIZATION_SERVER",
  "BOOND_OAUTH_SCOPES",
];

/** Shorthand for an authenticated MCP request body (OAuth Bearer required). */
const AUTH_HEADER = { Authorization: "Bearer test-access-token" };

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
    expect(opts.publicUrl).toBeUndefined();
    expect(opts.sessionTtlMs).toBe(30 * 60_000);
    expect(opts.sessionSweepIntervalMs).toBe(5 * 60_000);
  });

  it("reads session lifecycle knobs from env", () => {
    process.env["MCP_HTTP_SESSION_TTL_MS"] = "60000";
    process.env["MCP_HTTP_SESSION_SWEEP_INTERVAL_MS"] = "10000";
    const opts = resolveHttpOptions();
    expect(opts.sessionTtlMs).toBe(60_000);
    expect(opts.sessionSweepIntervalMs).toBe(10_000);
  });

  it("falls back to defaults on bad session lifecycle values", () => {
    process.env["MCP_HTTP_SESSION_TTL_MS"] = "0";
    process.env["MCP_HTTP_SESSION_SWEEP_INTERVAL_MS"] = "lots";
    const opts = resolveHttpOptions();
    expect(opts.sessionTtlMs).toBe(30 * 60_000);
    expect(opts.sessionSweepIntervalMs).toBe(5 * 60_000);
  });

  it("reads configuration from environment variables", () => {
    process.env["MCP_HTTP_PORT"] = "4242";
    process.env["MCP_HTTP_HOST"] = "0.0.0.0";
    process.env["MCP_HTTP_PATH"] = "/api/mcp";
    process.env["MCP_HTTP_STATEFUL"] = "true";
    process.env["MCP_HTTP_JSON_RESPONSE"] = "true";
    process.env["MCP_HTTP_PUBLIC_URL"] = "https://mcp.example.com/api/mcp";

    const opts = resolveHttpOptions();
    expect(opts.port).toBe(4242);
    expect(opts.host).toBe("0.0.0.0");
    expect(opts.path).toBe("/api/mcp");
    expect(opts.stateless).toBe(false);
    expect(opts.enableJsonResponse).toBe(true);
    expect(opts.publicUrl).toBe("https://mcp.example.com/api/mcp");
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

  it("parses MCP_HTTP_ALLOWED_HOSTS as a comma-separated list", () => {
    process.env["MCP_HTTP_ALLOWED_HOSTS"] = "example.com, mcp.internal ,";
    const opts = resolveHttpOptions();
    expect(opts.allowedHosts).toEqual(["example.com", "mcp.internal"]);
  });

  it("leaves allowedHosts undefined when MCP_HTTP_ALLOWED_HOSTS is unset", () => {
    const opts = resolveHttpOptions();
    expect(opts.allowedHosts).toBeUndefined();
  });
});

describe("resolveAllowedHosts", () => {
  it("returns the localhost allow-list by default when bound to a loopback interface", () => {
    expect(resolveAllowedHosts(undefined, "127.0.0.1")).toEqual(["localhost", "127.0.0.1", "[::1]"]);
    expect(resolveAllowedHosts(undefined, "::1")).toEqual(["localhost", "127.0.0.1", "[::1]"]);
    expect(resolveAllowedHosts(undefined, "localhost")).toEqual(["localhost", "127.0.0.1", "[::1]"]);
  });

  it("returns an empty list (validation disabled) when bound to a non-loopback interface with no config", () => {
    expect(resolveAllowedHosts(undefined, "0.0.0.0")).toEqual([]);
    expect(resolveAllowedHosts([], "0.0.0.0")).toEqual([]);
  });

  it("treats a sole `*` as an explicit opt-out", () => {
    expect(resolveAllowedHosts(["*"], "127.0.0.1")).toEqual([]);
  });

  it("ignores `*` when mixed with real hosts (keeps validation on)", () => {
    // A bare `*` alongside real hostnames is almost always a mistake; we drop
    // the `*` and keep validating the explicit hosts rather than opening up.
    expect(resolveAllowedHosts(["*", "example.com"], "0.0.0.0")).toEqual(["example.com"]);
  });

  it("uses the configured allow-list verbatim when provided", () => {
    expect(resolveAllowedHosts(["mcp.internal"], "0.0.0.0")).toEqual(["mcp.internal"]);
  });
});

describe("startHttpTransport (integration)", () => {
  let handle: HttpServerHandle | undefined;

  afterEach(async () => {
    if (handle) await handle.close();
    handle = undefined;
  });

  it("serves /healthz without authentication", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 34561,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
    });
    const res = await fetch(`http://127.0.0.1:${handle.address.port}/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const doc = (await res.json()) as Record<string, unknown>;
    expect(doc["status"]).toBe("ok");
    expect(typeof doc["version"]).toBe("string");
    expect(doc["mode"]).toBe("stateless");
    expect(doc["sessions"]).toBe(0);
  });

  it("serves /healthz even when the Host header is not in the allow-list", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 34562,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
      allowedHosts: ["mcp.example.com"],
    });
    // Probes (Docker/Kubernetes) often send the pod IP as Host — /healthz
    // must answer before Host validation kicks in.
    const res = await fetch(`http://127.0.0.1:${handle.address.port}/healthz`);
    expect(res.status).toBe(200);
  });

  it("does not answer /healthz on non-GET methods", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 34563,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
    });
    const res = await fetch(`http://127.0.0.1:${handle.address.port}/healthz`, { method: "POST", body: "{}" });
    expect(res.status).toBe(404);
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
    // GET on the MCP endpoint still needs to be authenticated — the 401
    // challenge fires before stateless-vs-stateful routing.
    const res = await fetch(`http://127.0.0.1:${handle.address.port}/mcp`, {
      headers: AUTH_HEADER,
    });
    expect(res.status).toBe(405);
  });

  it("returns 401 with a WWW-Authenticate challenge when no Bearer token is present", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 34569,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
    });
    const res = await fetch(`http://127.0.0.1:${handle.address.port}/mcp`, {
      method: "POST",
      body: "{}",
    });
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain("resource_metadata=");
    expect(challenge).toContain("/.well-known/oauth-protected-resource/mcp");
  });

  it("rejects requests with a non-Bearer Authorization scheme", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 34579,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
    });
    const res = await fetch(`http://127.0.0.1:${handle.address.port}/mcp`, {
      method: "POST",
      headers: { Authorization: "Basic dGVzdDp0ZXN0" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("publishes RFC 9728 protected-resource metadata at /.well-known/oauth-protected-resource", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 34580,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
      publicUrl: "https://mcp.example.com/mcp",
    });
    const res = await fetch(`http://127.0.0.1:${handle.address.port}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const doc = (await res.json()) as Record<string, unknown>;
    expect(doc["resource"]).toBe("https://mcp.example.com/mcp");
    expect(doc["authorization_servers"]).toEqual(["https://ui.boondmanager.com"]);
    expect(doc["bearer_methods_supported"]).toEqual(["header"]);
  });

  it("serves the path-suffixed metadata variant per RFC 9728 §3.2", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 34581,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
    });
    const res = await fetch(`http://127.0.0.1:${handle.address.port}/.well-known/oauth-protected-resource/mcp`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as Record<string, unknown>;
    expect(typeof doc["resource"]).toBe("string");
  });

  it("honours BOOND_OAUTH_AUTHORIZATION_SERVER + BOOND_OAUTH_SCOPES in the discovery metadata", async () => {
    process.env["BOOND_OAUTH_AUTHORIZATION_SERVER"] = "https://custom.boondmanager.com";
    process.env["BOOND_OAUTH_SCOPES"] = "candidates,resources";
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 34582,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
    });
    const res = await fetch(`http://127.0.0.1:${handle.address.port}/.well-known/oauth-protected-resource`);
    const doc = (await res.json()) as Record<string, unknown>;
    expect(doc["authorization_servers"]).toEqual(["https://custom.boondmanager.com"]);
    expect(doc["scopes_supported"]).toEqual(["candidates", "resources"]);
  });

  it("reaps idle stateful sessions on sweep", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 34571,
      path: "/mcp",
      stateless: false,
      enableJsonResponse: true,
      sessionTtlMs: 50,
      // Big sweep interval so the periodic timer never fires during this
      // test — we drive the sweep explicitly via the handle.
      sessionSweepIntervalMs: 60_000,
    });

    const initRes = await fetch(`http://127.0.0.1:${handle.address.port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...AUTH_HEADER,
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
    expect(initRes.status).toBe(200);
    await initRes.text();

    expect(handle.sessionCount()).toBe(1);

    // A fresh session should not be reaped — last activity is now-ish.
    expect(await handle.sweepIdleSessions()).toBe(0);
    expect(handle.sessionCount()).toBe(1);

    // Wait past the TTL, then a sweep should reap the idle session.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await handle.sweepIdleSessions()).toBe(1);
    expect(handle.sessionCount()).toBe(0);
  });

  it("rejects requests with a Host header outside the allow-list", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 34572,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
    });
    const res = await postWithHost(handle.address.port, "/mcp", "evil.example.com", "{}");
    expect(res.status).toBe(403);
    const parsed = JSON.parse(res.body) as { error?: { message?: string } };
    expect(parsed.error?.message).toMatch(/Invalid Host/);
  });

  it("accepts requests with a Host header in the configured allow-list", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "0.0.0.0",
      port: 34573,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
      allowedHosts: ["mcp.internal"],
    });
    const okRes = await postWithHost(
      handle.address.port,
      "/mcp",
      "mcp.internal",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "vitest", version: "1.0.0" },
        },
      }),
      { Accept: "application/json, text/event-stream", ...AUTH_HEADER }
    );
    expect(okRes.status).toBe(200);

    const koRes = await postWithHost(handle.address.port, "/mcp", "other.example.com", "{}", AUTH_HEADER);
    expect(koRes.status).toBe(403);
  });

  it("disables host validation when allowedHosts is `['*']`", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 34574,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
      allowedHosts: ["*"],
    });
    const res = await postWithHost(
      handle.address.port,
      "/mcp",
      "anything.example.com",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "vitest", version: "1.0.0" },
        },
      }),
      { Accept: "application/json, text/event-stream", ...AUTH_HEADER }
    );
    expect(res.status).toBe(200);
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
        ...AUTH_HEADER,
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

  it("rejects an oversized body with 413 (Content-Length precheck)", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 34574,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
    });
    const big = "x".repeat(2 * 1024 * 1024);
    const res = await fetch(`http://127.0.0.1:${handle.address.port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH_HEADER },
      body: big,
    });
    expect(res.status).toBe(413);
  });

  it("rejects new sessions with 503 once the session cap is reached", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 34575,
      path: "/mcp",
      stateless: false,
      enableJsonResponse: true,
      maxSessions: 1,
      sessionTtlMs: 60_000,
      sessionSweepIntervalMs: 60_000,
    });
    const initBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vitest", version: "1.0.0" } },
    });
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...AUTH_HEADER,
    };

    const first = await fetch(`http://127.0.0.1:${handle.address.port}/mcp`, {
      method: "POST",
      headers,
      body: initBody,
    });
    expect(first.status).toBe(200);
    await first.text();
    expect(handle.sessionCount()).toBe(1);

    const second = await fetch(`http://127.0.0.1:${handle.address.port}/mcp`, {
      method: "POST",
      headers,
      body: initBody,
    });
    expect(second.status).toBe(503);
  });

  it("builds the metadata URL by stripping the path as a suffix", async () => {
    // publicUrl whose host embeds the path string ('/mcp') must not be mangled.
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 34576,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
      publicUrl: "https://mcp.example.com/mcp",
    });
    const res = await fetch(`http://127.0.0.1:${handle.address.port}/mcp`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"');
  });
});
