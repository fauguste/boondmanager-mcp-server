/**
 * BoondManager API monitor.
 *
 * The documentation index page (https://doc.boondmanager.com/api-externe/raml-build/)
 * is a JS-rendered console behind a WAF that returns 403 to non-browser
 * clients — scraping it never worked (the snapshot stayed at 0 endpoints).
 * The raw RAML files underneath it, however, are served statically and
 * answer 200 to plain HTTP clients:
 *
 *   resources/{domain}/{file}.raml   (domain dirs are camelCase: businessUnits, …)
 *   traits/{trait}.raml
 *
 * So instead of parsing HTML we probe a manifest of well-known RAML paths,
 * hash each file's content, and diff the (path → sha256) map against the
 * previous snapshot. Added = 404→200, removed = 200→404, modified = hash
 * changed. New domains are caught by probing EXTRA_DOMAINS (entities Boond
 * documents but this server does not cover yet).
 *
 * No npm dependencies on purpose: this job's token can open issues/PRs, so
 * the less third-party code it executes, the better.
 *
 * Outputs (same contract the workflow's later steps consume):
 *   .github/api-snapshot.json — only rewritten when content actually changed
 *   changes.json              — { isFirstRun } | { hasChanges, changes: {added, removed, modified} }
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const RAML_BASE = "https://doc.boondmanager.com/api-externe/raml-build";
const SNAPSHOT_FILE = ".github/api-snapshot.json";
const CHANGES_FILE = "changes.json";
const SNAPSHOT_FORMAT = 2;
const CONCURRENCY = 8;
const FETCH_TIMEOUT_MS = 20_000;

/**
 * Domain directories to probe, derived from the API_PATHS keys in
 * src/constants.ts (they are camelCase, which matches the RAML directory
 * naming exactly — e.g. `businessUnits`, `providerInvoices`).
 */
function readProjectDomains() {
  const source = readFileSync("src/constants.ts", "utf8");
  const block = source.match(/export const API_PATHS = \{([\s\S]*?)\} as const/);
  if (!block) throw new Error("API_PATHS block not found in src/constants.ts");
  const keys = [...block[1].matchAll(/^\s*([A-Za-z0-9]+):/gm)].map((m) => m[1]);
  if (keys.length === 0) throw new Error("No API_PATHS keys parsed from src/constants.ts");
  return keys;
}

/**
 * Entities documented by BoondManager that this server does not (fully)
 * cover yet — probing them is how we detect new API surface worth adding.
 */
const EXTRA_DOMAINS = [
  "apps",
  "alerts",
  "forms",
  "groupments",
  "inactivities",
  "subscriptions",
  "marketplace",
  "deliveries",
  "settings",
  "shares",
  "devices",
];

/** Well-known per-domain RAML file names (camelCase, as served). */
const FILE_CANDIDATES = [
  "search.raml",
  "default.raml",
  "information.raml",
  "actions.raml",
  "attachedFlags.raml",
  "tasks.raml",
  "rights.raml",
  "dictionary.raml",
  "currentUser.raml",
];

/** Shared trait definitions — filter/pagination changes land here. */
const TRAIT_PATHS = ["traits/searchable.raml", "traits/sortablePaginable.raml"];

function buildProbeList() {
  const domains = [...new Set([...readProjectDomains(), ...EXTRA_DOMAINS])];
  const paths = [];
  for (const domain of domains) {
    for (const file of FILE_CANDIDATES) {
      paths.push(`resources/${domain}/${file}`);
    }
  }
  paths.push(...TRAIT_PATHS);
  return paths;
}

/**
 * Fetch one RAML path. Returns:
 *   { path, sha256, bytes, description } on 200
 *   null on 404 (file simply doesn't exist)
 * Throws on network errors / other statuses (retried once by the caller).
 */
async function probePath(path) {
  const res = await fetch(`${RAML_BASE}/${path}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "*/*" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  const body = await res.text();
  const description = (body.match(/^description:\s*(.+)$/m)?.[1] ?? "").trim().slice(0, 120);
  return {
    path,
    sha256: createHash("sha256").update(body).digest("hex"),
    bytes: Buffer.byteLength(body),
    description,
  };
}

async function probeAll(paths) {
  const results = [];
  const failures = [];
  let cursor = 0;
  async function worker() {
    while (cursor < paths.length) {
      const path = paths[cursor++];
      try {
        let entry;
        try {
          entry = await probePath(path);
        } catch {
          // One retry — the WAF occasionally hiccups on burst traffic.
          await new Promise((r) => setTimeout(r, 1000));
          entry = await probePath(path);
        }
        if (entry) results.push(entry);
      } catch (err) {
        failures.push({ path, error: String(err?.message ?? err) });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  results.sort((a, b) => a.path.localeCompare(b.path));
  return { results, failures };
}

function compareSnapshots(current, previous) {
  // Treat legacy snapshots (HTML-scraper era: empty/errored) and format bumps
  // as a fresh baseline — diffing against them would report everything as new.
  if (
    !previous ||
    previous.formatVersion !== SNAPSHOT_FORMAT ||
    !Array.isArray(previous.endpoints) ||
    previous.endpoints.length === 0
  ) {
    return { isFirstRun: true, changes: { added: [], removed: [], modified: [] } };
  }

  const prevMap = new Map(previous.endpoints.map((e) => [e.path, e]));
  const currMap = new Map(current.endpoints.map((e) => [e.path, e]));
  const changes = { added: [], removed: [], modified: [] };

  for (const [path, entry] of currMap) {
    const prev = prevMap.get(path);
    if (!prev) changes.added.push({ name: path, path, description: entry.description });
    else if (prev.sha256 !== entry.sha256) {
      changes.modified.push({ old: prev, new: { name: path, path, description: entry.description } });
    }
  }
  for (const [path, entry] of prevMap) {
    if (!currMap.has(path)) changes.removed.push({ name: path, path, description: entry.description });
  }

  return {
    isFirstRun: false,
    changes,
    hasChanges: changes.added.length > 0 || changes.removed.length > 0 || changes.modified.length > 0,
  };
}

async function main() {
  const paths = buildProbeList();
  console.log(`📡 Probing ${paths.length} RAML paths under ${RAML_BASE} …`);
  const { results, failures } = await probeAll(paths);
  console.log(`✅ ${results.length} RAML files found, ${failures.length} probe failures`);

  const previous = existsSync(SNAPSHOT_FILE) ? JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8")) : null;

  // Network-level failures (not 404s) make "removed" diffs unreliable. If any
  // previously-known file failed to probe, skip the diff entirely rather than
  // opening a bogus "endpoints removed" issue.
  const knownPaths = new Set((previous?.endpoints ?? []).map((e) => e.path));
  const criticalFailures = failures.filter((f) => knownPaths.size === 0 || knownPaths.has(f.path));
  if (failures.length > 0 && (criticalFailures.length > 0 || results.length === 0)) {
    console.log(`::warning::${failures.length} probe failures — skipping diff this run`);
    for (const f of failures.slice(0, 10)) console.log(`  - ${f.path}: ${f.error}`);
    writeFileSync(
      CHANGES_FILE,
      JSON.stringify({ hasChanges: false, error: `${failures.length} probe failures`, note: "Will retry next run" }, null, 2)
    );
    return;
  }

  const current = {
    formatVersion: SNAPSHOT_FORMAT,
    timestamp: new Date().toISOString(),
    url: `${RAML_BASE}/`,
    endpointsCount: results.length,
    endpoints: results,
  };

  const comparison = compareSnapshots(current, previous);

  if (comparison.isFirstRun) {
    writeFileSync(SNAPSHOT_FILE, JSON.stringify(current, null, 2));
    writeFileSync(CHANGES_FILE, JSON.stringify({ isFirstRun: true }, null, 2));
    console.log("::notice::Baseline snapshot created");
    return;
  }

  if (comparison.hasChanges) {
    // Only rewrite the snapshot when content changed — the timestamp alone
    // must not trigger the weekly snapshot-update PR.
    writeFileSync(SNAPSHOT_FILE, JSON.stringify(current, null, 2));
    writeFileSync(CHANGES_FILE, JSON.stringify(comparison, null, 2));
    console.log("::warning::Changes detected in BoondManager API!");
    console.log(`  - Added: ${comparison.changes.added.length}`);
    console.log(`  - Removed: ${comparison.changes.removed.length}`);
    console.log(`  - Modified: ${comparison.changes.modified.length}`);
    return;
  }

  writeFileSync(CHANGES_FILE, JSON.stringify({ hasChanges: false }, null, 2));
  console.log("::notice::No changes detected");
}

main().catch((err) => {
  console.error("::error::API monitor failed:", err);
  process.exit(1);
});
