import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerCandidateTools,
  registerResourceTools,
  registerContactTools,
  registerCompanyTools,
  registerOpportunityTools,
  registerActionTools,
  registerTimesheetTools,
  registerProjectTools,
  registerInvoiceTools,
  registerOrderTools,
  registerDeliveryTools,
  registerAbsenceTools,
  registerExpenseTools,
  registerProductTools,
  registerPositioningTools,
  registerPaymentTools,
  registerAdvantageTools,
  registerApplicationTools,
  registerContractTools,
  registerPurchaseTools,
  registerProviderInvoiceTools,
  registerAccountTools,
  registerAgencyTools,
  registerBusinessUnitTools,
  registerRoleTools,
  registerLogTools,
  registerNotificationTools,
  registerThreadTools,
  registerTodolistTools,
  registerFlagTools,
  registerCalendarTools,
  registerWebhookTools,
  registerValidationTools,
  registerPoleTools,
  registerReportingTools,
  registerPlanningAbsenceTools,
  registerDocumentTools,
  registerWorkflowTools,
} from "./tools/index.js";
import { registerAllPrompts } from "./prompts/index.js";
import { registerAllResources } from "./resources/index.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import type { DomainName } from "./constants.js";
import { resolveAccessPolicy, isDomainAllowed, withPolicy, type AccessPolicy } from "./config/access-policy.js";
import {
  createRegistrationIndex,
  decorateRegistrations,
  type RegistrationIndex,
} from "./tools/registration-decorators.js";
import { installProtocolIcons } from "./icons.js";

// Re-exported for the catalogue generator and tests that import it from here.
export { REGISTERED_DOMAINS } from "./constants.js";
export type { DomainName } from "./constants.js";

export const SERVER_NAME = "boondmanager-mcp-server";

/**
 * Read `package.json` so the identity advertised over MCP `initialize` always
 * matches the published artefact. CI already enforces version parity between
 * `package.json`, `manifest.json`, `server.json` and `gemini-extension.json`,
 * so `package.json` is the single source of truth here — no extra file to keep
 * in sync at release time.
 *
 * The compiled file lives at `dist/server.js`, mirroring `src/server.ts`,
 * so `../package.json` is correct in both layouts. On any failure we fall back
 * to recognisable placeholders rather than crashing the server.
 */
function readPackageManifest(): { version?: unknown; description?: unknown } {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(here, "..", "package.json");
    const parsed: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
    // `JSON.parse` happily returns `null` (or a string, or a number) for a
    // well-formed but non-object file. Those reach the property accesses below,
    // which run at module evaluation time — a `TypeError` there means the
    // server never starts, with an opaque import stack. Degrade instead.
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as { version?: unknown; description?: unknown };
  } catch {
    return {};
  }
}

function readStringField(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

const packageManifest = readPackageManifest();

export const SERVER_VERSION = readStringField(packageManifest.version, "0.0.0-unknown");

/**
 * `Implementation.description` (MCP 2025-11-25) — a human-readable summary of
 * what this server does, returned in the `initialize` result alongside the
 * name/version. Sourced from `package.json` so it matches the npm listing and
 * `server.json` (the registry manifest) without a fifth source of truth.
 */
export const SERVER_DESCRIPTION = readStringField(
  packageManifest.description,
  "MCP server for the BoondManager API (ERP/CRM)"
);

/**
 * Domain → registration function, in the canonical order of REGISTERED_DOMAINS.
 * Coupling the domain name to its registrar lets the access policy filter by
 * domain WITHOUT parsing tool names (no fragile regex on multi-word domains
 * like `provider-invoices`). Each registrar accepts an optional policy; only
 * `registerWorkflowTools` uses it (to mirror the prompt-level domain filter),
 * the others ignore the extra argument.
 *
 * ⚠️ **The order of this array is a protocol guarantee, not a convenience.**
 * `tools/list` must return a deterministic sequence (recommended by the
 * 2026-07-28 revision) so clients can cache the catalogue and so the prompt
 * cache keeps hitting across sessions: the SDK lists tools in registration
 * order, which is this order. Reordering entries — or introducing
 * non-determinism inside a registrar (iterating a `Set`, a dynamically built
 * object, an async race) — invalidates every client-side cache of this
 * server's tool list. `src/server.test.ts` pins both properties.
 *
 * Exported so the TOOLS.md generator can reuse the exact same list/order
 * instead of duplicating it.
 */
export const TOOL_REGISTRARS: ReadonlyArray<readonly [DomainName, (server: McpServer, policy?: AccessPolicy) => void]> =
  [
    ["candidates", registerCandidateTools],
    ["resources", registerResourceTools],
    ["contacts", registerContactTools],
    ["companies", registerCompanyTools],
    ["opportunities", registerOpportunityTools],
    ["actions", registerActionTools],
    ["timesheets", registerTimesheetTools],
    ["projects", registerProjectTools],
    ["invoices", registerInvoiceTools],
    ["orders", registerOrderTools],
    ["deliveries", registerDeliveryTools],
    ["absences", registerAbsenceTools],
    ["expenses", registerExpenseTools],
    ["products", registerProductTools],
    ["positionings", registerPositioningTools],
    ["payments", registerPaymentTools],
    ["advantages", registerAdvantageTools],
    ["application", registerApplicationTools],
    ["contracts", registerContractTools],
    ["purchases", registerPurchaseTools],
    ["provider-invoices", registerProviderInvoiceTools],
    ["accounts", registerAccountTools],
    ["agencies", registerAgencyTools],
    ["business-units", registerBusinessUnitTools],
    ["roles", registerRoleTools],
    ["logs", registerLogTools],
    ["notifications", registerNotificationTools],
    ["threads", registerThreadTools],
    ["todolists", registerTodolistTools],
    ["flags", registerFlagTools],
    ["calendars", registerCalendarTools],
    ["webhooks", registerWebhookTools],
    ["validations", registerValidationTools],
    ["poles", registerPoleTools],
    ["reporting", registerReportingTools],
    ["planning-absences", registerPlanningAbsenceTools],
    ["documents", registerDocumentTools],
    ["workflows", registerWorkflowTools],
  ];

/**
 * Register the full (policy-filtered) tool/prompt/resource surface onto a
 * server. Extracted from createMcpServer so tests can exercise the exact same
 * wiring against a stub server with an arbitrary policy.
 *
 * - `target` is either the server itself (no operation filter) or a Proxy that
 *   drops disallowed-operation tools at registration time.
 * - Tool domains are skipped wholesale when the domain is disallowed.
 * - Prompts are domain-filtered (a prompt is cut if any domain it orchestrates
 *   is disallowed, so the runbook never points at missing tools).
 * - Resources (reference dictionaries) are left intact (the lookup substrate).
 * - Each registrar is additionally wrapped per-domain
 *   (`decorateRegistrations`): search schemas get filter-correction messages,
 *   and every tool name is recorded against its domain for the icon layer.
 *
 * `index` is filled as a side effect; pass the one `installProtocolIcons` was
 * given so icons resolve. Callers that don't care (tests, catalogue generator)
 * can omit it.
 */
export function registerAll(server: McpServer, policy: AccessPolicy, index?: RegistrationIndex): void {
  const target = withPolicy(server, policy);

  for (const [domain, register] of TOOL_REGISTRARS) {
    // `workflows` is the tool-form mirror of the MCP prompts (1:1). It is
    // therefore gated like the prompts themselves: each workflow tool is kept
    // only when its source prompt's domains are all allowed (that per-prompt
    // filter lives inside registerWorkflowTools), and is NOT subject to
    // allow-list membership, so a prompt and its mirror tool always appear or
    // disappear together. An explicit deny (`BOOND_MCP_EXCLUDE_DOMAINS=workflows`)
    // still suppresses the whole tool-form mirror (e.g. "prompts only").
    const allowed = domain === "workflows" ? !policy.excludedDomains.has("workflows") : isDomainAllowed(policy, domain);
    if (allowed) register(decorateRegistrations(target, domain, index), policy);
  }

  registerAllPrompts(target, policy);
  registerAllResources(target);
}

export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      description: SERVER_DESCRIPTION,
    },
    {
      // Cross-cutting usage rules (filter naming, pagination ceilings,
      // dictionary resources) stated once here instead of once per tool.
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  // SEP-973 icons: installed BEFORE any registration, because it wraps the
  // list handlers the SDK sets up on the first registerTool/registerPrompt
  // call. The index it closes over is filled during registerAll below.
  const index = createRegistrationIndex();
  installProtocolIcons(server, index);

  // Operator-configured restrictions (env-driven). Absent config = full surface.
  registerAll(server, resolveAccessPolicy(), index);

  return server;
}
