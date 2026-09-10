import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_SEARCH_PAGE } from "../constants.js";

/**
 * Tool-description composition.
 *
 * A tool description is read by a model that has never seen this API, in a
 * `tools/list` payload holding 181 siblings. What it has to answer, in order:
 * *what does this do*, *should I call it or a neighbour*, *what will happen*,
 * *what comes back*. Nothing else earns its bytes — a paraphrase of a schema
 * the client already received costs context and buys nothing, so the builders
 * below never restate `.describe()`-d parameters. The one exception is
 * search-filter guidance, where the *vocabulary* (which of `states` /
 * `candidateStates` / `resourceStates` this endpoint accepts) is the whole
 * difficulty and lives per-endpoint in `src/schemas/index.ts`.
 *
 * Why a builder rather than 182 hand-written strings: the weak half of the
 * catalogue is the reference/admin domains, which are registered through
 * `crud-factory.ts` and therefore share five templates. Fixing the templates
 * fixes ~120 tools at once and keeps them consistent, which is exactly what a
 * model needs to tell siblings apart. The facts that MUST NOT drift
 * (pagination ceilings, `fields` semantics) are interpolated from
 * `constants.ts`, not retyped — the previous hand-written template announced
 * `pageSize (défaut: 20, max: 100)` against a schema enforcing
 * 30/500 and shipped that contradiction to 11 domains.
 */

export interface ToolDescriptionSpec {
  /**
   * Front-loaded purpose: verb + resource + scope, one sentence. This is the
   * only part guaranteed to be read when the catalogue is long, so it must be
   * enough to shortlist or discard the tool on its own.
   */
  purpose: string;
  /** When this tool is the right call. */
  when?: string;
  /**
   * When it is NOT, naming the tool to use instead. Omit only for a tool with
   * genuinely no neighbour — a vague "see other tools" is worse than silence.
   */
  instead?: string;
  /**
   * Behaviour a caller cannot infer from the schema or the annotations:
   * side effects, replace-vs-merge semantics, server-side clamping,
   * confirmation prompts, silently ignored fields.
   */
  behaviour?: string[];
  /** Endpoint-specific filter vocabulary / usage detail (search tools). */
  details?: string;
  /** What the call returns, in the shape the caller will actually receive. */
  returns: string;
}

/**
 * Render a spec into the catalogue's uniform layout. Sections are omitted when
 * empty rather than emitted blank, so a two-line reference tool stays two
 * lines.
 */
export function composeDescription(spec: ToolDescriptionSpec): string {
  const blocks: string[] = [spec.purpose.trim()];

  const guidance: string[] = [];
  if (spec.when) guidance.push(`Quand : ${spec.when.trim()}`);
  if (spec.instead) guidance.push(`Plutôt que : ${spec.instead.trim()}`);
  if (guidance.length > 0) blocks.push(guidance.join("\n"));

  if (spec.details) blocks.push(spec.details.trim());

  const behaviour = (spec.behaviour ?? []).map((b) => b.trim()).filter((b) => b.length > 0);
  if (behaviour.length > 0) blocks.push(behaviour.map((b) => `- ${b}`).join("\n"));

  blocks.push(`Returns : ${spec.returns.trim()}`);

  return blocks.join("\n\n");
}

// ---- Facts that must never drift out of sync with the schemas -------------

/**
 * The pagination contract, worded from `constants.ts`. `page` is capped rather
 * than clamped — the schema *rejects* a higher page so the model refines its
 * filters instead of walking 50 000 records (see `MAX_SEARCH_PAGE`).
 */
export const PAGINATION_DISCLOSURE =
  `Pagination : \`pageSize\` 1–${MAX_PAGE_SIZE} (défaut ${DEFAULT_PAGE_SIZE}), ` +
  `\`page\` 1–${MAX_SEARCH_PAGE} — au-delà : refus, affiner les filtres.`;

/**
 * The opposite contract, for the reference routes that accept `maxResults` and
 * discard it (see `TOOLS_IGNORING_PAGINATION`, measured against the live API).
 * Says the two things a caller acts on: asking for fewer rows changes nothing,
 * and there is no second page to fetch.
 *
 * Stating the ceiling on these tools would be the same defect the catalogue
 * just removed — a description promising behaviour the endpoint does not have.
 */
export const PAGINATION_INERT_DISCLOSURE =
  "Pagination sans effet : cette route renvoie toujours la table complète, " +
  "`pageSize` et `page` sont ignorés par l'API — inutile de paginer, tout est déjà là.";

/**
 * `fields` is the catalogue's main token-economy lever and is invisible in the
 * schema alone: the name list is applied *client-side* to the response, is
 * never forwarded to BoondManager, and silently ignores names the entity does
 * not carry. A model that does not know this either never uses it or expects
 * it to filter server-side.
 *
 * Kept deliberately terse. `SERVER_INSTRUCTIONS` already states the rule once
 * for the whole session, and this repeats it on 32 tools — a duplication the
 * project otherwise avoids on purpose (see `fieldsField` in
 * `src/schemas/index.ts`, terse for the same reason). It is here because a
 * tool-definition scorer, and a client that lists tools without ever reading
 * `instructions`, both see the tool in isolation; every word is therefore paid
 * 32 times, so it stays at the shortest form that still says *client-side*,
 * *never sent*, and *silently ignored*.
 */
export const FIELDS_DISCLOSURE =
  "`fields` : projection côté MCP, jamais transmise à l'API — remplace le résumé par les seuls " +
  "attributs listés (noms inconnus ignorés). À utiliser sur les grosses pages.";

// ---- The five CRUD templates ----------------------------------------------

export interface EntityWording {
  /** Singular, lowercase — "candidat", "compte utilisateur". */
  entityName: string;
  /** Plural, lowercase — "candidats", "comptes utilisateurs". */
  entityNamePlural: string;
  /** Tool-name prefix — "boond_candidates". */
  prefix: string;
}

/**
 * Default search description for a reference/admin domain: no endpoint-specific
 * filter vocabulary, so the value it adds over the schema is the pointer to the
 * matching `_get` and the shape of what comes back.
 *
 * It deliberately does **not** state the pagination or `fields` contracts.
 * Those are appended by `withParameterDisclosure`, which is the single source
 * for both — and has to be, because the right pagination sentence depends on
 * the *route*: four reference endpoints accept `maxResults` and discard it
 * (`TOOLS_IGNORING_PAGINATION`), so a template that hard-coded the ceiling
 * would make a promise the endpoint breaks, and would suppress the correct
 * wording by having already mentioned `pageSize`.
 */
export function defaultSearchDescription(opts: EntityWording): string {
  return composeDescription({
    purpose: `Liste et recherche les ${opts.entityNamePlural} de BoondManager, par mots-clés et pagination.`,
    when: `pour retrouver l'ID d'un(e) ${opts.entityName} à partir de son nom, ou pour énumérer les ${opts.entityNamePlural} existant(e)s.`,
    instead: `\`${opts.prefix}_get\` si l'ID est déjà connu — la recherche ne renvoie qu'un résumé d'une ligne par ${opts.entityName}.`,
    returns: `page de résumés (ID + libellé principal), plus \`structuredContent.total\` = nombre total côté BoondManager. Lecture seule.`,
  });
}

/** Default detail description; `withTab` mirrors `registerGetTool`. */
export function defaultGetDescription(opts: EntityWording & { withTab: boolean }): string {
  const behaviour: string[] = [
    `Un ID inconnu remonte l'erreur BoondManager telle quelle — l'ID doit venir de \`${opts.prefix}_search\`, jamais d'une supposition.`,
  ];
  if (opts.withTab) {
    behaviour.unshift(
      "`tab` cible un onglet précis (`information`, `technical-data`, `administrative`, `actions`…) ; " +
        "sans `tab`, seule la fiche de base est renvoyée, pas la réunion des onglets."
    );
  }
  return composeDescription({
    purpose: `Récupère la fiche complète d'un(e) ${opts.entityName} par son ID numérique.`,
    when: `après un \`${opts.prefix}_search\`, pour obtenir les attributs qui n'apparaissent pas dans le résumé de liste.`,
    instead: `\`${opts.prefix}_search\` si l'ID n'est pas connu (cet outil n'accepte pas de nom).`,
    behaviour,
    returns: `JSON de l'entité (attributs + relations) tel que renvoyé par l'API. Lecture seule.`,
  });
}

export function defaultCreateDescription(opts: EntityWording): string {
  return composeDescription({
    purpose: `Crée un(e) ${opts.entityName} dans BoondManager.`,
    when: `pour ajouter un(e) ${opts.entityName} inexistant(e).`,
    instead: `\`${opts.prefix}_update\` pour modifier un enregistrement existant, et \`${opts.prefix}_search\` d'abord pour vérifier qu'il n'existe pas déjà.`,
    behaviour: [
      "Écriture réelle et non idempotente : deux appels identiques créent deux enregistrements (l'API ne déduplique pas).",
      "Les ID de relations et les états/types sont des ID numériques BoondManager, à résoudre au préalable (recherches d'entités, `boond://dictionary/*`).",
    ],
    returns: `confirmation, ID créé, et la fiche complète. \`structuredContent.id\` est réutilisable directement pour chaîner un appel.`,
  });
}

export function defaultUpdateDescription(opts: EntityWording): string {
  return composeDescription({
    purpose: `Met à jour un(e) ${opts.entityName} existant(e), identifié(e) par son ID.`,
    when: `pour modifier quelques champs d'un enregistrement déjà en base.`,
    instead: `\`${opts.prefix}_create\` si l'enregistrement n'existe pas encore.`,
    behaviour: [
      "Mise à jour partielle : seuls les champs fournis sont écrits, les autres sont laissés en place.",
      "Attention aux champs de type tableau, qui sont **remplacés** et non fusionnés.",
    ],
    returns: `confirmation et fiche mise à jour.`,
  });
}

export function defaultDeleteDescription(opts: EntityWording): string {
  return composeDescription({
    purpose: `Supprime définitivement un(e) ${opts.entityName} de BoondManager.`,
    when: `uniquement sur demande explicite de l'utilisateur, et après avoir vérifié l'ID avec \`${opts.prefix}_get\`.`,
    instead: `\`${opts.prefix}_update\` pour désactiver ou changer l'état d'un enregistrement sans le détruire — c'est presque toujours l'intention réelle.`,
    behaviour: [
      "⚠️ Irréversible, sans corbeille côté API.",
      "Si le client MCP annonce la capacité `elicitation`, une confirmation est demandée à l'utilisateur final et un refus annule l'appel (`structuredContent.deleted: false` + `reason`) ; sinon la suppression part directement.",
    ],
    returns: `\`{ id, deleted, reason? }\` — vérifier \`deleted\`, qui vaut \`false\` en cas de refus utilisateur.`,
  });
}

// ---- Tab tools -------------------------------------------------------------

export interface TabDescriptionSpec extends EntityWording {
  /** Human name of the tab's content — "profil technique", "actions". */
  subject: string;
  /** What the tab actually holds, parenthetical-style detail. Omit when the subject already says it. */
  content?: string;
  /** What comes back. */
  returns: string;
  /** Extra behavioural facts, if any. */
  behaviour?: string[];
}

/**
 * Tab tools are the catalogue's biggest disambiguation risk: 48 of them, all
 * taking a bare `id`, all returning "some fields of one entity". The
 * description therefore has to state which slice this one holds *and* that the
 * generic `_get` with `tab` reaches the same data — otherwise a model picks by
 * name similarity.
 */
export function tabDescription(spec: TabDescriptionSpec): string {
  const scope = spec.content ? `${spec.subject} (${spec.content})` : spec.subject;
  return composeDescription({
    purpose: `Récupère ${scope} d'un(e) ${spec.entityName}, par son ID.`,
    when: `pour ne charger que cette section, sans le reste de la fiche.`,
    instead: `\`${spec.prefix}_get\` pour la fiche de base, ou \`${spec.prefix}_search\` si l'ID est inconnu.`,
    behaviour: spec.behaviour,
    returns: `${spec.returns} Lecture seule.`,
  });
}
