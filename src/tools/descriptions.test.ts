import { describe, it, expect, beforeEach } from "vitest";
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
import { registerUiResources } from "../ui/index.js";
import { SERVER_INSTRUCTIONS } from "../instructions.js";
import { connectMcpClient, useDefaultServerSurface } from "./test-helpers.js";

/**
 * Sensible upper bound for a single tool description. MCP has a ~50KB total
 * message limit, but individual descriptions should be digestible by the LLM
 * in a tools[] list — overly verbose descriptions dilute focus and waste
 * context. If a tool legitimately needs more than this, the detail belongs
 * in a prompt template or resource, not the tool schema.
 */
const MAX_TOOL_DESCRIPTION_LENGTH = 2000;

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
      registerResource: (config: { uri: string; description?: string }) => {
        resources.push({ uri: config.uri, description: config.description });
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
    // MCP Apps views: their *description* rides in `resources/list` like any
    // other, so it is held to the same budget. The HTML body does not — it only
    // travels on an explicit `resources/read`.
    registerUiResources(mockServer);
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

  it("registers a few resources (sanity check)", () => {
    expect(resources.length).toBeGreaterThanOrEqual(15);
    expect(resources.length).toBeLessThan(30);
  });
});
