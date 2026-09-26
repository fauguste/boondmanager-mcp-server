import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DeliveryCreateSchema, DeliverySearchSchema, DeliveryUpdateSchema } from "../schemas/index.js";
import {
  buildJsonApiBody,
  registerCreateTool,
  registerDeleteTool,
  registerGetTool,
  registerSearchTool,
  registerUpdateTool,
} from "./crud-factory.js";
import { composeDescription } from "./description-builders.js";

const OPTS = {
  entityName: "livraison (CRA)",
  entityNamePlural: "livraisons",
  apiPath: "/deliveries",
  prefix: "boond_deliveries",
};

/**
 * `/deliveries` payload: the tool's convenience names (`quantity`, `unitPrice`,
 * `note`) map onto the API attributes, and the two mandatory ids become the
 * `project` / `dependsOn` relationships.
 */
function deliveryAttributes(params: Record<string, unknown>): Record<string, unknown> {
  const { quantity, unitPrice, note, ...attrs } = params;
  return {
    ...attrs,
    ...(quantity !== undefined ? { numberOfDaysInvoicedOrQuantity: quantity } : {}),
    ...(unitPrice !== undefined ? { averageDailyPriceExcludingTax: unitPrice } : {}),
    ...(unitPrice !== undefined ? { forceAverageDailyPriceExcludingTax: true } : {}),
    ...(note ? { informationComments: note } : {}),
  };
}

export function buildDeliveryBody(params: Record<string, unknown>): unknown {
  const { projectId, resourceId, ...rest } = params;
  return buildJsonApiBody("delivery", deliveryAttributes(rest), undefined, {
    project: { id: String(projectId), type: "project" },
    dependsOn: { id: String(resourceId), type: "resource" },
  });
}

/** PUT /deliveries/{id}: attributes only — the project / resource attachment is never moved by an update (issue #252). */
export function buildDeliveryUpdateBody(params: Record<string, unknown>): unknown {
  const { id, ...rest } = params;
  return buildJsonApiBody("delivery", deliveryAttributes(rest), String(id));
}

export function registerDeliveryTools(server: McpServer): void {
  registerCreateTool(server, OPTS, DeliveryCreateSchema, buildDeliveryBody, {
    title: "Créer une prestation/livraison",
    description: composeDescription({
      purpose: "Crée une prestation (livraison) rattachée à un projet et à une ressource.",
      when: "pour ouvrir la ligne de mission qui rendra la ressource facturable sur ce projet.",
      instead: "`boond_projects_deliveries_groupments` pour lister les prestations déjà en place sur le projet.",
      behaviour: [
        "`project` et `resource` sont obligatoires et attendent des ID numériques.",
        "L'ID de prestation retourné est celui qu'exigent les lignes de note de frais (`boond_expenses_create`).",
        "Écriture non idempotente.",
      ],
      returns: "confirmation et fiche de la prestation créée, avec son ID dans `structuredContent.id`.",
    }),
  });

  // The list lives on `/deliveries-groupments`, the detail on `/deliveries/{id}`.
  registerSearchTool(
    server,
    { ...OPTS, apiPath: "/deliveries-groupments" },
    {
      schema: DeliverySearchSchema,
      title: "Rechercher des livraisons / CRA",
      description: `Recherche des prestations / livraisons dans BoondManager par projet, société, ressource, état (\`deliveryStates\`, \`projectStates\`), période (\`period: "running"\` + dates pour les prestations en cours) et périmètre (\`perimeter*\`).

\`projectId\` / \`companyId\` sont convertis en références \`keywords\` (PRJ<id> / CSOC<id>) : l'API n'a pas de paramètre dédié.

Returns: Liste des livraisons correspondantes.`,
    }
  );

  registerGetTool(server, OPTS, { withTab: false, title: "Détails d'une livraison / CRA" });

  // Issue #252: extend a delivery (endDate), change a daily rate, close it.
  registerUpdateTool(server, OPTS, DeliveryUpdateSchema, buildDeliveryUpdateBody, {
    method: "PUT",
    title: "Modifier une prestation/livraison",
  });
  registerDeleteTool(server, OPTS, { title: "Supprimer une prestation/livraison" });
}
