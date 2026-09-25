#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initClient, initClientWithAuth, oauthContextAuth, hasEnvCredentials } from "./services/boond-client.js";
import { createMcpServer, REGISTERED_DOMAINS } from "./server.js";
import { runUpdateNotification } from "./services/update-checker.js";
import { resolveHttpOptions, startHttpTransport } from "./transports/http.js";

type TransportKind = "stdio" | "http";

function resolveTransport(): TransportKind {
  const raw = (process.env["MCP_TRANSPORT"] ?? "").toLowerCase().trim();
  if (raw === "http" || raw === "streamable-http" || raw === "streamablehttp") return "http";
  return "stdio";
}

function readLocalPackageMeta(): { name: string; version: string } | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, "..", "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { name?: unknown; version?: unknown };
    if (typeof pkg.name !== "string" || typeof pkg.version !== "string") return null;
    return { name: pkg.name, version: pkg.version };
  } catch {
    return null;
  }
}

function scheduleUpdateCheck(): void {
  const meta = readLocalPackageMeta();
  if (!meta) return;
  void runUpdateNotification({ currentVersion: meta.version, packageName: meta.name });
}

function resolveStaticAuth(): boolean {
  const v = process.env["BOOND_HTTP_STATIC_AUTH"];
  if (!v || v.startsWith("${")) return false;
  return v.toLowerCase() === "true" || v === "1" || v.toLowerCase() === "yes";
}

async function main(): Promise<void> {
  const kind = resolveTransport();

  if (kind === "http") {
    const useStaticAuth = resolveStaticAuth();

    if (useStaticAuth) {
      // Static-auth mode: operator provides env credentials; no per-request
      // OAuth token needed from MCP clients (e.g. Hermes, CI pipelines,
      // single-tenant self-hosted deployments).
      if (!hasEnvCredentials()) {
        console.error(
          "⚠️  BOOND_HTTP_STATIC_AUTH is set but no credentials found. " +
            "Set BOOND_USER_TOKEN + BOOND_CLIENT_TOKEN + BOOND_CLIENT_KEY (or BOOND_API_TOKEN)."
        );
        process.exit(1);
      }
      try {
        initClient();
      } catch (error) {
        console.error("⚠️  Failed to initialise env-based credentials:", (error as Error).message);
        process.exit(1);
      }
    } else {
      // OAuth2 protected resource: each MCP request must carry its own Bearer.
      initClientWithAuth(oauthContextAuth);
    }

    const options = resolveHttpOptions();
    const handle = await startHttpTransport(createMcpServer, options);
    console.error("🚀 BoondManager MCP Server running (streamable HTTP transport)");
    console.error(`📡 Endpoint: http://${handle.address.host}:${handle.address.port}${handle.address.path}`);
    console.error(`🔑 Mode: ${options.stateless ? "stateless" : "stateful"}`);
    if (useStaticAuth) {
      console.error(
        options.apiKey
          ? "🔐 Boond auth: JWT statique (credentials env) — clients authentifiés par MCP_HTTP_API_KEY"
          : "🔐 Boond auth: JWT statique (credentials env) — ⚠️ aucune authentification client (bind loopback ou MCP_HTTP_INSECURE_STATIC_AUTH)"
      );
    } else {
      console.error("🔐 Boond auth: OAuth2 (per-request Bearer from MCP client)");
    }
    console.error(`📦 Domains: ${REGISTERED_DOMAINS.join(", ")}`);

    // Idempotent: a second signal (Docker sends SIGTERM, then the operator
    // hits Ctrl-C; Kubernetes retries) must not call close() on a closed
    // server and leave an unhandled rejection. The forced exit covers a
    // close() that never resolves (issue #237); handle.close() already
    // destroys lingering connections after `shutdownTimeoutMs`, so this only
    // fires if something else wedges.
    let shutdownStarted = false;
    const shutdown = (signal: string): void => {
      if (shutdownStarted) {
        console.error(`🛑 ${signal} received again — shutdown already in progress`);
        return;
      }
      shutdownStarted = true;
      console.error(`\n🛑 Received ${signal}, shutting down...`);
      const forceExit = setTimeout(
        () => {
          console.error("⏱️  Shutdown did not complete in time, exiting");
          process.exit(1);
        },
        (options.shutdownTimeoutMs ?? 10_000) + 2_000
      );
      forceExit.unref();
      handle.close().then(
        () => process.exit(0),
        (error: unknown) => {
          console.error("Shutdown error:", error instanceof Error ? error.message : error);
          process.exit(1);
        }
      );
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    scheduleUpdateCheck();
    return;
  }

  // stdio path: existing JWT / BasicAuth env vars (unchanged).
  try {
    initClient();
  } catch (error) {
    console.error("⚠️  Configuration warning:", (error as Error).message);
    console.error("The server will start but API calls will fail without proper credentials.");
  }

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🚀 BoondManager MCP Server running (stdio transport)");
  console.error(`📦 Domains: ${REGISTERED_DOMAINS.join(", ")}`);
  scheduleUpdateCheck();
}

main().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
