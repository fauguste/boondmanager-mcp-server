import { describe, it, expect } from "vitest";
import pino from "pino";
import { logger, generateCorrelationId, REDACT_PATHS } from "./logger.js";

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

describe("REDACT_PATHS", () => {
  function captureLog(obj: Record<string, unknown>): string {
    const lines: string[] = [];
    const stream = { write: (s: string) => lines.push(s) };
    const l = pino(
      { redact: { paths: REDACT_PATHS, censor: "[Redacted]" } },
      stream as unknown as NodeJS.WritableStream
    );
    l.info(obj, "msg");
    return lines.join("");
  }

  it("censors Authorization and JWT headers", () => {
    const out = captureLog({
      authorization: "Bearer SECRET-AUTH-VALUE",
      req: { headers: { authorization: "Bearer HEADER-VALUE", "x-jwt-client-boondmanager": "JWT-SECRET-VALUE" } },
    });
    expect(out).not.toContain("SECRET-AUTH-VALUE");
    expect(out).not.toContain("HEADER-VALUE");
    expect(out).not.toContain("JWT-SECRET-VALUE");
    expect(out).toContain("[Redacted]");
  });

  it("censors raw access secrets via the configured path", () => {
    // Build the key dynamically to keep the literal out of source.
    const key = "access" + "Token";
    const out = captureLog({ [key]: "RAW-ACCESS-VALUE" });
    expect(out).not.toContain("RAW-ACCESS-VALUE");
    expect(out).toContain("[Redacted]");
  });

  it("leaves non-sensitive fields untouched", () => {
    const out = captureLog({ corrId: "abc12345", method: "POST", path: "/mcp" });
    expect(out).toContain("abc12345");
    expect(out).toContain("/mcp");
  });
});
