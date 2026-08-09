import { describe, it, expect, vi } from "vitest";
import { progressReporterFrom } from "./progress.js";

/** Minimal stand-in for the SDK's `RequestHandlerExtra`. */
function extraWith(meta: unknown, sendNotification: unknown = vi.fn().mockResolvedValue(undefined)) {
  return { _meta: meta, sendNotification };
}

describe("progressReporterFrom", () => {
  it("is a no-op when the client sent no progressToken", () => {
    const send = vi.fn();
    const report = progressReporterFrom(extraWith({}, send));

    report(1, 3, "ignoré");

    expect(report.enabled).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["no _meta at all", { sendNotification: vi.fn() }],
    ["a null _meta", { _meta: null, sendNotification: vi.fn() }],
    ["no sendNotification", { _meta: { progressToken: 1 } }],
    ["a non-object extra", "nope"],
    ["undefined (handler called without extra, as in unit tests)", undefined],
  ])("stays a no-op with %s", (_label, extra) => {
    const report = progressReporterFrom(extra);
    expect(report.enabled).toBe(false);
    expect(() => report(1, 2, "x")).not.toThrow();
  });

  it.each([
    ["a token that is not a string or number", { progressToken: { nested: true } }],
    ["an explicitly null token", { progressToken: null }],
  ])("stays a no-op with %s", (_label, meta) => {
    const send = vi.fn();
    expect(progressReporterFrom(extraWith(meta, send)).enabled).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["a string token", "tok-1"],
    ["a numeric token", 42],
    // 0 is a legal progressToken and must not be treated as "absent".
    ["the zero token", 0],
  ])("emits notifications/progress with %s", (_label, progressToken) => {
    const send = vi.fn().mockResolvedValue(undefined);
    const report = progressReporterFrom(extraWith({ progressToken }, send));

    report(2, 5, "page 2/5");

    expect(report.enabled).toBe(true);
    expect(send).toHaveBeenCalledWith({
      method: "notifications/progress",
      params: { progressToken, progress: 2, total: 5, message: "page 2/5" },
    });
  });

  it("omits `total` when the caller does not know it", () => {
    const send = vi.fn().mockResolvedValue(undefined);

    progressReporterFrom(extraWith({ progressToken: "t" }, send))(1, undefined, "en cours");

    expect(send.mock.calls[0][0].params).not.toHaveProperty("total");
  });

  // The critical property: a broken progress channel must never cost the
  // caller its result. Both failure shapes are swallowed, and a rejected
  // promise must not escape as an unhandled rejection either.
  it("swallows a rejected sendNotification (disconnected client)", async () => {
    const send = vi.fn().mockRejectedValue(new Error("client gone"));
    const report = progressReporterFrom(extraWith({ progressToken: "t" }, send));

    expect(() => report(1, 2, "x")).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(send).toHaveBeenCalled();
  });

  it("swallows a synchronous throw from the transport", () => {
    const send = vi.fn(() => {
      throw new Error("stream closed");
    });
    const report = progressReporterFrom(extraWith({ progressToken: "t" }, send));

    expect(() => report(1, 2, "x")).not.toThrow();
  });

  it("does not block: the reporter returns before the notification resolves", () => {
    let resolved = false;
    const send = vi.fn(() => new Promise<void>((r) => setTimeout(() => ((resolved = true), r()), 50)));

    progressReporterFrom(extraWith({ progressToken: "t" }, send))(1, 2, "x");

    expect(resolved).toBe(false);
  });
});
