import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AbsenceSearchSchema, AbsenceCreateSchema, AbsenceUpdateSchema, IdSchema } from "../schemas/index.js";
import { apiRequest, buildSearchQuery, formatListResponse, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody, registerDeleteTool } from "./crud-factory.js";

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
        content: [{ type: "text" as const, text: formatListResponse(response, "absence") }],
      };
    }
  );

  server.registerTool(
    "boond_absences_get",
    {
      title: "Details d'une absence",
      description: "Recupere les informations detaillees d'une demande d'absence par son ID.",
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
      description: "Cree une demande d'absence Boond avec absencesPeriods.",
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
      description: "Met a jour une demande d'absence existante. Seuls les champs fournis sont modifies.",
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
      description: "Supprime une absence de BoondManager. Action irreversible.",
    }
  );
}
