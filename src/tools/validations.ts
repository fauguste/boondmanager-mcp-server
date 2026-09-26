import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { IdSchema, ValidationDecisionSchema, ValidationSearchSchema } from "../schemas/index.js";
import { readString } from "../config/env.js";
import { isFeatureDisabled } from "../config/env-flags.js";
import { buildJsonApiBody, confirmChoice } from "./crud-factory.js";
import { composeDescription } from "./description-builders.js";
import {
  apiRequest,
  apiSearch,
  buildSearchQuery,
  formatListResponse,
  formatDetailResponse,
} from "../services/boond-client.js";
import type { JsonApiResponse } from "../types.js";
import { progressReporterFrom } from "../services/progress.js";
import { defaultGetDescription } from "./description-builders.js";

const DECISION_STATE = { validate: "validated", reject: "rejected" } as const;

export const ValidationDecisionOutputSchema = z.object({
  id: z.string(),
  decided: z.boolean().describe("false quand l'utilisateur a refusé la confirmation (aucun appel API)"),
  state: z.string().optional().describe("État demandé (`validated` / `rejected`)"),
  documentType: z
    .string()
    .optional()
    .describe("Type du document validé (timesreport / absencesreport / expensesreport)"),
  documentId: z.string().optional(),
  reason: z.string().optional(),
});

/** `BOOND_MCP_CONFIRM_REJECT=0|false|no|off` opts out of the confirmation prompt on a rejection. */
function rejectConfirmationDisabled(): boolean {
  return isFeatureDisabled(readString("BOOND_MCP_CONFIRM_REJECT"));
}

function documentRef(response: JsonApiResponse): { documentType?: string; documentId?: string } {
  const entity = Array.isArray(response.data) ? response.data[0] : response.data;
  const rel = entity?.relationships?.dependsOn?.data;
  const ref = Array.isArray(rel) ? rel[0] : rel;
  return ref ? { documentType: ref.type, documentId: ref.id } : {};
}

export function registerValidationTools(server: McpServer): void {
  server.registerTool(
    "boond_validations_search",
    {
      title: "Rechercher des validations",
      description: `Recherche des validations en attente dans BoondManager (absences, notes de frais, feuilles de temps...).

⚠️ \`startMonth\` et \`endMonth\` (YYYY-MM) sont requis par l'API.

Returns: Liste des validations correspondantes.`,
      inputSchema: ValidationSearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params, extra: unknown) => {
      const query = buildSearchQuery(params);
      const response = await apiSearch("/validations", query, progressReporterFrom(extra));
      return {
        content: [{ type: "text" as const, text: formatListResponse(response, "validation", params.fields) }],
      };
    }
  );

  server.registerTool(
    "boond_validations_get",
    {
      title: "Détails d'une validation",
      description: defaultGetDescription({
        ...{ entityName: "validation", entityNamePlural: "validations", prefix: "boond_validations" },
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
      const response = await apiRequest(`/validations/${params.id}`);
      return {
        content: [{ type: "text" as const, text: formatDetailResponse(response) }],
      };
    }
  );

  // Issue #251: approve / reject a CRA, an expense report or an absence request.
  server.registerTool(
    "boond_validations_update",
    {
      title: "Valider ou refuser un CRA / une note de frais / une absence",
      description: composeDescription({
        purpose:
          "Approuve (`validate`) ou refuse (`reject`) une validation en attente : CRA, note de frais ou demande d'absence.",
        when: 'après `boond_validations_search` (`validationStates: ["waitingForValidation"]`) et l\'examen du document (`boond_timesheets_get`, `boond_expenses_get`, `boond_absences_get`).',
        instead:
          "`boond_validations_get` pour relire la validation avant de décider ; il n'existe pas d'autre chemin d'écriture sur le workflow de validation (`state` n'est pas un champ des CRA / notes / absences).",
        behaviour: [
          "`PUT /validations/{id}` avec `state: validated | rejected` (le vocabulaire de `validationStates`) et `reason`. Route déduite du modèle `validation` et non éprouvée sur un tenant de test : un 404 / 405 doit être remonté tel quel.",
          "Un **refus** demande une confirmation à l'utilisateur final si le client MCP déclare la capacité `elicitation` (désactivable par `BOOND_MCP_CONFIRM_REJECT=0`) ; un refus de confirmer renvoie `decided: false` sans appel API.",
          "Idempotent : rejouer la même décision renvoie le même état.",
        ],
        returns:
          "`{ id, decided, state, documentType, documentId, reason? }` et la fiche de la validation mise à jour.",
      }),
      inputSchema: ValidationDecisionSchema,
      outputSchema: ValidationDecisionOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const { id, decision, reason } = params;
      const state = DECISION_STATE[decision];
      if (decision === "reject") {
        const confirmation = await confirmChoice(server, {
          disabled: rejectConfirmationDisabled(),
          message: `Refuser la validation #${id} dans BoondManager${reason ? ` (motif : ${reason})` : ""} ? Le demandeur sera notifié par le workflow.`,
          title: `Refus de la validation #${id}`,
          description: "Choisir « Refuser » pour confirmer, sinon rien ne sera modifié.",
          confirmTitle: "Refuser",
        });
        if (!confirmation.confirmed) {
          return {
            content: [
              {
                type: "text" as const,
                text: `⛔ Refus de la validation #${id} annulé (${confirmation.reason ?? "non confirmé"}).`,
              },
            ],
            structuredContent: { id, decided: false, ...(confirmation.reason ? { reason: confirmation.reason } : {}) },
          };
        }
      }
      const body = buildJsonApiBody("validation", { state, ...(reason !== undefined ? { reason } : {}) }, id);
      const response = await apiRequest(`/validations/${id}`, "PUT", body);
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Validation #${id} → ${state}.\n\n${formatDetailResponse(response)}`,
          },
        ],
        structuredContent: {
          id,
          decided: true,
          state,
          ...documentRef(response),
          ...(reason !== undefined ? { reason } : {}),
        },
      };
    }
  );
}
