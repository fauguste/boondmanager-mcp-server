import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";
import {
  MAX_BODY_BYTES,
  assertStaticAuthPolicy,
  isApiKeyMatch,
  isDiscoveryPath,
  isOriginAllowed,
  resolveAllowedHosts,
  resolveHttpOptions,
  resolveOriginPolicy,
  startHttpTransport,
  type HttpServerHandle,
  resolveServerTimeouts,
  DEFAULT_KEEP_ALIVE_TIMEOUT_MS,
  DEFAULT_HEADERS_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
} from "./http.js";
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
  "MCP_HTTP_KEEP_ALIVE_TIMEOUT_MS",
  "MCP_HTTP_HEADERS_TIMEOUT_MS",
  "MCP_HTTP_REQUEST_TIMEOUT_MS",
  "MCP_HTTP_SHUTDOWN_TIMEOUT_MS",
  "MCP_HTTP_SESSION_SWEEP_INTERVAL_MS",
  "MCP_HTTP_ALLOWED_HOSTS",
  "MCP_HTTP_ALLOWED_ORIGINS",
  "MCP_HTTP_PUBLIC_URL",
  "BOOND_OAUTH_AUTHORIZATION_SERVER",
  "BOOND_OAUTH_SCOPES",
  "BOOND_HTTP_STATIC_AUTH",
  "MCP_HTTP_API_KEY",
  "MCP_HTTP_INSECURE_STATIC_AUTH",
];

/** Shorthand for an authenticated MCP request body (OAuth Bearer required). */
const AUTH_HEADER = { Authorization: "Bearer test-access-token" };

/** Minimal, valid MCP `initialize` payload. */
const INIT_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "vitest", version: "1.0.0" },
  },
});

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

  it("defaults the server timeouts above load-balancer idle windows (#237)", () => {
    const opts = resolveHttpOptions();
    expect(opts.keepAliveTimeoutMs).toBe(DEFAULT_KEEP_ALIVE_TIMEOUT_MS);
    expect(opts.headersTimeoutMs).toBe(DEFAULT_HEADERS_TIMEOUT_MS);
    expect(opts.requestTimeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(opts.shutdownTimeoutMs).toBe(DEFAULT_SHUTDOWN_TIMEOUT_MS);
    // The whole point: Node's 5 s default sits below AWS ALB (60 s) and nginx (75 s).
    expect(DEFAULT_KEEP_ALIVE_TIMEOUT_MS).toBeGreaterThan(60_000);
    expect(DEFAULT_HEADERS_TIMEOUT_MS).toBeGreaterThan(DEFAULT_KEEP_ALIVE_TIMEOUT_MS);
  });

  it("reads the server timeouts from env and falls back on bad values", () => {
    process.env["MCP_HTTP_KEEP_ALIVE_TIMEOUT_MS"] = "80000";
    process.env["MCP_HTTP_HEADERS_TIMEOUT_MS"] = "81000";
    process.env["MCP_HTTP_REQUEST_TIMEOUT_MS"] = "0";
    process.env["MCP_HTTP_SHUTDOWN_TIMEOUT_MS"] = "soon";
    const opts = resolveHttpOptions();
    expect(opts.keepAliveTimeoutMs).toBe(80_000);
    expect(opts.headersTimeoutMs).toBe(81_000);
    expect(opts.requestTimeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(opts.shutdownTimeoutMs).toBe(DEFAULT_SHUTDOWN_TIMEOUT_MS);
  });

  it("raises a headers timeout that does not exceed keep-alive (Node's own invariant)", () => {
    expect(resolveServerTimeouts({ keepAliveTimeoutMs: 70_000, headersTimeoutMs: 70_000 })).toMatchObject({
      keepAliveTimeout: 70_000,
      headersTimeout: 71_000,
      coerced: true,
    });
    expect(resolveServerTimeouts({ keepAliveTimeoutMs: 70_000, headersTimeoutMs: 90_000 })).toMatchObject({
      headersTimeout: 90_000,
      coerced: false,
    });
    expect(resolveServerTimeouts({})).toEqual({
      keepAliveTimeout: DEFAULT_KEEP_ALIVE_TIMEOUT_MS,
      headersTimeout: DEFAULT_HEADERS_TIMEOUT_MS,
      requestTimeout: DEFAULT_REQUEST_TIMEOUT_MS,
      coerced: false,
    });
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

  it("parses MCP_HTTP_ALLOWED_ORIGINS as a comma-separated list", () => {
    process.env["MCP_HTTP_ALLOWED_ORIGINS"] = "https://app.example.com, http://localhost:5173 ,";
    const opts = resolveHttpOptions();
    expect(opts.allowedOrigins).toEqual(["https://app.example.com", "http://localhost:5173"]);
  });

  it("leaves allowedOrigins undefined when MCP_HTTP_ALLOWED_ORIGINS is unset", () => {
    const opts = resolveHttpOptions();
    expect(opts.allowedOrigins).toBeUndefined();
  });

  it("reads BOOND_HTTP_STATIC_AUTH correctly", () => {
    process.env["BOOND_HTTP_STATIC_AUTH"] = "true";
    expect(resolveHttpOptions().staticAuth).toBe(true);
    process.env["BOOND_HTTP_STATIC_AUTH"] = "1";
    expect(resolveHttpOptions().staticAuth).toBe(true);
    process.env["BOOND_HTTP_STATIC_AUTH"] = "yes";
    expect(resolveHttpOptions().staticAuth).toBe(true);
    process.env["BOOND_HTTP_STATIC_AUTH"] = "false";
    expect(resolveHttpOptions().staticAuth).toBe(false);
    delete process.env["BOOND_HTTP_STATIC_AUTH"];
    expect(resolveHttpOptions().staticAuth).toBe(false);
  });
});

describe("static auth policy (#230)", () => {
  beforeEach(() => clearEnv());
  afterEach(() => clearEnv());

  it("reads MCP_HTTP_API_KEY and MCP_HTTP_INSECURE_STATIC_AUTH from env", () => {
    process.env["MCP_HTTP_API_KEY"] = "  s3cret  ";
    process.env["MCP_HTTP_INSECURE_STATIC_AUTH"] = "1";
    const opts = resolveHttpOptions();
    expect(opts.apiKey).toBe("s3cret");
    expect(opts.insecureStaticAuth).toBe(true);
  });

  it("treats a blank or unresolved MCP_HTTP_API_KEY as unconfigured, never as an empty secret", () => {
    for (const value of ["", "   ", "${user_config.api_key}"]) {
      process.env["MCP_HTTP_API_KEY"] = value;
      expect(resolveHttpOptions().apiKey).toBeUndefined();
    }
    expect(resolveHttpOptions().insecureStaticAuth).toBe(false);
  });

  const base = { port: 0, path: "/mcp", stateless: true, enableJsonResponse: true };

  it("refuses static auth on a non-loopback bind without an API key", () => {
    expect(() => assertStaticAuthPolicy({ ...base, host: "0.0.0.0", staticAuth: true })).toThrow(/MCP_HTTP_API_KEY/);
    expect(() => assertStaticAuthPolicy({ ...base, host: "10.0.0.5", staticAuth: true })).toThrow(/MCP_HTTP_API_KEY/);
  });

  it("allows static auth without a key on loopback, with a key anywhere, or with the explicit insecure opt-out", () => {
    expect(() => assertStaticAuthPolicy({ ...base, host: "127.0.0.1", staticAuth: true })).not.toThrow();
    expect(() => assertStaticAuthPolicy({ ...base, host: "localhost", staticAuth: true })).not.toThrow();
    expect(() => assertStaticAuthPolicy({ ...base, host: "0.0.0.0", staticAuth: true, apiKey: "k" })).not.toThrow();
    expect(() =>
      assertStaticAuthPolicy({ ...base, host: "0.0.0.0", staticAuth: true, insecureStaticAuth: true })
    ).not.toThrow();
  });

  it("never applies to OAuth mode", () => {
    expect(() => assertStaticAuthPolicy({ ...base, host: "0.0.0.0", staticAuth: false })).not.toThrow();
  });

  it("compares API keys in constant time (length mismatch does not throw)", () => {
    expect(isApiKeyMatch("secret", "secret")).toBe(true);
    expect(isApiKeyMatch("secre", "secret")).toBe(false);
    expect(isApiKeyMatch("secret-but-longer", "secret")).toBe(false);
    expect(isApiKeyMatch("", "secret")).toBe(false);
    expect(isApiKeyMatch(null, "secret")).toBe(false);
    expect(isApiKeyMatch(undefined, "secret")).toBe(false);
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

describe("resolveOriginPolicy", () => {
  it("accepts any loopback origin by default when bound to a loopback interface", () => {
    const policy = resolveOriginPolicy(undefined, "127.0.0.1");
    expect(policy).toEqual({ enabled: true, origins: [], allowAnyLoopback: true });
    // The port is deliberately NOT pinned: nothing is served from the MCP port,
    // so the browser clients that legitimately show up sit on other local ports.
    for (const origin of [
      "http://localhost:6274", // MCP Inspector
      "http://127.0.0.1:5173", // Vite dev server
      "http://[::1]:8080",
      "https://localhost:3000",
      "http://localhost", // implicit :80
    ]) {
      expect(isOriginAllowed(policy, origin)).toBe(true);
    }
  });

  it("still rejects remote origins under the loopback default (DNS rebinding)", () => {
    const policy = resolveOriginPolicy(undefined, "localhost");
    for (const origin of [
      "https://evil.example.com",
      "http://127.0.0.1.nip.io", // resolves to loopback, hostname is not
      "http://localhost.evil.example.com",
      "file://",
      "null",
    ]) {
      expect(isOriginAllowed(policy, origin)).toBe(false);
    }
  });

  it("adds the public URL's origin to the loopback default (reverse-proxy deployment)", () => {
    const policy = resolveOriginPolicy(undefined, "127.0.0.1", "https://mcp.example.com/mcp");
    expect(policy.origins).toEqual(["https://mcp.example.com"]);
    expect(isOriginAllowed(policy, "https://mcp.example.com")).toBe(true);
    expect(isOriginAllowed(policy, "https://other.example.com")).toBe(false);
  });

  it("ignores an unparseable public URL rather than throwing", () => {
    expect(resolveOriginPolicy(undefined, "127.0.0.1", "not a url").origins).toEqual([]);
  });

  it("disables validation when bound to a non-loopback interface with no config", () => {
    const policy = resolveOriginPolicy(undefined, "0.0.0.0");
    expect(policy.enabled).toBe(false);
    expect(isOriginAllowed(policy, "https://evil.example.com")).toBe(true);
  });

  it("treats an empty configured list as unconfigured, not as disabled", () => {
    // A blank `MCP_HTTP_ALLOWED_ORIGINS=` must not silently switch the check
    // off — `*` is the explicit opt-out. Asserted on a *loopback* bind, where
    // the two behaviours actually differ.
    const policy = resolveOriginPolicy([], "127.0.0.1");
    expect(policy).toEqual({ enabled: true, origins: [], allowAnyLoopback: true });
    expect(isOriginAllowed(policy, "https://evil.example.com")).toBe(false);
    expect(resolveOriginPolicy([], "0.0.0.0").enabled).toBe(false);
  });

  it("treats a sole `*` as an explicit opt-out", () => {
    const policy = resolveOriginPolicy(["*"], "127.0.0.1");
    expect(policy.enabled).toBe(false);
    expect(isOriginAllowed(policy, "https://evil.example.com")).toBe(true);
  });

  it("ignores `*` when mixed with real origins (keeps validation on)", () => {
    const policy = resolveOriginPolicy(["*", "https://app.example.com"], "0.0.0.0");
    expect(policy).toEqual({
      enabled: true,
      origins: ["https://app.example.com"],
      allowAnyLoopback: false,
    });
  });

  it("matches an explicit list exactly — port-sensitive, no loopback shortcut", () => {
    const policy = resolveOriginPolicy(["http://localhost:5173"], "127.0.0.1");
    expect(policy.allowAnyLoopback).toBe(false);
    expect(isOriginAllowed(policy, "http://localhost:5173")).toBe(true);
    expect(isOriginAllowed(policy, "http://localhost:6274")).toBe(false);
  });

  it("normalises configured origins (case, whitespace, trailing slashes)", () => {
    expect(resolveOriginPolicy(["HTTPS://App.Example.COM/"], "0.0.0.0").origins).toEqual(["https://app.example.com"]);
    expect(resolveOriginPolicy([" https://app.example.com///"], "0.0.0.0").origins).toEqual([
      "https://app.example.com",
    ]);
  });

  it("normalises a long run of trailing slashes in linear time", () => {
    // Guards the js/polynomial-redos fix: normalisation runs on the
    // caller-supplied Origin header, so it must not backtrack.
    const origin = `https://app.example.com${"/".repeat(50_000)}`;
    const started = process.hrtime.bigint();
    expect(resolveOriginPolicy([origin], "0.0.0.0").origins).toEqual(["https://app.example.com"]);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(elapsedMs).toBeLessThan(250);
  });
});

describe("isDiscoveryPath", () => {
  it("matches the bare and path-suffixed RFC 9728 metadata paths", () => {
    expect(isDiscoveryPath("/.well-known/oauth-protected-resource", "/mcp")).toBe(true);
    expect(isDiscoveryPath("/.well-known/oauth-protected-resource/mcp", "/mcp")).toBe(true);
    expect(isDiscoveryPath("/.well-known/oauth-protected-resource?x=1", "/mcp")).toBe(true);
  });

  it("does not match anything else", () => {
    expect(isDiscoveryPath("/mcp", "/mcp")).toBe(false);
    expect(isDiscoveryPath("/.well-known/oauth-authorization-server", "/mcp")).toBe(false);
    expect(isDiscoveryPath(undefined, "/mcp")).toBe(false);
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
      port: 0,
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
      port: 0,
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
      port: 0,
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
      port: 0,
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
      port: 0,
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
      port: 0,
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
      port: 0,
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
      port: 0,
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
      port: 0,
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
      port: 0,
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
      port: 0,
      path: "/mcp",
      stateless: false,
      enableJsonResponse: true,
      // Wide enough that the `initialize` round-trip (which instantiates a full
      // McpServer and its ~180 tool registrations) cannot itself age the session
      // past the TTL before the first sweep runs. A tight budget here made the
      // "fresh session is not reaped" assertion fail whenever the suite ran
      // under load — it measured the machine, not the sweep logic. Do not shrink
      // it back: at 50 ms this failed ~2 runs out of 6 of the full suite.
      sessionTtlMs: 1_000,
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
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(await handle.sweepIdleSessions()).toBe(1);
    expect(handle.sessionCount()).toBe(0);
  });

  it("rejects requests with a Host header outside the allow-list", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 0,
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
      port: 0,
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
      port: 0,
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

  it("accepts a request with no Origin header (non-browser clients)", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
    });
    // Default (loopback) origin allow-list is active, but a missing Origin must
    // never be rejected — curl, gateways and MCP CLI clients don't send one.
    const res = await postWithHost(handle.address.port, "/mcp", "127.0.0.1", INIT_BODY, {
      Accept: "application/json, text/event-stream",
      ...AUTH_HEADER,
    });
    expect(res.status).toBe(200);
  });

  it("accepts a request whose Origin is in the allow-list", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
    });
    // The loopback default accepts any local port, not just the bound one:
    // a browser client (MCP Inspector, a dev server) is served from elsewhere.
    for (const origin of [
      `http://localhost:${handle.address.port}`,
      "http://localhost:6274",
      "http://127.0.0.1:5173",
    ]) {
      const res = await postWithHost(handle.address.port, "/mcp", "127.0.0.1", INIT_BODY, {
        Accept: "application/json, text/event-stream",
        Origin: origin,
        ...AUTH_HEADER,
      });
      expect(res.status, `Origin ${origin} should be accepted`).toBe(200);
    }
  });

  it("serves the RFC 9728 discovery document regardless of Origin", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
      allowedOrigins: ["https://app.example.com"],
    });
    // A browser client only fetches this because a 401 challenge pointed it
    // here; 403ing it would dead-end the OAuth bootstrap.
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const res = await fetch(`http://127.0.0.1:${handle.address.port}${path}`, {
        headers: { Origin: "https://evil.example.com" },
      });
      expect(res.status, `${path} should be served`).toBe(200);
      const doc = (await res.json()) as { resource?: string };
      expect(doc.resource).toContain("/mcp");
    }
  });

  it("adds the publicUrl origin to the loopback default (reverse-proxy deployment)", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
      publicUrl: "https://mcp.example.com/mcp",
    });
    const res = await postWithHost(handle.address.port, "/mcp", "127.0.0.1", INIT_BODY, {
      Accept: "application/json, text/event-stream",
      Origin: "https://mcp.example.com",
      ...AUTH_HEADER,
    });
    expect(res.status).toBe(200);
  });

  it("rejects a request with a foreign Origin with 403", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
    });
    const res = await postWithHost(handle.address.port, "/mcp", "127.0.0.1", INIT_BODY, {
      Accept: "application/json, text/event-stream",
      Origin: "https://evil.example.com",
      ...AUTH_HEADER,
    });
    expect(res.status).toBe(403);
    const parsed = JSON.parse(res.body) as { error?: { message?: string } };
    expect(parsed.error?.message).toMatch(/Invalid Origin/);
  });

  it("honours an explicit allowedOrigins list", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "0.0.0.0",
      port: 0,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
      allowedHosts: ["mcp.internal"],
      allowedOrigins: ["https://app.example.com"],
    });
    const okRes = await postWithHost(handle.address.port, "/mcp", "mcp.internal", INIT_BODY, {
      Accept: "application/json, text/event-stream",
      // Trailing slash + mixed case must still match.
      Origin: "https://App.example.com/",
      ...AUTH_HEADER,
    });
    expect(okRes.status).toBe(200);

    const koRes = await postWithHost(handle.address.port, "/mcp", "mcp.internal", INIT_BODY, {
      Accept: "application/json, text/event-stream",
      Origin: "https://other.example.com",
      ...AUTH_HEADER,
    });
    expect(koRes.status).toBe(403);
  });

  it("disables origin validation when allowedOrigins is `['*']`", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
      allowedOrigins: ["*"],
    });
    const res = await postWithHost(handle.address.port, "/mcp", "127.0.0.1", INIT_BODY, {
      Accept: "application/json, text/event-stream",
      Origin: "https://anything.example.com",
      ...AUTH_HEADER,
    });
    expect(res.status).toBe(200);
  });

  it("keeps origin validation on when `*` is mixed with real origins", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
      allowedOrigins: ["*", "https://app.example.com"],
    });
    const koRes = await postWithHost(handle.address.port, "/mcp", "127.0.0.1", INIT_BODY, {
      Accept: "application/json, text/event-stream",
      Origin: "https://anything.example.com",
      ...AUTH_HEADER,
    });
    expect(koRes.status).toBe(403);

    const okRes = await postWithHost(handle.address.port, "/mcp", "127.0.0.1", INIT_BODY, {
      Accept: "application/json, text/event-stream",
      Origin: "https://app.example.com",
      ...AUTH_HEADER,
    });
    expect(okRes.status).toBe(200);
  });

  it("serves /healthz even when the Origin is not in the allow-list", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
      allowedOrigins: ["https://app.example.com"],
    });
    const res = await fetch(`http://127.0.0.1:${handle.address.port}/healthz`, {
      headers: { Origin: "https://evil.example.com" },
    });
    expect(res.status).toBe(200);
  });

  it("responds to an MCP initialize request in stateless mode", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 0,
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

  it("accepts MCP initialize without Bearer token in staticAuth mode", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
      staticAuth: true,
    });
    const res = await fetch(`http://127.0.0.1:${handle.address.port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        // No Authorization header
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
    const json = (await res.json()) as { result?: { serverInfo?: { name?: string } } };
    expect(json.result?.serverInfo?.name).toBe("boondmanager-mcp-server");
  });

  it("still rejects without Bearer when staticAuth is false (default)", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
      staticAuth: false,
    });
    const res = await fetch(`http://127.0.0.1:${handle.address.port}/mcp`, {
      method: "POST",
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("rejects an oversized body with 413 (Content-Length precheck)", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 0,
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

  /**
   * Streams a POST body in chunks **without** a `Content-Length` header, so
   * Node sends it `Transfer-Encoding: chunked` — the shape a reverse proxy that
   * re-encodes produces, and the one the `Content-Length` precheck cannot see.
   * The client tolerates a socket reset after the server's early answer: a
   * `413` is written before the upload finishes, and the server then closes
   * the connection rather than draining the rest.
   */
  function postChunked(
    port: number,
    path: string,
    chunks: string[],
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
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            ...extraHeaders,
          },
        },
        (res) => {
          const parts: Buffer[] = [];
          res.on("data", (chunk) => parts.push(chunk as Buffer));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(parts).toString("utf8") }));
          res.on("error", reject);
        }
      );
      let settled = false;
      req.on("response", () => {
        settled = true;
      });
      // Once the server has answered, a write error on the request side is
      // expected (it stopped reading); only a failure *before* any response
      // is a real error.
      req.on("error", (err) => {
        if (!settled) reject(err);
      });
      let i = 0;
      const pump = (): void => {
        while (i < chunks.length) {
          const ok = req.write(chunks[i++]!);
          if (!ok) {
            req.once("drain", pump);
            return;
          }
        }
        req.end();
      };
      pump();
    });
  }

  /** `MAX_BODY_BYTES + 64 KiB` as a JSON-looking chunked payload. */
  const OVERSIZED_CHUNKS = (() => {
    const chunk = "x".repeat(64 * 1024);
    const count = Math.ceil((MAX_BODY_BYTES + 64 * 1024) / chunk.length);
    return ['{"jsonrpc":"2.0","id":1,"method":"ping","params":{"pad":"', ...Array(count).fill(chunk), '"}}'];
  })();

  it("rejects an oversized chunked body (no Content-Length) with 413 in stateless mode", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
    });
    const res = await postChunked(handle.address.port, "/mcp", OVERSIZED_CHUNKS, AUTH_HEADER);
    expect(res.status).toBe(413);
    expect(JSON.parse(res.body)).toMatchObject({ error: { message: "Request body too large" } });
  });

  it("rejects an oversized chunked body on an existing stateful session with 413, and keeps the session usable", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      stateless: false,
      enableJsonResponse: true,
      sessionTtlMs: 60_000,
      sessionSweepIntervalMs: 60_000,
    });
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...AUTH_HEADER,
    };
    const init = await fetch(`http://127.0.0.1:${handle.address.port}/mcp`, {
      method: "POST",
      headers,
      body: INIT_BODY,
    });
    expect(init.status).toBe(200);
    await init.text();
    const sessionId = init.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    const big = await postChunked(handle.address.port, "/mcp", OVERSIZED_CHUNKS, {
      ...AUTH_HEADER,
      "Mcp-Session-Id": sessionId!,
    });
    expect(big.status).toBe(413);

    // The session survived the rejected request.
    const ping = await fetch(`http://127.0.0.1:${handle.address.port}/mcp`, {
      method: "POST",
      headers: { ...headers, "Mcp-Session-Id": sessionId! },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
    });
    expect(ping.status).toBe(200);
    expect(handle.sessionCount()).toBe(1);
  });

  it("still serves a valid chunked body under the cap", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      stateless: true,
      enableJsonResponse: true,
    });
    // Split the initialize payload into several chunks so the request is
    // genuinely `Transfer-Encoding: chunked`.
    const chunks = INIT_BODY.match(/.{1,16}/g) ?? [INIT_BODY];
    const res = await postChunked(handle.address.port, "/mcp", chunks, AUTH_HEADER);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body) as { result?: { serverInfo?: { name?: string } } };
    expect(json.result?.serverInfo?.name).toBe("boondmanager-mcp-server");
  });

  it("answers an unparseable JSON body with 400 / -32700 instead of handing the drained stream to the SDK", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 0,
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
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: number } };
    expect(json.error?.code).toBe(-32700);
  });

  it("refuses to start in static-auth mode on a non-loopback bind without an API key", async () => {
    await expect(
      startHttpTransport(createMcpServer, {
        host: "0.0.0.0",
        port: 0,
        path: "/mcp",
        stateless: true,
        enableJsonResponse: true,
        staticAuth: true,
      })
    ).rejects.toThrow(/MCP_HTTP_API_KEY/);
  });

  describe("static auth with MCP_HTTP_API_KEY", () => {
    const API_KEY = "topsecret-key";
    const start = async () => {
      handle = await startHttpTransport(createMcpServer, {
        host: "127.0.0.1",
        port: 0,
        path: "/mcp",
        stateless: true,
        enableJsonResponse: true,
        staticAuth: true,
        apiKey: API_KEY,
      });
      return `http://127.0.0.1:${handle.address.port}`;
    };
    const post = (base: string, headers: Record<string, string>) =>
      fetch(`${base}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
        body: INIT_BODY,
      });

    it("answers 401 with a challenge when no key is presented", async () => {
      const base = await start();
      const res = await post(base, {});
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("Bearer realm=");
      // No `resource_metadata`: there is no OAuth server to discover in this mode.
      expect(res.headers.get("www-authenticate")).not.toContain("resource_metadata");
      const json = (await res.json()) as { error?: { code?: number; message?: string } };
      expect(json.error?.code).toBe(-32001);
      expect(json.error?.message).toContain("MCP_HTTP_API_KEY");
    });

    it("answers 401 on a wrong key, via either header", async () => {
      const base = await start();
      expect((await post(base, { Authorization: "Bearer wrong" })).status).toBe(401);
      expect((await post(base, { "X-Api-Key": "wrong" })).status).toBe(401);
      expect((await post(base, { Authorization: `Bearer ${API_KEY}x` })).status).toBe(401);
    });

    it("serves the MCP endpoint with `Authorization: Bearer <key>`", async () => {
      const base = await start();
      const res = await post(base, { Authorization: `Bearer ${API_KEY}` });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { result?: { serverInfo?: { name?: string } } };
      expect(json.result?.serverInfo?.name).toBe("boondmanager-mcp-server");
    });

    it("serves the MCP endpoint with `X-Api-Key: <key>`", async () => {
      const base = await start();
      const res = await post(base, { "X-Api-Key": API_KEY });
      expect(res.status).toBe(200);
    });

    it("keeps /healthz unauthenticated", async () => {
      const base = await start();
      const res = await fetch(`${base}/healthz`);
      expect(res.status).toBe(200);
    });

    it("does not serve the OAuth discovery document in static-auth mode", async () => {
      const base = await start();
      const res = await fetch(`${base}/.well-known/oauth-protected-resource`);
      expect(res.status).toBe(404);
    });
  });

  describe("session ownership (#232)", () => {
    const TOKEN_A = { Authorization: "Bearer token-A" };
    const TOKEN_B = { Authorization: "Bearer token-B" };
    const PING = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" });
    const jsonHeaders = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

    async function openSession(): Promise<{ base: string; sessionId: string }> {
      handle = await startHttpTransport(createMcpServer, {
        host: "127.0.0.1",
        port: 0,
        path: "/mcp",
        stateless: false,
        enableJsonResponse: true,
        sessionTtlMs: 60_000,
        sessionSweepIntervalMs: 60_000,
      });
      const base = `http://127.0.0.1:${handle.address.port}`;
      const init = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { ...jsonHeaders, ...TOKEN_A },
        body: INIT_BODY,
      });
      expect(init.status).toBe(200);
      await init.text();
      const sessionId = init.headers.get("mcp-session-id");
      expect(sessionId).toBeTruthy();
      return { base, sessionId: sessionId! };
    }

    it("answers 404 to a POST on the session with another Bearer, exactly like an unknown session", async () => {
      const { base, sessionId } = await openSession();
      const asB = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { ...jsonHeaders, ...TOKEN_B, "Mcp-Session-Id": sessionId },
        body: PING,
      });
      expect(asB.status).toBe(404);
      const jsonB = (await asB.json()) as { error?: { code?: number; message?: string } };

      const unknown = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { ...jsonHeaders, ...TOKEN_B, "Mcp-Session-Id": "00000000-0000-4000-8000-000000000000" },
        body: PING,
      });
      expect(unknown.status).toBe(404);
      const jsonUnknown = (await unknown.json()) as { error?: { code?: number; message?: string } };
      // Same status, same body: the probe cannot tell "exists, not yours" from "does not exist".
      expect(jsonB).toEqual(jsonUnknown);
      expect(jsonB.error?.code).toBe(-32001);

      // The owner is unaffected.
      const asA = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { ...jsonHeaders, ...TOKEN_A, "Mcp-Session-Id": sessionId },
        body: PING,
      });
      expect(asA.status).toBe(200);
      expect(handle!.sessionCount()).toBe(1);
    });

    it("refuses another Bearer's GET (SSE stream) and DELETE on the session", async () => {
      const { base, sessionId } = await openSession();
      const getAsB = await fetch(`${base}/mcp`, {
        method: "GET",
        headers: { Accept: "text/event-stream", ...TOKEN_B, "Mcp-Session-Id": sessionId },
      });
      expect(getAsB.status).toBe(404);
      const delAsB = await fetch(`${base}/mcp`, {
        method: "DELETE",
        headers: { ...TOKEN_B, "Mcp-Session-Id": sessionId },
      });
      expect(delAsB.status).toBe(404);
      expect(handle!.sessionCount()).toBe(1);

      const delAsA = await fetch(`${base}/mcp`, {
        method: "DELETE",
        headers: { ...TOKEN_A, "Mcp-Session-Id": sessionId },
      });
      expect(delAsA.status).toBe(200);
      expect(handle!.sessionCount()).toBe(0);
    });

    it("still lets a POST initialize carrying a stale session id open a new session", async () => {
      const { base } = await openSession();
      const init = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { ...jsonHeaders, ...TOKEN_B, "Mcp-Session-Id": "00000000-0000-4000-8000-000000000000" },
        body: INIT_BODY,
      });
      expect(init.status).toBe(200);
      await init.text();
      expect(handle!.sessionCount()).toBe(2);
    });
  });

  describe("unknown or expired session ids (#233)", () => {
    const PING = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" });
    const jsonHeaders = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

    it("answers 404 / -32001 on a session reaped by the TTL sweep, for POST and GET, and lets initialize reopen one", async () => {
      handle = await startHttpTransport(createMcpServer, {
        host: "127.0.0.1",
        port: 0,
        path: "/mcp",
        stateless: false,
        enableJsonResponse: true,
        // Same budget as the sweep test above: wide enough that `initialize`
        // itself cannot age the session past the TTL under load.
        sessionTtlMs: 1_000,
        sessionSweepIntervalMs: 60_000,
      });
      const base = `http://127.0.0.1:${handle.address.port}`;
      const init = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { ...jsonHeaders, ...AUTH_HEADER },
        body: INIT_BODY,
      });
      expect(init.status).toBe(200);
      await init.text();
      const sessionId = init.headers.get("mcp-session-id")!;
      expect(sessionId).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, 1_100));
      expect(await handle.sweepIdleSessions()).toBe(1);

      // The Streamable HTTP spec reserves 404 for "this session is gone,
      // re-initialize"; a 400 reads as a malformed request and makes a client
      // give up instead of reconnecting.
      const post = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { ...jsonHeaders, ...AUTH_HEADER, "Mcp-Session-Id": sessionId },
        body: PING,
      });
      expect(post.status).toBe(404);
      const postJson = (await post.json()) as { error?: { code?: number; message?: string } };
      expect(postJson.error?.code).toBe(-32001);
      expect(postJson.error?.message).toBe("Session not found");

      const get = await fetch(`${base}/mcp`, {
        method: "GET",
        headers: { Accept: "text/event-stream", ...AUTH_HEADER, "Mcp-Session-Id": sessionId },
      });
      expect(get.status).toBe(404);
      await get.text();

      const del = await fetch(`${base}/mcp`, {
        method: "DELETE",
        headers: { ...AUTH_HEADER, "Mcp-Session-Id": sessionId },
      });
      expect(del.status).toBe(404);
      await del.text();

      // What the 404 is for: the client re-initializes, stale id and all.
      const reinit = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { ...jsonHeaders, ...AUTH_HEADER, "Mcp-Session-Id": sessionId },
        body: INIT_BODY,
      });
      expect(reinit.status).toBe(200);
      await reinit.text();
      expect(reinit.headers.get("mcp-session-id")).toBeTruthy();
      expect(reinit.headers.get("mcp-session-id")).not.toBe(sessionId);
      expect(handle.sessionCount()).toBe(1);
    });

    it("keeps 400 for a request that names no session and is not an initialize", async () => {
      handle = await startHttpTransport(createMcpServer, {
        host: "127.0.0.1",
        port: 0,
        path: "/mcp",
        stateless: false,
        enableJsonResponse: true,
      });
      const base = `http://127.0.0.1:${handle.address.port}`;
      // No id at all: nothing to look up, so this is a malformed request, not
      // a vanished session — 400 is the right answer and must not become 404.
      const post = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { ...jsonHeaders, ...AUTH_HEADER },
        body: PING,
      });
      expect(post.status).toBe(400);
      await post.text();
      const get = await fetch(`${base}/mcp`, {
        method: "GET",
        headers: { Accept: "text/event-stream", ...AUTH_HEADER },
      });
      expect(get.status).toBe(400);
      await get.text();
    });
  });

  describe("shutdown and socket timeouts (#237)", () => {
    it("applies the resolved timeouts to the Node server", async () => {
      handle = await startHttpTransport(createMcpServer, {
        host: "127.0.0.1",
        port: 0,
        path: "/mcp",
        stateless: true,
        enableJsonResponse: true,
        keepAliveTimeoutMs: 70_000,
        headersTimeoutMs: 60_000, // below keep-alive → coerced to 71 000
        requestTimeoutMs: 120_000,
      });
      expect(handle.server.keepAliveTimeout).toBe(70_000);
      expect(handle.server.headersTimeout).toBe(71_000);
      expect(handle.server.requestTimeout).toBe(120_000);
    });

    it("applies the defaults when nothing is configured", async () => {
      handle = await startHttpTransport(createMcpServer, {
        host: "127.0.0.1",
        port: 0,
        path: "/mcp",
        stateless: true,
        enableJsonResponse: true,
      });
      expect(handle.server.keepAliveTimeout).toBe(DEFAULT_KEEP_ALIVE_TIMEOUT_MS);
      expect(handle.server.headersTimeout).toBe(DEFAULT_HEADERS_TIMEOUT_MS);
      expect(handle.server.requestTimeout).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    });

    it("close() is idempotent: a second call resolves instead of failing on a closed server", async () => {
      handle = await startHttpTransport(createMcpServer, {
        host: "127.0.0.1",
        port: 0,
        path: "/mcp",
        stateless: true,
        enableJsonResponse: true,
      });
      const first = handle.close();
      const second = handle.close();
      // Same in-flight shutdown, not a new one — and no ERR_SERVER_NOT_RUNNING.
      expect(second).toBe(first);
      await expect(first).resolves.toBeUndefined();
      await expect(handle.close()).resolves.toBeUndefined();
      expect(handle.server.listening).toBe(false);
    });

    it("destroys a connection still open after the grace period instead of hanging", async () => {
      handle = await startHttpTransport(createMcpServer, {
        host: "127.0.0.1",
        port: 0,
        path: "/mcp",
        stateless: true,
        enableJsonResponse: true,
        shutdownTimeoutMs: 300,
      });
      // A request whose *headers* never complete: the parser has started a
      // message, so Node's own close() does not treat the socket as idle, and
      // nothing ends it before headersTimeout (66 s) — only the grace-period
      // destroy can. (A request stalled mid-*body* is reset by close() itself.)
      const socket = netConnect(handle.address.port, "127.0.0.1");
      await new Promise<void>((resolve) => socket.once("connect", resolve));
      socket.on("error", () => undefined);
      socket.write("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\n");
      await new Promise((resolve) => setTimeout(resolve, 50));
      const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
      const closeAll = vi.spyOn(handle.server, "closeAllConnections");

      const started = Date.now();
      await handle.close();
      const elapsed = Date.now() - started;
      await closed;
      expect(closeAll).toHaveBeenCalledTimes(1);
      expect(elapsed).toBeGreaterThanOrEqual(250);
      expect(elapsed).toBeLessThan(5_000);
      expect(handle.server.listening).toBe(false);
    });

    it("closes promptly when only idle keep-alive connections remain", async () => {
      handle = await startHttpTransport(createMcpServer, {
        host: "127.0.0.1",
        port: 0,
        path: "/mcp",
        stateless: true,
        enableJsonResponse: true,
        shutdownTimeoutMs: 5_000,
      });
      // A completed request on a keep-alive connection: without
      // closeIdleConnections() the 65 s keep-alive would hold close() open.
      const res = await fetch(`http://127.0.0.1:${handle.address.port}/healthz`, { keepalive: true });
      expect(res.status).toBe(200);
      await res.text();
      const started = Date.now();
      await handle.close();
      expect(Date.now() - started).toBeLessThan(2_000);
    });
  });

  it("rejects new sessions with 503 once the session cap is reached", async () => {
    handle = await startHttpTransport(createMcpServer, {
      host: "127.0.0.1",
      port: 0,
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
      port: 0,
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
