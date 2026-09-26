import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest, apiSearch, buildSearchQuery } from "../services/boond-client.js";
import { getDictionary, resolveDictionaryPath } from "../services/dictionary.js";
import { getDictionaryOverrides } from "../config/dictionary-overrides.js";
import { identityIcons, iconsForDomain, referenceIcons } from "../icons.js";
import { isDomainAllowed, type AccessPolicy } from "../config/access-policy.js";
import { ENTITY_TEMPLATES, readEntityAggregate, type EntityTemplate } from "./templates.js";
import { logger } from "../services/logger.js";

/** Ids offered per `completions/complete` call. The spec caps `values` at 100. */
const COMPLETION_PAGE_SIZE = 10;

/**
 * MCP resources for BoondManager reference data.
 *
 * Why expose these as resources rather than relying on the
 * `boond_application_dictionary` tool alone:
 * - Clients (Claude Desktop, LobeChat, MCP Inspector…) display resources in
 *   a browseable list. The user (or the model) discovers what's available
 *   without trial-and-error tool calls.
 * - The model can read a resource silently when it needs to translate an
 *   integer state id into a human label, instead of explaining a tool call.
 * - Read access is idempotent and cache-friendly: many MCP hosts cache the
 *   resource body for the duration of a conversation.
 *
 * Backing data: a single `GET /application/dictionary` call returns the whole
 * payload, which we cache (see `services/dictionary.ts`). Each resource read
 * extracts a sub-tree via a fixed slug→path mapping.
 */

interface DictionaryEntry {
  /** URI suffix, e.g. "states/resources". Joined with "boond://dictionary/". */
  slug: string;
  /** Dotted path inside the dictionary `data` object (e.g. "setting.state.resource"). */
  path: string;
  /** Human title shown to the user / model in the resource list. */
  title: string;
  /** One-line description. */
  description: string;
}

/**
 * Curated dictionaries surfaced as static MCP resources. Slugs follow the
 * historical "kind/entity" naming for backward compatibility with client URIs;
 * the API path mapping reflects the actual BoondManager `/application/dictionary`
 * response structure (cf. `data.setting.*`, `data.country`, `data.languages`).
 *
 * Slugs that do not map to a real path in the API (e.g. `states/absences`,
 * `typeOf/candidates`) are intentionally absent.
 */
const DICTIONARIES: DictionaryEntry[] = [
  // states/* — used to translate the integer `state` attribute on entities
  {
    slug: "states/resources",
    path: "setting.state.resource",
    title: "États ressources",
    description: "Libellés des états de ressource (collaborateur).",
  },
  {
    slug: "states/candidates",
    path: "setting.state.candidate",
    title: "États candidats",
    description: "Libellés des états de candidat.",
  },
  {
    slug: "states/contacts",
    path: "setting.state.contact",
    title: "États contacts",
    description: "Libellés des états de contact.",
  },
  {
    slug: "states/companies",
    path: "setting.state.company",
    title: "États sociétés",
    description: "Libellés des états de société.",
  },
  {
    slug: "states/opportunities",
    path: "setting.state.opportunity",
    title: "États opportunités",
    description: "Libellés des états d'opportunité commerciale.",
  },
  {
    slug: "states/projects",
    path: "setting.state.project",
    title: "États projets",
    description: "Libellés des états de projet/mission.",
  },
  {
    slug: "states/invoices",
    path: "setting.state.invoice",
    title: "États factures",
    description: "Libellés des états de facture client.",
  },
  {
    slug: "states/orders",
    path: "setting.state.order",
    title: "États bons de commande",
    description: "Libellés des états de bon de commande.",
  },
  {
    slug: "states/positionings",
    path: "setting.state.positioning",
    title: "États positionnements",
    description: "Libellés des états de positionnement.",
  },
  // typeOf/* — used to translate the integer `typeOf` attribute on entities
  {
    slug: "typeOf/resources",
    path: "setting.typeOf.resource",
    title: "Types ressources",
    description: "Types de ressource (interne, sous-traitant, freelance...).",
  },
  {
    slug: "typeOf/contacts",
    path: "setting.typeOf.contact",
    title: "Types contacts",
    description: "Types de contact.",
  },
  {
    slug: "typeOf/projects",
    path: "setting.typeOf.project",
    title: "Types projets",
    description: "Types de projet (régie, forfait, produit...).",
  },
  // Skills / referential
  {
    slug: "tools",
    path: "setting.tool",
    title: "Outils / Technos",
    description: "Catalogue des outils et technologies utilisables sur les ressources et candidats (Java, AWS, ...).",
  },
  {
    slug: "expertiseAreas",
    path: "setting.expertiseArea",
    title: "Domaines d'expertise",
    description: "Domaines d'expertise métier (DevOps, Data, Frontend, ...).",
  },
  {
    slug: "experiences",
    path: "setting.experience",
    title: "Niveaux d'expérience",
    description: "Niveaux d'expérience (junior, confirmé, senior, ...).",
  },
  {
    slug: "activityAreas",
    path: "setting.activityArea",
    title: "Secteurs d'activité",
    description: "Secteurs d'activité des sociétés clientes.",
  },
  {
    slug: "mobilityAreas",
    path: "setting.mobilityArea",
    title: "Mobilités",
    description: "Zones de mobilité géographique.",
  },
  // states/* on the finance / delivery entities (issue #261) — paths verified
  // against the live `/application/dictionary` on 2026-09-26. Deliberately
  // absent because the API publishes no such table: `states/contracts` (a
  // contract has no state), `states/validations` (the validation state of a
  // CRA / expense / absence report is a workflow *string* —
  // `waitingForValidation`, `validated`, `refused` —, see #250) and the absence
  // types (work-unit types, only on `/absences-reports/default`, #257).
  {
    slug: "states/deliveries",
    path: "setting.state.delivery",
    title: "États prestations",
    description: "Libellés des états de prestation (mission / delivery).",
  },
  {
    slug: "states/payments",
    path: "setting.state.payment",
    title: "États paiements",
    description: "Libellés des états de paiement (confirmé, en attente, rejeté...).",
  },
  {
    slug: "states/purchases",
    path: "setting.state.purchase",
    title: "États achats",
    description: "Libellés des états d'achat / sous-traitance.",
  },
  {
    slug: "states/provider-invoices",
    path: "setting.state.providerinvoice",
    title: "États factures fournisseurs",
    description: "Libellés des états de facture fournisseur (brouillon, à valider, validée, payée...).",
  },
  {
    slug: "states/products",
    path: "setting.state.product",
    title: "États produits",
    description: "Libellés des états de produit.",
  },
  {
    slug: "states/quotations",
    path: "setting.state.quotation",
    title: "États devis",
    description: "Libellés des états de devis (création, transmis au client, accepté...).",
  },
  {
    slug: "states/probations",
    path: "setting.state.probation",
    title: "États périodes d'essai",
    description: "Libellés des états de période d'essai d'un contrat (en cours, validée, rompue...).",
  },
  // typeOf/* — `typeOf/candidates`, `typeOf/opportunities` and
  // `typeOf/companies` do not exist in the dictionary (verified 2026-09-26).
  {
    slug: "typeOf/contracts",
    path: "setting.typeOf.contract",
    title: "Types contrats",
    description: "Types de contrat de travail (CDI, CDD, freelance, stage...).",
  },
  {
    slug: "typeOf/deliveries",
    path: "setting.typeOf.delivery",
    title: "Types prestations",
    description: "Types de prestation (nouvelle, renouvellement...).",
  },
  {
    slug: "typeOf/purchases",
    path: "setting.typeOf.purchase",
    title: "Types achats",
    description: "Types d'achat / sous-traitance.",
  },
  {
    slug: "typeOf/activities",
    path: "setting.typeOf.activity",
    title: "Types d'activité",
    description: "Types d'activité d'une ligne de CRA ou de frais (production, absence, interne...) — `activityType`.",
  },
  // actions/* — the action types are declared PER attached entity
  // (`setting.action.<entity>`); `boond_actions_create` needs the id that
  // matches the entity the action is attached to.
  {
    slug: "actions/candidates",
    path: "setting.action.candidate",
    title: "Types d'action — candidats",
    description:
      "Types d'action rattachables à un candidat (note, rappel, entretien...) : `typeOf` de `boond_actions_create` avec `candidateId`.",
  },
  {
    slug: "actions/contacts",
    path: "setting.action.contact",
    title: "Types d'action — contacts",
    description: "Types d'action rattachables à un contact : `typeOf` de `boond_actions_create` avec `contactId`.",
  },
  {
    slug: "actions/resources",
    path: "setting.action.resource",
    title: "Types d'action — ressources",
    description: "Types d'action rattachables à une ressource : `typeOf` de `boond_actions_create` avec `resourceId`.",
  },
  {
    slug: "actions/opportunities",
    path: "setting.action.opportunity",
    title: "Types d'action — opportunités",
    description:
      "Types d'action rattachables à une opportunité : `typeOf` de `boond_actions_create` avec `opportunityId`.",
  },
  {
    slug: "actions/projects",
    path: "setting.action.project",
    title: "Types d'action — projets",
    description: "Types d'action rattachables à un projet : `typeOf` de `boond_actions_create` avec `projectId`.",
  },
  {
    slug: "actions/invoices",
    path: "setting.action.invoice",
    title: "Types d'action — factures",
    description:
      "Types d'action rattachables à une facture (envoi, relance, note) — lus dans `boond_invoices_actions`.",
  },
  {
    slug: "actions/orders",
    path: "setting.action.order",
    title: "Types d'action — bons de commande",
    description: "Types d'action rattachables à un bon de commande — lus dans `boond_orders_actions`.",
  },
  // Origins / sources
  {
    slug: "sources",
    path: "setting.source",
    title: "Sources candidats",
    description: "Sources de candidature (job boards, cooptation, cabinet...) — `source` d'un candidat.",
  },
  {
    slug: "origins",
    path: "setting.origin",
    title: "Origines opportunités",
    description:
      "Origines d'une opportunité commerciale (prospection, apporteur d'affaires, appel d'offres...) — `origin`.",
  },
  // Finance settings used by invoice / order / purchase writes
  {
    slug: "paymentMethods",
    path: "setting.paymentMethod",
    title: "Modes de paiement",
    description:
      "Modes de paiement (virement, prélèvement, chèque...) — `paymentMethod` des factures, commandes et achats.",
  },
  {
    slug: "paymentTerms",
    path: "setting.paymentTerm",
    title: "Conditions de paiement",
    description:
      "Conditions de paiement (`x` jours, fin de mois `y`) — `paymentTerm` des factures, commandes et achats.",
  },
  {
    slug: "taxRates",
    path: "setting.taxRate",
    title: "Taux de TVA",
    description: "Taux de TVA configurés (`rate` en %, `code`) — `taxRate` des factures, achats et lignes de frais.",
  },
  {
    slug: "contractEndReasons",
    path: "setting.contractEndReason",
    title: "Motifs de fin de contrat",
    description: "Motifs de fin de contrat (démission, rupture conventionnelle...) — `endReason` d'un contrat.",
  },
  // Global lookups
  { slug: "countries", path: "country", title: "Pays", description: "Liste des pays (codes ISO + libellés)." },
  { slug: "currencies", path: "setting.currency", title: "Devises", description: "Liste des devises supportées." },
  {
    slug: "languages",
    path: "languages",
    title: "Langues",
    description: "Langues d'interface BoondManager (fr, en, es).",
  },
];

/** URI prefix under which all dictionaries are exposed. */
const DICTIONARY_URI_PREFIX = "boond://dictionary/";
/** URI of the cached identity resource. */
const CURRENT_USER_URI = "boond://application/current-user";
/** URI of the derived rights / perimeter view of the same payload (issue #261). */
const CURRENT_USER_RIGHTS_URI = "boond://application/current-user/rights";
/** URI of the static dictionary-overrides resource (no API call behind it). */
const OVERRIDES_URI = "boond://dictionary/overrides";

function buildResourceUri(slug: string): string {
  return `${DICTIONARY_URI_PREFIX}${slug}`;
}

/** Exposed for tests; lets us assert the catalog without booting a server. */
export const REGISTERED_RESOURCES = [
  ...DICTIONARIES.map((d) => ({
    name: `dictionary/${d.slug}`,
    uri: buildResourceUri(d.slug),
    title: d.title,
  })),
  { name: "dictionary/overrides", uri: OVERRIDES_URI, title: "Libellés personnalisés (overrides)" },
  { name: "application/current-user", uri: CURRENT_USER_URI, title: "Utilisateur courant" },
  {
    name: "application/current-user/rights",
    uri: CURRENT_USER_RIGHTS_URI,
    title: "Droits et périmètre de l'utilisateur",
  },
];

interface Included {
  id?: string;
  type?: string;
  attributes?: Record<string, unknown>;
}

/**
 * `advancedRights.<entity>` in `/application/current-user` is a deep object
 * (field-level write access, group-level read access, search perimeter). This
 * keeps what a caller needs before writing or scoping a search: whether the
 * entity is enabled, whether it may be created / deleted, and the perimeter
 * flags that are *on* (plus explicit id lists). Everything else is dropped —
 * the raw payload stays on `boond://application/current-user`.
 */
export function summariseRights(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [entity, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as {
      isEnabled?: unknown;
      entity?: { authorizations?: Record<string, unknown> };
      search?: { perimeter?: Record<string, unknown> };
    };
    const summary: Record<string, unknown> = {};
    if (typeof v.isEnabled === "boolean") summary.isEnabled = v.isEnabled;
    const auth = v.entity?.authorizations;
    if (auth && typeof auth === "object") {
      for (const [key, flag] of Object.entries(auth)) if (typeof flag === "boolean") summary[key] = flag;
    }
    const perimeter = v.search?.perimeter;
    if (perimeter && typeof perimeter === "object") {
      const active: Record<string, unknown> = {};
      for (const [key, flag] of Object.entries(perimeter)) {
        if (flag === true) active[key] = true;
        else if (Array.isArray(flag) && flag.length > 0) active[key] = flag;
      }
      if (Object.keys(active).length > 0) summary.perimeter = active;
    }
    if (Object.keys(summary).length > 0) out[entity] = summary;
  }
  return out;
}

/** The body of `boond://application/current-user/rights`, derived from the raw current-user payload. */
export function buildCurrentUserRights(response: { data?: unknown; included?: unknown }): Record<string, unknown> {
  const data = (Array.isArray(response.data) ? response.data[0] : response.data) as Included | undefined;
  const attributes = data?.attributes ?? {};
  const included = (Array.isArray(response.included) ? response.included : []) as Included[];
  const named = (type: string) =>
    included
      .filter((item) => item.type === type)
      .map((item) => ({ id: item.id, name: item.attributes?.name ?? item.attributes?.title ?? null }));
  const apps = included
    .filter((item) => item.type === "app")
    .map((item) => item.attributes?.name)
    .filter((name): name is string => typeof name === "string");
  return {
    id: data?.id,
    login: attributes.login,
    level: attributes.level,
    isOwner: attributes.isOwner,
    narrowPerimeter: attributes.narrowPerimeter,
    language: attributes.language,
    timezone: attributes.timezone,
    customer: named("customer")[0] ?? null,
    agencies: named("agency"),
    poles: named("pole"),
    businessUnits: named("businessunit"),
    apps,
    rights: summariseRights(attributes.advancedRights),
  };
}

/**
 * Autocomplete the `{id}` of an entity template through the domain's own search
 * endpoint, so a client that implements `completions/complete` can offer ids
 * while the user types.
 *
 * Only ids come back, never labels: `CompleteResult.completion.values` is a
 * `string[]` and each value is substituted verbatim into the URI variable — a
 * human-readable label there would produce an invalid URI. (The issue's design
 * note asked for "id + libellé"; the protocol has no second channel for it.)
 *
 * Failures resolve to an empty list. A completion is a keystroke-rate
 * convenience: a rate-limited or erroring search must degrade to "no
 * suggestion", never to a visible error in the client's picker.
 */
function completeIdFor(template: EntityTemplate): (value: string) => Promise<string[]> {
  return async (value: string): Promise<string[]> => {
    const keywords = value.trim();
    if (keywords.length === 0) return [];
    try {
      const response = await apiSearch(
        template.apiPath,
        buildSearchQuery({ keywords, pageSize: COMPLETION_PAGE_SIZE })
      );
      const rows = Array.isArray(response.data) ? response.data : response.data ? [response.data] : [];
      return rows.map((row) => row.id).filter((id): id is string => typeof id === "string");
    } catch (error) {
      logger.debug(
        { component: "resources", template: template.uriTemplate, err: error },
        "Resource id completion failed; returning no suggestion"
      );
      return [];
    }
  };
}

/**
 * Register the entity resource templates allowed by `policy`.
 *
 * Unlike the reference dictionaries, these ARE domain-filtered: with
 * `BOOND_MCP_PROFILE=finance` the `candidates` domain is gone from
 * `tools/list`, and leaving `boond://candidate/{id}` readable would reopen
 * exactly what the operator closed. The dictionaries stay unfiltered — they
 * hold code tables, not business data.
 *
 * `list: undefined` is mandatory, not an omission: the SDK requires the key to
 * be present so nobody forgets to think about enumeration, and `undefined` is
 * the answer here. Enumerating would mean paginating the whole Boond database
 * into every `resources/list` response.
 */
function registerEntityTemplates(server: McpServer, policy?: AccessPolicy): void {
  for (const template of ENTITY_TEMPLATES) {
    if (policy && !isDomainAllowed(policy, template.domain)) continue;

    server.registerResource(
      template.name,
      new ResourceTemplate(template.uriTemplate, {
        list: undefined,
        complete: { id: completeIdFor(template) },
      }),
      {
        title: template.title,
        description: template.description,
        mimeType: "application/json",
        // Native here: `templates/list` spreads the whole metadata object, so
        // icons need none of the `tools/list` shim (see icons.ts).
        icons: iconsForDomain(template.domain),
      },
      async (uri, variables, extra) => ({
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: await readEntityAggregate(template, variables["id"], uri.toString(), extra),
          },
        ],
      })
    );
  }
}

/**
 * `policy` is optional on purpose — same rule as `registerAllPrompts`: the
 * catalogue generator and the existing test suites call this with a bare stub
 * server and must keep seeing the full surface, otherwise TOOLS.md drifts.
 */
export function registerAllResources(server: McpServer, policy?: AccessPolicy): void {
  for (const dict of DICTIONARIES) {
    const uri = buildResourceUri(dict.slug);
    server.registerResource(
      `dictionary/${dict.slug}`,
      uri,
      {
        title: dict.title,
        description: dict.description,
        mimeType: "application/json",
        // SEP-973. Unlike tools/prompts, the SDK's resource listing spreads the
        // whole config, so `icons` reaches the client with no shim needed.
        icons: referenceIcons(),
      },
      async () => {
        const { payload } = await getDictionary();
        const node = resolveDictionaryPath(payload, dict.path);
        const body =
          node === undefined
            ? {
                error: `Path "${dict.path}" not found in BoondManager dictionary. The upstream API may have changed — please open an issue.`,
              }
            : node;
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(body, null, 2),
            },
          ],
        };
      }
    );
  }

  // Static resource: the label→id overrides configured by the operator via
  // BOOND_DICTIONARY_OVERRIDES (see docs/dictionary-overrides.md). No API call:
  // the body reflects exactly what the server resolved at startup, so the
  // model (and the user) can check which custom labels are usable.
  server.registerResource(
    "dictionary/overrides",
    OVERRIDES_URI,
    {
      title: "Libellés personnalisés (overrides)",
      description:
        "Mapping libellé→ID configuré via BOOND_DICTIONARY_OVERRIDES (types d'action et états). " +
        'Renvoie { "configured": false } si aucun override n\'est configuré.',
      mimeType: "application/json",
      icons: referenceIcons(),
    },
    () => {
      const overrides = getDictionaryOverrides();
      return Promise.resolve({
        contents: [
          {
            uri: OVERRIDES_URI,
            mimeType: "application/json",
            text: JSON.stringify(overrides ?? { configured: false }, null, 2),
          },
        ],
      });
    }
  );

  // The current-user resource is a convenience for prompts/tools that need
  // the caller's userId without first issuing a tool call. The body is the
  // full /application/current-user payload.
  server.registerResource(
    "application/current-user",
    CURRENT_USER_URI,
    {
      title: "Utilisateur courant",
      description:
        "Profil de l'utilisateur authentifié auprès de l'API BoondManager (id, agence, permissions). " +
        "Utile pour résoudre 'mon ID' avant un appel filtré par perimeterManagers.",
      mimeType: "application/json",
      icons: identityIcons(),
    },
    async () => {
      const response = await apiRequest("/application/current-user");
      return {
        contents: [
          {
            uri: CURRENT_USER_URI,
            mimeType: "application/json",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }
  );

  // Derived view of the same payload (issue #261): what the caller may do and
  // see, without the ~100 KB of field-level detail. Prompts used to rebuild
  // "my agencies / my N-1" from current-user + a resources search.
  server.registerResource(
    "application/current-user/rights",
    CURRENT_USER_RIGHTS_URI,
    {
      title: "Droits et périmètre de l'utilisateur",
      description:
        "Vue condensée des droits de l'utilisateur authentifié : niveau, agences / pôles / BU, apps installées, et par entité (resources, candidates, invoices...) " +
        "les autorisations creation / deletion et les flags de périmètre de recherche actifs (allAgencies, myManagers, managers[]...). " +
        "À lire avant une écriture ou un filtre `perimeter*` ; le payload brut reste sur boond://application/current-user.",
      mimeType: "application/json",
      icons: identityIcons(),
    },
    async () => {
      const response = await apiRequest("/application/current-user");
      return {
        contents: [
          {
            uri: CURRENT_USER_RIGHTS_URI,
            mimeType: "application/json",
            text: JSON.stringify(buildCurrentUserRights(response), null, 2),
          },
        ],
      };
    }
  );

  registerEntityTemplates(server, policy);
}
