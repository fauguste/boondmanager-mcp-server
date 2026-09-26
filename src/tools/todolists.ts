import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TasksGetSchema, TodolistCreateSchema } from "../schemas/index.js";
import type { TaskEntity } from "../schemas/index.js";
import { apiRequest, formatTabResponse } from "../services/boond-client.js";
import { buildJsonApiBody, registerCreateTool, registerGetTool, registerSearchTool } from "./crud-factory.js";
import { composeDescription } from "./description-builders.js";

const OPTS = {
  entityName: "todolist",
  entityNamePlural: "todolists",
  apiPath: "/todolists",
  prefix: "boond_todolists",
};

/** API collection of each entity `tasks.raml` covers (14). */
const TASK_ENTITY_PATH: Record<TaskEntity, string> = {
  candidate: "/candidates",
  resource: "/resources",
  contact: "/contacts",
  company: "/companies",
  opportunity: "/opportunities",
  project: "/projects",
  order: "/orders",
  product: "/products",
  purchase: "/purchases",
  positioning: "/positionings",
  invoice: "/invoices",
  contract: "/contracts",
  delivery: "/deliveries",
  payment: "/payments",
};

/** `/todolists` payload (issue #254): `agencyIds` → `agencies` relationship, the rest as attributes (`models.todolist`). */
export function buildTodolistBody(params: Record<string, unknown>): unknown {
  const { agencyIds, ...attrs } = params;
  const body = buildJsonApiBody("todolist", attrs) as { data: Record<string, unknown> };
  if (Array.isArray(agencyIds) && agencyIds.length > 0) {
    body.data.relationships = { agencies: { data: agencyIds.map((id) => ({ id: String(id), type: "agency" })) } };
  }
  return body;
}

export function registerTodolistTools(server: McpServer): void {
  registerSearchTool(server, OPTS);
  registerGetTool(server, OPTS, { withTab: false });

  // Issue #254: `POST /todolists` is documented (todolists/search.raml), its
  // body is not — built from `models.todolist`, not exercised.
  registerCreateTool(server, OPTS, TodolistCreateSchema, buildTodolistBody, {
    title: "Créer une todolist",
    description: composeDescription({
      purpose: "Crée une todolist (modèle de tâches) avec ses tâches ordonnées, applicable à un type de fiche.",
      when: "pour définir une checklist réutilisable (onboarding consultant, préparation de facturation…).",
      instead: "`boond_todolists_search` d'abord : l'API ne déduplique pas les titres.",
      behaviour: [
        "Corps déduit de `models.todolist` (`title`, `profile`, `profileTypesOf`, `profileStates`, `tasks[]`, relation `agencies`) — non éprouvé sur un tenant de test.",
        "Les tâches d'une fiche (`boond_tasks_get`) ne se créent pas ici : aucune route de création de tâche n'est documentée.",
      ],
      returns: "confirmation et ID de la todolist (`structuredContent.id`).",
    }),
  });

  // Issue #254: `GET /{entity}/{id}/tasks` exists on 14 entities (tasks.raml);
  // one parameterised tool rather than 14 tabs. No write: the RAML documents
  // only `get`, and no `/tasks` collection exists (404 on the doc site).
  server.registerTool(
    "boond_tasks_get",
    {
      title: "Tâches d'un enregistrement",
      description: composeDescription({
        purpose:
          "Liste les tâches (todolist instanciée) d'un candidat, d'une ressource, d'un contact, d'une société, d'une opportunité, d'un projet, d'une commande, d'un produit, d'un achat, d'un positionnement, d'une facture, d'un contrat, d'une prestation ou d'un paiement.",
        when: "pour voir où en est la checklist d'une fiche (tâches faites / à faire, validées par qui).",
        instead:
          "`boond_actions_search` pour les rappels datés — une tâche est un item de checklist, une action un événement daté. Aucune route de création de tâche n'est documentée par l'API.",
        returns:
          "les tâches (`description`, `state`, `row`, `validatedAt`, `validatedBy`, sous-tâches). Lecture seule.",
      }),
      inputSchema: TasksGetSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const { entity, id } = params;
      const response = await apiRequest(`${TASK_ENTITY_PATH[entity]}/${id}/tasks`);
      return { content: [{ type: "text" as const, text: formatTabResponse(response) }] };
    }
  );
}
