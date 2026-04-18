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

export const SERVER_NAME = "boondmanager-mcp-server";
export const SERVER_VERSION = "1.0.0";

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

  return server;
}
