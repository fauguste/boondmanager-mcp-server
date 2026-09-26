import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ContractCreateSchema } from "../schemas/index.js";
import { buildJsonApiBody, registerCreateTool, registerGetTool } from "./crud-factory.js";
import { composeDescription } from "./description-builders.js";

const OPTS = { entityName: "contrat", entityNamePlural: "contrats", apiPath: "/contracts", prefix: "boond_contracts" };

/** `/contracts` payload: the resource id becomes the `resource` relationship. */
export function buildContractBody(params: Record<string, unknown>): unknown {
  const { resourceId, ...attrs } = params;
  return buildJsonApiBody("contract", attrs, undefined, {
    resource: resourceId ? { id: String(resourceId), type: "resource" } : undefined,
  });
}

export function registerContractTools(server: McpServer): void {
  registerGetTool(server, OPTS, {
    withTab: false,
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
  });

  registerCreateTool(server, OPTS, ContractCreateSchema, buildContractBody, {
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
  });
}
