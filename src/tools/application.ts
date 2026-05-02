import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DictionaryGetSchema } from "../schemas/index.js";
import type { DictionaryGetInput } from "../schemas/index.js";
import { CHARACTER_LIMIT } from "../constants.js";
import { apiRequest, formatDetailResponse } from "../services/boond-client.js";
import { getDictionary, resolveDictionaryPath } from "../services/dictionary.js";

function formatDictionaryNode(node: unknown): string {
  const text = JSON.stringify(node, null, 2);
  if (text.length > CHARACTER_LIMIT) {
    return text.substring(0, CHARACTER_LIMIT) + "\n\n[Résultat tronqué...]";
  }
  return text;
}

export function registerApplicationTools(server: McpServer): void {
  // Get dictionary
  server.registerTool(
    "boond_application_dictionary",
    {
      title: "Récupérer un dictionnaire BoondManager",
      description: `Récupère un dictionnaire de référence BoondManager (états, types, pays, devises, langues, outils, expertises, ...).

L'API expose un seul endpoint \`/application/dictionary\` qui renvoie tout — le serveur le cache (TTL 1h, configurable via \`BOOND_DICTIONARY_TTL_MS\`) et extrait un sous-arbre par chemin dotté.

Args:
  - dictionaryType (string): Chemin dans la réponse (relatif à \`data\`). Exemples :
    - "setting.state.{resource,candidate,contact,company,opportunity,project,invoice,order,positioning}" → états par entité
    - "setting.typeOf.{resource,contact,project}" → types par entité
    - "setting.action.{candidate,resource,opportunity,project,...}" → actions disponibles
    - "setting.tool" → outils / technos (Java, AWS...)
    - "setting.expertiseArea" → domaines d'expertise
    - "setting.experience" → niveaux d'expérience
    - "setting.languageSpoken" → langues parlées
    - "setting.activityArea" → secteurs d'activité
    - "setting.mobilityArea" → mobilités géographiques
    - "setting.currency" → devises
    - "setting.civility" → civilités
    - "country" → pays
    - "languages" → langues d'interface (fr, en, es)

Note : l'ancienne forme "states/resources" (slash) n'est pas valide — utilisez "setting.state.resource".

Retourne le sous-arbre (souvent un tableau \`{id, value, ...}\`) ou \`isError: true\` si le chemin est introuvable.`,
      inputSchema: DictionaryGetSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: DictionaryGetInput) => {
      const { payload } = await getDictionary();
      const node = resolveDictionaryPath(payload, params.dictionaryType);
      if (node === undefined) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Chemin "${params.dictionaryType}" introuvable dans le dictionnaire BoondManager. Les chemins sont relatifs à \`data\` (ex: "setting.state.resource", "country"). Note: "states/resources" (slash) n'est pas un chemin valide ; utilisez "setting.state.resource".`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: formatDictionaryNode(node) }],
      };
    }
  );

  // Get current user / application info
  server.registerTool(
    "boond_application_current_user",
    {
      title: "Utilisateur courant BoondManager",
      description: `Récupère les informations de l'utilisateur actuellement connecté à l'API BoondManager (profil, permissions, agence...).

Returns: Données JSON de l'utilisateur courant.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const response = await apiRequest("/application/current-user");
      const text = formatDetailResponse(response);
      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );
}
