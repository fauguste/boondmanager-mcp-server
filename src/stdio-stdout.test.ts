import { describe, it, expect, beforeAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Issue #225 — on the stdio transport, stdout *is* the JSON-RPC stream.
 *
 * This is the only test that exercises the real entry point (`dist/index.js`)
 * as a child process, because the defect cannot be seen from inside the
 * process: pino writes through a worker thread (pino-pretty) or a SonicBoom
 * on a raw file descriptor, neither of which goes through `process.stdout`,
 * so a `vi.spyOn(process.stdout, "write")` would stay green while the client
 * receives corrupted frames.
 *
 * Scenario: an access policy with an unknown domain, which makes the server
 * emit a WARN and an INFO ("Access policy active") *before* it answers
 * `initialize`. Before the fix those blocks landed on stdout, multi-line and
 * colourised, right after the `initialize` response.
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..");
const entryPoint = join(projectRoot, "dist", "index.js");

/** Run the server until this marker shows up on stderr, then stop it. */
const STDERR_MARKER = "Access policy active";
const TIMEOUT_MS = 8_000;

interface ProbeResult {
  stdout: string;
  stderr: string;
}

function initializeRequest(): string {
  return (
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "stdout-probe", version: "0.0.0" },
      },
    }) + "\n"
  );
}

function probeStdio(extraEnv: NodeJS.ProcessEnv): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entryPoint], {
      cwd: projectRoot,
      env: {
        ...process.env,
        // Dummy credentials: initClient() must succeed, nothing calls the API.
        BOOND_USER_TOKEN: "user-token",
        BOOND_CLIENT_TOKEN: "client-token",
        BOOND_CLIENT_KEY: "client-key",
        BOOND_DISABLE_UPDATE_CHECK: "1",
        // The trigger: one unknown domain → WARN + the "Access policy active" INFO.
        BOOND_MCP_DOMAINS: "candidates,bogusdomain",
        LOG_LEVEL: "info",
        NODE_ENV: "",
        LOG_FORMAT: "",
        ...extraEnv,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let sawResponse = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      resolve({ stdout, stderr });
    };
    const maybeFinish = (): void => {
      // The log lines are emitted from createMcpServer(), before the response
      // is written; waiting for both means nothing is still in flight when we
      // read the buffers. On a regression the marker never reaches stderr and
      // the timeout path hands the polluted stdout to the assertions.
      if (sawResponse && stderr.includes(STDERR_MARKER)) setTimeout(finish, 100);
    };

    const timer = setTimeout(finish, TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.includes('"id":1')) sawResponse = true;
      maybeFinish();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      maybeFinish();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", () => finish());

    child.stdin.write(initializeRequest());
  });
}

function assertStdoutIsPureJsonRpc(stdout: string): void {
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Non-JSON line on stdout (would corrupt the MCP stream): ${JSON.stringify(line.slice(0, 160))}`);
    }
    expect(parsed).toMatchObject({ jsonrpc: "2.0" });
  }
}

describe("stdio transport keeps stdout for JSON-RPC (issue #225)", () => {
  beforeAll(() => {
    // CI builds before running the tests; locally, build on demand so the
    // test never silently skips.
    if (existsSync(entryPoint)) return;
    const build = spawnSync("npx", ["tsc"], { cwd: projectRoot, stdio: "inherit" });
    if (build.status !== 0) throw new Error("tsc failed; cannot run the stdio probe");
  }, 120_000);

  it(
    "pretty logger (dev default): every stdout line is JSON-RPC, warnings go to stderr",
    async () => {
      const { stdout, stderr } = await probeStdio({});
      assertStdoutIsPureJsonRpc(stdout);
      expect(stdout).toContain('"protocolVersion"');
      expect(stderr).toContain("bogusdomain");
      expect(stderr).toContain(STDERR_MARKER);
      expect(stdout).not.toContain("bogusdomain");
    },
    TIMEOUT_MS + 2_000
  );

  it(
    "JSON logger (LOG_FORMAT=json): every stdout line is JSON-RPC, warnings go to stderr",
    async () => {
      const { stdout, stderr } = await probeStdio({ LOG_FORMAT: "json" });
      assertStdoutIsPureJsonRpc(stdout);
      expect(stdout).toContain('"protocolVersion"');
      // Pino JSON lines are JSON too — that is precisely why the stdout check
      // above is not enough on its own: the log must be on the *other* stream.
      expect(stderr).toContain("bogusdomain");
      expect(stderr).toContain(STDERR_MARKER);
      expect(stdout).not.toContain("bogusdomain");
      expect(stdout).not.toContain(STDERR_MARKER);
    },
    TIMEOUT_MS + 2_000
  );
});
