import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AbsenceSearchSchema, AbsenceCreateSchema, AbsenceUpdateSchema, IdSchema } from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody, registerDeleteTool } from "./crud-factory.js";
import { composeDescription, defaultDeleteDescription, defaultGetDescription } from "./description-builders.js";

function inclusiveDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 1;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function registerAbsenceTools(server: McpServer): void {
  server.registerTool(
    "boond_absences_search",
    {
      title: "Rechercher des demandes d'absence",
      description: `Recherche des demandes d'absence dans BoondManager.

Args:
  - keywords (string, optional): Termes de recherche. resourceId est converti en COMP<id>.
  - startMonth, endMonth (string, optional): Periode au format YYYY-MM.
  - page, pageSize: Pagination

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
      const { resourceId, keywords, ...rest } = params;
      const tokens: string[] = [];
      if (keywords) tokens.push(keywords);
      if (resourceId) tokens.push(`COMP${resourceId}`);
      const query = buildSearchQuery(tokens.length > 0 ? { ...rest, keywords: tokens.join(" ") } : rest);
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
          "`state` est soumis au workflow de validation BoondManager : la demande part dans son état initial, elle n'est pas validée par cet appel.",
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
      const { resourceId, typeOf, startDate, endDate, duration, workUnitTypeReference, absencesPeriods, state, note } =
        params;
      const periods = absencesPeriods ?? [
        {
          startDate,
          endDate,
          duration: duration ?? inclusiveDays(startDate, endDate),
          title: typeOf,
          workUnitType: { reference: workUnitTypeReference ?? 2 },
        },
      ];
      const body = buildJsonApiBody("absencesreport", {
        ...(note ? { informationComments: note } : {}),
        ...(state !== undefined ? { state } : {}),
        absencesPeriods: periods,
      });
      (body as Record<string, Record<string, unknown>>).data.relationships = {
        resource: { data: { id: resourceId, type: "resource" } },
      };
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
