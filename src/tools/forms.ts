import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FormCreateSchema, FormDefaultSchema } from "../schemas/index.js";
import type { FormDefaultInput } from "../schemas/index.js";
import { apiRequest, formatDetailResponse } from "../services/boond-client.js";
import { buildJsonApiBody, registerCreateTool, registerGetTool } from "./crud-factory.js";
import { composeDescription } from "./description-builders.js";

const OPTS = { entityName: "formulaire", entityNamePlural: "formulaires", apiPath: "/forms", prefix: "boond_forms" };

/** `/forms` payload (issue #256): `template` (required), polymorphic `dependsOn`, `validator` / `recipient` (`models.form`). */
export function buildFormBody(params: Record<string, unknown>): unknown {
  const { templateId, resourceId, candidateId, validatorId, recipientId, ...attrs } = params;
  const dependsOn = resourceId
    ? { id: String(resourceId), type: "resource" }
    : candidateId
      ? { id: String(candidateId), type: "candidate" }
      : undefined;
  return buildJsonApiBody("form", attrs, undefined, {
    template: { id: String(templateId), type: "formtemplate" },
    dependsOn,
    validator: validatorId ? { id: String(validatorId), type: "resource" } : undefined,
    recipient: recipientId ? { id: String(recipientId), type: "resource" } : undefined,
  });
}

export function registerFormTools(server: McpServer): void {
  server.registerTool(
    "boond_forms_default",
    {
      title: "Référentiels d'un formulaire",
      description: composeDescription({
        purpose:
          "Renvoie un formulaire vide pré-rempli pour un modèle et une entité (questions du modèle, validateur et destinataire par défaut).",
        when: "AVANT `boond_forms_create`, pour connaître les questions et les dates que le modèle attend.",
        instead: "`boond_forms_get` pour un formulaire déjà créé.",
        behaviour: ["Lecture seule (`GET /forms/default?template=&resource=`) ; la réponse est rendue telle quelle."],
        returns: "JSON du formulaire vide (questions incluses).",
      }),
      inputSchema: FormDefaultSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params: FormDefaultInput) => {
      const response = await apiRequest("/forms/default", "GET", undefined, {
        template: params.templateId,
        resource: params.resourceId,
      });
      return { content: [{ type: "text" as const, text: formatDetailResponse(response) }] };
    }
  );

  registerGetTool(server, OPTS, {
    withTab: false,
    title: "Détails d'un formulaire",
    description: composeDescription({
      purpose:
        "Récupère un formulaire (entretien annuel, bilan de fin de mission, évaluation) par son ID : questions, réponses, état, validateur.",
      when: "après `boond_forms_create`, ou depuis l'ID lu dans les relations d'une ressource / d'un candidat.",
      instead:
        "il n'existe pas de liste des formulaires côté API (`GET /forms` n'est pas documenté) ; `boond_tasks_get` avec `entity: \"form\"` pour ses tâches.",
      returns: "JSON du formulaire (attributs + relations). Lecture seule.",
    }),
  });

  registerCreateTool(server, OPTS, FormCreateSchema, buildFormBody, {
    title: "Créer un formulaire",
    description: composeDescription({
      purpose:
        "Instancie un formulaire à partir d'un modèle (entretien annuel, bilan de fin de mission, évaluation) pour une ressource ou un candidat.",
      when: "pour lancer une campagne d'évaluation ou un bilan, formulaire par formulaire.",
      instead: "`boond_forms_default` d'abord, pour les questions et les dates attendues par le modèle.",
      behaviour: [
        "Corps déduit de `models.form` (`template`, `dependsOn`, `validator`, `recipient`, `validateDate`, `remindDate`) — non éprouvé sur un tenant de test ; exactement une entité visée parmi `resourceId` / `candidateId`.",
        "Écriture non idempotente.",
      ],
      returns: "confirmation et ID du formulaire (`structuredContent.id`).",
    }),
  });
}
