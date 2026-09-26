import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toKeywordReferences } from "./linked-entity-filters.js";
import {
  AbsenceSearchSchema,
  AbsenceCreateSchema,
  AbsenceUpdateSchema,
  AbsenceDefaultSchema,
  IdSchema,
} from "../schemas/index.js";
import type { AbsenceDefaultInput } from "../schemas/index.js";
import type { JsonApiResponse } from "../types.js";
import { renderAttributeValue } from "../services/format/summary.js";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody, registerDeleteTool } from "./crud-factory.js";
import { composeDescription, defaultDeleteDescription, defaultGetDescription } from "./description-builders.js";

function inclusiveDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 1;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

interface WorkUnitType {
  reference?: number;
  name?: string;
  activityType?: string;
}

/**
 * Render `/absences-reports/default` down to what a caller needs before
 * `boond_absences_create` (issue #257): the absence types — work-unit types
 * on the included resource, same publication point as the CRA (#249), absent
 * from `/application/dictionary` — plus the report's own scalar attributes
 * (quotas, agency, term) without the raw payload.
 */
export function formatAbsenceDefaults(response: JsonApiResponse): string {
  const entity = Array.isArray(response.data) ? response.data[0] : response.data;
  if (!entity) return "Aucune donnée par défaut retournée pour cette ressource.";
  const attrs = entity.attributes ?? {};
  const included = response.included ?? [];
  const resourceRef = entity.relationships?.resource?.data as { id?: string } | undefined;
  const resource =
    included.find((i) => i.type === "resource" && i.id === resourceRef?.id) ??
    included.find((i) => i.type === "resource");
  const agency = included.find((i) => i.type === "agency");
  const resourceAttrs = resource?.attributes ?? {};
  const name = [resourceAttrs.firstName, resourceAttrs.lastName].filter(Boolean).join(" ");
  const lines = [
    `Demande d'absence — ressource #${resource?.id ?? resourceRef?.id ?? "?"}${name ? ` (${name})` : ""}${agency ? ` | agence #${agency.id}${agency.attributes?.name ? ` (${String(agency.attributes.name)})` : ""}` : ""}`,
  ];
  const types = ((resourceAttrs.workUnitTypesAllowed as WorkUnitType[] | undefined) ?? []).filter(
    (t) =>
      t.activityType === undefined ||
      /absence|conge|leave/i.test(String(t.activityType)) ||
      t.activityType !== "production"
  );
  lines.push(
    "",
    `Types d'absence autorisés (${types.length}) — utiliser \`reference\` comme \`workUnitTypeReference\` :`
  );
  lines.push(
    ...(types.length
      ? types.map((t) => `  reference=${t.reference} | ${t.name ?? ""}${t.activityType ? ` | ${t.activityType}` : ""}`)
      : ["  (aucun type publié pour cette ressource — vérifier l'agence)"])
  );
  const scalars = Object.entries(attrs).filter(([, v]) => v !== null && typeof v !== "object");
  if (scalars.length > 0) {
    lines.push("", "Valeurs par défaut de la demande :");
    lines.push(...scalars.map(([k, v]) => `  ${k}: ${renderAttributeValue(v)}`));
  }
  return lines.join("\n");
}

export function registerAbsenceTools(server: McpServer): void {
  server.registerTool(
    "boond_absences_default",
    {
      title: "Référentiels d'une demande d'absence",
      description: composeDescription({
        purpose:
          "Renvoie les types d'absence autorisés pour une ressource (RTT, maladie, congés payés… avec leur code) et les valeurs par défaut d'une demande.",
        when: "AVANT `boond_absences_create` — le code `workUnitTypeReference` n'est publié que par `GET /absences-reports/default` (ni dans `boond_application_dictionary`, ni sur l'agence).",
        instead:
          "`boond_timesheets_default` pour les mêmes codes vus du CRA (production comprise) ; aucun autre outil ne donne les types d'absence.",
        behaviour: [
          "Lecture seule ; la réponse brute est réduite aux types (ressource incluse, `workUnitTypesAllowed`) et aux scalaires de la demande.",
        ],
        returns: "texte : ressource, agence, types d'absence (reference | libellé | activityType), valeurs par défaut.",
      }),
      inputSchema: AbsenceDefaultSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params: AbsenceDefaultInput) => {
      const query: Record<string, string | undefined> = { resource: params.resourceId };
      if (params.agencyId) query.agency = params.agencyId;
      const response = await apiRequest("/absences-reports/default", "GET", undefined, query);
      return { content: [{ type: "text" as const, text: formatAbsenceDefaults(response) }] };
    }
  );

  server.registerTool(
    "boond_absences_search",
    {
      title: "Rechercher des demandes d'absence",
      description: `Recherche des demandes d'absence dans BoondManager, par période (\`startMonth\` / \`endMonth\` en YYYY-MM, requis), ressource, état de validation (\`validationStates\`) et périmètre (\`perimeter*\`).

\`resourceId\` est converti en référence \`keywords\` COMP<id> : l'API n'a pas de paramètre dédié.

Returns: Liste des demandes d'absence correspondantes.`,
      inputSchema: AbsenceSearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const query = buildSearchQuery(toKeywordReferences(params));
      const response = await apiRequest("/absences-reports", "GET", undefined, query);
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "absence", params.fields) }],
      };
    }
  );

  server.registerTool(
    "boond_absences_get",
    {
      title: "Details d'une absence",
      description: defaultGetDescription({
        ...{ entityName: "demande d'absence", entityNamePlural: "demandes d'absence", prefix: "boond_absences" },
        withTab: false,
      }),
      inputSchema: IdSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const response = await apiRequest(`/absences-reports/${params.id}`);
      return {
        content: [{ type: "text" as const, text: formatDetailResponse(response) }],
      };
    }
  );

  server.registerTool(
    "boond_absences_create",
    {
      title: "Creer une demande d'absence",
      description: composeDescription({
        purpose: "Crée une demande d'absence (congés, RTT, maladie…) pour une ressource.",
        when: "pour poser une absence au nom d'une ressource identifiée par son ID.",
        instead: "`boond_absences_update` pour modifier une demande déjà déposée.",
        behaviour: [
          "Le détail est porté par `absencesPeriods` ; si le tableau est omis, une période unique est déduite de `startDate`/`endDate`.",
          "Pas de `state` : sur `/absences-reports` l'état est une chaîne du workflow de validation (`waitingForValidation`, `validated`…) que seul le workflow déplace — la demande part en attente de validation, elle n'est pas validée par cet appel (suivi via `boond_validations_search`).",
          "Écriture non idempotente — l'API ne déduplique pas deux demandes sur les mêmes dates.",
        ],
        returns: "confirmation et fiche de la demande créée.",
      }),
      inputSchema: AbsenceCreateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const { resourceId, typeOf, startDate, endDate, duration, workUnitTypeReference, absencesPeriods, note } = params;
      const periods = absencesPeriods ?? [
        {
          startDate,
          endDate,
          duration: duration ?? inclusiveDays(startDate, endDate),
          title: typeOf,
          workUnitType: { reference: workUnitTypeReference ?? 2 },
        },
      ];
      const body = buildJsonApiBody(
        "absencesreport",
        {
          ...(note ? { informationComments: note } : {}),
          absencesPeriods: periods,
        },
        undefined,
        { resource: { id: resourceId, type: "resource" } }
      );
      const response = await apiRequest("/absences-reports", "POST", body);
      const entity = Array.isArray(response.data) ? response.data[0] : response.data;
      return {
        content: [
          {
            type: "text" as const,
            text: `Absence creee avec succes.\nID: ${entity?.id}\n\n${formatDetailResponse(response)}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "boond_absences_update",
    {
      title: "Modifier une absence",
      description: composeDescription({
        purpose: "Met à jour une demande d'absence existante, identifiée par son ID.",
        when: "pour corriger les dates, le motif ou le commentaire d'une demande déjà déposée.",
        instead: "`boond_absences_create` si la demande n'existe pas encore.",
        behaviour: [
          "Mise à jour partielle : seuls les champs fournis sont écrits.",
          "`absencesPeriods` fait exception — le tableau fourni **remplace** l'intégralité des périodes existantes.",
        ],
        returns: "confirmation et fiche mise à jour.",
      }),
      inputSchema: AbsenceUpdateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const { id, ...attrs } = params;
      const body = buildJsonApiBody("absencesreport", attrs, id);
      const response = await apiRequest(`/absences-reports/${id}`, "PUT", body);
      return {
        content: [
          {
            type: "text" as const,
            text: `Absence #${id} mise a jour.\n\n${formatDetailResponse(response)}`,
          },
        ],
      };
    }
  );

  registerDeleteTool(
    server,
    { entityName: "absence", entityNamePlural: "absences", apiPath: "/absences-reports", prefix: "boond_absences" },
    {
      title: "Supprimer une absence",
      description: defaultDeleteDescription({
        entityName: "demande d'absence",
        entityNamePlural: "demandes d'absence",
        prefix: "boond_absences",
      }),
    }
  );
}
