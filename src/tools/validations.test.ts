import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { createMockServer, registeredToolNames, toolCallback } from "./test-helpers.js";
import { registerValidationTools } from "./validations.js";
import { apiRequest, apiSearch } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn(), apiSearch: vi.fn() };
});

/** Mock server whose underlying Server declares (or not) the elicitation capability. */
function createMockServerWithClient(elicitation: boolean, elicitResult?: ElicitResult) {
  const elicitInput = vi.fn(
    async () => elicitResult ?? { action: "accept" as const, content: { confirmation: "delete" } }
  );
  const server = {
    registerTool: vi.fn(),
    server: { getClientCapabilities: vi.fn(() => (elicitation ? { elicitation: {} } : {})), elicitInput },
  } as unknown as McpServer;
  return { server, elicitInput };
}

const MONTHS = { startMonth: "2026-09", endMonth: "2026-09" };

describe("registerValidationTools", () => {
  let server: McpServer;
  beforeEach(() => {
    server = createMockServer();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiSearch).mockReset();
    vi.unstubAllEnvs();
  });

  it("registers search, get and the decision tool (#251)", () => {
    registerValidationTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(3);
    expect(registeredToolNames(server)).toEqual([
      "boond_validations_search",
      "boond_validations_get",
      "boond_validations_update",
    ]);
  });

  it("search and get are read-only, update is an idempotent write", () => {
    registerValidationTools(server);
    const annotations = (name: string) =>
      vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === name)?.[1].annotations;
    expect(annotations("boond_validations_search")?.readOnlyHint).toBe(true);
    expect(annotations("boond_validations_get")?.readOnlyHint).toBe(true);
    expect(annotations("boond_validations_update")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  it("search goes through apiSearch on /validations, get through apiRequest", async () => {
    vi.mocked(apiSearch).mockResolvedValue({ data: [] } as never);
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "42", type: "validation", attributes: {} } } as never);
    registerValidationTools(server);
    await toolCallback(server, "boond_validations_search")({ ...MONTHS, page: 1, pageSize: 10 });
    expect(vi.mocked(apiSearch).mock.calls[0]?.[0]).toBe("/validations");
    await toolCallback(server, "boond_validations_get")({ id: "42" });
    expect(vi.mocked(apiRequest).mock.calls[0]?.[0]).toBe("/validations/42");
  });
});

describe("boond_validations_update (issue #251)", () => {
  const validated = {
    data: {
      id: "77",
      type: "validation",
      attributes: { state: "validated" },
      relationships: { dependsOn: { data: { id: "500", type: "timesreport" } } },
    },
  };

  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    vi.unstubAllEnvs();
  });

  it("validate: PUTs state=validated on /validations/{id} and reports the document", async () => {
    vi.mocked(apiRequest).mockResolvedValue(validated as never);
    const { server, elicitInput } = createMockServerWithClient(true);
    registerValidationTools(server);
    const result = (await toolCallback(server, "boond_validations_update")({ id: "77", decision: "validate" })) as {
      structuredContent: Record<string, unknown>;
    };
    expect(elicitInput).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledWith("/validations/77", "PUT", {
      data: { type: "validation", id: "77", attributes: { state: "validated" } },
    });
    expect(result.structuredContent).toEqual({
      id: "77",
      decided: true,
      state: "validated",
      documentType: "timesreport",
      documentId: "500",
    });
  });

  it("reject: asks the end user first and sends state=rejected + reason on confirmation", async () => {
    vi.mocked(apiRequest).mockResolvedValue(validated as never);
    const { server, elicitInput } = createMockServerWithClient(true);
    registerValidationTools(server);
    await toolCallback(
      server,
      "boond_validations_update"
    )({ id: "77", decision: "reject", reason: "Jour férié saisi" });
    expect(elicitInput).toHaveBeenCalledOnce();
    const request = elicitInput.mock.calls[0]?.[0] as unknown as {
      message: string;
      requestedSchema: { properties: { confirmation: { default: string; oneOf: Array<{ title: string }> } } };
    };
    expect(request.message).toContain("Jour férié saisi");
    expect(request.requestedSchema.properties.confirmation.default).toBe("cancel");
    expect(request.requestedSchema.properties.confirmation.oneOf[0]?.title).toBe("Refuser");
    expect(apiRequest).toHaveBeenCalledWith("/validations/77", "PUT", {
      data: { type: "validation", id: "77", attributes: { state: "rejected", reason: "Jour férié saisi" } },
    });
  });

  it("reject: a declined confirmation makes no API call and says so", async () => {
    const { server } = createMockServerWithClient(true, { action: "cancel" });
    registerValidationTools(server);
    const result = (await toolCallback(server, "boond_validations_update")({ id: "77", decision: "reject" })) as {
      structuredContent: Record<string, unknown>;
      content: Array<{ text: string }>;
    };
    expect(apiRequest).not.toHaveBeenCalled();
    expect(result.structuredContent).toEqual({ id: "77", decided: false, reason: "cancel" });
    expect(result.content[0]?.text).toContain("annulé");
  });

  it("reject: no prompt without the elicitation capability, or when BOOND_MCP_CONFIRM_REJECT is off", async () => {
    vi.mocked(apiRequest).mockResolvedValue(validated as never);
    const noCapability = createMockServerWithClient(false);
    registerValidationTools(noCapability.server);
    await toolCallback(noCapability.server, "boond_validations_update")({ id: "77", decision: "reject" });
    expect(noCapability.elicitInput).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledTimes(1);

    vi.stubEnv("BOOND_MCP_CONFIRM_REJECT", "0");
    const optedOut = createMockServerWithClient(true);
    registerValidationTools(optedOut.server);
    await toolCallback(optedOut.server, "boond_validations_update")({ id: "77", decision: "reject" });
    expect(optedOut.elicitInput).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });
});
