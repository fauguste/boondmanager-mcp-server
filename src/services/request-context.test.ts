import { describe, it, expect } from "vitest";
import {
  RequestCancelledError,
  abortPromise,
  currentRequestSignal,
  requestSignalFrom,
  runWithRequestSignal,
  throwIfCancelled,
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
