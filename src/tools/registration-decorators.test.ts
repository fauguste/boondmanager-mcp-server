import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { instrumentHandlers } from "./registration-decorators.js";
import { currentRequestContext, runWithRequestContext, type RequestContext } from "../services/request-context.js";
import { logger } from "../services/logger.js";

type Handler = (...args: unknown[]) => unknown;

/** Register one tool through the wrapper and hand back the handler the SDK would call. */
function registerThrough(
  handler: Handler,
  method: "registerTool" | "registerResource" | "registerPrompt" = "registerTool"
) {
  const registered: { handler?: Handler } = {};
  const fake = {
    [method]: vi.fn((..._args: unknown[]) => {
      registered.handler = _args[_args.length - 1] as Handler;
    }),
  } as unknown as McpServer;
  const server = instrumentHandlers(fake);
  if (method === "registerResource") server.registerResource("r", "boond://x", {}, handler as never);
  else if (method === "registerPrompt") server.registerPrompt("p", {}, handler as never);
  else server.registerTool("boond_demo_tool", { description: "d" }, handler as never);
  return registered.handler!;
}

const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

describe("instrumentHandlers (#231, #236)", () => {
  let info: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("runs the handler with extra.signal in the request context", async () => {
    const controller = new AbortController();
    let seen: RequestContext | undefined;
    const handler = registerThrough(async () => {
      seen = currentRequestContext();
      return { content: [] };
    });
    await handler({}, { signal: controller.signal });
    expect(seen?.signal).toBe(controller.signal);
  });

  it("derives corrId from a W3C traceparent in _meta and forwards the header", async () => {
    let seen: RequestContext | undefined;
    const handler = registerThrough(async () => {
      seen = currentRequestContext();
      return { content: [{ type: "text", text: "ok" }] };
    });
    await handler({}, { _meta: { traceparent: TRACEPARENT, baggage: "userId=42,session=abc" } });
    expect(seen?.corrId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(seen?.traceparent).toBe(TRACEPARENT);
    // `baggage` may carry end-user identifiers: never read, never logged.
    expect(seen).not.toHaveProperty("baggage");
    expect(JSON.stringify(info.mock.calls)).not.toContain("userId=42");
  });

  it("keeps the corrId the HTTP transport generated when there is no traceparent", async () => {
    let seen: RequestContext | undefined;
    const handler = registerThrough(async () => {
      seen = currentRequestContext();
      return { content: [] };
    });
    await runWithRequestContext({ corrId: "deadbeef" }, () => handler({}, { _meta: {} }));
    expect(seen?.corrId).toBe("deadbeef");
  });

  it("generates a corrId when neither the client nor the transport provided one (stdio)", async () => {
    let seen: RequestContext | undefined;
    const handler = registerThrough(async () => {
      seen = currentRequestContext();
      return { content: [] };
    });
    await handler({}, { signal: new AbortController().signal });
    expect(seen?.corrId).toMatch(/^[0-9a-f]{8}$/);
  });

  it("ignores a malformed traceparent rather than trusting it", async () => {
    let seen: RequestContext | undefined;
    const handler = registerThrough(async () => {
      seen = currentRequestContext();
      return { content: [] };
    });
    await handler({}, { _meta: { traceparent: "not-a-trace" } });
    expect(seen?.corrId).toMatch(/^[0-9a-f]{8}$/);
    expect(seen?.traceparent).toBeUndefined();
  });

  it("logs one line per tool call with corrId, tool, duration, outcome and size", async () => {
    const handler = registerThrough(async () => ({
      content: [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ],
      structuredContent: { id: "1" },
    }));
    await handler({}, { _meta: { traceparent: TRACEPARENT } });
    expect(info).toHaveBeenCalledTimes(1);
    const [fields, message] = info.mock.calls[0] as [Record<string, unknown>, string];
    expect(message).toBe("tool call");
    expect(fields).toMatchObject({
      corrId: "4bf92f3577b34da6a3ce929d0e0e4736",
      tool: "boond_demo_tool",
      ok: true,
      chars: "hello".length + "world".length + JSON.stringify({ id: "1" }).length,
    });
    expect(typeof fields.durationMs).toBe("number");
  });

  it("an isError result is logged as ok: false", async () => {
    const handler = registerThrough(async () => ({ isError: true, content: [{ type: "text", text: "nope" }] }));
    await handler({}, {});
    expect(info.mock.calls[0][0]).toMatchObject({ ok: false, chars: 4 });
  });

  it("a thrown handler is logged at warn and rethrown so the SDK still answers isError", async () => {
    const boom = new Error("boom");
    const handler = registerThrough(async () => {
      throw boom;
    });
    await expect(handler({}, {})).rejects.toBe(boom);
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({ tool: "boond_demo_tool", err: boom });
    expect(warn.mock.calls[0][1]).toBe("tool call threw");
  });

  it("a synchronous handler is supported too", () => {
    const handler = registerThrough(() => ({ content: [{ type: "text", text: "sync" }] }));
    const result = handler({}, {});
    expect(result).toEqual({ content: [{ type: "text", text: "sync" }] });
    expect(info.mock.calls[0][0]).toMatchObject({ ok: true, chars: 4 });
  });

  it("resource and prompt handlers get the context but no tool log line", async () => {
    let seen: RequestContext | undefined;
    const resource = registerThrough(async () => {
      seen = currentRequestContext();
      return { contents: [] };
    }, "registerResource");
    await resource(new URL("boond://x"), { _meta: { traceparent: TRACEPARENT } });
    expect(seen?.corrId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    const prompt = registerThrough(async () => {
      seen = currentRequestContext();
      return { messages: [] };
    }, "registerPrompt");
    await prompt({}, { signal: new AbortController().signal });
    expect(seen?.corrId).toMatch(/^[0-9a-f]{8}$/);
    expect(info).not.toHaveBeenCalled();
  });

  it("passes non-handler registrations and other methods straight through", () => {
    const fake = { registerTool: vi.fn(), close: vi.fn() } as unknown as McpServer;
    const server = instrumentHandlers(fake);
    server.registerTool("x", { description: "d" }, undefined as never);
    expect((fake.registerTool as ReturnType<typeof vi.fn>).mock.calls[0][2]).toBeUndefined();
    void server.close();
    expect(fake.close).toHaveBeenCalled();
  });
});
