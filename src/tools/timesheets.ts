import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ResourceTimesheetSchema,
  TimesheetCreateSchema,
  TimesheetDefaultSchema,
  TimesheetSearchSchema,
  TimesheetUpdateSchema,
} from "../schemas/index.js";
import type { ResourceTimesheetInput, TimesheetDefaultInput, TimesheetLineInput } from "../schemas/index.js";
import { apiRequest, formatListResponse } from "../services/boond-client.js";
import {
  buildJsonApiBody,
  registerCreateTool,
  registerGetTool,
  registerSearchTool,
  registerUpdateTool,
} from "./crud-factory.js";
import type { JsonApiResource, JsonApiResponse } from "../types.js";
import { composeDescription } from "./description-builders.js";

/**
 * One CRA line, as the API stores it: nested `workUnitType`, `project`,
 * `delivery`, `batch` objects around the flat ids the schema takes. A missing
 * project / delivery / batch is sent as `null`, which is how the API itself
 * represents an absence line (`GET /times-reports/{id}` → `"project": null`).
 */
export function buildTimeLine(line: TimesheetLineInput): Record<string, unknown> {
  const { workUnitTypeReference, projectId, deliveryId, batchId, ...rest } = line;
  return {
    ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
    workUnitType: { reference: workUnitTypeReference },
    project: projectId === undefined ? null : { id: projectId },
    delivery: deliveryId === undefined ? null : { id: deliveryId },
    batch: batchId === undefined ? null : { id: batchId },
  };
}

/** Build the `/times-reports` payload: convenience ids → relationships, lines → nested objects. */
export function buildTimesheetBody(params: Record<string, unknown>): unknown {
  const { id, resourceId, agencyId, regularTimes, exceptionalTimes, ...attrs } = params;
  const attributes: Record<string, unknown> = { ...attrs };
  if (regularTimes !== undefined) attributes.regularTimes = (regularTimes as TimesheetLineInput[]).map(buildTimeLine);
  if (exceptionalTimes !== undefined) {
    attributes.exceptionalTimes = (exceptionalTimes as TimesheetLineInput[]).map(buildTimeLine);
  }
  return buildJsonApiBody("timesreport", attributes, id as string | undefined, {
    resource: resourceId ? { id: String(resourceId), type: "resource" } : undefined,
    agency: agencyId ? { id: String(agencyId), type: "agency" } : undefined,
  });
}

interface WorkUnitType {
  reference?: number;
  activityType?: string;
  name?: string;
}

interface PlannedTime {
  startDate?: string;
  duration?: number;
  workUnitType?: WorkUnitType;
  project?: { id?: string; reference?: string } | null;
  delivery?: { id?: string } | null;
}

/**
 * Render `/times-reports/default` down to what a caller needs to write lines.
 *
 * The response is the only place the work-unit-type codes are published — on
 * the included **resource** (`workUnitTypesAllowed`), not on the agency and not
 * in `/application/dictionary` — together with the (project, delivery) pairs
 * chargeable that month and the `plannedTimes` derived from the deliveries'
 * planning, which are the lines a filled CRA usually repeats.
 */
export function formatTimesheetDefaults(response: JsonApiResponse): string {
  const entity = Array.isArray(response.data) ? response.data[0] : response.data;
  if (!entity) return "Aucune donnée par défaut retournée pour cette ressource / ce mois.";
  const attrs = entity.attributes ?? {};
  const included = response.included ?? [];
  const byType = (type: string) => included.filter((i) => i.type === type);
  const resourceRef = entity.relationships?.resource?.data as { id?: string } | undefined;
  const agencyRef = entity.relationships?.agency?.data as { id?: string } | undefined;
  const resource = byType("resource").find((r) => r.id === resourceRef?.id) ?? byType("resource")[0];
  const agency = byType("agency").find((a) => a.id === agencyRef?.id) ?? byType("agency")[0];
  const resourceAttrs = resource?.attributes ?? {};
  const agencyAttrs = agency?.attributes ?? {};

  const lines: string[] = [
    `CRA — ressource #${resource?.id ?? resourceRef?.id ?? "?"}${resourceAttrs.firstName || resourceAttrs.lastName ? ` (${[resourceAttrs.firstName, resourceAttrs.lastName].filter(Boolean).join(" ")})` : ""}, mois ${String(attrs.term ?? "?")}`,
    `Agence: #${agency?.id ?? "?"}${agencyAttrs.name ? ` (${String(agencyAttrs.name)})` : ""} | Unité d'œuvre: ${String(attrs.workUnitRate ?? agencyAttrs.workUnitRate ?? "?")} | Calendrier: ${String(agencyAttrs.calendar ?? "?")}`,
  ];

  const types = (resourceAttrs.workUnitTypesAllowed as WorkUnitType[] | undefined) ?? [];
  lines.push(
    "",
    `Types d'unité d'œuvre autorisés (${types.length}) — utiliser \`reference\` comme \`workUnitTypeReference\` :`
  );
  lines.push(
    ...(types.length
      ? types.map((t) => `  reference=${t.reference} | ${t.name ?? ""} | ${t.activityType ?? ""}`)
      : ["  (aucun type publié pour cette ressource)"])
  );

  const projects = byType("project");
  lines.push("", `Imputations possibles (${projects.length}) — \`projectId\` / \`deliveryId\` :`);
  if (projects.length === 0) {
    lines.push(
      "  (aucune imputation disponible pour cette ressource sur ce mois — seules des absences peuvent être saisies)"
    );
  } else {
    for (const p of projects) {
      const ref = p.attributes?.reference ?? p.attributes?.title ?? "";
      const refs = (name: string): string[] =>
        ((p.relationships?.[name]?.data ?? []) as { id?: string }[]).map((d) => `#${d.id}`);
      const deliveryIds = refs("deliveries");
      const batchIds = refs("batches");
      const parts = [
        `  projectId=${p.id}`,
        String(ref),
        `deliveryId ∈ ${deliveryIds.length ? deliveryIds.join(", ") : "(aucune prestation — imputation impossible)"}`,
      ];
      if (batchIds.length) parts.push(`batchId ∈ ${batchIds.join(", ")}`);
      lines.push(parts.join(" | "));
    }
  }

  const planned = (attrs.plannedTimes as PlannedTime[] | undefined) ?? [];
  const totalPlanned = planned.reduce((n, t) => n + (Number(t.duration) || 0), 0);
  lines.push(
    "",
    `Planning prévu (${planned.length} ligne(s), ${totalPlanned} unité(s)) — base de saisie à confirmer jour par jour :`
  );
  if (planned.length === 0) {
    lines.push("  (aucune ligne planifiée)");
  } else {
    const byKey = new Map<string, { count: number; duration: number; first: string; last: string }>();
    for (const t of planned) {
      const key = `projectId=${t.project?.id ?? "-"} | deliveryId=${t.delivery?.id ?? "-"} | workUnitTypeReference=${t.workUnitType?.reference ?? "-"} (${t.workUnitType?.name ?? ""})`;
      const day = t.startDate ?? "";
      const cur = byKey.get(key) ?? { count: 0, duration: 0, first: day, last: day };
      cur.count += 1;
      cur.duration += Number(t.duration) || 0;
      if (day && (cur.first === "" || day < cur.first)) cur.first = day;
      if (day && day > cur.last) cur.last = day;
      byKey.set(key, cur);
    }
    for (const [key, v] of byKey)
      lines.push(`  ${key} : ${v.count} jour(s), ${v.duration} unité(s), du ${v.first} au ${v.last}`);
  }

  const absences = (attrs.absencesTimes as PlannedTime[] | undefined) ?? [];
  if (absences.length) {
    lines.push("", `Absences déjà posées sur le mois (${absences.length}) — ne pas les ressaisir :`);
    for (const t of absences)
      lines.push(
        `  ${t.startDate ?? "?"} | ${t.duration ?? "?"} | ${t.workUnitType?.name ?? ""} (reference=${t.workUnitType?.reference ?? "?"})`
      );
  }
  return lines.join("\n");
}

/**
 * One line per times report. The rows carry no name / title, so the generic
 * summary would print a bare `[timesreport #id]`; this names the window, the
 * state and the totals instead. Truncation, the `shown/total` banner and the
 * `fields` projection come from `formatListResponse` (#243) — this file used
 * to carry its own formatter that cut mid-line and crashed on `data: null`.
 */
export function timesheetSummary(item: JsonApiResource): string {
  const attrs = item.attributes ?? {};
  const parts: string[] = [`[timesreport #${item.id}]`];

  if (attrs.term) parts.push(`Mois: ${attrs.term}`);
  if (attrs.startDate) parts.push(`Du: ${attrs.startDate}`);
  if (attrs.endDate) parts.push(`Au: ${attrs.endDate}`);
  if (attrs.state !== undefined) parts.push(`Statut: ${attrs.state}`);
  if (attrs.totalDays !== undefined) parts.push(`Jours: ${attrs.totalDays}`);
  if (attrs.totalHours !== undefined) parts.push(`Heures: ${attrs.totalHours}`);

  return parts.join(" | ");
}

const OPTS = {
  entityName: "feuille de temps",
  entityNamePlural: "feuilles de temps",
  apiPath: "/times-reports",
  prefix: "boond_timesheets",
};

export function registerTimesheetTools(server: McpServer): void {
  server.registerTool(
    "boond_timesheets_default",
    {
      title: "Référentiels de saisie d'un CRA",
      description: composeDescription({
        purpose:
          "Renvoie ce qu'il faut savoir avant d'écrire le CRA d'une ressource sur un mois : types d'unité d'œuvre autorisés, couples projet/prestation imputables, planning prévu et absences déjà posées.",
        when: "AVANT `boond_timesheets_create` / `boond_timesheets_update` — les codes `workUnitTypeReference` ne sont publiés nulle part ailleurs (ni dans `boond_application_dictionary`, ni sur `boond_agencies_get`).",
        instead: "aucun autre outil ne donne ces codes ; `boond_timesheets_get` pour relire un CRA existant.",
        behaviour: [
          "Lecture seule (`GET /times-reports/default`). La réponse brute est réduite : les types viennent de la ressource incluse (`workUnitTypesAllowed`), les imputations des projets inclus, le planning de `plannedTimes`.",
          "Une ressource sans imputation ce mois-là ne peut saisir que des absences.",
        ],
        returns:
          "texte : agence, types d'unité d'œuvre (reference | libellé | activityType), imputations `projectId` / `deliveryId` (et `batchId`), planning prévu agrégé par imputation, absences déjà posées.",
      }),
      inputSchema: TimesheetDefaultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: TimesheetDefaultInput) => {
      const query: Record<string, string | number | undefined> = { resource: params.resourceId, term: params.term };
      if (params.agencyId) query.agency = params.agencyId;
      const response = await apiRequest("/times-reports/default", "GET", undefined, query);
      return { content: [{ type: "text" as const, text: formatTimesheetDefaults(response) }] };
    }
  );

  registerCreateTool(server, OPTS, TimesheetCreateSchema, buildTimesheetBody, {
    title: "Créer une feuille de temps",
    description: composeDescription({
      purpose: "Crée la feuille de temps (CRA) d'un mois pour une ressource, avec ses lignes jour par jour.",
      when: "pour ouvrir le CRA d'un couple (ressource, mois) qui n'existe pas encore, après `boond_timesheets_default`.",
      instead:
        "`boond_timesheets_search` (`startMonth`/`endMonth` + `resourceId`) d'abord : l'API ne déduplique pas, deux CRA peuvent coexister sur le même mois ; `boond_timesheets_update` si le CRA existe déjà.",
      behaviour: [
        "Un CRA est un conteneur mensuel (`term` + `resource`) ; les lignes vont dans `regularTimes[]` (production et absences) et `exceptionalTimes[]` — chaque ligne = un jour, une durée, un type d'unité d'œuvre, et pour la production un couple `projectId` / `deliveryId` imputable.",
        "`state` n'est pas un champ d'écriture : il est piloté par le workflow de validation (`boond_validations_search`).",
        "Écriture non idempotente. Modèle d'écriture établi en lecture depuis l'API (forme des CRA existants et de `/times-reports/default`), pas encore éprouvé en écriture sur un tenant de test — voir CLAUDE.md.",
      ],
      returns: "confirmation, ID créé (`structuredContent.id`) et fiche du CRA.",
    }),
  });

  registerUpdateTool(server, OPTS, TimesheetUpdateSchema, buildTimesheetBody, {
    method: "PUT",
    title: "Modifier une feuille de temps",
    description: composeDescription({
      purpose: "Met à jour un CRA existant : commentaires, clôture, ou remplacement complet de ses lignes.",
      when: "pour compléter ou corriger le CRA d'un mois déjà ouvert (trouvé via `boond_timesheets_search`).",
      instead: "`boond_timesheets_create` si aucun CRA n'existe encore pour ce couple (ressource, mois).",
      behaviour: [
        "Mise à jour partielle sur les champs simples, MAIS `regularTimes` / `exceptionalTimes` **remplacent le tableau entier** : relire le CRA (`boond_timesheets_get`), fusionner, renvoyer la liste complète — envoyer une seule ligne efface le mois.",
        "`state` n'est pas un champ d'écriture (workflow de validation).",
      ],
      returns: "confirmation et fiche du CRA mis à jour.",
    }),
  });

  // Get timesheets for a specific resource
  server.registerTool(
    "boond_resources_timesheets",
    {
      title: "Feuilles de temps d'une ressource",
      description: `Récupère les feuilles de temps (times reports) d'une ressource par son ID, avec filtre optionnel par mois/année (défaut : mois courant).

Returns: Liste des feuilles de temps de la ressource avec jours/heures et statut.`,
      inputSchema: ResourceTimesheetSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: ResourceTimesheetInput) => {
      const queryParams: Record<string, string | number | undefined> = {};
      if (params.month !== undefined) queryParams["month"] = params.month;
      if (params.year !== undefined) queryParams["year"] = params.year;

      const response = await apiRequest(`/resources/${params.resourceId}/times-reports`, "GET", undefined, queryParams);
      const text = formatListResponse(response, "feuille de temps", undefined, timesheetSummary);
      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );

  // Search all timesheets — the factory hands `timesheetSummary` to the list
  // formatter and to `structuredContent` alike (#243).
  registerSearchTool(server, OPTS, {
    schema: TimesheetSearchSchema,
    summaryFn: timesheetSummary,
    title: "Rechercher des feuilles de temps",
    description: `Recherche des feuilles de temps (CRA mensuels) dans BoondManager.

⚠️ \`startMonth\` et \`endMonth\` (format YYYY-MM) sont requis par l'API — passer YYYY-MM-DD ou les omettre renvoie un 422.

Returns: Liste des feuilles de temps correspondantes (une ligne par CRA : mois, période, statut, totaux).`,
  });

  registerGetTool(server, OPTS, {
    withTab: false,
    title: "Détails d'une feuille de temps",
    description: `Récupère les informations détaillées d'une feuille de temps (CRA mensuel) par son ID.

Returns: Données JSON complètes de la feuille de temps (jours, heures, statut, détails).`,
  });
}
