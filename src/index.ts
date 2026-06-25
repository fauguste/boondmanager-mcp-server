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
      console.error("🔐 Boond auth: JWT statique (credentials env, pas de Bearer requis par le client)");
    } else {
      console.error("🔐 Boond auth: OAuth2 (per-request Bearer from MCP client)");
    }
    console.error(`📦 Domains: ${REGISTERED_DOMAINS.join(", ")}`);

    const shutdown = async (signal: string): Promise<void> => {
      console.error(`\n🛑 Received ${signal}, shutting down...`);
      await handle.close();
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
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
