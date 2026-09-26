import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TOOL_REGISTRARS } from "./server.js";
import { connectMcpClient, useDefaultServerSurface } from "./tools/test-helpers.js";

/**
 * The catalogue figures quoted in CLAUDE.md and README.md are hand-written and
 * used to rot (issue #264: "182 tools, 12 prompts" survived two releases of
 * additions). TOOLS.md is already drift-checked by CI; this suite extends the
 * same guarantee to the two documents a contributor or an agent reads first.
 *
 * The figures are parsed from the documents rather than hard-coded here, so a
 * new tool means editing the sentence — not a constant in a test.
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const claudeMd = readFileSync(`${root}/CLAUDE.md`, "utf8");
const readmeMd = readFileSync(`${root}/README.md`, "utf8");

function announcedInClaudeMd() {
  const m = /\*\*(\d+) tools, (\d+) prompts, (\d+) resources, (\d+) resource templates\*\* across (\d+)\ndomains/.exec(
    claudeMd
  );
  if (!m) throw new Error("CLAUDE.md no longer states the catalogue counts in the expected sentence");
  return { tools: +m[1], prompts: +m[2], resources: +m[3], templates: +m[4], domains: +m[5] };
}

function announcedInReadme() {
  const m = /\*\*(\d+) outils\*\* couvrant \*\*(\d+) domaines\*\*/.exec(readmeMd);
  if (!m) throw new Error("README.md no longer states the tool count in the expected sentence");
  return { tools: +m[1], domains: +m[2] };
}

describe("catalogue counts announced in the documentation", () => {
  useDefaultServerSurface();

  async function actual() {
    const { client, close } = await connectMcpClient();
    try {
      const [tools, prompts, resources, templates] = await Promise.all([
        client.listTools(),
        client.listPrompts(),
        client.listResources(),
        client.listResourceTemplates(),
      ]);
      return {
        tools: tools.tools.length,
        prompts: prompts.prompts.length,
        resources: resources.resources.length,
        templates: templates.resourceTemplates.length,
        domains: TOOL_REGISTRARS.length,
      };
    } finally {
      await close();
    }
  }

  it("CLAUDE.md quotes the real number of tools, prompts, resources, templates and domains", async () => {
    expect(announcedInClaudeMd()).toEqual(await actual());
  });

  it("README.md quotes the real number of tools and domains", async () => {
    const { tools, domains } = await actual();
    expect(announcedInReadme()).toEqual({ tools, domains });
  });

  it("CLAUDE.md does not quote a test count (it rots on every PR and nothing checks it)", () => {
    expect(claudeMd).not.toMatch(/\d+ test files/);
    expect(claudeMd).not.toMatch(/\*\*\d+ tests\*\*/);
  });
});
