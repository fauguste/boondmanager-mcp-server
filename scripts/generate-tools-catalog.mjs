#!/usr/bin/env node
// Auto-generate TOOLS.md from the actual server registrations.
//
// Strategy: stub `registerTool` / `registerPrompt` / `registerResource` on a
// fake McpServer, run the same `register*` functions the real server runs,
// and snapshot what was registered. This way the catalog cannot drift from
// the code — if a tool is added/renamed/removed, regenerating the catalog
// reflects it on the next CI run, and `--check` fails the build if it was
// not regenerated.
//
// Usage:
//   node scripts/generate-tools-catalog.mjs           # writes TOOLS.md
//   node scripts/generate-tools-catalog.mjs --check   # fails if TOOLS.md is stale
//
// Requires `npm run build` first (we read the compiled output from dist/).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUTPUT_PATH = join(REPO_ROOT, "TOOLS.md");
const DIST_DIR = join(REPO_ROOT, "dist");

if (!existsSync(DIST_DIR)) {
  console.error(`ERROR: ${DIST_DIR} does not exist. Run \`npm run build\` first.`);
  process.exit(1);
}

// Import everything we need from the compiled output.
const tools = await import("../dist/tools/index.js");
const { registerAllPrompts } = await import("../dist/prompts/index.js");
const { registerAllResources } = await import("../dist/resources/index.js");
const { REGISTERED_DOMAINS } = await import("../dist/server.js");

// Domains that span more than one underscore segment (e.g. `business_units`).
// REGISTERED_DOMAINS uses dashes; tool names use underscores. Convert and
// keep only the multi-word ones — they need a longest-prefix match in
// `domainOf` so they're not chopped at the first underscore.
const MULTI_WORD_DOMAINS = REGISTERED_DOMAINS
  .map((d) => d.replace(/-/g, "_"))
  .filter((d) => d.includes("_"));

// ---- Capture all registrations against a stub McpServer ----------------

const captured = { tools: [], prompts: [], resources: [] };

const stub = {
  registerTool: (name, config /*, _cb */) => {
    captured.tools.push({ name, ...config });
  },
  registerPrompt: (name, config /*, _cb */) => {
    captured.prompts.push({ name, ...config });
  },
  registerResource: (name, uri, config /*, _cb */) => {
    captured.resources.push({ name, uri, ...config });
  },
};

// Mirror the order in src/server.ts so the captured set is identical to a
// real createMcpServer() boot.
const TOOL_REGISTRARS = [
  "registerCandidateTools", "registerResourceTools", "registerContactTools",
  "registerCompanyTools", "registerOpportunityTools", "registerActionTools",
  "registerTimesheetTools", "registerProjectTools", "registerInvoiceTools",
  "registerOrderTools", "registerDeliveryTools", "registerAbsenceTools",
  "registerExpenseTools", "registerProductTools", "registerPositioningTools",
  "registerPaymentTools", "registerAdvantageTools", "registerApplicationTools",
  "registerContractTools", "registerPurchaseTools", "registerProviderInvoiceTools",
  "registerAccountTools", "registerAgencyTools", "registerBusinessUnitTools",
  "registerRoleTools", "registerLogTools", "registerNotificationTools",
  "registerThreadTools", "registerTodolistTools", "registerFlagTools",
  "registerCalendarTools", "registerWebhookTools", "registerValidationTools",
  "registerPoleTools", "registerReportingTools", "registerPlanningAbsenceTools",
];

for (const fnName of TOOL_REGISTRARS) {
  const fn = tools[fnName];
  if (typeof fn !== "function") {
    console.error(`ERROR: ${fnName} is not exported from dist/tools/index.js`);
    process.exit(1);
  }
  fn(stub);
}
registerAllPrompts(stub);
registerAllResources(stub);

// ---- Helpers -----------------------------------------------------------

/** Domain bucket for a tool. Matches multi-word domains (e.g. `business_units`)
 *  before falling back to "first underscore segment". */
function domainOf(name) {
  if (!name.startsWith("boond_")) return "other";
  const rest = name.slice("boond_".length);
  for (const m of MULTI_WORD_DOMAINS) {
    if (rest === m || rest.startsWith(m + "_")) return m;
  }
  const idx = rest.indexOf("_");
  return idx === -1 ? rest : rest.slice(0, idx);
}

/** Compact one-line label of a tool's MCP annotations. */
function hintsLabel(annotations = {}) {
  const out = [];
  if (annotations.readOnlyHint) out.push("read");
  else if (annotations.destructiveHint) out.push("delete");
  else out.push("write");
  if (annotations.idempotentHint) out.push("idempotent");
  if (annotations.openWorldHint) out.push("open-world");
  return out.join(" · ");
}

/** Inspect a Zod raw shape and list arg keys, marking optionals with `?`. */
function describeArgs(argsSchema) {
  if (!argsSchema || typeof argsSchema !== "object") return "—";
  const entries = Object.entries(argsSchema);
  if (entries.length === 0) return "—";
  return entries
    .map(([k, v]) => {
      // Zod schemas expose isOptional() — duck-type check it.
      const optional = typeof v?.isOptional === "function" ? v.isOptional() : false;
      return `\`${k}${optional ? "?" : ""}\``;
    })
    .join(" ");
}

/** Escape characters that have special meaning inside a Markdown table cell.
 *  We escape `\` BEFORE `|` — otherwise an input like `a\|b` would become
 *  `a\\|b` which renders as `a\|b` (the `\` was meant literally). Doing the
 *  backslash pass first guarantees `a\|b` -> `a\\\|b`, rendered as `a\|b`. */
function md(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

// ---- Build the catalog -------------------------------------------------

const byDomain = new Map();
for (const t of captured.tools) {
  const d = domainOf(t.name);
  if (!byDomain.has(d)) byDomain.set(d, []);
  byDomain.get(d).push(t);
}
// Deterministic ordering: domains alphabetical, tools alphabetical within.
const domains = [...byDomain.keys()].sort();
for (const d of domains) {
  byDomain.get(d).sort((a, b) => a.name.localeCompare(b.name));
}

const lines = [];
lines.push("# Tool Catalogue");
lines.push("");
lines.push("> Auto-generated from the server registrations. Do not edit by hand.");
lines.push("> Regenerate with `npm run docs:tools` (CI fails if this file is stale).");
lines.push("");
lines.push(`**${captured.tools.length} tools** across **${domains.length} domains** · **${captured.prompts.length} prompts** · **${captured.resources.length} resources**.`);
lines.push("");
lines.push("Hint legend: `read` (readOnlyHint), `write` (creates/updates), `delete` (destructiveHint), `idempotent` (idempotentHint), `open-world` (openWorldHint, e.g. paginated keyword search).");
lines.push("");

lines.push("## Tools");
lines.push("");
for (const domain of domains) {
  const items = byDomain.get(domain);
  lines.push(`### ${domain} (${items.length})`);
  lines.push("");
  lines.push("| Tool | Title | Hints |");
  lines.push("|---|---|---|");
  for (const t of items) {
    lines.push(`| \`${t.name}\` | ${md(t.title)} | ${md(hintsLabel(t.annotations))} |`);
  }
  lines.push("");
}

lines.push(`## Prompts (${captured.prompts.length})`);
lines.push("");
lines.push("Pre-orchestrated workflows surfaced via the MCP prompts API.");
lines.push("");
lines.push("| Prompt | Title | Args |");
lines.push("|---|---|---|");
for (const p of [...captured.prompts].sort((a, b) => a.name.localeCompare(b.name))) {
  lines.push(`| \`${p.name}\` | ${md(p.title)} | ${describeArgs(p.argsSchema)} |`);
}
lines.push("");

lines.push(`## Resources (${captured.resources.length})`);
lines.push("");
lines.push("Reference data exposed as MCP resources.");
lines.push("");
lines.push("| URI | Title |");
lines.push("|---|---|");
for (const r of [...captured.resources].sort((a, b) => a.uri.localeCompare(b.uri))) {
  lines.push(`| \`${r.uri}\` | ${md(r.title)} |`);
}
lines.push("");

const generated = lines.join("\n");

// ---- Write or check ---------------------------------------------------

const checkMode = process.argv.includes("--check");
if (checkMode) {
  const existing = existsSync(OUTPUT_PATH) ? readFileSync(OUTPUT_PATH, "utf8") : "";
  // Normalise CRLF → LF on both sides so Windows checkouts don't false-fail.
  const norm = (s) => s.replace(/\r\n/g, "\n");
  if (norm(existing) !== norm(generated)) {
    console.error(`ERROR: ${OUTPUT_PATH} is out of date. Run \`npm run docs:tools\` and commit the result.`);
    process.exit(1);
  }
  console.log(`${OUTPUT_PATH} is up to date.`);
} else {
  writeFileSync(OUTPUT_PATH, generated);
  console.log(`Wrote ${OUTPUT_PATH} — ${captured.tools.length} tools, ${captured.prompts.length} prompts, ${captured.resources.length} resources.`);
}
