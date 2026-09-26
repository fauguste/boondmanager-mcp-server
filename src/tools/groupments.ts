import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GroupmentCreateSchema, GroupmentDefaultSchema, GroupmentUpdateSchema } from "../schemas/index.js";
import type { GroupmentDefaultInput } from "../schemas/index.js";
import { apiRequest, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody, registerCreateTool, registerGetTool, registerUpdateTool } from "./crud-factory.js";
import { composeDescription } from "./description-builders.js";

const OPTS = {
  entityName: "regroupement de prestations",
  entityNamePlural: "regroupements de prestations",
  apiPath: "/groupments",
  prefix: "boond_groupments",
};

/** `/groupments` payload (issue #256): `project` relationship (create), `deliveryIds` → `deliveries`, `note` → `informationComments` (`models.groupment`). */
export function buildGroupmentBody(params: Record<string, unknown>): unknown {
  const { id, projectId, deliveryIds, note, ...attrs } = params;
  const body = buildJsonApiBody(
    "groupment",
    { ...attrs, ...(note !== undefined ? { informationComments: note } : {}) },
    typeof id === "string" ? id : undefined,
    { project: projectId ? { id: String(projectId), type: "project" } : undefined }
  ) as { data: Record<string, unknown> & { relationships?: Record<string, unknown> } };
  if (Array.isArray(deliveryIds) && deliveryIds.length > 0) {
    body.data.relationships = {
      ...(body.data.relationships ?? {}),
      deliveries: { data: deliveryIds.map((d) => ({ id: String(d), type: "delivery" })) },
    };
  }
  return body;
}

export function registerGroupmentTools(server: McpServer): void {
  server.registerTool(
    "boond_groupments_default",
    {
      title: "Référentiels d'un regroupement de prestations",
      description: composeDescription({
        purpose:
          "Renvoie un regroupement vide pré-rempli pour un projet : prestations regroupables, prix et coûts par défaut.",
        when: "AVANT `boond_groupments_create`.",
        instead:
          "`boond_projects_deliveries_groupments` pour les prestations et regroupements déjà en place sur le projet.",
        behaviour: ["Lecture seule (`GET /groupments/default?project=`) ; la réponse est rendue telle quelle."],
        returns: "JSON du regroupement vide, prestations incluses.",
      }),
      inputSchema: GroupmentDefaultSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params: GroupmentDefaultInput) => {
      const response = await apiRequest("/groupments/default", "GET", undefined, { project: params.projectId });
      return { content: [{ type: "text" as const, text: formatDetailResponse(response) }] };
    }
  );

  registerGetTool(server, OPTS, {
    withTab: false,
    title: "Détails d'un regroupement de prestations",
    description: composeDescription({
      purpose: "Récupère un regroupement de prestations (facturation multi-prestations) par son ID.",
      when: "depuis l'ID lu dans `boond_projects_deliveries_groupments`.",
      instead:
        "`boond_projects_deliveries_groupments` pour la liste des regroupements d'un projet — il n'y a pas de liste globale.",
      returns: "JSON du regroupement (attributs + relations `project`, `deliveries`). Lecture seule.",
    }),
  });

  registerCreateTool(server, OPTS, GroupmentCreateSchema, buildGroupmentBody, {
    title: "Créer un regroupement de prestations",
    description: composeDescription({
      purpose:
        "Regroupe plusieurs prestations d'un projet sous un même prix et une même période, pour les facturer ensemble.",
      when: "pour la facturation multi-prestations (forfait sur plusieurs consultants, lot).",
      instead: "`boond_groupments_default` d'abord ; `boond_groupments_update` pour ajuster un regroupement existant.",
      behaviour: [
        "Corps déduit de `models.groupment` (`title`, dates, prix / coûts journaliers, relations `project` / `deliveries`) — non éprouvé sur un tenant de test.",
        "Écriture non idempotente.",
      ],
      returns: "confirmation et ID du regroupement (`structuredContent.id`).",
    }),
  });

  // PUT /groupments/{id} — no information.raml, base resource like /deliveries/{id} (#252).
  registerUpdateTool(server, OPTS, GroupmentUpdateSchema, buildGroupmentBody, {
    method: "PUT",
    title: "Modifier un regroupement de prestations",
  });
}
