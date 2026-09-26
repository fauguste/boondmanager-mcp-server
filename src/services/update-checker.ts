import { logger } from "./logger.js";
import { readBool } from "../config/env.js";

const NPM_REGISTRY_URL = "https://registry.npmjs.org";
const DEFAULT_TIMEOUT_MS = 3000;

export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
  releaseUrl: string;
}

function parseSemverCore(v: string): [number, number, number] | null {
  const core = v.split(/[-+]/)[0] ?? "";
  const parts = core.split(".");
  if (parts.length !== 3) return null;
  const [major, minor, patch] = parts.map((p) => Number(p));
  if (major === undefined || minor === undefined || patch === undefined) return null;
  if ([major, minor, patch].some((n) => !Number.isInteger(n) || n < 0)) return null;
  return [major, minor, patch];
}

function isNewer(latest: string, current: string): boolean {
  const a = parseSemverCore(latest);
  const b = parseSemverCore(current);
  if (!a || !b) return false;
  const pairs: [number, number][] = [
    [a[0], b[0]],
    [a[1], b[1]],
    [a[2], b[2]],
  ];
  for (const [x, y] of pairs) {
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

export async function checkForUpdate(opts: {
  currentVersion: string;
  packageName: string;
  timeoutMs?: number;
}): Promise<UpdateInfo | null> {
  const { currentVersion, packageName, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const url = `${NPM_REGISTRY_URL}/${packageName}/latest`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    if (typeof body.version !== "string") return null;
    return {
      current: currentVersion,
      latest: body.version,
      updateAvailable: isNewer(body.version, currentVersion),
      releaseUrl: `https://www.npmjs.com/package/${packageName}/v/${body.version}`,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function isUpdateCheckDisabled(): boolean {
  return readBool("BOOND_DISABLE_UPDATE_CHECK", false);
}

export async function runUpdateNotification(opts: {
  currentVersion: string;
  packageName: string;
  timeoutMs?: number;
}): Promise<void> {
  if (isUpdateCheckDisabled()) return;
  const info = await checkForUpdate(opts);
  if (!info?.updateAvailable) return;
  logger.warn(
    {
      event: "update_available",
      current: info.current,
      latest: info.latest,
      url: info.releaseUrl,
    },
    `BoondManager MCP Server ${info.latest} is available (current: ${info.current}). Download: ${info.releaseUrl}`
  );
}
