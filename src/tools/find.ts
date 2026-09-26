import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiSearch, buildSearchQuery } from "../services/boond-client.js";
import { formatEntitySummary } from "../services/format/summary.js";
import { progressReporterFrom } from "../services/progress.js";
import { isDomainAllowed, type AccessPolicy } from "../config/access-policy.js";
import type { DomainName } from "../constants.js";
import type { JsonApiResource } from "../types.js";
import { composeDescription } from "./description-builders.js";

/**
 * `boond_find` — name (or e-mail) → id, in one call (issue #262).
 *
 * Every other tool takes numeric ids, and until now only the prompts resolved
 * a label: "mets à jour la fiche de Jean Dupont" cost the model a search with
 * the right `keywordsType`, a choice among homonyms, then the `_get`. This
 * tool owns that sequence: it picks the field to search per entity (`fullName`
 * with the `NOM#PRENOM` form the API expects — tried in both orders, since a
 * user types "Jean Dupont" as often as "Dupont Jean" —, `emails`, `name`), and
 * it **refuses to choose** among several exact matches: an ambiguous name
 * comes back as `isError` with the list, never as a silent first-row pick.
 */

const ENTITY_DOMAIN = {
  candidate: "candidates",
  resource: "resources",
  contact: "contacts",
  company: "companies",
  opportunity: "opportunities",
  project: "projects",
} as const satisfies Record<string, DomainName>;

export type FindEntity = keyof typeof ENTITY_DOMAIN;
const ALL_ENTITIES = Object.keys(ENTITY_DOMAIN) as FindEntity[];

const API_PATH: Record<FindEntity, string> = {
  candidate: "/candidates",
  resource: "/resources",
  contact: "/contacts",
  company: "/companies",
  opportunity: "/opportunities",
  project: "/projects",
};

const PEOPLE = new Set<FindEntity>(["candidate", "resource", "contact"]);

/** Bounded: a resolver is a keystroke-cheap lookup, not a listing. */
const FIND_PAGE_SIZE = 10;

export const FindOutputSchema = z.object({
  entity: z.string(),
  query: z.string(),
  count: z.number().describe("Nombre de candidats renvoyés par la recherche (≤ 10)"),
  match: z
    .object({ id: z.string(), label: z.string() })
    .optional()
    .describe("Présent quand exactement un résultat porte le libellé demandé : l'ID à utiliser."),
  ambiguous: z.boolean().optional().describe("true quand plusieurs résultats portent exactement le libellé demandé"),
  items: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      detail: z.string().optional().describe("Élément de désambiguïsation (titre, e-mail, ville, référence, état)"),
      exact: z.boolean().describe("Le libellé correspond exactement à la requête"),
    })
  ),
});

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** The search calls to try, in order; the first one that returns a row wins. */
export function searchAttempts(entity: FindEntity, query: string, email?: string): Array<Record<string, unknown>> {
  const q = query.trim();
  if (email) {
    return PEOPLE.has(entity) || entity === "company"
      ? [{ keywords: email, keywordsType: "emails" }]
      : [{ keywords: email }];
  }
  if (PEOPLE.has(entity)) {
    const words = q.split(/\s+/);
    if (words.length >= 2) {
      const [first, ...rest] = words;
      const last = rest.join(" ");
      // The API's `fullName` form is `NOM#PRENOM`; "Jean Dupont" and "Dupont Jean" are both common.
      return [
        { keywords: `${last}#${first ?? ""}`, keywordsType: "fullName" },
        { keywords: `${first ?? ""}#${last}`, keywordsType: "fullName" },
        { keywords: q },
      ];
    }
    return [{ keywords: q, keywordsType: "lastName" }, { keywords: q }];
  }
  if (entity === "company") return [{ keywords: q, keywordsType: "name" }, { keywords: q }];
  return [{ keywords: q }];
}

export interface FoundItem {
  id: string;
  label: string;
  detail?: string;
  exact: boolean;
}

/** Human label + disambiguation detail for one search row. */
export function describeRow(entity: FindEntity, row: JsonApiResource): { label: string; detail?: string } {
  const a = row.attributes ?? {};
  if (PEOPLE.has(entity)) {
    const label = [str(a.firstName), str(a.lastName)].filter(Boolean).join(" ") || formatEntitySummary(row);
    const detail = [str(a.title), str(a.email1), str(a.town) ?? str(a.city)].filter(Boolean).join(" · ");
    return detail ? { label, detail } : { label };
  }
  if (entity === "company") {
    const label = str(a.name) ?? formatEntitySummary(row);
    const detail = [
      str(a.town) ?? str(a.city),
      str(a.email1),
      a.state !== undefined ? `état ${String(a.state)}` : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    return detail ? { label, detail } : { label };
  }
  // opportunity / project: title first, reference as the disambiguator.
  const label = str(a.title) ?? str(a.reference) ?? formatEntitySummary(row);
  const detail = [
    str(a.reference) !== label ? str(a.reference) : undefined,
    a.state !== undefined ? `état ${String(a.state)}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return detail ? { label, detail } : { label };
}

/** Exact = same label ignoring case / accents / spacing; for people, both word orders count; for e-mail lookups, the e-mail itself. */
export function isExactMatch(
  entity: FindEntity,
  row: JsonApiResource,
  item: { label: string },
  query: string,
  email?: string
): boolean {
  const a = row.attributes ?? {};
  if (email) {
    const emails = [a.email1, a.email2, a.email3].map((v) => (typeof v === "string" ? v.toLowerCase().trim() : ""));
    return emails.includes(email.toLowerCase().trim());
  }
  const want = normalize(query);
  if (normalize(item.label) === want) return true;
  if (PEOPLE.has(entity)) {
    const reversed = [str(a.lastName), str(a.firstName)].filter(Boolean).join(" ");
    return normalize(reversed) === want;
  }
  return false;
}

export function registerFindTool(server: McpServer, policy?: AccessPolicy): void {
  const entities = ALL_ENTITIES.filter((e) => !policy || isDomainAllowed(policy, ENTITY_DOMAIN[e]));
  if (entities.length === 0) return;
  const [firstEntity, ...otherEntities] = entities;
  if (firstEntity === undefined) return;

  const FindSchema = z
    .object({
      entity: z.enum([firstEntity, ...otherEntities]).describe("Type d'entité à résoudre."),
      query: z
        .string()
        .min(1)
        .describe(
          "Libellé : « Prénom Nom » ou « Nom Prénom » (personnes), raison sociale (société), intitulé (opportunité, projet)."
        ),
      email: z
        .string()
        .email()
        .optional()
        .describe("Recherche par e-mail à la place du libellé (personnes et sociétés) — plus sûr qu'un nom."),
    })
    .strict();

  server.registerTool(
    "boond_find",
    {
      title: "Résoudre un nom ou un e-mail en ID",
      description: composeDescription({
        purpose:
          "Résout un libellé (« Jean Dupont », « ACME », un intitulé de projet) ou un e-mail en ID BoondManager, pour un candidat, une ressource, un contact, une société, une opportunité ou un projet.",
        when: "dès qu'une demande nomme une entité sans donner son ID — avant un `_get`, un `_update`, un onglet ou un filtre `perimeterManagers` / `companyId`.",
        instead:
          "le `*_search` du domaine quand il faut une liste filtrée (états, périmètre, pagination) plutôt qu'une résolution.",
        behaviour: [
          "Choisit le champ à interroger : `fullName` (essayé dans les deux ordres, l'API attend `NOM#PRENOM`) puis texte libre pour les personnes, `name` pour les sociétés, `emails` quand `email` est fourni ; au plus 10 résultats.",
          "Ne tranche jamais entre homonymes : plusieurs correspondances exactes → `isError` avec la liste (ID + détail) à soumettre à l'utilisateur ; une seule → `structuredContent.match.id`.",
          "Aucune correspondance exacte mais des résultats proches → la liste est renvoyée sans `match` : confirmer avec l'utilisateur avant d'utiliser un ID.",
        ],
        returns:
          "`{ entity, query, count, match?, ambiguous?, items[{ id, label, detail?, exact }] }` et le même contenu en texte. Lecture seule.",
      }),
      inputSchema: FindSchema,
      outputSchema: FindOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params, extra: unknown) => {
      const { entity, query, email } = params as { entity: FindEntity; query: string; email?: string };
      const report = progressReporterFrom(extra);
      let rows: JsonApiResource[] = [];
      for (const attempt of searchAttempts(entity, query, email)) {
        const response = await apiSearch(
          API_PATH[entity],
          buildSearchQuery({ ...attempt, pageSize: FIND_PAGE_SIZE }),
          report
        );
        rows = Array.isArray(response.data) ? response.data : response.data ? [response.data] : [];
        if (rows.length > 0) break;
      }
      const items: FoundItem[] = rows.map((row) => {
        const described = describeRow(entity, row);
        return { id: row.id, ...described, exact: isExactMatch(entity, row, described, query, email) };
      });
      const exact = items.filter((i) => i.exact);
      const structured: z.infer<typeof FindOutputSchema> = {
        entity,
        query: email ?? query,
        count: items.length,
        items,
        ...(exact.length === 1 && exact[0] ? { match: { id: exact[0].id, label: exact[0].label } } : {}),
        ...(exact.length > 1 ? { ambiguous: true } : {}),
      };
      const lines = items.map((i) => `- #${i.id} ${i.label}${i.detail ? ` (${i.detail})` : ""}${i.exact ? " ✓" : ""}`);
      const what = email ?? query;
      if (items.length === 0) {
        return {
          content: [{ type: "text" as const, text: `Aucun(e) ${entity} trouvé(e) pour « ${what} ».` }],
          structuredContent: structured,
        };
      }
      if (exact.length > 1) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Ambigu : ${exact.length} ${entity}(s) portent exactement « ${what} ». Demander à l'utilisateur lequel :\n${lines.join("\n")}`,
            },
          ],
          structuredContent: structured,
        };
      }
      const head =
        exact.length === 1 && exact[0]
          ? `${entity} « ${what} » → ID ${exact[0].id} (${exact[0].label}).`
          : `Aucune correspondance exacte pour « ${what} » — ${items.length} résultat(s) proche(s), à confirmer :`;
      return {
        content: [{ type: "text" as const, text: `${head}\n${lines.join("\n")}` }],
        structuredContent: structured,
      };
    }
  );
}
