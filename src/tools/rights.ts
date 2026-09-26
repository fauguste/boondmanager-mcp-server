import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest, formatDetailResponse } from "../services/boond-client.js";
import { EntityIdSchema } from "../schemas/index.js";
import { isDomainAllowed, type AccessPolicy } from "../config/access-policy.js";
import type { DomainName } from "../constants.js";
import { composeDescription } from "./description-builders.js";

/**
 * `boond_rights_get` (issue #257): what the authenticated user may do on one
 * record, from `GET /{collection}/{id}/rights` — a route the RAML documents on
 * every entity below and that no tool exposed. A 403 avoided is cheaper than a
 * 403 explained: the model can tell the user "vous n'avez pas le droit de
 * supprimer cette facture" before trying.
 *
 * One tool parameterised by entity rather than 25 `*_rights` tabs: the route
 * shape is identical everywhere and the payload is rendered as-is.
 */
export const RIGHTS_ENTITIES = {
  candidate: { path: "/candidates", domain: "candidates" },
  resource: { path: "/resources", domain: "resources" },
  contact: { path: "/contacts", domain: "contacts" },
  company: { path: "/companies", domain: "companies" },
  opportunity: { path: "/opportunities", domain: "opportunities" },
  project: { path: "/projects", domain: "projects" },
  action: { path: "/actions", domain: "actions" },
  positioning: { path: "/positionings", domain: "positionings" },
  invoice: { path: "/invoices", domain: "invoices" },
  order: { path: "/orders", domain: "orders" },
  delivery: { path: "/deliveries", domain: "deliveries" },
  purchase: { path: "/purchases", domain: "purchases" },
  payment: { path: "/payments", domain: "payments" },
  providerInvoice: { path: "/provider-invoices", domain: "provider-invoices" },
  product: { path: "/products", domain: "products" },
  contract: { path: "/contracts", domain: "contracts" },
  advantage: { path: "/advantages", domain: "advantages" },
  timesReport: { path: "/times-reports", domain: "timesheets" },
  expensesReport: { path: "/expenses-reports", domain: "expenses" },
  absencesReport: { path: "/absences-reports", domain: "absences" },
  agency: { path: "/agencies", domain: "agencies" },
} as const satisfies Record<string, { path: string; domain: DomainName }>;

export type RightsEntity = keyof typeof RIGHTS_ENTITIES;
const ALL_RIGHTS_ENTITIES = Object.keys(RIGHTS_ENTITIES) as RightsEntity[];

export function registerRightsTool(server: McpServer, policy?: AccessPolicy): void {
  const entities = ALL_RIGHTS_ENTITIES.filter((e) => !policy || isDomainAllowed(policy, RIGHTS_ENTITIES[e].domain));
  const [first, ...rest] = entities;
  if (first === undefined) return;

  const RightsSchema = z
    .object({
      entity: z.enum([first, ...rest]).describe("Type de l'enregistrement."),
      id: EntityIdSchema.describe("ID numérique de l'enregistrement."),
    })
    .strict();

  server.registerTool(
    "boond_rights_get",
    {
      title: "Droits de l'utilisateur sur un enregistrement",
      description: composeDescription({
        purpose:
          "Renvoie les droits de l'utilisateur authentifié sur un enregistrement précis (lecture, écriture, suppression, actions du workflow…), tels que BoondManager les publie sur `GET /{entité}/{id}/rights`.",
        when: "avant un `*_update` ou un `*_delete` dont l'issue est incertaine (fiche d'une autre agence, document validé, facture clôturée) — un 403 évité coûte moins qu'un 403 expliqué.",
        instead:
          "`boond://application/current-user/rights` pour les droits *globaux* par entité (création, périmètre) ; cet outil est le droit sur **un** enregistrement.",
        behaviour: [
          "Lecture seule ; le payload est rendu tel quel — les clés varient selon l'entité (`canWrite`, `canDelete`, `canValidate`…) et n'ont pas été normalisées, la RAML ne les documente pas.",
          "Les entités proposées suivent la politique d'accès du serveur.",
        ],
        returns: "JSON des droits sur l'enregistrement.",
      }),
      inputSchema: RightsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const { entity, id } = params;
      const response = await apiRequest(`${RIGHTS_ENTITIES[entity].path}/${id}/rights`);
      return {
        content: [
          { type: "text" as const, text: `Droits sur ${entity} #${id} :\n\n${formatDetailResponse(response)}` },
        ],
      };
    }
  );
}
