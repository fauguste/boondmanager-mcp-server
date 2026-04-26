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
} from "./index.js";
import { registerAllPrompts } from "../prompts/index.js";
import { registerAllResources } from "../resources/index.js";

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

    registerAllPrompts(mockServer);
    registerAllResources(mockServer);
  });

  it("no tool description exceeds the length limit", () => {
    const violations = tools.filter(
      (t) => t.description && t.description.length > MAX_TOOL_DESCRIPTION_LENGTH
    );
    if (violations.length > 0) {
      const details = violations.map(
        (t) => `  - ${t.name}: ${t.description?.length} chars`
      );
      expect.fail(
        `${violations.length} tool(s) exceed MAX_TOOL_DESCRIPTION_LENGTH (${MAX_TOOL_DESCRIPTION_LENGTH}):\n${details.join("\n")}`
      );
    }
  });

  it("no prompt description exceeds the length limit", () => {
    const violations = prompts.filter(
      (p) => p.description && p.description.length > MAX_PROMPT_DESCRIPTION_LENGTH
    );
    if (violations.length > 0) {
      const details = violations.map(
        (p) => `  - ${p.name}: ${p.description?.length} chars`
      );
      expect.fail(
        `${violations.length} prompt(s) exceed MAX_PROMPT_DESCRIPTION_LENGTH (${MAX_PROMPT_DESCRIPTION_LENGTH}):\n${details.join("\n")}`
      );
    }
  });

  it("no resource description exceeds the length limit", () => {
    const violations = resources.filter(
      (r) => r.description && r.description.length > MAX_RESOURCE_DESCRIPTION_LENGTH
    );
    if (violations.length > 0) {
      const details = violations.map(
        (r) => `  - ${r.uri}: ${r.description?.length} chars`
      );
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
