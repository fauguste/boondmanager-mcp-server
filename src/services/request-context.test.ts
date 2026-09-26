import { describe, it, expect } from "vitest";
import {
  RequestCancelledError,
  abortPromise,
  currentCorrId,
  currentRequestContext,
  currentRequestSignal,
  parseTraceparent,
  requestSignalFrom,
  runWithRequestContext,
  runWithRequestSignal,
  throwIfCancelled,
  traceparentFrom,
  withoutRequestSignal,
} from "./request-context.js";

describe("request context (#231)", () => {
  it("exposes the signal of the request being handled, and nothing outside it", async () => {
    const controller = new AbortController();
    expect(currentRequestSignal()).toBeUndefined();
    const seen = await runWithRequestSignal(controller.signal, async () => {
      await Promise.resolve();
      return currentRequestSignal();
    });
    expect(seen).toBe(controller.signal);
    expect(currentRequestSignal()).toBeUndefined();
  });

  it("runWithRequestSignal(undefined) clears an enclosing signal", () => {
    const controller = new AbortController();
    runWithRequestSignal(controller.signal, () => {
      expect(runWithRequestSignal(undefined, () => currentRequestSignal())).toBeUndefined();
    });
  });

  it("withoutRequestSignal detaches shared work from the caller's cancellation", () => {
    const controller = new AbortController();
    runWithRequestSignal(controller.signal, () => {
      expect(withoutRequestSignal(() => currentRequestSignal())).toBeUndefined();
      expect(currentRequestSignal()).toBe(controller.signal);
    });
  });

  it("requestSignalFrom narrows the SDK's extra and ignores anything else", () => {
    const controller = new AbortController();
    expect(requestSignalFrom({ signal: controller.signal })).toBe(controller.signal);
    expect(requestSignalFrom({ signal: "nope" })).toBeUndefined();
    expect(requestSignalFrom(undefined)).toBeUndefined();
    expect(requestSignalFrom(null)).toBeUndefined();
    expect(requestSignalFrom({})).toBeUndefined();
  });

  it("throwIfCancelled raises an AbortError-named error naming the endpoint", () => {
    const controller = new AbortController();
    expect(() => throwIfCancelled(controller.signal, "GET", "/actions")).not.toThrow();
    expect(() => throwIfCancelled(undefined, "GET", "/actions")).not.toThrow();
    controller.abort(new Error("client went away"));
    let caught: unknown;
    try {
      throwIfCancelled(controller.signal, "GET", "/actions");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RequestCancelledError);
    const e = caught as RequestCancelledError;
    expect(e.name).toBe("AbortError");
    expect(e.message).toContain("cancelled");
    expect(e.message).toContain("Endpoint: GET /actions");
    expect((e.cause as Error).message).toBe("client went away");
  });

  it("abortPromise rejects with the reason when the signal fires", async () => {
    const controller = new AbortController();
    const p = abortPromise(controller.signal);
    controller.abort("stop");
    await expect(p).rejects.toBe("stop");
  });
});

describe("correlation context (#236)", () => {
  it("parses a valid W3C traceparent and rejects the rest", () => {
    const valid = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    expect(parseTraceparent(valid)).toEqual({ header: valid, traceId: "4bf92f3577b34da6a3ce929d0e0e4736" });
    expect(parseTraceparent(` ${valid} `)?.header).toBe(valid);
    expect(parseTraceparent("00-00000000000000000000000000000000-00f067aa0ba902b7-01")).toBeUndefined();
    expect(parseTraceparent("00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01")).toBeUndefined();
    expect(parseTraceparent("garbage")).toBeUndefined();
    expect(parseTraceparent(42)).toBeUndefined();
    expect(parseTraceparent(undefined)).toBeUndefined();
  });

  it("reads traceparent from extra._meta only", () => {
    const valid = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    expect(traceparentFrom({ _meta: { traceparent: valid } })?.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(traceparentFrom({ traceparent: valid })).toBeUndefined();
    expect(traceparentFrom({ _meta: null })).toBeUndefined();
    expect(traceparentFrom(null)).toBeUndefined();
  });

  it("withoutRequestSignal keeps the correlation id while dropping the signal", () => {
    const controller = new AbortController();
    runWithRequestContext({ signal: controller.signal, corrId: "c0ffee00", traceparent: "tp" }, () => {
      expect(currentCorrId()).toBe("c0ffee00");
      withoutRequestSignal(() => {
        expect(currentRequestSignal()).toBeUndefined();
        expect(currentCorrId()).toBe("c0ffee00");
        expect(currentRequestContext()?.traceparent).toBe("tp");
      });
    });
    expect(currentCorrId()).toBeUndefined();
  });
});
