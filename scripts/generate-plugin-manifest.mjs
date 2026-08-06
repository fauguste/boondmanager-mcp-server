#!/usr/bin/env node
// Generate the Claude Code plugin files from `manifest.json` (the MCPB manifest).
//
// Why generated rather than hand-written: the plugin's `userConfig` block and
// the MCPB `user_config` block describe the same 14 options, and the plugin's
// `.mcp.json` env map is the same 14 `${user_config.*}` → `BOOND_*` pairs as
// `manifest.json::server.mcp_config.env`. Two hand-maintained copies diverge on
// the first option added — same failure mode TOOLS.md would have without its
// drift check. `manifest.json` is the source of truth (it is already validated
// in CI by `mcpb validate`), and this script owns every MCPB→plugin format
// difference so the generated files stay dumb data.
//
// Usage:
//   node scripts/generate-plugin-manifest.mjs           # writes the two files
//   node scripts/generate-plugin-manifest.mjs --check   # fails if they are stale
//
// No build step required: this reads JSON only.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

/** Plugin id. Public-facing: users type `/plugin install <PLUGIN_NAME>@<MARKETPLACE_NAME>`. */
const PLUGIN_NAME = "boondmanager-mcp";
/** Marketplace id, must match `.claude-plugin/marketplace.json::name`. */
const MARKETPLACE_NAME = "boondmanager";
/** Directory of the plugin inside this repo — matches the marketplace entry's relative `source`. */
const PLUGIN_DIR = join(REPO_ROOT, "plugins", PLUGIN_NAME);
/** MCP server id inside the plugin. Tools surface client-side as `mcp__boondmanager__boond_*`. */
const MCP_SERVER_NAME = "boondmanager";

const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));

// ---- MCPB → plugin format mapping -------------------------------------
//
// Every difference between the two formats is encoded here rather than in the
// generated files, so a future MCPB change surfaces as a generator change.

/**
 * `user_config` (MCPB, snake_case field) → `userConfig` (plugin, camelCase field).
 *
 * The per-option field names are identical in both specs (`type`, `title`,
 * `description`, `sensitive`, `required`, `default`, `multiple`, `min`, `max`),
 * so options are copied key by key through an explicit allow-list: an MCPB-only
 * field added later must be mapped deliberately, not leak into the plugin
 * manifest where `claude plugin validate` would warn about it.
 *
 * `title` and `description` are REQUIRED by the plugin schema (they are only
 * recommended by MCPB), so they are asserted rather than assumed.
 */
const OPTION_FIELDS = ["type", "title", "description", "sensitive", "required", "default", "multiple", "min", "max"];
const PLUGIN_OPTION_TYPES = ["string", "number", "boolean", "directory", "file"];

function buildUserConfig(userConfig) {
  const out = {};
  for (const [key, spec] of Object.entries(userConfig)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      fail(`user_config key "${key}" is not a valid identifier; the plugin schema requires one.`);
    }
    for (const required of ["title", "description"]) {
      if (typeof spec[required] !== "string" || spec[required].length === 0) {
        fail(`user_config.${key} has no \`${required}\`; the plugin schema requires it for every option.`);
      }
    }
    if (!PLUGIN_OPTION_TYPES.includes(spec.type)) {
      fail(`user_config.${key} has type "${spec.type}", not one of ${PLUGIN_OPTION_TYPES.join("/")}.`);
    }
    const unknown = Object.keys(spec).filter((f) => !OPTION_FIELDS.includes(f));
    if (unknown.length > 0) {
      fail(`user_config.${key} has field(s) ${unknown.join(", ")} with no mapping to the plugin schema. Map them in OPTION_FIELDS or drop them explicitly.`);
    }
    out[key] = Object.fromEntries(OPTION_FIELDS.filter((f) => f in spec).map((f) => [f, spec[f]]));
  }
  return out;
}

/**
 * `plugin.json`. Deliberately NOT ported from `manifest.json`:
 *
 * - `manifest_version` / `server` / `tools_generated` / `prompts_generated` /
 *   `compatibility` — MCPB-only, no plugin equivalent.
 * - `icons` — MCPB takes a bundled `icon.png`; the plugin manifest schema has
 *   no icon field. (The protocol-level icons from `src/icons.ts` are unaffected:
 *   they ride on `tools/list`, not on the plugin manifest.)
 * - `support` — no plugin equivalent; the issues URL is reachable from `homepage`.
 *
 * Format differences: `display_name` → `displayName`, and `repository` is an
 * object in MCPB but a plain URL string in the plugin schema.
 */
const pluginJson = {
  name: PLUGIN_NAME,
  displayName: manifest.display_name,
  // Pinned, not left to the commit SHA: `version` is what makes `/plugin
  // marketplace update` offer an update, and it must line up with the npm
  // version pinned in the `.mcp.json` args below.
  version: manifest.version,
  description: manifest.description,
  author: manifest.author,
  homepage: manifest.homepage,
  repository: manifest.repository.url,
  license: manifest.license,
  keywords: manifest.keywords,
  userConfig: buildUserConfig(manifest.user_config),
};

/**
 * `.mcp.json`. The env map is copied verbatim from
 * `manifest.json::server.mcp_config.env` — that copy IS the parity guarantee
 * between the two channels.
 *
 * The launch command differs on purpose. MCPB bundles `dist/` and runs
 * `node ${__dirname}/dist/index.js`; the plugin ships two small JSON files and
 * defers to the published npm package, pinned to this exact version so a
 * refreshed marketplace installs a known build rather than whatever `latest`
 * resolves to at that moment.
 */
const mcpJson = {
  mcpServers: {
    [MCP_SERVER_NAME]: {
      command: "npx",
      args: ["-y", `${pkg.name}@${manifest.version}`],
      env: { ...manifest.server.mcp_config.env },
    },
  },
};

// ---- Sanity checks on the result --------------------------------------

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

if (manifest.version !== pkg.version) {
  fail(`manifest.json version (${manifest.version}) != package.json version (${pkg.version}); fix the version drift first.`);
}

// Every `${user_config.X}` referenced by the env map must be a declared option,
// and every declared option must be referenced — an option nobody reads is a
// form field that does nothing, and a reference to an undeclared option
// substitutes to nothing at all.
const declared = new Set(Object.keys(pluginJson.userConfig));
const referenced = new Set();
for (const [envKey, value] of Object.entries(mcpJson.mcpServers[MCP_SERVER_NAME].env)) {
  const match = /^\$\{user_config\.([A-Za-z0-9_]+)\}$/.exec(value);
  if (!match) fail(`env ${envKey} is "${value}", not a bare \${user_config.KEY} reference.`);
  if (!declared.has(match[1])) fail(`env ${envKey} references undeclared option "${match[1]}".`);
  referenced.add(match[1]);
}
const orphans = [...declared].filter((k) => !referenced.has(k));
if (orphans.length > 0) fail(`user_config option(s) ${orphans.join(", ")} are never mapped to an env var.`);

// The marketplace entry has to agree with the plugin it points at. Checked here
// because the marketplace file is hand-written (one entry, three fields worth
// keeping honest) while these two files are generated.
const marketplacePath = join(REPO_ROOT, ".claude-plugin", "marketplace.json");
if (existsSync(marketplacePath)) {
  const marketplace = JSON.parse(readFileSync(marketplacePath, "utf8"));
  if (marketplace.name !== MARKETPLACE_NAME) {
    fail(`marketplace.json name is "${marketplace.name}", expected "${MARKETPLACE_NAME}".`);
  }
  const entry = marketplace.plugins?.find((p) => p.name === PLUGIN_NAME);
  if (!entry) fail(`marketplace.json has no plugin entry named "${PLUGIN_NAME}".`);
  if (entry.version !== manifest.version) {
    fail(`marketplace.json entry version (${entry.version}) != manifest.json version (${manifest.version}).`);
  }
  const expectedSource = `./plugins/${PLUGIN_NAME}`;
  if (entry.source !== expectedSource) {
    fail(`marketplace.json entry source is "${entry.source}", expected "${expectedSource}".`);
  }
}

// ---- Write or check ---------------------------------------------------

const outputs = [
  [join(PLUGIN_DIR, ".claude-plugin", "plugin.json"), pluginJson],
  [join(PLUGIN_DIR, ".mcp.json"), mcpJson],
];

const checkMode = process.argv.includes("--check");
let stale = false;

for (const [path, value] of outputs) {
  const generated = `${JSON.stringify(value, null, 2)}\n`;
  const rel = relative(REPO_ROOT, path);
  if (checkMode) {
    const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
    // Normalise CRLF → LF on both sides so Windows checkouts don't false-fail.
    if (existing.replace(/\r\n/g, "\n") !== generated) {
      console.error(`ERROR: ${rel} is out of date.`);
      stale = true;
    }
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, generated);
    console.log(`Wrote ${rel}`);
  }
}

if (checkMode) {
  if (stale) {
    console.error("Run `npm run plugin:manifest` and commit the result.");
    process.exit(1);
  }
  console.log(`Claude Code plugin files are up to date (v${manifest.version}, ${declared.size} options).`);
}
