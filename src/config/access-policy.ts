import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { REGISTERED_DOMAINS } from "../constants.js";
import { logger } from "../services/logger.js";

/**
 * Access policy: operator-side restriction of what the MCP server exposes,
 * driven entirely by environment variables. Two orthogonal axes:
 *
 *  1. Domain filtering (allow-list + deny-list): restrict the server to a
 *     subset of business domains (e.g. accounting only).
 *  2. Operation filtering: restrict which kinds of action are exposed
 *     (`read` / `create` / `update` / `delete`), e.g. read-only mode.
 *
 * ⚠️ This is NOT a hard security boundary. The server keeps using the
 * configured BoondManager credentials; if those credentials may write, this
 * filter only HIDES the tools from the model; it does not revoke anything
 * API-side. The real boundary is the BoondManager account/role rights. The
 * two are complementary: Boond rights = hard wall; this filter = ergonomics,
 * token economy, and a guard-rail against accidental actions.
 *
 * Env vars (all optional; absent = no restriction = current behaviour):
 *  - `BOOND_MCP_DOMAINS`         CSV allow-list of domains. Absent = all.
 *  - `BOOND_MCP_EXCLUDE_DOMAINS` CSV deny-list. Applied AFTER the allow-list.
 *  - `BOOND_MCP_OPERATIONS`      CSV of `read,create,update,delete`. Absent = all.
 *  - `BOOND_MCP_READ_ONLY`       Boolean shortcut, equivalent to OPERATIONS=read.
 */

export type Operation = "read" | "create" | "update" | "delete";

export const ALL_OPERATIONS: readonly Operation[] = ["read", "create", "update", "delete"];

/** Subset of the MCP tool annotations we use to classify a tool's operation. */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface AccessPolicy {
  /** `null` = all domains allowed (no allow-list). Otherwise the set of allowed canonical (dash) domain names. */
  allowedDomains: Set<string> | null;
  /** Canonical (dash) domain names explicitly denied. Applied after the allow-list. */
  excludedDomains: Set<string>;
  /** Operations the server is allowed to expose. */
  operations: Set<Operation>;
}

// --- Env parsing helpers (mirroring the patterns already used across the
// codebase: see transports/http.ts, services/oauth.ts, services/update-checker.ts) ---

function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  // Ignore unresolved placeholders like "${SOMETHING}" (same guard as http.ts).
  if (raw.startsWith("${")) return undefined;
  return raw;
}

/** Split a CSV / whitespace-separated env value into trimmed, non-empty tokens. */
function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseBoolean(raw: string | undefined): boolean {
  const v = (raw ?? "").toLowerCase().trim();
  return v === "1" || v === "true" || v === "yes";
}

/** Normalise a user-supplied domain to the canonical (dash, lowercase) form. */
function normalizeDomain(domain: string): string {
  return domain.toLowerCase().trim().replace(/_/g, "-");
}

function normalizeAndValidateDomains(
  items: string[],
  known: ReadonlySet<string>,
  varName: string,
  log: typeof logger
): Set<string> {
  const out = new Set<string>();
  for (const raw of items) {
    const norm = normalizeDomain(raw);
    if (known.has(norm)) {
      out.add(norm);
    } else {
      log.warn(
        { value: raw, normalized: norm, var: varName },
        `${varName}: unknown domain "${raw}" ignored (not one of the ${known.size} known domains)`
      );
    }
  }
  return out;
}

function validateOperations(items: string[], log: typeof logger): Set<Operation> {
  const out = new Set<Operation>();
  for (const raw of items) {
    const op = raw.toLowerCase() as Operation;
    if ((ALL_OPERATIONS as readonly string[]).includes(op)) {
      out.add(op);
    } else {
      log.warn(
        { value: raw },
        `BOOND_MCP_OPERATIONS: unknown operation "${raw}" ignored (expected read/create/update/delete)`
      );
    }
  }
  // If the operator provided only invalid values, fall back to "all" rather
  // than silently exposing zero tools (that would look like a broken server).
  if (out.size === 0) {
    log.warn("BOOND_MCP_OPERATIONS contained no valid operation; defaulting to all operations");
    return new Set<Operation>(ALL_OPERATIONS);
  }
  return out;
}

/**
 * Build the effective access policy from the environment. Resilient: unknown
 * domains/operations are warned-and-ignored, never fatal.
 */
export function resolveAccessPolicy(env: NodeJS.ProcessEnv = process.env): AccessPolicy {
  const log = logger.child({ component: "access-policy" });
  const known = new Set<string>(REGISTERED_DOMAINS);

  // --- Domains ---
  const allowItems = parseList(readEnv(env, "BOOND_MCP_DOMAINS"));
  const excludeItems = parseList(readEnv(env, "BOOND_MCP_EXCLUDE_DOMAINS"));

  const allowedDomains =
    allowItems.length > 0 ? normalizeAndValidateDomains(allowItems, known, "BOOND_MCP_DOMAINS", log) : null;
  const excludedDomains = normalizeAndValidateDomains(excludeItems, known, "BOOND_MCP_EXCLUDE_DOMAINS", log);

  // --- Operations ---
  const opItems = parseList(readEnv(env, "BOOND_MCP_OPERATIONS"));
  const readOnlyShortcut = parseBoolean(readEnv(env, "BOOND_MCP_READ_ONLY"));

  let operations: Set<Operation>;
  if (opItems.length > 0) {
    operations = validateOperations(opItems, log);
    if (readOnlyShortcut) {
      log.warn("Both BOOND_MCP_OPERATIONS and BOOND_MCP_READ_ONLY are set; BOOND_MCP_OPERATIONS takes precedence");
    }
  } else if (readOnlyShortcut) {
    operations = new Set<Operation>(["read"]);
  } else {
    operations = new Set<Operation>(ALL_OPERATIONS);
  }

  const policy: AccessPolicy = { allowedDomains, excludedDomains, operations };

  // --- Surface the effective policy + a guard-rail warning for `application` ---
  const restricted = allowedDomains !== null || excludedDomains.size > 0 || operations.size !== ALL_OPERATIONS.length;
  if (restricted) {
    if (!isDomainAllowed(policy, "application")) {
      log.warn(
        "Domain `application` is filtered out; dictionary lookups (state/type labels) and current-user resolution will be unavailable, degrading many tools/resources"
      );
    }
    log.info(
      {
        allowedDomains: allowedDomains ? [...allowedDomains] : "all",
        excludedDomains: [...excludedDomains],
        operations: [...operations],
      },
      "Access policy active: the exposed tool/prompt surface is restricted"
    );
  }

  return policy;
}

/** Is a business domain allowed by the policy? (deny-list wins over allow-list.) */
export function isDomainAllowed(policy: AccessPolicy, domain: string): boolean {
  const norm = normalizeDomain(domain);
  if (policy.excludedDomains.has(norm)) return false;
  if (policy.allowedDomains !== null && !policy.allowedDomains.has(norm)) return false;
  return true;
}

/**
 * Classify a tool into a single operation from its MCP annotations.
 * Order matters: read-only first, then destructive (delete), then idempotent
 * writes (update), else non-idempotent writes (create). A tool with no
 * `readOnlyHint:true` is treated as a write (the safe default in read-only mode).
 */
export function operationOf(annotations: ToolAnnotations | undefined): Operation {
  if (annotations?.readOnlyHint === true) return "read";
  if (annotations?.destructiveHint === true) return "delete";
  if (annotations?.idempotentHint === true) return "update";
  return "create";
}

/** Is a tool (by its annotations) allowed under the policy's operation set? */
export function isOperationAllowed(policy: AccessPolicy, annotations: ToolAnnotations | undefined): boolean {
  return policy.operations.has(operationOf(annotations));
}

/**
 * Wrap an McpServer so that `registerTool` silently drops tools whose operation
 * is not allowed by the policy. Implemented as a Proxy (no mutation of the
 * instance, typing preserved). Methods are bound to the real target so the
 * SDK's private fields keep working. Other methods (`registerPrompt`,
 * `registerResource`, …) pass straight through.
 *
 * Fast path: when all operations are allowed, the original server is returned
 * untouched (zero overhead in the default, unrestricted case).
 */
export function withPolicy(server: McpServer, policy: AccessPolicy): McpServer {
  if (policy.operations.size === ALL_OPERATIONS.length) return server;

  return new Proxy(server, {
    get(target, prop) {
      // receiver = target so any getters/private fields resolve against the real instance.
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== "function") return value;

      if (prop === "registerTool") {
        return (...args: unknown[]) => {
          const config = args[1] as { annotations?: ToolAnnotations } | undefined;
          if (!isOperationAllowed(policy, config?.annotations)) {
            return undefined; // skip registration; callers ignore the return value
          }
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }

      // Bind every other method to the real target (avoids private-field errors
      // that occur when an unbound method runs with `this` = Proxy).
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
}
