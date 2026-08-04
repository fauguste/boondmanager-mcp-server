import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListPromptsRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { DomainName } from "./constants.js";
import { PROMPTS } from "./prompts/index.js";
import { isFeatureDisabled } from "./config/env-flags.js";
import type { RegistrationIndex } from "./tools/registration-decorators.js";

/**
 * Protocol-level icons (SEP-973, spec 2025-11-25) for tools, prompts and
 * resources.
 *
 * ## Scope: one icon per *domain*, not per tool
 *
 * 180 hand-picked icons would be unmaintainable and would triple the byte cost
 * below. Every tool of a domain shares that domain's glyph, which is also what
 * a client UI wants: the icon groups the catalogue, the name distinguishes
 * inside the group.
 *
 * ## Byte cost
 *
 * `icons` rides on every entry of `tools/list`, so it competes with the tool
 * catalogue itself. Two consequences baked into the format below:
 *
 * - inline `data:` SVG only (no network fetch from the client, no asset to
 *   host, no CSP question);
 * - a deliberately spartan glyph vocabulary — 16×16 viewBox, single `<path>`,
 *   no `mimeType`/`sizes` fields (the data URI already carries the type, and an
 *   SVG is scalable by definition). `descriptions.test.ts` caps both the
 *   per-icon size and the total added to `tools/list`.
 *
 * ## Why a response decorator and not a `registerTool` option
 *
 * `@modelcontextprotocol/sdk@1.30` types `icons` on `Tool`/`Prompt`/`Resource`
 * but its `McpServer` never emits them: the `tools/list` and `prompts/list`
 * handlers build their entries field by field and drop anything else
 * (`server/mcp.js`). Resources are the exception — their listing spreads the
 * whole registration config, so `registerResource` can carry `icons` natively
 * (see `resources/index.ts`).
 *
 * So for tools and prompts we decorate the *responses*: `installProtocolIcons`
 * wraps the handlers the SDK installs, using only the public
 * `Server.setRequestHandler` API plus schema identity. When the SDK gains
 * first-class support, this whole shim can be deleted in favour of passing
 * `icons` in the registration config — `src/icons.test.ts` fails loudly if the
 * shim ever stops producing icons.
 */

export interface Icon {
  src: string;
  mimeType?: string;
  sizes?: string[];
}

/**
 * Mid-grey: legible on both light and dark client themes. A data-URI SVG can't
 * inherit `currentColor` from the host UI, so a single neutral tone beats
 * shipping a light/dark pair (which would double the payload).
 */
const ICON_COLOR = "%237d8794";

/**
 * `BOOND_MCP_ICONS=0|false|no|off` drops icons everywhere. Measured cost of the
 * full set: ~40 KiB, i.e. ~14% of the 295 KiB `tools/list` payload (180 tools ×
 * ~230 B). Worth it for a client that renders them, pure overhead for a gateway
 * that doesn't — hence the switch.
 */
function iconsDisabled(): boolean {
  return isFeatureDisabled(process.env.BOOND_MCP_ICONS);
}

/**
 * Build the data URI for a single-path 16×16 glyph.
 *
 * Path data uses `,` as its number separator rather than a space: both are
 * valid SVG, and a comma needs no percent-encoding inside a `data:` URI (a
 * space does). The markup's own spaces are written as `%20` so the URI stays
 * valid unquoted.
 */
function glyph(path: string): Icon {
  return {
    src:
      `data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'` +
      `%20fill='${ICON_COLOR}'%3E%3Cpath%20d='${path.replace(/ /g, ",")}'/%3E%3C/svg%3E`,
  };
}

// ---- Glyph vocabulary (reused across domains) ----
const PERSON = glyph("M8 3a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM3 14v-1c0-1.7 2.2-3 5-3s5 1.3 5 3v1z");
const PEOPLE = glyph(
  "M5 4a2 2 0 100 4 2 2 0 000-4zm6 0a2 2 0 100 4 2 2 0 000-4zM1 14v-1c0-1.4 1.8-2.5 4-2.5s4 1.1 4 2.5v1zm8 0v-1c0-1 .7-1.9 1.9-2.4 1.8.2 3.1 1.2 3.1 2.4v1z"
);
const BUILDING = glyph("M3 2h10v12H3zm2 2h2v2H5zm4 0h2v2H9zM5 8h2v2H5zm4 0h2v2H9zm-2 4h2v2H7z");
const TARGET = glyph("M8 2a6 6 0 100 12A6 6 0 008 2zm0 4a2 2 0 100 4 2 2 0 000-4z");
const BRIEFCASE = glyph("M6 2h4v2h3v9H3V4h3zm1 1v1h2V3z");
const DOCUMENT = glyph("M4 1h5l3 3v11H4zm1 5h6v1H5zm0 3h6v1H5zm0 3h4v1H5z");
const CALENDAR = glyph("M3 3h10v11H3zm2-2h1v3H5zm5 0h1v3h-1zM4 6h8v1H4z");
const CLOCK = glyph("M8 2a6 6 0 100 12A6 6 0 008 2zm-.5 2h1v3.7l2.3 1.4-.5.9L7.5 8.4z");
const MONEY = glyph("M2 4h12v8H2zm6 1.5A2.5 2.5 0 118 10.5a2.5 2.5 0 010-5z");
const CART = glyph("M1 2h2l2 8h8l1-5H5v-1h10l-2 8H4L2 3H1zm4 10h1.5v1.5H5zm6 0h1.5v1.5H11z");
const BOX = glyph("M8 1l6 3-6 3-6-3zM2 6l6 3v6l-6-3zm12 0v6l-6 3V9z");
const CHART = glyph("M2 13h12v1H2zm1-5h2v4H3zm4-4h2v8H7zm4 2h2v6h-2z");
const LIST = glyph("M2 3h12v2H2zm0 4h12v2H2zm0 4h12v2H2z");
const CHECK = glyph("M6.5 13L2 8.5l1.4-1.4 3.1 3.1L12.6 4l1.4 1.4z");
const TAG = glyph("M2 2h6l6 6-6 6-6-6zm2 2v2h2V4z");
const GEAR = glyph(
  "M7 1h2v2H7zm0 12h2v2H7zM1 7h2v2H1zm12 0h2v2h-2zM8 4.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zm0 2a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"
);
const BELL = glyph("M8 1a4 4 0 00-4 4v4l-1 2h10l-1-2V5a4 4 0 00-4-4zm-1.5 12h3a1.5 1.5 0 01-3 0z");
const CHAT = glyph("M2 3h12v8H7l-3 3v-3H2z");
const PLUG = glyph("M4 1h2v4H4zm6 0h2v4h-2zM3 6h10v2a5 5 0 01-4 4.9V15H7v-2.1A5 5 0 013 8z");
const KEY = glyph(
  "M10 2a4 4 0 00-3.9 5L2 11.1V14h3v-2h2v-1.2l.9-.9A4 4 0 1010 2zm1 2.2a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z"
);
const PIN = glyph(
  "M8 1a4.5 4.5 0 00-4.5 4.5C3.5 9 8 15 8 15s4.5-6 4.5-9.5A4.5 4.5 0 008 1zm0 2.8a1.8 1.8 0 110 3.6 1.8 1.8 0 010-3.6z"
);
const PLANE = glyph("M8 1l1.2 5.5L15 8l-5.8 1.5L8 15l-1.2-5.5L1 8l5.8-1.5z");

/**
 * Domain → icons. Every entry of `REGISTERED_DOMAINS` must be present
 * (asserted in `icons.test.ts`), so adding a domain without an icon fails CI
 * rather than shipping a half-iconified catalogue.
 */
export const DOMAIN_ICONS: Readonly<Record<DomainName, Icon[]>> = {
  candidates: [PERSON],
  resources: [PEOPLE],
  contacts: [PERSON],
  companies: [BUILDING],
  opportunities: [TARGET],
  actions: [CHAT],
  timesheets: [CLOCK],
  projects: [BRIEFCASE],
  invoices: [DOCUMENT],
  orders: [DOCUMENT],
  deliveries: [BRIEFCASE],
  absences: [PLANE],
  expenses: [MONEY],
  products: [BOX],
  positionings: [TARGET],
  payments: [MONEY],
  advantages: [MONEY],
  application: [GEAR],
  contracts: [DOCUMENT],
  purchases: [CART],
  "provider-invoices": [DOCUMENT],
  accounts: [KEY],
  agencies: [BUILDING],
  "business-units": [BUILDING],
  roles: [KEY],
  logs: [LIST],
  notifications: [BELL],
  threads: [CHAT],
  todolists: [CHECK],
  flags: [TAG],
  calendars: [CALENDAR],
  webhooks: [PLUG],
  validations: [CHECK],
  poles: [PIN],
  reporting: [CHART],
  "planning-absences": [CALENDAR],
  documents: [DOCUMENT],
  workflows: [LIST],
};

/**
 * Icons for the dictionary / reference resources (`boond://…`). Resolved
 * through a function, not a constant, because `registerAllResources` runs at
 * startup and must honour `BOOND_MCP_ICONS` too.
 */
export function referenceIcons(): Icon[] | undefined {
  return iconsDisabled() ? undefined : [LIST];
}

/** Icons for the `current-user` resource. */
export function identityIcons(): Icon[] | undefined {
  return iconsDisabled() ? undefined : [PERSON];
}

export function iconsForDomain(domain: DomainName | undefined): Icon[] | undefined {
  if (domain === undefined || iconsDisabled()) return undefined;
  return DOMAIN_ICONS[domain];
}

/**
 * Prompt → icons, from the first domain the prompt orchestrates (its subject:
 * `factures_a_relancer` → invoices, `synthese_equipe` → resources).
 */
export function iconsForPrompt(name: string): Icon[] | undefined {
  const prompt = PROMPTS.find((p) => p.name === name);
  return iconsForDomain(prompt?.domains[0]);
}

/** Total byte cost of an icon payload, for the cap test and the docs. */
export function iconsByteSize(icons: readonly Icon[] | undefined): number {
  return icons === undefined ? 0 : JSON.stringify(icons).length;
}

type AnyHandler = (...args: unknown[]) => unknown;

function withIcons<T extends { name: string }>(entry: T, icons: Icon[] | undefined): T {
  return icons === undefined || icons.length === 0 ? entry : { ...entry, icons };
}

/**
 * Attach domain icons to `tools/list` and `prompts/list` responses.
 *
 * MUST be called before the first `registerTool` / `registerPrompt` on this
 * server: it works by intercepting the `setRequestHandler` calls the SDK makes
 * when it lazily installs those handlers. `index` is read at request time, so
 * it can still be empty at install time.
 */
export function installProtocolIcons(server: McpServer, index: RegistrationIndex): void {
  // `Server.setRequestHandler` is generic over the request schema; the shim is
  // schema-agnostic, hence the single cast at the boundary.
  const underlying = server.server as unknown as {
    setRequestHandler: (schema: unknown, handler: AnyHandler) => void;
  };
  const original = underlying.setRequestHandler.bind(underlying);

  underlying.setRequestHandler = (schema: unknown, handler: AnyHandler) => {
    if (schema === ListToolsRequestSchema) {
      return original(schema, async (...args: unknown[]) => {
        const result = (await handler(...args)) as { tools?: Array<{ name: string }> };
        if (!Array.isArray(result?.tools)) return result;
        return {
          ...result,
          tools: result.tools.map((t) => withIcons(t, iconsForDomain(index.toolDomains.get(t.name)))),
        };
      });
    }
    if (schema === ListPromptsRequestSchema) {
      return original(schema, async (...args: unknown[]) => {
        const result = (await handler(...args)) as { prompts?: Array<{ name: string }> };
        if (!Array.isArray(result?.prompts)) return result;
        return { ...result, prompts: result.prompts.map((p) => withIcons(p, iconsForPrompt(p.name))) };
      });
    }
    return original(schema, handler);
  };
}
