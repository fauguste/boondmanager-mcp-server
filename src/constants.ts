// BoondManager API constants
export const DEFAULT_BASE_URL = "https://ui.boondmanager.com/api";
export const CHARACTER_LIMIT = 50000;
export const DEFAULT_PAGE_SIZE = 30;
export const MAX_PAGE_SIZE = 500;

// HTTP client defaults
// Timeout applied to every BoondManager API request. Overridable via
// BOOND_HTTP_TIMEOUT_MS to handle slow tenants or long reporting queries.
export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

// API paths
export const API_PATHS = {
  candidates: "/candidates",
  resources: "/resources",
  contacts: "/contacts",
  companies: "/companies",
  opportunities: "/opportunities",
  actions: "/actions",
  projects: "/projects",
  invoices: "/invoices",
  orders: "/orders",
  deliveries: "/deliveries",
  deliveriesGroupments: "/deliveries-groupments",
  absences: "/absences",
  absencesReports: "/absences-reports",
  expenses: "/expenses",
  expensesReports: "/expenses-reports",
  products: "/products",
  positionings: "/positionings",
  payments: "/payments",
  advantages: "/advantages",
  application: "/application",
  timesReports: "/times-reports",
  contracts: "/contracts",
  purchases: "/purchases",
  providerInvoices: "/provider-invoices",
  accounts: "/accounts",
  agencies: "/agencies",
  businessUnits: "/business-units",
  roles: "/roles",
  logs: "/logs",
  notifications: "/notifications",
  threads: "/threads",
  todolists: "/todolists",
  flags: "/flags",
  calendars: "/calendars",
  webhooks: "/webhooks",
  validations: "/validations",
  poles: "/poles",
  planningAbsences: "/planning-absences",
  reportingCompanies: "/reporting-companies",
  reportingProjects: "/reporting-projects",
  reportingResources: "/reporting-resources",
  reportingSynthesis: "/reporting-synthesis",
  reportingProductionPlans: "/reporting-production-plans",
} as const;

// Tab names available on entities (matching actual API endpoints)
export const ENTITY_TABS = {
  candidates: ["information", "technical-data", "administrative", "actions", "positionings"] as const,
  resources: ["information", "technical-data", "administrative", "advantages", "actions", "positionings", "projects", "times-reports", "expenses-reports", "absences-reports"] as const,
  contacts: ["information", "actions", "opportunities", "projects", "orders", "invoices"] as const,
  companies: ["information", "contacts", "actions", "opportunities", "projects", "orders", "invoices", "purchases", "provider-invoices"] as const,
  opportunities: ["information", "actions", "positionings", "projects", "simulation"] as const,
  projects: ["information", "actions", "simulation", "deliveries-groupments", "orders", "purchases", "productivity"] as const,
  invoices: ["information", "actions", "billable-items"] as const,
  orders: ["information", "actions", "invoices"] as const,
} as const;
