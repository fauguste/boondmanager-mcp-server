#!/usr/bin/env node
// Read-only smoke test against a real BoondManager tenant, through the real
// server (dist/index.js over stdio). This is the only test in the repository
// that can catch the class of defect the unit tests cannot: an endpoint that
// silently ignores a filter (#247), a write model the RAML does not document
// (#179), a route that answers its app shell instead of JSON (#186).
//
// Everything here is a GET: `*_search` with `pageSize: 1`, one `*_get`,
// `current-user`, and a filter assertion (a `companyId` filter must reduce
// `meta.totals.rows`). It never creates, updates or deletes anything, so it is
// safe on a production tenant — but the CI workflow points it at a sandbox.
//
// Usage (credentials from the environment, same variables as the server):
//   BOOND_USER_TOKEN=… BOOND_CLIENT_TOKEN=… BOOND_CLIENT_KEY=… node scripts/smoke-live.mjs
//
// Exit code 1 on any failure; a summary table is printed either way.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, "..", "dist", "index.js");

if (!existsSync(ENTRY)) {
  console.error(`ERROR: ${ENTRY} does not exist. Run \`npm run build\` first.`);
  process.exit(1);
}
const hasJwt = process.env.BOOND_USER_TOKEN && process.env.BOOND_CLIENT_TOKEN && process.env.BOOND_CLIENT_KEY;
if (!hasJwt && !process.env.BOOND_API_TOKEN && !(process.env.BOOND_USER && process.env.BOOND_PASSWORD)) {
  console.error("ERROR: no BoondManager credentials in the environment (BOOND_USER_TOKEN + BOOND_CLIENT_TOKEN + BOOND_CLIENT_KEY).");
  process.exit(1);
}

const now = new Date();
const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
const firstOfMonth = `${month}-01`;
const today = now.toISOString().slice(0, 10);

const results = [];
function record(name, ok, note = "") {
  results.push({ name, ok, note });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? `  — ${note}` : ""}`);
}

function textOf(result) {
  return (result.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [ENTRY],
  env: { ...process.env, BOOND_DISABLE_UPDATE_CHECK: "1", LOG_LEVEL: process.env.LOG_LEVEL ?? "warn" },
  stderr: "inherit",
});
const client = new Client({ name: "smoke-live", version: "1.0.0" });
await client.connect(transport);

try {
  // 1. Authentication + identity.
  const me = await client.callTool({ name: "boond_application_current_user", arguments: {} });
  const meText = textOf(me);
  const meId = /"id":\s*"(\d+)"/.exec(meText)?.[1];
  record("boond_application_current_user", !me.isError && Boolean(meId), meId ? `id ${meId}` : meText.slice(0, 200));
  if (me.isError) throw new Error("current-user failed — credentials or base URL problem, nothing else can be asserted");

  // 2. One search per domain, pageSize: 1, required arguments filled from context.
  const { tools } = await client.listTools();
  const searches = tools.filter((t) => t.name.endsWith("_search") && !t.name.startsWith("boond_workflow_"));
  const firstIds = new Map(); // tool prefix → first item id, for the get step
  for (const tool of searches) {
    const props = tool.inputSchema?.properties ?? {};
    const required = tool.inputSchema?.required ?? [];
    const args = {};
    if ("pageSize" in props) args.pageSize = 1;
    if ("maxResults" in props) args.maxResults = 1;
    for (const key of required) {
      if (key === "startMonth" || key === "endMonth") args[key] = month;
      else if (key === "startDate") args[key] = firstOfMonth;
      else if (key === "endDate") args[key] = today;
      else if (key === "resourceId") args[key] = meId;
    }
    const missing = required.filter((k) => !(k in args));
    if (missing.length) {
      record(tool.name, true, `skipped (required: ${missing.join(", ")})`);
      continue;
    }
    const res = await client.callTool({ name: tool.name, arguments: args });
    const text = textOf(res);
    const ok = !res.isError;
    record(tool.name, ok, ok ? text.split("\n")[0].slice(0, 100) : text.slice(0, 200));
    const first = res.structuredContent?.items?.[0]?.id;
    if (first) firstIds.set(tool.name.replace(/_search$/, ""), String(first));
  }

  // 3. A detail read on the first search hit.
  const getTarget = ["boond_companies", "boond_resources", "boond_projects"].find((p) => firstIds.has(p));
  if (getTarget) {
    const id = firstIds.get(getTarget);
    const res = await client.callTool({ name: `${getTarget}_get`, arguments: { id } });
    record(`${getTarget}_get`, !res.isError, `id ${id}`);
  } else {
    record("*_get", false, "no search returned an id to read");
  }

  // 4. Filter assertions: a linked-entity filter must reduce the total (#247).
  // The server rewrites `companyId` into `keywords=CSOC<id>`; if BoondManager
  // ignored the filter the total would equal the unfiltered baseline.
  const companyId = firstIds.get("boond_companies");
  if (companyId) {
    for (const tool of ["boond_invoices_search", "boond_orders_search"]) {
      const baseline = await client.callTool({ name: tool, arguments: { pageSize: 1 } });
      const filtered = await client.callTool({ name: tool, arguments: { pageSize: 1, companyId } });
      const b = baseline.structuredContent?.total;
      const f = filtered.structuredContent?.total;
      if (typeof b !== "number" || typeof f !== "number") {
        record(`${tool} companyId filter`, false, `no total (baseline ${b}, filtered ${f})`);
      } else if (b <= 1) {
        record(`${tool} companyId filter`, true, `skipped: baseline total ${b} cannot show a reduction`);
      } else {
        record(`${tool} companyId filter`, f < b, `total ${b} → ${f} with companyId=${companyId}`);
      }
    }
  }
} catch (error) {
  record("smoke", false, error instanceof Error ? error.message : String(error));
} finally {
  await client.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  // Markdown table cell: escape backslashes first, then pipes (CodeQL js/incomplete-sanitization).
  const cell = (text) => text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
  const rows = results.map((r) => `| ${r.ok ? "✅" : "❌"} | \`${r.name}\` | ${cell(r.note)} |`);
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Smoke test (live BoondManager)\n\n${results.length - failed.length}/${results.length} passed\n\n| | Check | Note |\n|---|---|---|\n${rows.join("\n")}\n`,
  );
}
process.exit(failed.length ? 1 : 0);
