import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createMcpServer,
  registerAll,
  TOOL_REGISTRARS,
  REGISTERED_DOMAINS,
  SERVER_NAME,
  SERVER_VERSION,
  SERVER_DESCRIPTION,
} from "./server.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
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

describe("SERVER_DESCRIPTION", () => {
  it("matches the package.json description (single source of truth)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(here, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { description: string };
    expect(SERVER_DESCRIPTION).toBe(pkg.description);
    expect(SERVER_DESCRIPTION.length).toBeGreaterThan(0);
  });
});

describe("package.json manifest degradation", () => {
  /**
   * Both identity constants are computed at module-evaluation time, so a
   * malformed `package.json` must degrade to a placeholder rather than throw an
   * import-time TypeError (which would mean the server never starts, with an
   * opaque stack). `JSON.parse` returning a *valid* non-object — `null` is the
   * one that bites — is the case a try/catch around the parse alone misses.
   */
  async function importServerWithPackageJson(contents: string) {
    vi.resetModules();
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        readFileSync: (path: Parameters<typeof readFileSync>[0], ...rest: unknown[]) =>
          String(path).endsWith("package.json")
            ? contents
            : (actual.readFileSync as (...a: unknown[]) => unknown)(path, ...rest),
      };
    });
    try {
      // `vi.resetModules()` above drops the statically imported copy, so this
      // re-evaluates `server.ts` against the mocked fs.
      return await import("./server.js");
    } finally {
      vi.doUnmock("node:fs");
      vi.resetModules();
    }
  }

  it.each([
    ["a file that parses to null", "null"],
    ["a file that parses to a scalar", '"2.0.0"'],
    ["a truncated file", '{"version": "2.'],
  ])("falls back to placeholders for %s", async (_label, contents) => {
    const mod = (await importServerWithPackageJson(contents)) as {
      SERVER_VERSION: string;
      SERVER_DESCRIPTION: string;
    };
    expect(mod.SERVER_VERSION).toBe("0.0.0-unknown");
    expect(mod.SERVER_DESCRIPTION).toBe("MCP server for the BoondManager API (ERP/CRM)");
  });
});

describe("SERVER_INSTRUCTIONS", () => {
  it("is a non-empty string", () => {
    expect(typeof SERVER_INSTRUCTIONS).toBe("string");
    expect(SERVER_INSTRUCTIONS.trim().length).toBeGreaterThan(0);
  });

  it("states the cross-cutting rules the tool descriptions no longer repeat", () => {
    // Perimeter filters: the most common source of silently-wrong searches.
    expect(SERVER_INSTRUCTIONS).toContain("perimeterDynamic");
    expect(SERVER_INSTRUCTIONS).toContain("perimeterManagers");
    expect(SERVER_INSTRUCTIONS).toContain("perimeterAgencies");
    expect(SERVER_INSTRUCTIONS).toContain("narrowPerimeter");
    // The rejected legacy names must be called out explicitly.
    expect(SERVER_INSTRUCTIONS).toContain("mainManagers");
    // Dictionary resolution via resources rather than an extra tool call.
    expect(SERVER_INSTRUCTIONS).toContain("boond://dictionary");
    // Naming convention + token-economy knobs.
    expect(SERVER_INSTRUCTIONS).toContain("boond_{domaine}_{opération}");
    expect(SERVER_INSTRUCTIONS).toContain("pageSize");
    expect(SERVER_INSTRUCTIONS).toContain("fields");
    // keywords prefix syntax.
    for (const prefix of ["CSOC", "CCON", "CAND", "COMP", "AO", "PRJ", "MIS", "PROD", "CTR"]) {
      expect(SERVER_INSTRUCTIONS).toContain(prefix);
    }
  });
});

describe("MCP initialize result", () => {
  it("advertises instructions, name, version and description to a connected client", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer();
    const client = new Client({ name: "vitest", version: "1.0.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
      const info = client.getServerVersion();
      expect(info?.name).toBe(SERVER_NAME);
      expect(info?.version).toBe(SERVER_VERSION);
      expect(info?.description).toBe(SERVER_DESCRIPTION);
    } finally {
      await client.close();
      await server.close();
    }
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
