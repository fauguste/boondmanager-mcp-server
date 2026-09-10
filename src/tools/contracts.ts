import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IdSchema } from "../schemas/index.js";
import { apiRequest, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody } from "./crud-factory.js";
import { z } from "zod";
import { composeDescription, defaultGetDescription } from "./description-builders.js";

const ContractCreateSchema = z
  .object({
    resourceId: z.string().optional().describe("ID de la ressource associée"),
    typeOf: z.string().optional().describe("Type de contrat (CDI, CDD, freelance...)"),
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
      description: defaultGetDescription({
        ...{ entityName: "contrat", entityNamePlural: "contrats", prefix: "boond_contracts" },
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
          "`boond_contracts_search` d'abord, pour vérifier qu'un contrat couvrant la même période n'existe pas déjà.",
        behaviour: [
          "Écriture non idempotente : deux appels identiques créent deux contrats.",
          "Le type de contrat est un ID entier du dictionnaire (`boond://dictionary/typeOf/contracts`), pas un libellé.",
        ],
        returns: "confirmation et fiche du contrat créé, avec son ID dans `structuredContent.id`.",
      }),
      inputSchema: ContractCreateSchema,
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
      };
    }
  );
}
