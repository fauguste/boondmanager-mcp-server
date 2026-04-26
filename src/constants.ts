// BoondManager API constants
export const DEFAULT_BASE_URL = "https://ui.boondmanager.com/api";
export const CHARACTER_LIMIT = 50000;
export const DEFAULT_PAGE_SIZE = 30;
export const MAX_PAGE_SIZE = 500;

// Cap the page number on search tools (openWorldHint) to prevent runaway
// iterations. At 500 results/page, page 100 = 50k records — well beyond
// typical interactive exploration. The model can refine filters instead.
export const MAX_SEARCH_PAGE = 100;

// HTTP client defaults
// Timeout applied to every BoondManager API request. Overridable via
// BOOND_HTTP_TIMEOUT_MS to handle slow tenants or long reporting queries.
export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

// Retry policy for transient failures. Override via BOOND_HTTP_MAX_RETRIES,
// BOOND_HTTP_RETRY_BASE_MS, BOOND_HTTP_RETRY_MAX_MS. Set MAX_RETRIES to 0 to
// disable retries entirely.
export const DEFAULT_HTTP_MAX_RETRIES = 2;
export const DEFAULT_HTTP_RETRY_BASE_MS = 200;
export const DEFAULT_HTTP_RETRY_MAX_MS = 5_000;

// Client-side rate limit (token bucket). Modest defaults: invisible during
// interactive use, but cap pathological loops before BoondManager 429s us.
// Override via BOOND_HTTP_RATE_LIMIT_RPS / BOOND_HTTP_RATE_LIMIT_BURST.
// Set RPS to 0 to disable rate limiting entirely.
export const DEFAULT_HTTP_RATE_LIMIT_RPS = 10;
export const DEFAULT_HTTP_RATE_LIMIT_BURST = 20;

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
