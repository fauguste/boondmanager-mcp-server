import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPositioningTools } from "./positionings.js";
import { apiRequest } from "../services/boond-client.js";

vi.mock("../services/boond-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/boond-client.js")>();
  return { ...actual, apiRequest: vi.fn() };
});

function createMockServer() {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer;
}

describe("registerPositioningTools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("should register 5 positioning tools", () => {
    registerPositioningTools(server);
    expect(server.registerTool).toHaveBeenCalledTimes(5);
  });

  it("should register all expected tool names", () => {
    registerPositioningTools(server);
    const names = vi.mocked(server.registerTool).mock.calls.map((c) => c[0]);
    expect(names).toContain("boond_positionings_search");
    expect(names).toContain("boond_positionings_get");
    expect(names).toContain("boond_positionings_create");
    expect(names).toContain("boond_positionings_update");
    expect(names).toContain("boond_positionings_delete");
  });

  it("should register search and get as readOnly", () => {
    registerPositioningTools(server);
    const readOnlyCalls = vi
      .mocked(server.registerTool)
      .mock.calls.filter(
        (c) =>
          typeof c[0] === "string" && ["boond_positionings_search", "boond_positionings_get"].includes(c[0] as string)
      );
    for (const call of readOnlyCalls) {
      expect(call[1].annotations?.readOnlyHint).toBe(true);
    }
  });

  it("should register delete as destructive", () => {
    registerPositioningTools(server);
    const deleteCall = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_positionings_delete");
    expect(deleteCall?.[1].annotations?.destructiveHint).toBe(true);
  });

  it("should register update as an idempotent, non-destructive write", () => {
    registerPositioningTools(server);
    const updateCall = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_positionings_update");
    expect(updateCall).toBeDefined();
    expect(updateCall?.[1].annotations?.readOnlyHint).toBe(false);
    expect(updateCall?.[1].annotations?.destructiveHint).toBe(false);
    expect(updateCall?.[1].annotations?.idempotentHint).toBe(true);
  });

  describe("boond_positionings_update handler", () => {
    function updateHandler() {
      registerPositioningTools(server);
      const call = vi.mocked(server.registerTool).mock.calls.find((c) => c[0] === "boond_positionings_update");
      return call?.[2] as (params: unknown) => Promise<{
        content: Array<{ type: string; text: string }>;
        structuredContent?: Record<string, unknown>;
      }>;
    }

    beforeEach(() => {
      vi.mocked(apiRequest).mockReset();
      vi.mocked(apiRequest).mockResolvedValue({
        data: { id: "42", type: "positioning", attributes: { state: 3 } },
      } as never);
    });

    it("PUTs a minimal JSON:API body when only state is provided", async () => {
      const handler = updateHandler();
      const result = await handler({ id: "42", state: 3 });
      expect(apiRequest).toHaveBeenCalledTimes(1);
      expect(apiRequest).toHaveBeenCalledWith("/positionings/42", "PUT", {
        data: { type: "positioning", id: "42", attributes: { state: 3 } },
      });
      expect(result.structuredContent).toEqual({ id: "42", type: "positioning" });
      expect(result.content[0].text).toContain("42");
    });

    it("folds stateReasonTypeOf/stateReasonDetail into stateReason", async () => {
      const handler = updateHandler();
      await handler({ id: "7", state: 5, stateReasonTypeOf: 2, stateReasonDetail: "Refus client" });
      const body = vi.mocked(apiRequest).mock.calls[0][2] as {
        data: { attributes: Record<string, unknown> };
      };
      expect(body.data.attributes).toEqual({
        state: 5,
        stateReason: { typeOf: 2, detail: "Refus client" },
      });
      expect(body.data.attributes).not.toHaveProperty("stateReasonTypeOf");
      expect(body.data.attributes).not.toHaveProperty("stateReasonDetail");
    });

    it("folds a partial stateReason (detail only)", async () => {
      const handler = updateHandler();
      await handler({ id: "7", stateReasonDetail: "Concurrent retenu" });
      const body = vi.mocked(apiRequest).mock.calls[0][2] as {
        data: { attributes: Record<string, unknown> };
      };
      expect(body.data.attributes).toEqual({ stateReason: { detail: "Concurrent retenu" } });
    });

    it("does not send fields that were not provided", async () => {
      const handler = updateHandler();
      await handler({ id: "9", informationComments: "RAS", startDate: "2026-07-01" });
      const body = vi.mocked(apiRequest).mock.calls[0][2] as {
        data: { id: string; type: string; attributes: Record<string, unknown> };
      };
      expect(body.data.id).toBe("9");
      expect(body.data.type).toBe("positioning");
      expect(Object.keys(body.data.attributes).sort()).toEqual(["informationComments", "startDate"]);
    });
  });
});
