import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * The two packaged install channels — the MCPB extension for Claude Desktop
 * (`manifest.json`) and the Claude Code plugin
 * (`plugins/boondmanager-mcp/…`) — expose the *same* configuration surface
 * through two different manifest formats.
 *
 * `manifest.json` is the source of truth and the plugin files are generated from
 * it by `scripts/generate-plugin-manifest.mjs`, with `npm run plugin:manifest:check`
 * failing CI on drift. These tests are the fast local net under that: they pin
 * the properties a reader would otherwise have to trust the generator for, and
 * two claims about `manifest.json` itself that no generator can check —
 * which options are secrets, and that the npm pin tracks the release version.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p: string[]) => JSON.parse(readFileSync(join(REPO_ROOT, ...p), "utf8"));

const pkg = read("package.json");
const manifest = read("manifest.json");
const marketplace = read(".claude-plugin", "marketplace.json");
const plugin = read("plugins", "boondmanager-mcp", ".claude-plugin", "plugin.json");
const mcpConfig = read("plugins", "boondmanager-mcp", ".mcp.json");

const PLUGIN_NAME = "boondmanager-mcp";
const MCP_SERVER_NAME = "boondmanager";
const server = mcpConfig.mcpServers[MCP_SERVER_NAME];

/**
 * The five options that must reach the OS keychain rather than `settings.json`.
 * Keychain storage is shared with Claude Code's OAuth tokens under a ~2 KB
 * budget, so `sensitive` is spent only on real secrets — marking the access
 * restrictions sensitive too would burn the budget for no gain.
 */
const SECRET_OPTIONS = ["user_token", "client_token", "client_key", "api_token", "password"];

describe("user config parity between the MCPB manifest and the Claude Code plugin", () => {
  it("declares the same option keys in both manifests", () => {
    expect(Object.keys(plugin.userConfig)).toEqual(Object.keys(manifest.user_config));
  });

  it("declares every option the env map references, and references every option declared", () => {
    const referenced = Object.values(server.env as Record<string, string>).map(
      (v) => /^\$\{user_config\.([A-Za-z0-9_]+)\}$/.exec(v)?.[1]
    );
    expect(referenced).not.toContain(undefined);
    expect([...referenced].sort()).toEqual(Object.keys(plugin.userConfig).sort());
  });

  it("maps each option to the same BOOND_* env var as the MCPB manifest", () => {
    expect(server.env).toEqual(manifest.server.mcp_config.env);
  });

  it("gives every option the title and description the plugin schema requires", () => {
    for (const [key, spec] of Object.entries(plugin.userConfig) as [string, Record<string, unknown>][]) {
      expect(typeof spec.title, key).toBe("string");
      expect(typeof spec.description, key).toBe("string");
      expect((spec.title as string).length, key).toBeGreaterThan(0);
      expect((spec.description as string).length, key).toBeGreaterThan(0);
    }
  });

  it("marks exactly the five credential options as sensitive, in both manifests", () => {
    const sensitive = (config: Record<string, { sensitive?: boolean }>) =>
      Object.entries(config)
        .filter(([, spec]) => spec.sensitive === true)
        .map(([key]) => key)
        .sort();
    expect(sensitive(plugin.userConfig)).toEqual([...SECRET_OPTIONS].sort());
    expect(sensitive(manifest.user_config)).toEqual([...SECRET_OPTIONS].sort());
  });

  /**
   * Both booleans reach the server as a *string*, and both must be safe when
   * that string is `"false"` or empty. An explicit `default` is what guarantees
   * the value exists at all; the interpretation is pinned in
   * `access-policy.test.ts` (read-only) and `env-flags.test.ts` (confirmations).
   */
  it("gives every boolean option an explicit default", () => {
    for (const [key, spec] of Object.entries(plugin.userConfig) as [string, Record<string, unknown>][]) {
      if (spec.type === "boolean") expect(typeof spec.default, key).toBe("boolean");
    }
  });
});

describe("Claude Code plugin launch configuration", () => {
  it("runs the published npm package pinned to this exact version", () => {
    expect(server.command).toBe("npx");
    expect(server.args).toEqual(["-y", `${pkg.name}@${pkg.version}`]);
  });

  it("keeps every version copy in step with package.json", () => {
    expect(manifest.version).toBe(pkg.version);
    expect(plugin.version).toBe(pkg.version);
    expect(marketplace.plugins.find((p: { name: string }) => p.name === PLUGIN_NAME).version).toBe(pkg.version);
  });

  it("names the MCP server `boondmanager` (tools surface as mcp__boondmanager__boond_*)", () => {
    expect(Object.keys(mcpConfig.mcpServers)).toEqual([MCP_SERVER_NAME]);
  });

  // stdio only: the HTTP transport's OAuth model is for gateways and remote
  // deployments, and would need a token this form has no way to obtain.
  it("declares no transport, so the plugin runs the server over stdio", () => {
    expect(server.type).toBeUndefined();
    expect(server.url).toBeUndefined();
  });
});

describe("marketplace manifest", () => {
  it("points at the in-repo plugin directory with a ./-relative source", () => {
    const entry = marketplace.plugins.find((p: { name: string }) => p.name === PLUGIN_NAME);
    expect(entry.source).toBe(`./plugins/${PLUGIN_NAME}`);
  });

  // Claude Code re-checks the reserved-name list on *every* marketplace load,
  // not just at `/plugin marketplace add`, so a name that drifts into the
  // reserved set silently stops loading for every existing user.
  it("uses a marketplace name that cannot read as an official Anthropic source", () => {
    expect(marketplace.name).toBe("boondmanager");
    expect(marketplace.name).not.toMatch(/anthropic|claude|official|first-party/);
  });

  it("has an owner with a name", () => {
    expect(typeof marketplace.owner?.name).toBe("string");
    expect(marketplace.owner.name.length).toBeGreaterThan(0);
  });
});
