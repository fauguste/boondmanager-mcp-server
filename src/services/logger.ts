import pino from "pino";
import { readString } from "../config/env.js";
import { randomUUID } from "node:crypto";

/**
 * Redaction paths for the structured logger. Defence-in-depth: nothing in the
 * codebase currently logs auth material, but if a request/error object that
 * carries credentials is ever passed to the logger, these paths censor it
 * before it reaches stderr / a log aggregator. Covers the BoondManager JWT
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
 * File descriptor every log line is written to: **stderr, on every transport**.
 *
 * On the stdio transport stdout *is* the JSON-RPC channel — anything that is
 * not an MCP message corrupts the stream and the client drops the connection.
 * Pino defaults to fd 1, and so does the pino-pretty transport when no
 * `destination` is given, which is exactly how the "Access policy active"
 * line, the update notice and the dictionary-override warnings used to land in
 * the middle of the protocol (issue #225). stderr is what Claude Desktop
 * captures into its log viewer, and it is equally fine for the HTTP transport,
 * so there is one destination rather than one per transport.
 */
export const LOG_DESTINATION_FD = 2;

const VALID_LEVELS: readonly pino.Level[] = ["trace", "debug", "info", "warn", "error", "fatal"];

/**
 * Read the log level from env, falling back to 'info' for production-friendly
 * defaults. DEBUG / trace logs are useful during development but too noisy
 * in production. Pino's level hierarchy: trace < debug < info < warn < error < fatal.
 */
export function resolveLogLevel(env: NodeJS.ProcessEnv = process.env): pino.Level {
  const raw = readString("LOG_LEVEL", env)?.trim().toLowerCase();
  if (raw && VALID_LEVELS.includes(raw as pino.Level)) return raw as pino.Level;
  return "info";
}

/** Human-readable (pretty) output in dev, JSON in prod. Override via LOG_FORMAT. */
export function usePrettyOutput(env: NodeJS.ProcessEnv = process.env): boolean {
  return readString("LOG_FORMAT", env)?.trim() !== "json" && readString("NODE_ENV", env)?.trim() !== "production";
}

export type LoggerConfig =
  | { format: "pretty"; options: pino.LoggerOptions & { transport: pino.TransportSingleOptions } }
  | { format: "json"; options: pino.LoggerOptions; destinationFd: number };

/**
 * The two shapes the logger can take, as data — so a test can assert where each
 * one writes without spawning a process. Pino refuses a stream argument when
 * `transport` is set (the transport runs in a worker thread), which is why the
 * destination travels inside the pino-pretty options on one branch and as a
 * `pino.destination()` on the other.
 */
export function resolveLoggerConfig(env: NodeJS.ProcessEnv = process.env): LoggerConfig {
  const base: pino.LoggerOptions = {
    level: resolveLogLevel(env),
    redact: { paths: REDACT_PATHS, censor: "[Redacted]" },
  };
  if (usePrettyOutput(env)) {
    return {
      format: "pretty",
      options: {
        ...base,
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
            destination: LOG_DESTINATION_FD,
          },
        },
      },
    };
  }
  return { format: "json", options: base, destinationFd: LOG_DESTINATION_FD };
}

export function createLogger(env: NodeJS.ProcessEnv = process.env): pino.Logger {
  const config = resolveLoggerConfig(env);
  if (config.format === "pretty") return pino(config.options);
  return pino(config.options, pino.destination(config.destinationFd));
}

/**
 * Centralized structured logger. Use this instead of console.log/error for
 * all application logging — it provides timestamps, levels, and JSON output
 * (when LOG_FORMAT=json) that plays nicely with log aggregators. It always
 * writes to stderr (see `LOG_DESTINATION_FD`).
 *
 * Example:
 *   logger.info({ sessionId: "abc", userId: 123 }, "Session initialized");
 *   logger.error({ err, endpoint: "/mcp" }, "HTTP transport error");
 */
export const logger = createLogger();

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
