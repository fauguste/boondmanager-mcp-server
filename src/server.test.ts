import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createMcpServer, REGISTERED_DOMAINS, SERVER_NAME, SERVER_VERSION } from "./server.js";

describe("createMcpServer", () => {
  it("returns an McpServer instance with the expected name", () => {
    const server = createMcpServer();
    expect(server).toBeDefined();
    expect(SERVER_NAME).toBe("boondmanager-mcp-server");
  });

  it("exposes a non-empty list of registered domains", () => {
    expect(REGISTERED_DOMAINS.length).toBeGreaterThan(30);
    expect(REGISTERED_DOMAINS).toContain("candidates");
    expect(REGISTERED_DOMAINS).toContain("resources");
    expect(REGISTERED_DOMAINS).toContain("application");
    expect(REGISTERED_DOMAINS).toContain("reporting");
  });

  it("can be instantiated multiple times without throwing", () => {
    expect(() => createMcpServer()).not.toThrow();
    expect(() => createMcpServer()).not.toThrow();
  });
});

describe("SERVER_VERSION", () => {
  it("matches the package.json version", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(here, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    expect(SERVER_VERSION).toBe(pkg.version);
  });

  it("is not the legacy hardcoded placeholder", () => {
    expect(SERVER_VERSION).not.toBe("1.0.0");
    expect(SERVER_VERSION).not.toBe("0.0.0-unknown");
  });
});
