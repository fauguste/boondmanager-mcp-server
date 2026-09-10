import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest, formatTabResponse } from "../services/boond-client.js";
import { IdSchema } from "../schemas/index.js";
import type { IdInput } from "../schemas/index.js";
import { tabDescription } from "./description-builders.js";
import type { EntityWording } from "./description-builders.js";

/**
 * The 42 entity-tab tools (`boond_candidates_technical_data`,
 * `boond_companies_invoices`, …) were six byte-identical registration loops in
 * six domain files, each with its own copy of the `TabDefinition` interface and
 * its own hand-typed description ending in a redundant `Args: - id (string)`
 * block. They are the catalogue's densest cluster of near-identical tools —
 * same input, same annotations, all "some fields of one entity" — so a
 * description that only names the tab leaves a model choosing by string
 * similarity.
 *
 * Centralising them buys the thing that matters for that: every tab tool now
 * states what its slice holds *and* which sibling reaches the rest, from one
 * template that cannot drift per domain.
 */

const TAB_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export interface TabDefinition {
  /** Tool-name suffix, underscored — `technical_data`. */
  name: string;
  /** API path segment, as BoondManager spells it — `technical-data`. */
  tab: string;
  title: string;
  /** What the tab holds, as a noun phrase — "le profil technique". */
  subject: string;
  /** Parenthetical enumeration of the fields inside it. Omitted when the subject says it all. */
  content?: string;
  /** What the caller receives. */
  returns: string;
  /** Facts a caller cannot infer from the schema. */
  behaviour?: string[];
}

export interface TabToolsOptions extends EntityWording {
  /** API path of the parent collection — `/candidates`. */
  apiPath: string;
}

export function registerTabTools(server: McpServer, opts: TabToolsOptions, tabs: TabDefinition[]): void {
  for (const tab of tabs) {
    server.registerTool(
      `${opts.prefix}_${tab.name}`,
      {
        title: tab.title,
        description: tabDescription({
          entityName: opts.entityName,
          entityNamePlural: opts.entityNamePlural,
          prefix: opts.prefix,
          subject: tab.subject,
          content: tab.content,
          returns: tab.returns,
          behaviour: tab.behaviour,
        }),
        inputSchema: IdSchema,
        annotations: TAB_TOOL_ANNOTATIONS,
      },
      async (params: IdInput) => {
        const response = await apiRequest(`${opts.apiPath}/${params.id}/${tab.tab}`);
        const text = formatTabResponse(response);
        return {
          content: [{ type: "text" as const, text }],
        };
      }
    );
  }
}
