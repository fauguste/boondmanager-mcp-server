import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../services/boond-client.js";
import { getDictionary, resolveDictionaryPath } from "../services/dictionary.js";

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
  { name: "application/current-user", uri: CURRENT_USER_URI, title: "Utilisateur courant" },
];

export function registerAllResources(server: McpServer): void {
  for (const dict of DICTIONARIES) {
    const uri = buildResourceUri(dict.slug);
    server.registerResource(
      `dictionary/${dict.slug}`,
      uri,
      {
        title: dict.title,
        description: dict.description,
        mimeType: "application/json",
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
}
