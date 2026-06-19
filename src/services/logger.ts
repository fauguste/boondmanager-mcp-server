import pino from "pino";
import { randomUUID } from "node:crypto";

/**
 * Redaction paths for the structured logger. Defence-in-depth: nothing in the
 * codebase currently logs auth material, but if a request/error object that
 * carries credentials is ever passed to the logger, these paths censor it
 * before it reaches stdout / a log aggregator. Covers the BoondManager JWT
 * header, OAuth Bearer headers, and raw access tokens at one level of nesting.
 */
export const REDACT_PATHS = [
  "authorization",
  "Authorization",
  "*.authorization",
  "*.Authorization",
  "headers.authorization",
  "req.headers.authorization",
  "res.headers.authorization",
  'headers["x-jwt-client-boondmanager"]',
  'req.headers["x-jwt-client-boondmanager"]',
  "accessToken",
  "*.accessToken",
];

/**
 * Read the log level from env, falling back to 'info' for production-friendly
 * defaults. DEBUG / trace logs are useful during development but too noisy
 * in production. Pino's level hierarchy: trace < debug < info < warn < error < fatal.
 */
function resolveLogLevel(): pino.Level {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  const valid: pino.Level[] = ["trace", "debug", "info", "warn", "error", "fatal"];
  if (raw && valid.includes(raw as pino.Level)) return raw as pino.Level;
  return "info";
}

/**
 * Centralized structured logger. Use this instead of console.log/error for
 * all application logging — it provides timestamps, levels, and JSON output
 * (when LOG_FORMAT=json) that plays nicely with log aggregators.
 *
 * Example:
 *   logger.info({ sessionId: "abc", userId: 123 }, "Session initialized");
 *   logger.error({ err, endpoint: "/mcp" }, "HTTP transport error");
 */
export const logger = pino({
  level: resolveLogLevel(),
  redact: { paths: REDACT_PATHS, censor: "[Redacted]" },
  // Human-readable (pretty) output in dev, JSON in prod. Override via LOG_FORMAT.
  transport:
    process.env.LOG_FORMAT === "json" || process.env.NODE_ENV === "production"
      ? undefined
      : {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
});

/**
 * Generate a short correlation ID (8 hex chars) for tracing a single request
 * through the stack (HTTP handler → tool call → API request). Attach it to
 * logger child contexts so every log line from that request shares the ID.
 */
export function generateCorrelationId(): string {
  // randomUUID() is collision-resistant under high concurrency (unlike
  // Math.random); the first 8 chars of the hyphen-free first group give a
  // compact, still-unique-enough id for request tracing.
  return randomUUID().replace(/-/g, "").slice(0, 8);
}
