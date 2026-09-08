import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerCandidateTools,
  registerResourceTools,
  registerContactTools,
  registerCompanyTools,
  registerOpportunityTools,
  registerActionTools,
  registerTimesheetTools,
  registerProjectTools,
  registerInvoiceTools,
  registerOrderTools,
  registerDeliveryTools,
  registerAbsenceTools,
  registerExpenseTools,
  registerProductTools,
  registerPositioningTools,
  registerPaymentTools,
  registerAdvantageTools,
  registerApplicationTools,
  registerContractTools,
  registerPurchaseTools,
  registerProviderInvoiceTools,
  registerAccountTools,
  registerAgencyTools,
  registerBusinessUnitTools,
  registerRoleTools,
  registerLogTools,
  registerNotificationTools,
  registerThreadTools,
  registerTodolistTools,
  registerFlagTools,
  registerCalendarTools,
  registerWebhookTools,
  registerValidationTools,
  registerPoleTools,
  registerReportingTools,
  registerPlanningAbsenceTools,
  registerWorkflowTools,
} from "./index.js";
import { registerAllPrompts } from "../prompts/index.js";
import { registerAllResources } from "../resources/index.js";
import { SERVER_INSTRUCTIONS } from "../instructions.js";
import { connectMcpClient, useDefaultServerSurface } from "./test-helpers.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants.js";
import { USAGE_GUIDANCE } from "./usage-guidance.js";

/**
 * Sensible upper bound for a single tool description. MCP has a ~50KB total
 * message limit, but individual descriptions should be digestible by the LLM
 * in a tools[] list — overly verbose descriptions dilute focus and waste
 * context. If a tool legitimately needs more than this, the detail belongs
 * in a prompt template or resource, not the tool schema.
 *
 * Raised from 2000 when every tool gained a mandatory usage-guidance section
 * ("Quand / Plutôt que", see `description-builders.ts`) and an explicit
 * `Returns`. The old ceiling was calibrated on descriptions that stated
 * purpose and filters only, and `boond_resources_search` — the widest filter
 * vocabulary in the catalogue — landed at 2149 with the two lines that tell a
 * model when NOT to call it. The cap's job is to stop essays, not to force a
 * choice between documenting filters and documenting siblings; the *floor*
 * below is what now guards the other end.
 */
const MAX_TOOL_DESCRIPTION_LENGTH = 2400;

/**
 * Lower bound, and the more load-bearing of the two. A ~50-character
 * description ("Récupère les détails d'une action par son ID.") restates the
 * tool name, and a catalogue of 182 tools where 30 of them read like that
 * leaves a model picking by string similarity. Every tool must state its
 * purpose, when not to use it, and what comes back — which no honest
 * description fits under this.
 */
const MIN_TOOL_DESCRIPTION_LENGTH = 250;

/**
 * Prompts can be longer than tools (they're explicit user-facing templates),
 * but still shouldn't balloon into multi-page essays.
 */
const MAX_PROMPT_DESCRIPTION_LENGTH = 3000;

/**
 * Resources are reference data — descriptions here are metadata for the list,
 * not the content itself. Keep them terse.
 */
const MAX_RESOURCE_DESCRIPTION_LENGTH = 1000;

/**
 * Server-level `instructions` are sent once in the `initialize` result but live
 * in the model's context for the whole session, competing with the tools[] list
 * for the same budget. They exist to *replace* per-tool boilerplate, so if they
 * grow past this, the content probably belongs in a prompt or a resource.
 */
const MAX_SERVER_INSTRUCTIONS_LENGTH = 4000;

/**
 * Cumulative budget for SEP-973 icons in `tools/list`. Icons are per-domain but
 * shipped per-tool, so the total scales with the catalogue (~180 tools × ~230 B
 * ≈ 40 KiB today). This cap is what stops a "nicer" glyph set from quietly
 * costing more than the tool descriptions it decorates; the second assertion
 * bounds it relative to the payload so growing the catalogue alone can't trip
 * it. Operators who don't render icons can drop them entirely with
 * `BOOND_MCP_ICONS=0`.
 */
const MAX_TOTAL_ICON_BYTES = 48 * 1024;
const MAX_ICON_SHARE_OF_PAYLOAD = 0.2;

describe("tools/list icon budget", () => {
  // Without this the cap is only as meaningful as the ambient environment: an
  // exported `BOOND_MCP_ICONS=0` makes it 0 bytes (always under the cap) and a
  // `BOOND_MCP_PROFILE` shrinks the catalogue it is measured against.
  useDefaultServerSurface();

  it("stays within the cumulative byte cap and its share of the payload", async () => {
    const { client, close } = await connectMcpClient();
    try {
      const tools = (await client.listTools()).tools;
      const iconBytes = tools.reduce(
        (n, t) => n + (t.icons ? JSON.stringify(t.icons).length + '"icons":,'.length : 0),
        0
      );
      const payloadBytes = JSON.stringify(tools).length;
      // Guards against the cap passing because nothing was measured.
      expect(iconBytes).toBeGreaterThan(0);
      expect(iconBytes, `${(iconBytes / 1024).toFixed(1)} KiB of icons`).toBeLessThanOrEqual(MAX_TOTAL_ICON_BYTES);
      expect(iconBytes / payloadBytes).toBeLessThanOrEqual(MAX_ICON_SHARE_OF_PAYLOAD);
    } finally {
      await close();
    }
  });
});

/**
 * Advertised-description contract.
 *
 * Asserted over a real client rather than over `registerTool` arguments,
 * because three of the four properties below are installed centrally at
 * registration time (`registration-decorators.ts`) and are therefore invisible
 * to a mock server: a domain file can pass a description with no `fields`
 * paragraph and still be correct, since the decorator adds it. What a client
 * receives is the only thing that matters to the model, so that is what this
 * measures.
 */
describe("advertised tool descriptions", () => {
  useDefaultServerSurface();

  let advertised: Array<{ name: string; description: string; inputKeys: string[] }>;

  beforeAll(async () => {
    const { client, close } = await connectMcpClient();
    try {
      advertised = (await client.listTools()).tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputKeys: Object.keys(
          (t.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}
        ),
      }));
    } finally {
      await close();
    }
    expect(advertised.length).toBeGreaterThan(150);
  });

  it("keeps every description inside the length band", () => {
    const tooLong = advertised.filter((t) => t.description.length > MAX_TOOL_DESCRIPTION_LENGTH);
    const tooShort = advertised.filter((t) => t.description.length < MIN_TOOL_DESCRIPTION_LENGTH);
    expect(tooLong.map((t) => `${t.name}: ${t.description.length} > ${MAX_TOOL_DESCRIPTION_LENGTH}`)).toEqual([]);
    expect(tooShort.map((t) => `${t.name}: ${t.description.length} < ${MIN_TOOL_DESCRIPTION_LENGTH}`)).toEqual([]);
  });

  it("tells the model when NOT to call the tool", () => {
    // The dimension the catalogue scored worst on: 181 of 182 tools used to
    // state what they do and nothing about which sibling to prefer, in a
    // listing where ~45 tools return "some fields of one entity".
    const missing = advertised.filter((t) => !/^(Quand|Plutôt que) :/m.test(t.description));
    expect(missing.map((t) => t.name)).toEqual([]);
  });

  it("states what every tool returns", () => {
    const missing = advertised.filter((t) => !/^Returns\s*:/m.test(t.description));
    expect(missing.map((t) => t.name)).toEqual([]);
  });

  it("discloses `fields` and pagination wherever the schema accepts them", () => {
    // Both carry semantics a JSON Schema cannot express: `fields` is applied
    // client-side and never forwarded to BoondManager, and the page ceiling
    // *rejects* rather than clamps. A tool that accepts them without saying so
    // is the exact defect that made `boond_poles_search` the catalogue's
    // lowest-scoring tool.
    const silentFields = advertised.filter((t) => t.inputKeys.includes("fields") && !/fields/.test(t.description));
    const silentPaging = advertised.filter((t) => t.inputKeys.includes("pageSize") && !/pageSize/.test(t.description));
    expect(silentFields.map((t) => t.name)).toEqual([]);
    expect(silentPaging.map((t) => t.name)).toEqual([]);
    // Guards against the assertions passing because nothing declares them.
    expect(advertised.filter((t) => t.inputKeys.includes("fields")).length).toBeGreaterThan(20);
  });

  it("has no orphan entry in the usage-guidance table", () => {
    // The table is keyed by tool name, so a rename would silently drop a
    // tool's guidance. This is the half of the drift check the table cannot
    // do on its own; the "tells the model when NOT to call" test above is the
    // other half.
    const registered = new Set(advertised.map((t) => t.name));
    const orphans = Object.keys(USAGE_GUIDANCE).filter((name) => !registered.has(name));
    expect(orphans).toEqual([]);
    expect(Object.keys(USAGE_GUIDANCE).length).toBeGreaterThan(20);
  });

  it("never contradicts the pagination ceilings it enforces", () => {
    // A hand-typed "défaut: 20, max: 100" shipped to 11 domains against a
    // schema enforcing 30/500. Descriptions must quote the constants, so any
    // literal that disagrees with them is a regression.
    const contradicting = advertised.filter((t) => {
      const claimed = [...t.description.matchAll(/pageSize[^.\n]*?(\d{2,4})/g)].map((m) => Number(m[1]));
      return claimed.some((n) => n !== MAX_PAGE_SIZE && n !== DEFAULT_PAGE_SIZE);
    });
    expect(contradicting.map((t) => t.name)).toEqual([]);
  });

  it("the pagination guard above actually catches the historical defect", () => {
    // Without this, the assertion could pass because its regex matches nothing
    // at all. This is the exact string the default search template shipped to
    // 11 domains, `boond_poles_search` and `boond_accounts_search` included.
    const legacy = "  - pageSize (number): Résultats par page (défaut: 20, max: 100)";
    const claimed = [...legacy.matchAll(/pageSize[^.\n]*?(\d{2,4})/g)].map((m) => Number(m[1]));
    expect(claimed.some((n) => n !== MAX_PAGE_SIZE && n !== DEFAULT_PAGE_SIZE)).toBe(true);
  });
});

describe("server instructions length", () => {
  it("does not exceed the length limit", () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(MAX_SERVER_INSTRUCTIONS_LENGTH);
  });

  it("is substantial enough to be worth sending", () => {
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(500);
  });
});

describe("tool/prompt/resource description lengths", () => {
  let tools: Array<{ name: string; description?: string }>;
  let prompts: Array<{ name: string; description?: string }>;
  let resources: Array<{ uri: string; description?: string }>;

  beforeEach(() => {
    tools = [];
    prompts = [];
    resources = [];

    const mockServer = {
      registerTool: (name: string, config: { description?: string }) => {
        tools.push({ name, description: config.description });
      },
      registerPrompt: (name: string, config: { description?: string }) => {
        prompts.push({ name, description: config.description });
      },
      // Signature is `registerResource(name, uriOrTemplate, config, cb)`. Reading
      // `uri`/`description` off the FIRST argument (the name string) yielded
      // `undefined` for every resource, so the description cap below asserted
      // nothing at all for as long as it existed.
      registerResource: (
        _name: string,
        uriOrTemplate: string | { uriTemplate: unknown },
        config: { description?: string }
      ) => {
        const uri = typeof uriOrTemplate === "string" ? uriOrTemplate : String(uriOrTemplate.uriTemplate);
        resources.push({ uri, description: config.description });
      },
    } as unknown as McpServer;

    // Register all tools, prompts, and resources
    registerCandidateTools(mockServer);
    registerResourceTools(mockServer);
    registerContactTools(mockServer);
    registerCompanyTools(mockServer);
    registerOpportunityTools(mockServer);
    registerActionTools(mockServer);
    registerTimesheetTools(mockServer);
    registerProjectTools(mockServer);
    registerInvoiceTools(mockServer);
    registerOrderTools(mockServer);
    registerDeliveryTools(mockServer);
    registerAbsenceTools(mockServer);
    registerExpenseTools(mockServer);
    registerProductTools(mockServer);
    registerPositioningTools(mockServer);
    registerPaymentTools(mockServer);
    registerAdvantageTools(mockServer);
    registerApplicationTools(mockServer);
    registerContractTools(mockServer);
    registerPurchaseTools(mockServer);
    registerProviderInvoiceTools(mockServer);
    registerAccountTools(mockServer);
    registerAgencyTools(mockServer);
    registerBusinessUnitTools(mockServer);
    registerRoleTools(mockServer);
    registerLogTools(mockServer);
    registerNotificationTools(mockServer);
    registerThreadTools(mockServer);
    registerTodolistTools(mockServer);
    registerFlagTools(mockServer);
    registerCalendarTools(mockServer);
    registerWebhookTools(mockServer);
    registerValidationTools(mockServer);
    registerPoleTools(mockServer);
    registerReportingTools(mockServer);
    registerPlanningAbsenceTools(mockServer);
    registerWorkflowTools(mockServer);

    registerAllPrompts(mockServer);
    registerAllResources(mockServer);
  });

  it("no tool description exceeds the length limit", () => {
    const violations = tools.filter((t) => t.description && t.description.length > MAX_TOOL_DESCRIPTION_LENGTH);
    if (violations.length > 0) {
      const details = violations.map((t) => `  - ${t.name}: ${t.description?.length} chars`);
      expect.fail(
        `${violations.length} tool(s) exceed MAX_TOOL_DESCRIPTION_LENGTH (${MAX_TOOL_DESCRIPTION_LENGTH}):\n${details.join("\n")}`
      );
    }
  });

  it("no prompt description exceeds the length limit", () => {
    const violations = prompts.filter((p) => p.description && p.description.length > MAX_PROMPT_DESCRIPTION_LENGTH);
    if (violations.length > 0) {
      const details = violations.map((p) => `  - ${p.name}: ${p.description?.length} chars`);
      expect.fail(
        `${violations.length} prompt(s) exceed MAX_PROMPT_DESCRIPTION_LENGTH (${MAX_PROMPT_DESCRIPTION_LENGTH}):\n${details.join("\n")}`
      );
    }
  });

  it("no resource description exceeds the length limit", () => {
    const violations = resources.filter((r) => r.description && r.description.length > MAX_RESOURCE_DESCRIPTION_LENGTH);
    if (violations.length > 0) {
      const details = violations.map((r) => `  - ${r.uri}: ${r.description?.length} chars`);
      expect.fail(
        `${violations.length} resource(s) exceed MAX_RESOURCE_DESCRIPTION_LENGTH (${MAX_RESOURCE_DESCRIPTION_LENGTH}):\n${details.join("\n")}`
      );
    }
  });

  it("registers a realistic number of tools (sanity check)", () => {
    expect(tools.length).toBeGreaterThan(150);
    expect(tools.length).toBeLessThan(200);
  });

  it("registers a few prompts (sanity check)", () => {
    expect(prompts.length).toBeGreaterThanOrEqual(6);
    expect(prompts.length).toBeLessThan(20);
  });

  it("every resource carries a description the cap can measure", () => {
    // Guards the assertion above against silently measuring `undefined` again:
    // the filter it runs is a no-op on a resource with no description.
    expect(resources.length).toBeGreaterThan(0);
    const missing = resources.filter((r) => !r.description);
    expect(missing.map((r) => r.uri)).toEqual([]);
  });

  it("registers a few resources (sanity check)", () => {
    expect(resources.length).toBeGreaterThanOrEqual(15);
    expect(resources.length).toBeLessThan(30);
  });
});
