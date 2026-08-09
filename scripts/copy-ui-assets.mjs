#!/usr/bin/env node
// Copy the MCP Apps HTML assets into the compiled output.
//
// `tsc` only emits .js/.d.ts, so without this step `dist/ui/index.js` would
// resolve `./assets/reporting.html` to a path that does not exist and the
// server would start with no UI (it degrades, but silently — hence the
// `--check` mode used by CI and the assertion below that the asset is not
// empty).
//
// Keeping the asset a *file* rather than a template literal inside a .ts is
// what makes it editable as HTML (syntax highlighting, prettier, a browser can
// open it directly); the price is exactly this eight-line copy step.
//
// Usage:
//   node scripts/copy-ui-assets.mjs           # copy
//   node scripts/copy-ui-assets.mjs --check   # verify dist is in sync

import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(REPO_ROOT, "src", "ui", "assets");
const OUT_DIR = join(REPO_ROOT, "dist", "ui", "assets");

const checkMode = process.argv.includes("--check");

const assets = existsSync(SRC_DIR) ? readdirSync(SRC_DIR).filter((f) => f.endsWith(".html")) : [];
if (assets.length === 0) {
  console.error(`ERROR: no HTML asset found in ${SRC_DIR}`);
  process.exit(1);
}

if (!checkMode) mkdirSync(OUT_DIR, { recursive: true });

let stale = 0;
for (const name of assets) {
  const source = readFileSync(join(SRC_DIR, name), "utf8");
  if (source.trim().length === 0) {
    console.error(`ERROR: ${name} is empty`);
    process.exit(1);
  }
  const target = join(OUT_DIR, name);
  if (checkMode) {
    const current = existsSync(target) ? readFileSync(target, "utf8") : null;
    if (current !== source) {
      console.error(`ERROR: ${target} is missing or out of date. Run \`npm run build\`.`);
      stale++;
    }
  } else {
    writeFileSync(target, source);
  }
}

if (stale > 0) process.exit(1);
console.log(`${checkMode ? "Verified" : "Copied"} ${assets.length} UI asset(s) → dist/ui/assets/`);
