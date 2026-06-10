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
import type { DomainName } from "./constants.js";
import { resolveAccessPolicy, isDomainAllowed, withPolicy, type AccessPolicy } from "./config/access-policy.js";

// Re-exported for the catalogue generator and tests that import it from here.
export { REGISTERED_DOMAINS } from "./constants.js";
export type { DomainName } from "./constants.js";

export const SERVER_NAME = "boondmanager-mcp-server";

/**
 * Read the package version from `package.json` so the value advertised over
 * MCP `initialize` always matches the published artefact. CI already enforces
 * version parity between `package.json`, `manifest.json`, and `server.json`,
 * so resolving from `package.json` is sufficient.
 *
 * The compiled file lives at `dist/server.js`, mirroring `src/server.ts`,
 * so `../package.json` is correct in both layouts.
 */
function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(here, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
    if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
  } catch {
    // Fall through to the placeholder — surface a recognisable value rather
    // than crashing the server on a missing package.json.
  }
  return "0.0.0-unknown";
}

export const SERVER_VERSION = readPackageVersion();

/**
 * Domain → registration function, in the canonical order of REGISTERED_DOMAINS.
 * Coupling the domain name to its registrar lets the access policy filter by
 * domain WITHOUT parsing tool names (no fragile regex on multi-word domains
 * like `provider-invoices`). Each registrar accepts an optional policy; only
 * `registerWorkflowTools` uses it (to mirror the prompt-level domain filter),
 * the others ignore the extra argument.
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
 */
export function registerAll(server: McpServer, policy: AccessPolicy): void {
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
    if (allowed) register(target, policy);
  }

  registerAllPrompts(target, policy);
  registerAllResources(target);
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Operator-configured restrictions (env-driven). Absent config = full surface.
  registerAll(server, resolveAccessPolicy());

  return server;
}
