import { describe, it, expect } from "vitest";
import { logger, generateCorrelationId } from "./logger.js";

describe("logger", () => {
  it("exposes the pino logger interface", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.child).toBe("function");
  });

  it("can create a child logger with context", () => {
    const child = logger.child({ corrId: "test123" });
    expect(child).toBeDefined();
    // Child inherits parent level + bindings, but is a distinct instance.
    expect(child).not.toBe(logger);
  });
});

describe("generateCorrelationId", () => {
  it("returns an 8-char hex string", () => {
    const id = generateCorrelationId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("produces unique IDs on successive calls", () => {
    const ids = Array.from({ length: 100 }, () => generateCorrelationId());
    const unique = new Set(ids);
    // Collision is possible but astronomically unlikely for 100 calls.
    expect(unique.size).toBeGreaterThan(95);
  });
});
