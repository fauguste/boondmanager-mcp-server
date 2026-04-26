import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../services/boond-client.js";

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
 * The set below covers the dictionaries our search tools refer to most
 * (states + typeOf for the six search domains, plus the global ones used in
 * formatting like countries / currencies / languages). Anything beyond this
 * fixed set is still reachable via the `boond_application_dictionary` tool.
 */

interface DictionaryEntry {
  /** URI suffix, e.g. "states/resources". Joined with "boond://dictionary/". */
  slug: string;
  /** Human title shown to the user / model in the resource list. */
  title: string;
  /** One-line description. */
  description: string;
}

/**
 * Well-known Boond dictionaries surfaced as static MCP resources. We keep
 * this list deliberately curated — better to expose the dozen the search
 * tools actually depend on than the hundreds of obscure config dicts.
 */
const DICTIONARIES: DictionaryEntry[] = [
  // states/* — used to translate the integer `state` attribute on entities
  { slug: "states/resources",     title: "États ressources",     description: "Libellés des états de ressource (collaborateur)." },
  { slug: "states/candidates",    title: "États candidats",      description: "Libellés des états de candidat." },
  { slug: "states/contacts",      title: "États contacts",       description: "Libellés des états de contact." },
  { slug: "states/companies",     title: "États sociétés",       description: "Libellés des états de société." },
  { slug: "states/opportunities", title: "États opportunités",   description: "Libellés des états d'opportunité commerciale." },
  { slug: "states/projects",      title: "États projets",        description: "Libellés des états de projet/mission." },
  { slug: "states/invoices",      title: "États factures",       description: "Libellés des états de facture client." },
  { slug: "states/orders",        title: "États bons de commande", description: "Libellés des états de bon de commande." },
  { slug: "states/positionings",  title: "États positionnements", description: "Libellés des états de positionnement." },
  { slug: "states/absences",      title: "États absences",       description: "Libellés des états des demandes d'absence." },
  // typeOf/* — used to translate the integer `typeOf` attribute on entities
  { slug: "typeOf/resources",     title: "Types ressources",     description: "Types de ressource (interne, sous-traitant, freelance...)." },
  { slug: "typeOf/candidates",    title: "Types candidats",      description: "Types de candidat." },
  { slug: "typeOf/contacts",      title: "Types contacts",       description: "Types de contact." },
  { slug: "typeOf/projects",      title: "Types projets",        description: "Types de projet (régie, forfait, produit...)." },
  { slug: "typeOf/actions",       title: "Types actions",        description: "Types d'action (appel, email, RDV, note...)." },
  { slug: "typeOf/absences",      title: "Types absences",       description: "Types d'absence (CP, RTT, maladie, sans solde...)." },
  // Global lookups
  { slug: "countries",            title: "Pays",                 description: "Liste des pays (codes ISO + libellés)." },
  { slug: "currencies",           title: "Devises",              description: "Liste des devises supportées." },
  { slug: "languages",            title: "Langues",              description: "Liste des langues parlées." },
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
        // Mirror the path used by the boond_application_dictionary tool so
        // both read paths stay in sync if the upstream API moves.
        const response = await apiRequest(`/application/dictionaries/${dict.slug}`);
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(response, null, 2),
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
        "Profil de l'utilisateur authentifié auprès de l'API BoondManager (id, agence, permissions). "
        + "Utile pour résoudre 'mon ID' avant un appel filtré par perimeterManagers.",
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
