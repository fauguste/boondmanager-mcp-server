#!/usr/bin/env node
// Measure the byte size of the `tools/list` payload as a real MCP client sees it.
//
// Unlike the unit test in src/tools/descriptions.test.ts (in-memory transport),
// this spawns the built `dist/index.js` over stdio — the exact process a user
// runs — so the figure includes everything the transport serialises (icons,
// `$schema` stripping, annotations). CI runs it on every PR and fails above
// `--max-kib`; with `--compare <base.json>` it also renders the delta against
// the base branch as Markdown for a sticky PR comment.
//
// Usage:
//   node scripts/measure-tools-list.mjs                       # human-readable
//   node scripts/measure-tools-list.mjs --json > head.json    # machine-readable
//   node scripts/measure-tools-list.mjs --max-kib 448         # exit 1 if larger
//   node scripts/measure-tools-list.mjs --compare base.json --markdown
//
// Requires `npm run build` first. No BoondManager credentials are needed: the
// server only validates that *some* auth is configured at start-up, and
// `tools/list` never calls the API.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const ENTRY = join(REPO_ROOT, "dist", "index.js");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

if (!existsSync(ENTRY)) {
  console.error(`ERROR: ${ENTRY} does not exist. Run \`npm run build\` first.`);
  process.exit(1);
}

export async function measure() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRY],
    env: {
      ...process.env,
      // A placeholder token: initClient() only checks that auth is configured.
      BOOND_API_TOKEN: process.env.BOOND_API_TOKEN ?? "measure-tools-list",
      BOOND_DISABLE_UPDATE_CHECK: "1",
      LOG_LEVEL: "silent",
      // Neutralise any ambient surface restriction so the figure is the full catalogue.
      BOOND_MCP_PROFILE: "",
      BOOND_MCP_DOMAINS: "",
      BOOND_MCP_EXCLUDE_DOMAINS: "",
      BOOND_MCP_OPERATIONS: "",
      BOOND_MCP_READ_ONLY: "",
      BOOND_MCP_ICONS: "",
    },
    stderr: "ignore",
  });
  const client = new Client({ name: "measure-tools-list", version: "1.0.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const withOutputSchema = tools.filter((t) => t.outputSchema).length;
    const bytes = Buffer.byteLength(JSON.stringify(tools), "utf8");
    const iconBytes = tools.reduce(
      (sum, t) => sum + (t.icons ? Buffer.byteLength(JSON.stringify(t.icons), "utf8") : 0),
      0,
    );
    return { tools: tools.length, withOutputSchema, bytes, iconBytes };
  } finally {
    await client.close();
  }
}

const kib = (n) => (n / 1024).toFixed(1);

function renderMarkdown(head, base) {
  const delta = base ? head.bytes - base.bytes : 0;
  const sign = delta > 0 ? "+" : "";
  const lines = [
    "<!-- tools-list-size -->",
    "### `tools/list` payload",
    "",
    "| | Tools | Payload | Icons |",
    "|---|---:|---:|---:|",
  ];
  if (base) lines.push(`| base | ${base.tools} | ${kib(base.bytes)} KiB | ${kib(base.iconBytes)} KiB |`);
  lines.push(`| this PR | ${head.tools} | ${kib(head.bytes)} KiB | ${kib(head.iconBytes)} KiB |`);
  if (base) {
    lines.push(
      "",
      `**Δ ${sign}${kib(delta)} KiB** (${sign}${delta} bytes, ${sign}${head.tools - base.tools} tools)${
        delta > 0 ? " — every byte is paid on every `tools/list`; see CLAUDE.md § *Tool Description Contract*." : ""
      }`,
    );
  }
  return lines.join("\n");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const head = await measure();
  const comparePath = option("--compare");
  const base = comparePath ? JSON.parse(readFileSync(comparePath, "utf8")) : undefined;
  if (flag("--json")) {
    console.log(JSON.stringify(head));
  } else if (flag("--markdown")) {
    console.log(renderMarkdown(head, base));
  } else {
    console.log(`tools/list: ${head.tools} tools, ${kib(head.bytes)} KiB (icons ${kib(head.iconBytes)} KiB)`);
    if (base) console.log(`base:       ${base.tools} tools, ${kib(base.bytes)} KiB → Δ ${kib(head.bytes - base.bytes)} KiB`);
  }
  const maxKib = option("--max-kib");
  if (maxKib !== undefined && head.bytes > Number(maxKib) * 1024) {
    console.error(`ERROR: tools/list is ${kib(head.bytes)} KiB, above the ${maxKib} KiB ceiling.`);
    process.exit(1);
  }
}
