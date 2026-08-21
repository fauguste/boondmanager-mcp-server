import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ExpenseSearchSchema,
  ExpenseCreateSchema,
  ExpenseUpdateSchema,
  ExpenseDefaultSchema,
} from "../schemas/index.js";
import type { ExpenseDefaultInput, ExpenseLineInput } from "../schemas/index.js";
import { apiRequest } from "../services/boond-client.js";
import type { JsonApiResource, JsonApiResponse } from "../types.js";
import {
  buildJsonApiBody,
  registerSearchTool,
  registerGetTool,
  registerCreateTool,
  registerUpdateTool,
  registerDeleteTool,
} from "./crud-factory.js";

// Expense reports are searched on /expenses but read/written on /expenses-reports.
const SEARCH_OPTS = {
  entityName: "note de frais",
  entityNamePlural: "notes de frais",
  apiPath: "/expenses",
  prefix: "boond_expenses",
};
const REPORT_OPTS = { ...SEARCH_OPTS, apiPath: "/expenses-reports" };

/**
 * Map one flat line input to the nested shape `actualExpenses[]` expects.
 *
 * `batch` is the reason this cannot be a generic undefined-stripping mapper:
 * the API requires the key to be **present** on every line and its `id` to be
 * `null` when there is no batch (`{ id: "0" }` / `{ id: 0 }` both 422). Same for
 * `expenseType` on a kilometric line — the key must be there, holding `null`,
 * which is why it is written unconditionally instead of via the optional path.
 */
function buildExpenseLine(line: ExpenseLineInput): Record<string, unknown> {
  const { expenseTypeReference, projectId, deliveryId, batchId, ...rest } = line;
  const out: Record<string, unknown> = {
    ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
    expenseType: expenseTypeReference === undefined ? null : { reference: expenseTypeReference },
    project: { id: projectId },
    delivery: { id: deliveryId },
    batch: { id: batchId ?? null },
  };
  return out;
}

/**
 * Build the `/expenses-reports` payload: the convenience ids become JSON:API
 * relationships, `ratePerKilometerTypeReference` becomes the nested
 * `ratePerKilometerType`, and every line goes through `buildExpenseLine`.
 */
function buildExpenseBody(params: Record<string, unknown>): unknown {
  const { id, resourceId, agencyId, ratePerKilometerTypeReference, actualExpenses, ...attrs } = params;
  const attributes: Record<string, unknown> = { ...attrs };
  if (ratePerKilometerTypeReference !== undefined) {
    attributes.ratePerKilometerType = { reference: ratePerKilometerTypeReference };
  }
  if (actualExpenses !== undefined) {
    attributes.actualExpenses = (actualExpenses as ExpenseLineInput[]).map(buildExpenseLine);
  }
  return buildJsonApiBody("expensesreport", attributes, id as string | undefined, {
    resource: resourceId ? { id: String(resourceId), type: "resource" } : undefined,
    agency: agencyId ? { id: String(agencyId), type: "agency" } : undefined,
  });
}

interface DefaultRef {
  reference?: number;
  name?: string;
  taxRate?: number;
  amount?: number;
}

/**
 * Render `/expenses-reports/default` down to the handful of references a caller
 * actually needs to write a line.
 *
 * The raw response is unusable as-is: it inlines the resource's whole
 * `timesreport` (every daily time row of the month), so `formatDetailResponse`
 * would spend the character budget on data no expense payload references. What
 * matters is the agency's `expenseTypes` and `ratePerKilometerTypes` — the only
 * place those codes are published, since `/application/dictionary` does not
 * carry them and `/agencies/{id}` only returns a name — plus the (project,
 * delivery) pairs the resource may charge for that term, which are exactly the
 * two ids a line cannot omit.
 */
function formatExpenseDefaults(response: JsonApiResponse): string {
  const entity = (Array.isArray(response.data) ? response.data[0] : response.data) as JsonApiResource | undefined;
  if (!entity) return "Aucune donnée par défaut retournée pour cette ressource / ce mois.";

  const attrs = entity.attributes ?? {};
  const included = response.included ?? [];
  const byType = (type: string) => included.filter((i) => i.type === type);

  const agencyRef = entity.relationships?.agency?.data as { id?: string } | undefined;
  const agency = byType("agency").find((a) => a.id === agencyRef?.id) ?? byType("agency")[0];
  const agencyAttrs = agency?.attributes ?? {};

  const lines: string[] = [
    `Note de frais — ressource #${(entity.relationships?.resource?.data as { id?: string } | undefined)?.id ?? "?"}, mois ${String(attrs.term ?? "?")}`,
    `Agence: #${agency?.id ?? "?"}${agencyAttrs.name ? ` (${String(agencyAttrs.name)})` : ""}`,
    `Devise agence: ${String(attrs.currencyAgency ?? 0)} | Taux de change agence: ${String(attrs.exchangeRateAgency ?? 1)}`,
  ];

  const kmType = attrs.ratePerKilometerType as DefaultRef | undefined;
  if (kmType?.reference !== undefined) {
    lines.push(
      `Barème kilométrique par défaut: reference=${kmType.reference} (${kmType.name ?? ""} — ${kmType.amount ?? "?"} /km)`
    );
  }

  const expenseTypes = (agencyAttrs.expenseTypes as DefaultRef[] | undefined) ?? [];
  lines.push("", `Types de frais (${expenseTypes.length}) — utiliser \`reference\` comme \`expenseTypeReference\` :`);
  lines.push(
    ...(expenseTypes.length
      ? expenseTypes.map((t) => `  reference=${t.reference} | ${t.name ?? ""} | TVA ${t.taxRate ?? 0} %`)
      : ["  (aucun type de frais configuré sur cette agence)"])
  );

  const kmTypes = (agencyAttrs.ratePerKilometerTypes as DefaultRef[] | undefined) ?? [];
  if (kmTypes.length) {
    lines.push("", `Barèmes kilométriques (${kmTypes.length}) — \`ratePerKilometerTypeReference\` :`);
    lines.push(...kmTypes.map((t) => `  reference=${t.reference} | ${t.name ?? ""} | ${t.amount ?? "?"} /km`));
  }

  // A line must carry both projectId and deliveryId, and the API rejects a pair
  // it does not consider chargeable for that resource/term — so list the pairs
  // rather than the projects alone.
  //
  // The link is published on the **project** side (`project.relationships.deliveries`);
  // the included `delivery` objects carry no `relationships` at all. Reading it
  // the other way round matches nothing, and pairing every project with every
  // delivery as a fallback would advertise couples the API refuses — so a
  // project with no delivery is reported as such instead.
  const projects = byType("project");
  lines.push("", `Imputations possibles (${projects.length}) — \`projectId\` / \`deliveryId\` :`);
  if (projects.length === 0) {
    lines.push("  (aucune imputation disponible pour cette ressource sur ce mois)");
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

  return lines.join("\n");
}

export function registerExpenseTools(server: McpServer): void {
  registerSearchTool(server, SEARCH_OPTS, {
    schema: ExpenseSearchSchema,
    description: `Recherche des notes de frais dans BoondManager avec filtres par ressource, projet et période.

Args:
  - keywords (string, optional): Termes de recherche
  - resourceId, projectId (string, optional): Filtrer par entité liée
  - startDate, endDate (string, optional): Période (YYYY-MM-DD)
  - page, pageSize: Pagination

Returns: Liste des notes de frais correspondantes.`,
  });
  registerGetTool(server, REPORT_OPTS, { withTab: false });

  server.registerTool(
    "boond_expenses_default",
    {
      title: "Références de saisie d'une note de frais",
      description: `Retourne les référentiels nécessaires pour saisir une note de frais pour une ressource et un mois donnés : agence, devise et taux de change agence, **types de frais** (\`reference\` + libellé + taux de TVA), barèmes kilométriques, et couples projet / prestation imputables.

À appeler AVANT \`boond_expenses_create\` : les types de frais sont définis **par agence** et ne figurent pas dans \`boond_application_dictionary\`. Les ids \`projectId\` et \`deliveryId\` sont obligatoires sur chaque ligne et l'API refuse un couple qu'elle ne juge pas imputable sur ce mois.

Args:
  - resourceId (string): ID de la ressource
  - term (string): Mois ciblé (YYYY-MM)
  - agencyId (string, optional): Forcer l'agence

Returns: Les références à recopier dans \`boond_expenses_create\`.`,
      inputSchema: ExpenseDefaultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: ExpenseDefaultInput) => {
      // The query goes through `queryParams`, never the path: `assertSafeApiPath`
      // rejects a `?` outright (defense-in-depth against query injection through
      // an interpolated id).
      const response = await apiRequest("/expenses-reports/default", "GET", undefined, {
        resource: params.resourceId,
        term: params.term,
        agency: params.agencyId,
      });
      return { content: [{ type: "text" as const, text: formatExpenseDefaults(response) }] };
    }
  );

  registerCreateTool(server, REPORT_OPTS, ExpenseCreateSchema, buildExpenseBody, {
    description: `Crée une note de frais dans BoondManager. Une note de frais = **un mois** (\`term\`) × **une ressource**, dont les lignes sont portées par \`actualExpenses\`.

⚠️ Appeler \`boond_expenses_default\` d'abord : il fournit \`agencyId\`, \`currencyAgency\`, \`exchangeRateAgency\`, les \`expenseTypeReference\` disponibles (définis par agence, absents de \`boond_application_dictionary\`) et les couples \`projectId\` / \`deliveryId\` imputables. Sans ces valeurs l'API répond 422.

Sur une ligne, \`amountIncludingTax\` est le montant **TTC** et \`tax\` un **taux** de TVA en %. Le montant HT et le montant de TVA sont recalculés par BoondManager, ils ne se saisissent pas.

L'état de la note de frais n'est pas pilotable ici : une création part toujours en \`savedAndNoValidation\`, le passage en validation relève du workflow BoondManager.

Returns: Données de la note de frais créée avec son ID.`,
  });
  // BoondManager expects PUT (not PATCH) on /expenses-reports.
  registerUpdateTool(server, REPORT_OPTS, ExpenseUpdateSchema, buildExpenseBody, { method: "PUT" });
  registerDeleteTool(server, REPORT_OPTS, {
    title: "Supprimer une note de frais",
    description: `Supprime une note de frais de BoondManager. ⚠️ Action irréversible. Si le client MCP supporte l'élicitation, une confirmation est demandée avant la suppression.`,
  });
}
