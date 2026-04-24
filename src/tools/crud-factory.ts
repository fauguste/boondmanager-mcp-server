import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";
import { SearchSchema, IdSchema, IdTabSchema } from "../schemas/index.js";
import type { SearchInput, IdInput, IdTabInput } from "../schemas/index.js";

interface CrudToolOptions {
  entityName: string;         // ex: "candidat", "ressource"
  entityNamePlural: string;   // ex: "candidats", "ressources"
  apiPath: string;            // ex: "/candidates"
  prefix: string;             // ex: "boond_candidates"
}

interface SearchToolOverrides {
  schema?: z.ZodType;
  title?: string;
  description?: string;
}

export function registerSearchTool(
  server: McpServer,
  opts: CrudToolOptions,
  overrides: SearchToolOverrides = {}
): void {
  const schema = overrides.schema ?? SearchSchema;
  const title = overrides.title ?? `Rechercher des ${opts.entityNamePlural}`;
  const description = overrides.description ?? `Recherche des ${opts.entityNamePlural} dans BoondManager par mots-clés avec pagination.

Args:
  - keywords (string, optional): Termes de recherche (nom, email, compétences...)
  - page (number): Numéro de page (défaut: 1)
  - pageSize (number): Résultats par page (défaut: 20, max: 100)

Returns: Liste des ${opts.entityNamePlural} correspondants avec leur ID, nom et détails principaux.`;

  server.registerTool(
    `${opts.prefix}_search`,
    {
      title,
      description,
      inputSchema: schema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: unknown) => {
      const query = buildSearchQuery(params as SearchInput);
      const response = await apiRequest(opts.apiPath, "GET", undefined, query);
      const text = formatListResponse(response, opts.entityName);
      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );
}

export function registerGetTool(server: McpServer, opts: CrudToolOptions): void {
  server.registerTool(
    `${opts.prefix}_get`,
    {
      title: `Détails d'un(e) ${opts.entityName}`,
      description: `Récupère les informations détaillées d'un(e) ${opts.entityName} par son ID. Optionnellement un onglet spécifique (information, technical, financial, actions, contracts, documents).

Args:
  - id (string): Identifiant unique du/de la ${opts.entityName}
  - tab (string, optional): Onglet spécifique à récupérer

Returns: Données JSON complètes de l'entité.`,
      inputSchema: IdTabSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: IdTabInput) => {
      const path = params.tab
        ? `${opts.apiPath}/${params.id}/${params.tab}`
        : `${opts.apiPath}/${params.id}`;
      const response = await apiRequest(path);
      const text = formatDetailResponse(response);
      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );
}

export function registerCreateTool(
  server: McpServer,
  opts: CrudToolOptions,
  schema: z.ZodType,
  buildBody: (params: Record<string, unknown>) => unknown
): void {
  server.registerTool(
    `${opts.prefix}_create`,
    {
      title: `Créer un(e) ${opts.entityName}`,
      description: `Crée un(e) nouvel(le) ${opts.entityName} dans BoondManager.

Returns: Données du/de la ${opts.entityName} créé(e) avec son ID.`,
      inputSchema: schema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params: unknown) => {
      const body = buildBody(params as Record<string, unknown>);
      const response = await apiRequest(opts.apiPath, "POST", body);
      const entity = Array.isArray(response.data) ? response.data[0] : response.data;
      return {
        content: [{
          type: "text" as const,
          text: `✅ ${opts.entityName} créé(e) avec succès.\nID: ${entity?.id}\n\n${formatDetailResponse(response)}`,
        }],
      };
    }
  );
}

export function registerUpdateTool(
  server: McpServer,
  opts: CrudToolOptions,
  schema: z.ZodType,
  buildBody: (params: Record<string, unknown>) => unknown
): void {
  server.registerTool(
    `${opts.prefix}_update`,
    {
      title: `Modifier un(e) ${opts.entityName}`,
      description: `Met à jour un(e) ${opts.entityName} existant(e) dans BoondManager. Seuls les champs fournis sont modifiés.

Returns: Données mises à jour du/de la ${opts.entityName}.`,
      inputSchema: schema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: unknown) => {
      const p = params as Record<string, unknown>;
      const id = p.id as string;
      const body = buildBody(p);
      const response = await apiRequest(`${opts.apiPath}/${id}`, "PATCH", body);
      return {
        content: [{
          type: "text" as const,
          text: `✅ ${opts.entityName} #${id} mis(e) à jour.\n\n${formatDetailResponse(response)}`,
        }],
      };
    }
  );
}

export function registerDeleteTool(server: McpServer, opts: CrudToolOptions): void {
  server.registerTool(
    `${opts.prefix}_delete`,
    {
      title: `Supprimer un(e) ${opts.entityName}`,
      description: `Supprime un(e) ${opts.entityName} de BoondManager. ⚠️ Action irréversible.

Args:
  - id (string): Identifiant de l'entité à supprimer`,
      inputSchema: IdSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params: IdInput) => {
      await apiRequest(`${opts.apiPath}/${params.id}`, "DELETE");
      return {
        content: [{
          type: "text" as const,
          text: `🗑️ ${opts.entityName} #${params.id} supprimé(e).`,
        }],
      };
    }
  );
}

// Helper to build JSON:API body
export function buildJsonApiBody(
  type: string,
  attributes: Record<string, unknown>,
  id?: string
): unknown {
  const body: Record<string, unknown> = {
    data: {
      type,
      attributes: Object.fromEntries(
        Object.entries(attributes).filter(([_, v]) => v !== undefined)
      ),
    },
  };
  if (id) {
    (body.data as Record<string, unknown>).id = id;
  }
  return body;
}
