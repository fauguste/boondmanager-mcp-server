import { describe, it, expect } from "vitest";
import { connectMcpClient, useDefaultServerSurface } from "./test-helpers.js";
import { MAX_SEARCH_PAGE } from "../constants.js";

/**
 * Every paginated tool must refuse `page > MAX_SEARCH_PAGE` **with the
 * explanation** (`pageField`'s message), not with Zod's bare "Too big".
 *
 * The six entity searches always had it; ten other search schemas declared
 * their own `page` with no message, so `boond_actions_search { page: 500 }`
 * answered "expected number to be <=100" while CLAUDE.md promised the
 * MAX_SEARCH_PAGE explanation everywhere (issue #240). The shapes are shared
 * now; this is the net that keeps the next hand-rolled schema from drifting.
 *
 * Only validation runs here — the ceiling is rejected before any handler, so
 * no BoondManager call is made and no credentials are needed.
 */
describe("page ceiling on every paginated tool (#240)", () => {
  useDefaultServerSurface();

  it("rejects page > MAX_SEARCH_PAGE with the MAX_SEARCH_PAGE explanation", async () => {
    const { client, close } = await connectMcpClient();
    const silent: string[] = [];
    let paginated = 0;
    try {
      const tools = (await client.listTools()).tools;
      for (const tool of tools) {
        const props = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
        if (!("page" in props)) continue;
        paginated++;
        const result = (await client.callTool({ name: tool.name, arguments: { page: MAX_SEARCH_PAGE + 1 } })) as {
          isError?: boolean;
          content?: Array<{ type: string; text?: string }>;
        };
        const text = result.content?.map((c) => c.text ?? "").join("\n") ?? "";
        if (result.isError !== true || !text.includes("MAX_SEARCH_PAGE"))
          silent.push(`${tool.name}: ${text.slice(0, 120)}`);
      }
    } finally {
      await close();
    }
    expect(silent).toEqual([]);
    // Guards against the assertion passing because nothing declares `page`.
    expect(paginated).toBeGreaterThan(30);
  });
});
