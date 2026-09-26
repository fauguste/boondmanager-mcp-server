import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InactivityCreateSchema, InactivityDefaultSchema } from "../schemas/index.js";
import type { InactivityDefaultInput } from "../schemas/index.js";
import { apiRequest, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody, registerCreateTool, registerGetTool } from "./crud-factory.js";
import { composeDescription } from "./description-builders.js";

const OPTS = {
  entityName: "période d'inactivité",
  entityNamePlural: "périodes d'inactivité",
  apiPath: "/inactivities",
  prefix: "boond_inactivities",
};

/** `/inactivities` payload (issue #256): `resource` (required) / `contract` relationships, `note` → `informationComments` (`models.inactivity`). */
export function buildInactivityBody(params: Record<string, unknown>): unknown {
  const { resourceId, contractId, note, ...attrs } = params;
  return buildJsonApiBody(
    "inactivity",
    { ...attrs, ...(note !== undefined ? { informationComments: note } : {}) },
    undefined,
    {
      resource: { id: String(resourceId), type: "resource" },
      contract: contractId ? { id: String(contractId), type: "contract" } : undefined,
    }
  );
}

export function registerInactivityTools(server: McpServer): void {
  server.registerTool(
    "boond_inactivities_default",
    {
      title: "Référentiels d'une période d'inactivité",
      description: composeDescription({
        purpose:
          "Renvoie les valeurs par défaut d'une période d'inactivité (intercontrat, formation, congé sans solde…) pour une ressource : types d'inactivité, coût journalier retenu, contrat en cours.",
        when: "AVANT `boond_inactivities_create` — le type d'inactivité n'est publié que là.",
        instead:
          "`boond_resources_get` pour la fiche de la ressource ; `boond_reporting_resources` pour le taux d'occupation agrégé.",
        behaviour: ["Lecture seule (`GET /inactivities/default?resource=`) ; la réponse est rendue telle quelle."],
        returns: "JSON de l'inactivité vide pré-remplie, avec les types inclus.",
      }),
      inputSchema: InactivityDefaultSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params: InactivityDefaultInput) => {
      const response = await apiRequest("/inactivities/default", "GET", undefined, { resource: params.resourceId });
      return { content: [{ type: "text" as const, text: formatDetailResponse(response) }] };
    }
  );

  registerGetTool(server, OPTS, {
    withTab: false,
    title: "Détails d'une période d'inactivité",
    description: composeDescription({
      purpose: "Récupère une période d'inactivité (intercontrat, formation…) par son ID.",
      when: "après `boond_inactivities_create`, ou depuis l'ID lu dans les relations d'une ressource.",
      instead:
        "il n'existe pas de liste des inactivités côté API (`GET /inactivities` n'est pas documenté) : `boond_reporting_resources` donne l'occupation, `boond_resources_get` la fiche.",
      returns: "JSON de la période (attributs + relations). Lecture seule.",
    }),
  });

  registerCreateTool(server, OPTS, InactivityCreateSchema, buildInactivityBody, {
    title: "Créer une période d'inactivité",
    description: composeDescription({
      purpose:
        "Déclare une période d'inactivité (intercontrat, formation interne, congé sans solde…) pour une ressource, entre deux prestations.",
      when: "quand une ressource sort de mission sans relais immédiat — c'est ce qui rend le taux d'occupation et le coût de l'intercontrat justes.",
      instead:
        "`boond_absences_create` pour une absence (congés, maladie) ; `boond_deliveries_create` pour une nouvelle prestation.",
      behaviour: [
        "Corps déduit de `models.inactivity` (`title`, `startDate`, `endDate`, `inactivityType`, coûts, relations `resource` / `contract`) — non éprouvé sur un tenant de test.",
        "Écriture non idempotente.",
      ],
      returns: "confirmation et ID de la période (`structuredContent.id`).",
    }),
  });
}
