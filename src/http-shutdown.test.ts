import { describe, it, expect, beforeAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer as createNetServer, connect as netConnect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Issue #237 — the HTTP entry point must survive a second SIGTERM and must
 * exit within its grace period even with a connection still open.
 *
 * Exercised on the real `dist/index.js` because the defect lives in the
 * signal handler of `src/index.ts`: before the fix a second signal called
 * `close()` on an already-closed server and left an unhandled rejection, and
 * nothing bounded a shutdown blocked by an open stream (Kubernetes ended it
 * with SIGKILL).
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..");
const entryPoint = join(projectRoot, "dist", "index.js");
const TIMEOUT_MS = 15_000;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = address && typeof address === "object" ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  elapsedMs: number;
}

/** Start the HTTP server, open a stuck connection, send SIGTERM twice, wait for exit. */
function runShutdownScenario(port: number, shutdownTimeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entryPoint], {
      cwd: projectRoot,
      env: {
        ...process.env,
        MCP_TRANSPORT: "http",
        MCP_HTTP_HOST: "127.0.0.1",
        MCP_HTTP_PORT: String(port),
        MCP_HTTP_SHUTDOWN_TIMEOUT_MS: String(shutdownTimeoutMs),
        // Loopback static auth needs no API key; dummy credentials, nothing calls Boond.
        BOOND_HTTP_STATIC_AUTH: "true",
        BOOND_USER_TOKEN: "user-token",
        BOOND_CLIENT_TOKEN: "client-token",
        BOOND_CLIENT_KEY: "client-key",
        BOOND_DISABLE_UPDATE_CHECK: "1",
        LOG_LEVEL: "warn",
        LOG_FORMAT: "json",
        NODE_ENV: "",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    let signalled = false;
    let started = 0;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`server did not exit within ${TIMEOUT_MS} ms\n${stderr}`));
    }, TIMEOUT_MS);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (signalled || !stderr.includes("Endpoint:")) return;
      signalled = true;
      // A request whose *headers* never complete: the parser has started a
      // message, so Node's close() does not reap the socket as idle — only the
      // grace-period destroy ends it (a request stalled mid-body is reset by
      // close() itself, see http.test.ts).
      const socket = netConnect(port, "127.0.0.1", () => {
        socket.write("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\n");
        setTimeout(() => {
          started = Date.now();
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGTERM"), 50);
        }, 50);
      });
      socket.on("error", () => undefined);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stderr, elapsedMs: Date.now() - started });
    });
  });
}

describe("HTTP transport shutdown (issue #237)", () => {
  beforeAll(() => {
    if (existsSync(entryPoint)) return;
    const build = spawnSync("npx", ["tsc"], { cwd: projectRoot, stdio: "inherit" });
    if (build.status !== 0) throw new Error("tsc failed; cannot run the shutdown probe");
  }, 120_000);

  it(
    "exits 0 within the grace period on a double SIGTERM with a connection still open",
    async () => {
      const port = await freePort();
      const result = await runShutdownScenario(port, 500);
      expect(result.signal).toBeNull();
      expect(result.code).toBe(0);
      // Bounded by the grace period, not by the 15 s kill switch above.
      expect(result.elapsedMs).toBeGreaterThanOrEqual(400);
      expect(result.elapsedMs).toBeLessThan(5_000);
      expect(result.stderr).toContain("shutdown already in progress");
      expect(result.stderr).not.toMatch(/ERR_SERVER_NOT_RUNNING|UnhandledPromiseRejection|unhandledRejection/);
    },
    TIMEOUT_MS + 5_000
  );
});
