import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ResourceCreateSchema,
  ResourceUpdateSchema,
  ResourceSearchSchema,
  ResourceTechnicalDataUpdateSchema,
  ReferenceCreateSchema,
  ReferenceUpdateSchema,
  ReferenceIdSchema,
  IdSchema,
} from "../schemas/index.js";
import type {
  IdInput,
  ResourceTechnicalDataUpdateInput,
  ReferenceCreateInput,
  ReferenceUpdateInput,
  ReferenceIdInput,
} from "../schemas/index.js";
import {
  registerSearchTool,
  registerGetTool,
  registerCreateTool,
  registerUpdateTool,
  registerDeleteTool,
  buildJsonApiBody,
} from "./crud-factory.js";
import { apiRequest, formatDetailResponse } from "../services/boond-client.js";

const OPTS = {
  entityName: "ressource",
  entityNamePlural: "ressources",
  apiPath: "/resources",
  prefix: "boond_resources",
};

const TAB_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

interface TabDefinition {
  name: string;
  tab: string;
  title: string;
  description: string;
}

const RESOURCE_TABS: TabDefinition[] = [
  {
    name: "information",
    tab: "information",
    title: "Informations générales d'une ressource",
    description: `Récupère les informations générales d'une ressource (coordonnées, adresse, état civil, photo, tags, manager...).

Args:
  - id (string): ID de la ressource

Returns: Données personnelles et administratives de la ressource.`,
  },
  {
    name: "technical_data",
    tab: "technical-data",
    title: "Compétences techniques d'une ressource",
    description: `Récupère le profil technique d'une ressource (compétences, expériences, formations, certifications, langues, CV...).

Args:
  - id (string): ID de la ressource

Returns: Données techniques et compétences de la ressource.`,
  },
  {
    name: "administrative",
    tab: "administrative",
    title: "Données administratives d'une ressource",
    description: `Récupère les informations administratives d'une ressource (salaire, TJM, coût journalier, informations RH...).

Args:
  - id (string): ID de la ressource

Returns: Données administratives et RH de la ressource.`,
  },
  {
    name: "advantages",
    tab: "advantages",
    title: "Avantages d'une ressource",
    description: `Récupère les avantages associés à une ressource (tickets restaurant, mutuelle, véhicule, primes...).

Args:
  - id (string): ID de la ressource

Returns: Liste des avantages de la ressource.`,
  },
  {
    name: "actions",
    tab: "actions",
    title: "Actions liées à une ressource",
    description: `Récupère les actions (appels, emails, RDV, notes) associées à une ressource.

Args:
  - id (string): ID de la ressource

Returns: Liste des actions liées à la ressource.`,
  },
  {
    name: "positionings",
    tab: "positionings",
    title: "Positionnements d'une ressource",
    description: `Récupère les positionnements (placements sur des projets) d'une ressource.

Args:
  - id (string): ID de la ressource

Returns: Liste des positionnements de la ressource.`,
  },
  {
    name: "projects",
    tab: "projects",
    title: "Projets d'une ressource",
    description: `Récupère les projets auxquels une ressource participe ou a participé.

Args:
  - id (string): ID de la ressource

Returns: Liste des projets de la ressource.`,
  },
  {
    name: "times_reports",
    tab: "times-reports",
    title: "Feuilles de temps d'une ressource",
    description: `Récupère les feuilles de temps d'une ressource.

Args:
  - id (string): ID de la ressource

Returns: Liste des feuilles de temps de la ressource.`,
  },
  {
    name: "expenses_reports",
    tab: "expenses-reports",
    title: "Notes de frais d'une ressource",
    description: `Récupère les notes de frais d'une ressource.

Args:
  - id (string): ID de la ressource

Returns: Liste des notes de frais de la ressource.`,
  },
  {
    name: "absences_reports",
    tab: "absences-reports",
    title: "Demandes d'absences d'une ressource",
    description: `Récupère les demandes d'absences d'une ressource (congés, RTT, maladie...).

Args:
  - id (string): ID de la ressource

Returns: Liste des demandes d'absences de la ressource.`,
  },
];

const RESOURCE_SEARCH_DESCRIPTION = `Recherche des ressources (collaborateurs internes) dans BoondManager avec filtres serveur.

⚠️ Utilisez les filtres structurés plutôt que la pagination intégrale. Les noms de paramètres ci-dessous sont **ceux exacts** de l'API BoondManager — toute autre orthographe est silencieusement ignorée.

Cas d'usage courants :
• **Mes données / mon équipe / mon agence** sans connaître son propre ID : \`perimeterDynamic: ["data"]\` (mes ressources), \`["managers"]\` (mes N-1), \`["agencies"]\` (mes agences).
• **Équipe d'une personne X** : \`perimeterManagers: [<X_id>]\` (filtre les ressources dont X est le N+1).
• **Mon ID utilisateur** : appeler \`boond_application_current_user\` puis passer cet ID dans \`perimeterManagers\`.
• **États / types** : \`resourceStates: [<id>]\`, \`resourceTypes: [<id>]\`. IDs entiers issus du dictionnaire (voir \`boond_application_dictionary\` avec \`setting.state.resource\` ou \`setting.typeOf.resource\`). \`excludeResourceStates\` / \`excludeResourceTypes\` pour exclure.
• **Périmètre organisationnel** : \`perimeterAgencies\`, \`perimeterPoles\`, \`perimeterBusinessUnits\` (IDs entiers). Combiner avec \`narrowPerimeter: true\` pour ET au lieu de OU.
• **Compétences / outils** : \`tools: [<toolId>, ...]\` (OU par défaut ; pour ET: \`["#AND#", "1", "2"]\`). \`expertiseAreas\`, \`activityAreas\`, \`languages\` (format \`langueId|niveauId\`).
• **Disponibilité / activité** : \`period: "available"\` + \`startDate\`/\`endDate\`. Autres valeurs : \`working\`, \`hired\`, \`left\`, \`employed\`, \`birthday\`, \`seniority\`…
• **Recherche par nom** : \`keywords: "Dupont"\` + \`keywordsType: "lastName"\` (ou \`firstName\`, \`fullName\` avec \`keywords: "Dupont#Jean"\`).
• **Géolocalisation** : \`coordinates: "48.85,2.35"\` (ou \`location: "Paris"\`) + \`geoDistance: 50\` (km).

Pagination : \`page\` (1+), \`pageSize\` (1-500). Tri : \`sort: "lastName"\` (ou firstName/title/availability/state/updateDate/creationDate) + \`order: "asc"|"desc"\`.

Returns : liste paginée. Utiliser \`boond_resources_get\` ou les outils d'onglets pour le détail.`;

type DtToolItem = { tool: string; level: number };
type DtLanguageItem = { language: string; level: string };

// Merge a partial DT payload into the current DT attributes per the rules
// agreed in spec issue #79. Only keys actually present in `input` are touched;
// everything else is left untouched (i.e. not sent back to the API).
export function mergeTechnicalData(
  current: Record<string, unknown>,
  input: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const isBlank = (v: unknown) => v === undefined || v === null || v === "";

  // Scalars filled only when the existing value is blank.
  for (const key of ["title", "summary", "training"] as const) {
    if (input[key] !== undefined && isBlank(current[key])) {
      out[key] = input[key];
    }
  }
  if (input.experience !== undefined) {
    const cur = current.experience;
    if (cur === undefined || cur === null || cur === 0) {
      out.experience = input.experience;
    }
  }

  if (typeof input.skills === "string") {
    const split = (s: string) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x !== "");
    const curList = typeof current.skills === "string" ? split(current.skills) : [];
    const newItems = split(input.skills);
    const seen = new Set(curList.map((s) => s.toLowerCase()));
    const additions = newItems.filter((s) => {
      const k = s.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    out.skills = [...curList, ...additions].join(", ");
  }

  for (const key of ["expertiseAreas", "activityAreas", "diplomas"] as const) {
    const incoming = input[key];
    if (Array.isArray(incoming)) {
      const cur = Array.isArray(current[key]) ? (current[key] as unknown[]).map((v) => String(v)) : [];
      const seen = new Set(cur.map((s) => s.toLowerCase()));
      const merged = [...cur];
      for (const raw of incoming) {
        const v = String(raw);
        const k = v.toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          merged.push(v);
        }
      }
      out[key] = merged;
    }
  }

  if (Array.isArray(input.tools)) {
    const cur = Array.isArray(current.tools) ? (current.tools as Array<Record<string, unknown>>) : [];
    const existing = new Set(cur.map((t) => String(t.tool).toLowerCase()));
    const additions = (input.tools as DtToolItem[]).filter((t) => !existing.has(String(t.tool).toLowerCase()));
    out.tools = [...cur, ...additions];
  }

  if (Array.isArray(input.languages)) {
    const cur = Array.isArray(current.languages) ? (current.languages as Array<Record<string, unknown>>) : [];
    const existing = new Set(cur.map((l) => String(l.language).toLowerCase()));
    const additions = (input.languages as DtLanguageItem[]).filter(
      (l) => !existing.has(String(l.language).toLowerCase())
    );
    out.languages = [...cur, ...additions];
  }

  return out;
}

const TECHNICAL_DATA_UPDATE_DESCRIPTION = `Met à jour le dossier technique (DT) d'une ressource : compétences, outils, langues, expertises, formations, diplômes, expérience.

Mode 'merge' (défaut, recommandé pour automation) — enrichit sans rien écraser :
• skills (CSV) : concatène les compétences absentes
• tools / languages : ajoute les entrées dont la clé (slug outil / langue) est nouvelle, conserve le niveau existant pour les autres
• expertiseAreas, activityAreas, diplomas : ajoute les items absents
• title, summary, training, experience : remplis UNIQUEMENT si actuellement vides

Mode 'replace' — remplace intégralement chaque champ fourni par la valeur passée. Les champs non passés ne sont pas touchés.

Seuls les champs explicitement fournis dans l'appel sont envoyés à l'API — un champ omis ne sera jamais réinitialisé à vide.

Les expériences professionnelles (références) ne sont PAS gérées ici : utiliser boond_resources_reference_{create|update|delete}.`;

const REFERENCE_CREATE_DESCRIPTION = `Crée une expérience professionnelle (référence) rattachée au DT d'une ressource.

Champs requis : resourceId, title, company.
Dates : startMonth/endMonth au format '01'..'12' et startYear/endYear au format 'YYYY' (chaînes, pas entiers).

Pour ajouter des dates manquantes à une référence existante, préférer boond_resources_reference_update pour ne pas dupliquer.`;

const REFERENCE_UPDATE_DESCRIPTION = `Met à jour une référence existante. Seuls les champs explicitement fournis sont envoyés à l'API — un champ omis ne sera jamais écrasé par "".

Cas d'usage type : compléter startMonth/startYear/endMonth/endYear sur une référence sans toucher au titre, à la société ou à la description.`;

const REFERENCE_DELETE_DESCRIPTION = `Supprime définitivement une référence (expérience professionnelle) du DT d'une ressource. ⚠️ Action irréversible — vérifier l'ID au préalable.`;

export function registerResourceTools(server: McpServer): void {
  registerSearchTool(server, OPTS, {
    schema: ResourceSearchSchema,
    description: RESOURCE_SEARCH_DESCRIPTION,
  });
  registerGetTool(server, OPTS);

  registerCreateTool(server, OPTS, ResourceCreateSchema, (params) => {
    const { ...attrs } = params;
    return buildJsonApiBody("resource", attrs);
  });

  registerUpdateTool(server, OPTS, ResourceUpdateSchema, (params) => {
    const { id, ...attrs } = params;
    return buildJsonApiBody("resource", attrs, id as string);
  });

  registerDeleteTool(server, OPTS);

  // Register one tool per resource tab
  for (const tab of RESOURCE_TABS) {
    server.registerTool(
      `boond_resources_${tab.name}`,
      {
        title: tab.title,
        description: tab.description,
        inputSchema: IdSchema,
        annotations: TAB_TOOL_ANNOTATIONS,
      },
      async (params: IdInput) => {
        const response = await apiRequest(`/resources/${params.id}/${tab.tab}`);
        const text = formatDetailResponse(response);
        return {
          content: [{ type: "text" as const, text }],
        };
      }
    );
  }

  server.registerTool(
    "boond_resources_technical_data_update",
    {
      title: "Mettre à jour le dossier technique d'une ressource",
      description: TECHNICAL_DATA_UPDATE_DESCRIPTION,
      inputSchema: ResourceTechnicalDataUpdateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: ResourceTechnicalDataUpdateInput) => {
      const { id, mode, ...rest } = params;
      const provided: Record<string, unknown> = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined)
      );

      let attributes: Record<string, unknown>;
      if (mode === "replace") {
        attributes = provided;
      } else {
        const currentResponse = await apiRequest(`/resources/${id}/technical-data`);
        const currentEntity = Array.isArray(currentResponse.data) ? currentResponse.data[0] : currentResponse.data;
        const currentAttrs = (currentEntity?.attributes ?? {}) as Record<string, unknown>;
        attributes = mergeTechnicalData(currentAttrs, provided);
      }

      if (Object.keys(attributes).length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `ℹ️ Dossier technique #${id} inchangé (aucun champ à mettre à jour en mode ${mode}).`,
            },
          ],
        };
      }

      const body = buildJsonApiBody("resource", attributes, id);
      const response = await apiRequest(`/resources/${id}/technical-data`, "PUT", body);
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Dossier technique de la ressource #${id} mis à jour (mode: ${mode}).\n\n${formatDetailResponse(response)}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "boond_resources_reference_create",
    {
      title: "Créer une référence (expérience pro) sur une ressource",
      description: REFERENCE_CREATE_DESCRIPTION,
      inputSchema: ReferenceCreateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params: ReferenceCreateInput) => {
      const { resourceId, ...attrs } = params;
      const body = buildJsonApiBody("reference", attrs);
      const response = await apiRequest(`/resources/${resourceId}/references`, "POST", body);
      const entity = Array.isArray(response.data) ? response.data[0] : response.data;
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Référence créée pour la ressource #${resourceId}.\nID: ${entity?.id}\n\n${formatDetailResponse(response)}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "boond_resources_reference_update",
    {
      title: "Modifier une référence (expérience pro)",
      description: REFERENCE_UPDATE_DESCRIPTION,
      inputSchema: ReferenceUpdateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: ReferenceUpdateInput) => {
      const { referenceId, ...attrs } = params;
      const body = buildJsonApiBody("reference", attrs, referenceId);
      const response = await apiRequest(`/references/${referenceId}`, "PUT", body);
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Référence #${referenceId} mise à jour.\n\n${formatDetailResponse(response)}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "boond_resources_reference_delete",
    {
      title: "Supprimer une référence (expérience pro)",
      description: REFERENCE_DELETE_DESCRIPTION,
      inputSchema: ReferenceIdSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params: ReferenceIdInput) => {
      await apiRequest(`/references/${params.referenceId}`, "DELETE");
      return {
        content: [
          {
            type: "text" as const,
            text: `🗑️ Référence #${params.referenceId} supprimée.`,
          },
        ],
      };
    }
  );
}
