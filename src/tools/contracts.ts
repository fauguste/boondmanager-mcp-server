import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { EntityIdSchema, IdSchema } from "../schemas/index.js";
import { apiRequest, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody, entityRef, MutationOutputSchema } from "./crud-factory.js";
import { z } from "zod";
import { composeDescription } from "./description-builders.js";

const ContractCreateSchema = z
  .object({
    resourceId: EntityIdSchema.optional().describe("ID de la ressource associée"),
    typeOf: z
      .number()
      .int()
      .optional()
      .describe(
        "Type de contrat : ID entier du dictionnaire `setting.typeOf.contract` (CDI, CDD, freelance…), via `boond_application_dictionary`"
      ),
    startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
    note: z.string().optional().describe("Notes / commentaires"),
  })
  .strict();

export function registerContractTools(server: McpServer): void {
  server.registerTool(
    "boond_contracts_get",
    {
      title: "Détails d'un contrat",
      // Hand-written rather than `defaultGetDescription`: that template names
      // `${prefix}_search` as the id source, and this domain has no search tool
      // (#229). Contract ids come from the resource's administrative tab.
      description: composeDescription({
        purpose: "Récupère la fiche complète d'un contrat de travail par son ID numérique.",
        when: "après `boond_resources_administrative`, dont la relation `contracts` liste les contrats d'une ressource avec leurs IDs.",
        instead:
          "`boond_resources_administrative` pour lister les contrats d'une ressource — il n'existe pas d'outil de recherche de contrats, et cet outil n'accepte pas de nom.",
        behaviour: [
          "Un ID inconnu remonte l'erreur BoondManager telle quelle — l'ID doit venir de la relation `contracts` d'une ressource, jamais d'une supposition.",
        ],
        returns: "JSON du contrat (attributs + relations) tel que renvoyé par l'API. Lecture seule.",
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
      const response = await apiRequest(`/contracts/${params.id}`);
      return {
        content: [{ type: "text" as const, text: formatDetailResponse(response) }],
      };
    }
  );

  server.registerTool(
    "boond_contracts_create",
    {
      title: "Créer un contrat",
      description: composeDescription({
        purpose: "Crée un contrat de travail rattaché à une ressource.",
        when: "pour enregistrer un nouveau contrat (embauche, avenant, renouvellement).",
        instead:
          "`boond_resources_administrative` d'abord (relation `contracts`), pour vérifier qu'un contrat couvrant la même période n'existe pas déjà — il n'existe pas d'outil de recherche de contrats.",
        behaviour: [
          "Écriture non idempotente : deux appels identiques créent deux contrats.",
          "`typeOf` est un ID entier du dictionnaire `setting.typeOf.contract` (`boond_application_dictionary`), pas un libellé.",
        ],
        returns: "confirmation et fiche du contrat créé, avec son ID dans `structuredContent.id`.",
      }),
      inputSchema: ContractCreateSchema,
      outputSchema: MutationOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const { resourceId, ...attrs } = params;
      const body = buildJsonApiBody("contract", attrs);
      if (resourceId) {
        (body as Record<string, Record<string, unknown>>).data.relationships = {
          resource: { data: { id: resourceId, type: "resource" } },
        };
      }
      const response = await apiRequest("/contracts", "POST", body);
      const entity = Array.isArray(response.data) ? response.data[0] : response.data;
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Contrat créé avec succès.\nID: ${entity?.id}\n\n${formatDetailResponse(response)}`,
          },
        ],
        structuredContent: entityRef(response),
      };
    }
  );
}
