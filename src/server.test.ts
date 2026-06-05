import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createMcpServer,
  registerAll,
  TOOL_REGISTRARS,
  REGISTERED_DOMAINS,
  SERVER_NAME,
  SERVER_VERSION,
} from "./server.js";
import { resolveAccessPolicy } from "./config/access-policy.js";

/** Counting stub that records every registration call. */
function createCountingServer() {
  return {
    registerTool: vi.fn(),
    registerPrompt: vi.fn(),
    registerResource: vi.fn(),
  } as unknown as McpServer;
}

function fakeEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv;
}

function registeredToolNames(server: McpServer): string[] {
  return vi.mocked(server.registerTool).mock.calls.map((c) => c[0] as string);
}

function registeredPromptNames(server: McpServer): string[] {
  return vi.mocked(server.registerPrompt).mock.calls.map((c) => c[0] as string);
}

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

describe("TOOL_REGISTRARS", () => {
  it("lists the same domains, in the same order, as REGISTERED_DOMAINS", () => {
    expect(TOOL_REGISTRARS.map(([d]) => d)).toEqual([...REGISTERED_DOMAINS]);
  });
});

describe("registerAll — access policy filtering", () => {
  it("unrestricted policy registers the full surface (writes + all domains + prompts)", () => {
    const s = createCountingServer();
    registerAll(s, resolveAccessPolicy(fakeEnv({})));
    const tools = registeredToolNames(s);
    expect(tools.length).toBeGreaterThan(150);
    // A spread of domains is present.
    expect(tools).toContain("boond_candidates_create");
    expect(tools).toContain("boond_invoices_search");
    expect(tools).toContain("boond_provider_invoices_search");
    // Prompts and resources too.
    expect(registeredPromptNames(s).length).toBeGreaterThanOrEqual(11);
    expect(vi.mocked(s.registerResource).mock.calls.length).toBeGreaterThan(0);
  });

  it("domain allow-list exposes only the listed domains (no false positives on multi-word domains)", () => {
    const s = createCountingServer();
    registerAll(s, resolveAccessPolicy(fakeEnv({ BOOND_MCP_DOMAINS: "invoices,application" })));
    const tools = registeredToolNames(s);
    expect(tools.length).toBeGreaterThan(0);
    for (const name of tools) {
      // Allowed surface: the two listed domains, plus the workflow mirrors
      // (gated by their source prompt's domains, which are ⊆ {invoices, application}).
      expect(
        name.startsWith("boond_invoices_") ||
          name.startsWith("boond_application_") ||
          name.startsWith("boond_workflow_")
      ).toBe(true);
    }
    // `provider-invoices` must NOT leak in just because it shares the `invoices` substring.
    expect(tools.some((n) => n.startsWith("boond_provider_invoices_"))).toBe(false);
  });

  it("domain deny-list removes exactly that domain", () => {
    const s = createCountingServer();
    registerAll(s, resolveAccessPolicy(fakeEnv({ BOOND_MCP_EXCLUDE_DOMAINS: "candidates" })));
    const tools = registeredToolNames(s);
    expect(tools.some((n) => n.startsWith("boond_candidates_"))).toBe(false);
    expect(tools).toContain("boond_invoices_search");
  });

  it("read-only policy registers zero write/delete tools across every domain", () => {
    const s = createCountingServer();
    registerAll(s, resolveAccessPolicy(fakeEnv({ BOOND_MCP_READ_ONLY: "true" })));
    const calls = vi.mocked(s.registerTool).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const annotations = (call[1] as { annotations?: { readOnlyHint?: boolean } }).annotations;
      expect(annotations?.readOnlyHint).toBe(true);
    }
  });

  it("operations=read,create,update keeps writes but drops deletes", () => {
    const s = createCountingServer();
    registerAll(s, resolveAccessPolicy(fakeEnv({ BOOND_MCP_OPERATIONS: "read,create,update" })));
    const calls = vi.mocked(s.registerTool).mock.calls;
    const hasDelete = calls.some(
      (c) => (c[1] as { annotations?: { destructiveHint?: boolean } }).annotations?.destructiveHint === true
    );
    const hasCreate = registeredToolNames(s).some((n) => n.endsWith("_create"));
    expect(hasDelete).toBe(false);
    expect(hasCreate).toBe(true);
  });

  it("cuts prompts whose domains are not fully allowed (cross-domain coherence)", () => {
    const s = createCountingServer();
    registerAll(s, resolveAccessPolicy(fakeEnv({ BOOND_MCP_DOMAINS: "invoices,application" })));
    const prompts = registeredPromptNames(s);
    // factures_a_relancer needs only invoices+application → kept.
    expect(prompts).toContain("factures_a_relancer");
    // synthese_equipe needs resources → cut.
    expect(prompts).not.toContain("synthese_equipe");
  });

  it("cuts the mirror workflow tool when its prompt's domain is filtered out", () => {
    const s = createCountingServer();
    registerAll(s, resolveAccessPolicy(fakeEnv({ BOOND_MCP_DOMAINS: "invoices,application" })));
    const tools = registeredToolNames(s);
    expect(tools).toContain("boond_workflow_factures_a_relancer");
    expect(tools).not.toContain("boond_workflow_synthese_equipe");
  });
});
