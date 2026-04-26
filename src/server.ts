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
} from "./tools/index.js";
import { registerAllPrompts } from "./prompts/index.js";
import { registerAllResources } from "./resources/index.js";

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

export const REGISTERED_DOMAINS = [
  "candidates", "resources", "contacts", "companies", "opportunities", "actions",
  "timesheets", "projects", "invoices", "orders", "deliveries", "absences",
  "expenses", "products", "positionings", "payments", "advantages", "application",
  "contracts", "purchases", "provider-invoices", "accounts", "agencies",
  "business-units", "roles", "logs", "notifications", "threads", "todolists",
  "flags", "calendars", "webhooks", "validations", "poles", "reporting",
  "planning-absences",
] as const;

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerCandidateTools(server);
  registerResourceTools(server);
  registerContactTools(server);
  registerCompanyTools(server);
  registerOpportunityTools(server);
  registerActionTools(server);
  registerTimesheetTools(server);
  registerProjectTools(server);
  registerInvoiceTools(server);
  registerOrderTools(server);
  registerDeliveryTools(server);
  registerAbsenceTools(server);
  registerExpenseTools(server);
  registerProductTools(server);
  registerPositioningTools(server);
  registerPaymentTools(server);
  registerAdvantageTools(server);
  registerApplicationTools(server);
  registerContractTools(server);
  registerPurchaseTools(server);
  registerProviderInvoiceTools(server);
  registerAccountTools(server);
  registerAgencyTools(server);
  registerBusinessUnitTools(server);
  registerRoleTools(server);
  registerLogTools(server);
  registerNotificationTools(server);
  registerThreadTools(server);
  registerTodolistTools(server);
  registerFlagTools(server);
  registerCalendarTools(server);
  registerWebhookTools(server);
  registerValidationTools(server);
  registerPoleTools(server);
  registerReportingTools(server);
  registerPlanningAbsenceTools(server);

  registerAllPrompts(server);
  registerAllResources(server);

  return server;
}
