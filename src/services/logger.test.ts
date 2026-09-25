import { describe, it, expect } from "vitest";
import pino from "pino";
import {
  logger,
  generateCorrelationId,
  REDACT_PATHS,
  LOG_DESTINATION_FD,
  resolveLoggerConfig,
  resolveLogLevel,
  usePrettyOutput,
} from "./logger.js";

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

/**
 * Issue #225: stdout is the JSON-RPC channel on the stdio transport, so the
 * logger must never write there. Both output shapes are pinned here; the
 * end-to-end proof (a real `dist/index.js` child process) lives in
 * `src/stdio-stdout.test.ts`.
 */
describe("log destination (issue #225)", () => {
  it("targets stderr, never stdout", () => {
    expect(LOG_DESTINATION_FD).toBe(2);
  });

  it("pretty output (dev default) routes pino-pretty to stderr", () => {
    const config = resolveLoggerConfig({});
    expect(config.format).toBe("pretty");
    if (config.format !== "pretty") throw new Error("unreachable");
    const transport = config.options.transport as { target: string; options: { destination?: number } };
    expect(transport.target).toBe("pino-pretty");
    // pino-pretty defaults to fd 1 when `destination` is absent — the option
    // must be present *and* be stderr.
    expect(transport.options.destination).toBe(LOG_DESTINATION_FD);
  });

  it("JSON output (LOG_FORMAT=json) uses a stderr destination", () => {
    const config = resolveLoggerConfig({ LOG_FORMAT: "json" });
    expect(config.format).toBe("json");
    if (config.format !== "json") throw new Error("unreachable");
    expect(config.destinationFd).toBe(LOG_DESTINATION_FD);
    expect(config.options.transport).toBeUndefined();
  });

  it("JSON output (NODE_ENV=production) uses a stderr destination", () => {
    const config = resolveLoggerConfig({ NODE_ENV: "production" });
    expect(config.format).toBe("json");
    if (config.format !== "json") throw new Error("unreachable");
    expect(config.destinationFd).toBe(LOG_DESTINATION_FD);
  });

  it("keeps the redaction paths on both branches", () => {
    for (const env of [{}, { LOG_FORMAT: "json" }]) {
      const { options } = resolveLoggerConfig(env);
      expect((options.redact as { paths: string[] }).paths).toEqual(REDACT_PATHS);
    }
  });
});

describe("resolveLogLevel / usePrettyOutput", () => {
  it("honours a valid LOG_LEVEL, case-insensitively", () => {
    expect(resolveLogLevel({ LOG_LEVEL: "DEBUG" })).toBe("debug");
    expect(resolveLogLevel({ LOG_LEVEL: "warn" })).toBe("warn");
  });

  it("falls back to info on an unknown or absent LOG_LEVEL", () => {
    expect(resolveLogLevel({ LOG_LEVEL: "verbose" })).toBe("info");
    expect(resolveLogLevel({})).toBe("info");
  });

  it("is pretty by default and JSON under LOG_FORMAT=json or NODE_ENV=production", () => {
    expect(usePrettyOutput({})).toBe(true);
    expect(usePrettyOutput({ LOG_FORMAT: "json" })).toBe(false);
    expect(usePrettyOutput({ NODE_ENV: "production" })).toBe(false);
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
