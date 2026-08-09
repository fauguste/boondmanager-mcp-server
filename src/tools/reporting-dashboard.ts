import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JsonApiResource, JsonApiResponse, SearchParams } from "../types.js";
import { ReportingDashboardSchema } from "../schemas/index.js";
import { apiRequest, buildSearchQuery } from "../services/boond-client.js";
import { reportingEndpoint, reportingFilterKeys, type ReportingEndpoint } from "./reporting-endpoints.js";
import {
  appToolMeta,
  clientSupportsUi,
  resolveWebAppBaseUrl,
  REPORTING_UI_URI,
  RESOURCE_MIME_TYPE,
} from "../ui/index.js";

/**
 * `boond_reporting_dashboard` — the model-facing half of the MCP Apps reporting
 * app (`ui://boond/reporting`).
 *
 * ## Why the payload is pivoted server-side
 *
 * Every `/reporting-*` endpoint answers in a long/narrow "indicator" format:
 * one JSON:API row per (entity × scorecard), carrying
 * `attributes.scorecard.{reference,typeOf,dictionaryId}`, a stringified
 * `attributes.value`, and `relationships.dependsOn` pointing at the entity. A
 * page of 2 projects is 54 rows. Rendering that as-is is unreadable for a human
 * and expensive for a model, so the handler pivots it into the table everyone
 * actually wants — entities down, indicators across — and ships it as
 * `structuredContent`. The app renders that object directly; a client with no
 * MCP Apps support gets the same table as text.
 *
 * Three real response shapes are folded into two layouts:
 * - indicator rows *with* `dependsOn` (`/reporting-projects`, `-resources`,
 *   `-companies`) → `layout: "entities"`, pivoted;
 * - indicator rows *without* (`/reporting-synthesis`, which is global) →
 *   `layout: "indicators"`, one row per KPI with `value`/`target` columns;
 * - plain entity rows with flat attributes (`/reporting-production-plans`,
 *   which returns resources, not scorecards) → `layout: "entities"` too, with
 *   columns derived from the attribute keys.
 */

/** Hard ceilings on the pivoted table, so a wide page can't blow up the payload. */
const MAX_COLUMNS = 40;
const MAX_ROWS = 200;
/** Columns rendered in the *text* fallback (the app shows them all). */
const MAX_TEXT_COLUMNS = 8;

const CellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * Structured output of the dashboard tool.
 *
 * Detail tools in this codebase deliberately have no `outputSchema` (their text
 * already is machine-parseable JSON). This one is the opposite case: the app is
 * a *typed consumer* of the result, so the contract has to be declared and
 * stable — an untyped `structuredContent` would make every server-side shape
 * change a silent breakage of the iframe.
 */
export const ReportingDashboardOutputSchema = z.object({
  report: z.string().describe("Reporting demandé"),
  title: z.string().describe("Libellé du reporting"),
  layout: z.enum(["entities", "indicators"]).describe("'entities' = lignes par entité, 'indicators' = lignes par KPI"),
  period: z
    .object({ startDate: z.string().optional(), endDate: z.string().optional() })
    .optional()
    .describe("Période effectivement retournée par l'API"),
  total: z.number().optional().describe("Nombre total d'entités côté BoondManager (toutes pages)"),
  count: z.number().describe("Nombre de lignes de cette page"),
  webAppBaseUrl: z
    .string()
    .optional()
    .describe("Origine de l'interface BoondManager, pour construire un lien vers la fiche d'une ligne"),
  truncated: z.boolean().optional().describe("Présent si des lignes ou colonnes ont été coupées"),
  columns: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      kind: z.string().optional().describe("money, percentage, number, day, date, string..."),
    })
  ),
  rows: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      entity: z.object({ id: z.string(), type: z.string() }).optional(),
      kind: z.string().optional().describe("Type de la ligne (layout 'indicators')"),
      values: z.record(z.string(), CellValue),
    })
  ),
});

export type ReportingDashboardPayload = z.infer<typeof ReportingDashboardOutputSchema>;

// ---- Shaping helpers ---------------------------------------------------

function asArray(data: JsonApiResponse["data"]): JsonApiResource[] {
  return (Array.isArray(data) ? data : [data]).filter((r): r is JsonApiResource => r !== null && r !== undefined);
}

/** `turnoverSignedExcludingTax` → `Turnover signed excluding tax`. */
export function humanizeReference(reference: string): string {
  const spaced = reference
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced.length === 0 ? reference : spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

const NUMERIC_KINDS = new Set(["money", "percentage", "number", "day", "dayOrWorkUnit", "workUnit", "hour"]);

/**
 * BoondManager stringifies every indicator value, including money and
 * percentages. Numbers are recovered so the app can sort and plot them without
 * re-guessing; anything else (including compound `"210|0"` values) stays a
 * string.
 */
function coerceValue(value: unknown, kind: string | undefined): z.infer<typeof CellValue> {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "string") return String(value);
  if (kind !== undefined && !NUMERIC_KINDS.has(kind)) return value;
  if (value.trim() === "") return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

/** Human label for an entity, from the richest identity attribute available. */
export function entityLabel(entity: JsonApiResource | undefined, fallback: string): string {
  const a = entity?.attributes;
  if (a === undefined) return fallback;
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
  const name = str(a["name"]) ?? str(a["title"]) ?? str(a["reference"]);
  if (name !== undefined) return name;
  const person = [str(a["firstName"]), str(a["lastName"])].filter(Boolean).join(" ");
  return person !== "" ? person : fallback;
}

function includedIndex(response: JsonApiResponse): Map<string, JsonApiResource> {
  const index = new Map<string, JsonApiResource>();
  for (const r of response.included ?? []) index.set(`${r.type}:${r.id}`, r);
  return index;
}

interface Scorecard {
  reference: string;
  typeOf?: string;
  dictionaryId?: number;
}

function scorecardOf(row: JsonApiResource): Scorecard | undefined {
  const sc = row.attributes?.["scorecard"];
  if (typeof sc !== "object" || sc === null) return undefined;
  const { reference, typeOf, dictionaryId } = sc as Record<string, unknown>;
  if (typeof reference !== "string") return undefined;
  return {
    reference,
    typeOf: typeof typeOf === "string" ? typeOf : undefined,
    dictionaryId: typeof dictionaryId === "number" ? dictionaryId : undefined,
  };
}

function dependsOn(row: JsonApiResource): { id: string; type: string } | undefined {
  const rel = row.relationships?.["dependsOn"]?.data;
  return rel !== null && rel !== undefined && !Array.isArray(rel) ? rel : undefined;
}

/**
 * Two indicators can share a `reference` and differ only by `dictionaryId`
 * (`numberOfOpportunitiesPerStates` is emitted once per state). Folding them
 * onto the same column would silently overwrite all but the last.
 */
function columnKeyOf(sc: Scorecard): string {
  return sc.dictionaryId === undefined ? sc.reference : `${sc.reference}#${sc.dictionaryId}`;
}

function columnLabelOf(sc: Scorecard): string {
  const base = humanizeReference(sc.reference);
  return sc.dictionaryId === undefined ? base : `${base} (#${sc.dictionaryId})`;
}

type Column = ReportingDashboardPayload["columns"][number];
type Row = ReportingDashboardPayload["rows"][number];

/** Pivot indicator rows carrying a `dependsOn` entity. */
function pivotByEntity(rows: JsonApiResource[], included: Map<string, JsonApiResource>) {
  const columns = new Map<string, Column>();
  const byEntity = new Map<string, Row>();
  let truncated = false;

  for (const row of rows) {
    const sc = scorecardOf(row);
    const entity = dependsOn(row);
    if (sc === undefined || entity === undefined) continue;

    const rowKey = `${entity.type}:${entity.id}`;
    let target = byEntity.get(rowKey);
    if (target === undefined) {
      if (byEntity.size >= MAX_ROWS) {
        truncated = true;
        continue;
      }
      target = {
        key: rowKey,
        label: entityLabel(included.get(rowKey), `#${entity.id}`),
        entity,
        values: {},
      };
      byEntity.set(rowKey, target);
    }

    const colKey = columnKeyOf(sc);
    if (!columns.has(colKey)) {
      if (columns.size >= MAX_COLUMNS) {
        truncated = true;
        continue;
      }
      columns.set(colKey, { key: colKey, label: columnLabelOf(sc), ...(sc.typeOf ? { kind: sc.typeOf } : {}) });
    }
    target.values[colKey] = coerceValue(row.attributes?.["value"], sc.typeOf);
  }

  return { columns: [...columns.values()], rows: [...byEntity.values()], truncated };
}

/** One row per KPI — the global synthesis has no entity axis. */
function listIndicators(rows: JsonApiResource[]) {
  const columns: Column[] = [
    { key: "value", label: "Valeur" },
    { key: "target", label: "Cible" },
  ];
  const out: Row[] = [];
  let truncated = false;

  for (const row of rows) {
    const sc = scorecardOf(row);
    if (sc === undefined) continue;
    if (out.length >= MAX_ROWS) {
      truncated = true;
      break;
    }
    out.push({
      key: row.id,
      label: columnLabelOf(sc),
      ...(sc.typeOf ? { kind: sc.typeOf } : {}),
      values: {
        value: coerceValue(row.attributes?.["value"], sc.typeOf),
        target: coerceValue(row.attributes?.["target"], sc.typeOf),
      },
    });
  }

  return { columns, rows: out, truncated };
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

/** Endpoints that return plain entities rather than scorecards. */
function tabulateEntities(rows: JsonApiResource[]) {
  const columns = new Map<string, Column>();
  const out: Row[] = [];
  let truncated = false;

  for (const row of rows) {
    if (out.length >= MAX_ROWS) {
      truncated = true;
      break;
    }
    const values: Row["values"] = {};
    for (const [key, value] of Object.entries(row.attributes ?? {})) {
      if (!isScalar(value)) continue;
      if (!columns.has(key)) {
        if (columns.size >= MAX_COLUMNS) {
          truncated = true;
          continue;
        }
        columns.set(key, { key, label: humanizeReference(key) });
      }
      values[key] = value;
    }
    out.push({
      key: `${row.type}:${row.id}`,
      label: entityLabel(row, `#${row.id}`),
      entity: { id: row.id, type: row.type },
      values,
    });
  }

  return { columns: [...columns.values()], rows: out, truncated };
}

/**
 * Turn a raw `/reporting-*` response into the dashboard payload. Pure — no I/O,
 * so it is unit-tested against recorded shapes of all five endpoints.
 */
export function buildReportingDashboard(
  response: JsonApiResponse,
  ep: Pick<ReportingEndpoint, "name" | "title">
): ReportingDashboardPayload {
  const data = asArray(response.data);
  const included = includedIndex(response);
  const indicatorRows = data.filter((r) => scorecardOf(r) !== undefined);
  const hasEntityAxis = indicatorRows.some((r) => dependsOn(r) !== undefined);

  const shaped =
    indicatorRows.length === 0
      ? tabulateEntities(data)
      : hasEntityAxis
        ? pivotByEntity(indicatorRows, included)
        : listIndicators(indicatorRows);

  const layout: ReportingDashboardPayload["layout"] =
    indicatorRows.length > 0 && !hasEntityAxis ? "indicators" : "entities";

  const totals = response.meta?.totals;
  // `rows` counts indicator rows on the pivoted endpoints, `dependsOn` counts
  // the entities — which is what "total" means once the table is pivoted.
  const total = typeof totals?.dependsOn === "number" ? totals.dependsOn : totals?.rows;
  const dates = response.meta?.["dates"];
  const period =
    typeof dates === "object" && dates !== null
      ? {
          ...(typeof (dates as Record<string, unknown>)["startDate"] === "string"
            ? { startDate: (dates as Record<string, string>)["startDate"] }
            : {}),
          ...(typeof (dates as Record<string, unknown>)["endDate"] === "string"
            ? { endDate: (dates as Record<string, string>)["endDate"] }
            : {}),
        }
      : undefined;

  return {
    report: ep.name,
    title: ep.title,
    layout,
    ...(period !== undefined && Object.keys(period).length > 0 ? { period } : {}),
    ...(typeof total === "number" ? { total } : {}),
    count: shaped.rows.length,
    webAppBaseUrl: resolveWebAppBaseUrl(),
    ...(shaped.truncated ? { truncated: true } : {}),
    columns: shaped.columns,
    rows: shaped.rows,
  };
}

// ---- Text fallback -----------------------------------------------------

function renderCell(value: z.infer<typeof CellValue>): string {
  if (value === null) return "";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

/**
 * Markdown table of the same payload, for hosts that don't render MCP Apps —
 * and for the model, which reads this even when the app *is* rendered (the
 * result is part of the conversation either way).
 */
export function formatDashboardText(payload: ReportingDashboardPayload): string {
  const lines: string[] = [];
  const periodLabel =
    payload.period === undefined ? "" : ` — ${payload.period.startDate ?? "?"} → ${payload.period.endDate ?? "?"}`;
  lines.push(`${payload.title}${periodLabel}`);

  const totalLabel = payload.total === undefined ? "" : ` sur ${payload.total} au total`;
  lines.push(
    `${payload.count} ligne(s)${totalLabel}, ${payload.columns.length} colonne(s)` +
      (payload.truncated === true ? " (résultat tronqué)" : "")
  );

  if (payload.rows.length === 0) {
    lines.push("Aucune donnée pour ces critères.");
    return lines.join("\n");
  }

  const shown = payload.columns.slice(0, MAX_TEXT_COLUMNS);
  const hidden = payload.columns.length - shown.length;
  const rowHeader = payload.layout === "indicators" ? "Indicateur" : "Ligne";
  lines.push("");
  lines.push(`| ${[rowHeader, ...shown.map((c) => c.label)].join(" | ")} |`);
  lines.push(`|${"---|".repeat(shown.length + 1)}`);
  for (const row of payload.rows) {
    lines.push(`| ${[row.label, ...shown.map((c) => renderCell(row.values[c.key] ?? null))].join(" | ")} |`);
  }
  if (hidden > 0) {
    lines.push("");
    lines.push(`(+${hidden} colonne(s) non affichée(s) ici — présentes dans structuredContent.)`);
  }
  return lines.join("\n");
}

// ---- Tool registration -------------------------------------------------

/** Keys of the dashboard schema that are ours, not BoondManager query params. */
const SYNTHETIC_KEYS = new Set(["report", "max"]);

/**
 * Build the API query: keep only what the selected endpoint accepts, and map
 * the uniform `max` onto that endpoint's own `max*` parameter.
 */
export function buildDashboardQuery(params: Record<string, unknown>, ep: ReportingEndpoint): SearchParams {
  const allowed = new Set(reportingFilterKeys(ep));
  const forwarded: SearchParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (SYNTHETIC_KEYS.has(key)) continue;
    if (value === undefined) continue;
    if (allowed.has(key)) forwarded[key] = value;
  }
  if (ep.maxParam !== undefined && typeof params["max"] === "number") {
    forwarded[ep.maxParam] = params["max"];
  }
  return forwarded;
}

export function registerReportingDashboardTool(server: McpServer): void {
  server.registerTool(
    "boond_reporting_dashboard",
    {
      title: "Tableau de bord reporting",
      description: `Reporting BoondManager sous forme de tableau prêt à lire (entités en lignes, indicateurs en colonnes) plutôt que la liste brute d'indicateurs de l'API.
Sur les clients qui implémentent MCP Apps (extension io.modelcontextprotocol/ui), rend en plus un tableau de bord interactif : tri, graphe, changement de reporting/période sans nouvel appel du modèle. Ailleurs, la même donnée arrive en texte + structuredContent.

Choisir \`report\` : synthesis (KPIs globaux), projects, resources, companies, production_plans.
⚠️ \`startDate\` + \`endDate\` (YYYY-MM-DD) sont REQUIS pour synthesis, companies et production_plans.
Filtres : périmètre (perimeterDynamic/perimeterManagers/perimeterAgencies...), période (period, periodDynamic), états/types (IDs entiers de boond_application_dictionary), \`max\` = entités par page (1-10).
Les filtres non pertinents pour le \`report\` choisi ne sont pas transmis.

Returns: tableau pivoté (columns/rows) + total.`,
      inputSchema: ReportingDashboardSchema,
      outputSchema: ReportingDashboardOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: appToolMeta({ resourceUri: REPORTING_UI_URI, visibility: ["model", "app"] }),
    },
    async (params: unknown) => {
      const input = params as Record<string, unknown>;
      const ep = reportingEndpoint(String(input["report"]));
      if (ep === undefined) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Reporting inconnu : « ${String(input["report"])} ».` }],
        };
      }
      if (ep.datesRequired && (input["startDate"] === undefined || input["endDate"] === undefined)) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Le reporting « ${ep.name} » exige startDate ET endDate (YYYY-MM-DD) : l'API BoondManager répond 422 sans elles.`,
            },
          ],
        };
      }

      const query = buildSearchQuery(buildDashboardQuery(input, ep));
      const response = await apiRequest(ep.path, "GET", undefined, query);
      const payload = buildReportingDashboard(response, ep);

      return {
        content: [
          { type: "text" as const, text: formatDashboardText(payload) },
          // Additive, and only for hosts that can actually read a `ui://` URI —
          // sending it elsewhere is noise the model has to reason about.
          ...(clientSupportsUi(server)
            ? [
                {
                  type: "resource_link" as const,
                  uri: REPORTING_UI_URI,
                  name: "Tableau de bord reporting",
                  mimeType: RESOURCE_MIME_TYPE,
                },
              ]
            : []),
        ],
        structuredContent: payload,
      };
    }
  );
}
