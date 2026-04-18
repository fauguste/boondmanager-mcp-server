#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initClient } from "./services/boond-client.js";
import { createMcpServer, REGISTERED_DOMAINS } from "./server.js";
import { resolveHttpOptions, startHttpTransport } from "./transports/http.js";

type TransportKind = "stdio" | "http";

function resolveTransport(): TransportKind {
  const raw = (process.env["MCP_TRANSPORT"] ?? "").toLowerCase().trim();
  if (raw === "http" || raw === "streamable-http" || raw === "streamablehttp") return "http";
  return "stdio";
}

async function main(): Promise<void> {
  try {
    initClient();
  } catch (error) {
    console.error("⚠️  Configuration warning:", (error as Error).message);
    console.error("The server will start but API calls will fail without proper credentials.");
  }

  const kind = resolveTransport();

  if (kind === "http") {
    const options = resolveHttpOptions();
    const handle = await startHttpTransport(createMcpServer, options);
    console.error("🚀 BoondManager MCP Server running (streamable HTTP transport)");
    console.error(`📡 Endpoint: http://${handle.address.host}:${handle.address.port}${handle.address.path}`);
    console.error(`🔑 Mode: ${options.stateless ? "stateless" : "stateful"}${options.bearerToken ? " (bearer auth)" : ""}`);
    console.error(`📦 Domains: ${REGISTERED_DOMAINS.join(", ")}`);

    const shutdown = async (signal: string): Promise<void> => {
      console.error(`\n🛑 Received ${signal}, shutting down...`);
      await handle.close();
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    return;
  }

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🚀 BoondManager MCP Server running (stdio transport)");
  console.error(`📦 Domains: ${REGISTERED_DOMAINS.join(", ")}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
