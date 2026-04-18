import { describe, it, expect } from "vitest";
import { createMcpServer, REGISTERED_DOMAINS, SERVER_NAME } from "./server.js";

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
