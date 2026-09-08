/**
 * Per-tool usage guidance for the hand-rolled tools.
 *
 * The five CRUD templates and the tab template compose their own
 * "Quand / Plutôt que" block (see `description-builders.ts`), which covers
 * ~145 of the 182 tools. The remaining ones carry hand-written descriptions
 * whose *body* is worth keeping — endpoint filter vocabulary, the traps
 * documented in CLAUDE.md — and only lack the guidance section. Rewriting each
 * of them into a `composeDescription` call would churn a lot of prose to add
 * two lines, so the two lines live here and are injected centrally.
 *
 * The obvious hazard of a name-keyed side table is silent drift: rename a tool
 * and its guidance evaporates with nothing failing. `usage-guidance.test.ts`
 * closes both directions — no entry may point at a tool that does not exist,
 * and no tool may end up without guidance. So the table cannot rot quietly;
 * it can only break the build.
 *
 * What belongs in `instead`: a **named** sibling and the reason the two are
 * confusable. "See the other tools" is worse than nothing — it costs bytes and
 * resolves no ambiguity. Where a tool genuinely has no alternative, say that
 * explicitly (`boond_expenses_default`, `boond_documents_create`), because
 * "there is no other way to get this" is itself the actionable fact.
 */

export interface UsageGuidance {
  /** When this tool is the right call. */
  when?: string;
  /** The named alternative, and why they are confusable. */
  instead?: string;
}

export const USAGE_GUIDANCE: Record<string, UsageGuidance> = {
  // ---- application / référentiels ----
  boond_application_current_user: {
    when: "en début de session, pour connaître l'identité, l'agence et le périmètre du compte utilisé — donc ce que « mes données » désigne.",
    instead:
      "la ressource `boond://application/current-user`, identique et moins coûteuse ; et `boond_resources_search` " +
      "pour quelqu'un d'autre que le titulaire du compte, cet outil ne prenant aucun paramètre.",
  },
  boond_application_dictionary: {
    when: "pour traduire un état ou un type BoondManager entre son ID entier et son libellé, avant de filtrer une recherche.",
    instead:
      "les ressources `boond://dictionary/*` pour les tables courantes (états, typeOf, pays, devises, langues) : " +
      "même contenu par un `resources/read`, sans consommer un appel d'outil. Cet outil reste nécessaire pour les " +
      "tables non publiées en ressource.",
  },

  // ---- documents ----
  boond_documents_get: {
    when: "pour récupérer le contenu d'un CV ou d'un justificatif dont l'ID a été relevé dans un onglet d'entité.",
    instead:
      "`boond_candidates_information` / `boond_candidates_administrative` (relations `resumes` / `files`) pour " +
      "*trouver* l'ID : celui-ci exige un ID exact, suffixe compris (`123_resume`), et un ID tronqué désigne un autre document.",
  },
  boond_documents_create: {
    when: "pour attacher à une entité un fichier accessible par URL publique.",
    instead:
      "aucune alternative pour un fichier local : le serveur MCP ne lit jamais le disque, c'est BoondManager qui " +
      "télécharge l'URL. Il faut donc d'abord héberger le fichier quelque part d'atteignable.",
  },
  boond_documents_delete: {
    when: "pour retirer une pièce jointe erronée, sur demande explicite de l'utilisateur.",
    instead:
      "`boond_documents_get` d'abord, pour confirmer qu'il s'agit du bon fichier — les ID de documents sont suffixés " +
      "et un ID mal recopié pointe sur autre chose.",
  },

  // ---- actions ----
  boond_actions_search: {
    when: "pour balayer l'historique commercial ou RH sur un périmètre, plusieurs entités confondues.",
    instead:
      "les onglets `actions` d'une entité connue (`boond_candidates_actions`, `boond_companies_actions`, " +
      "`boond_projects_actions`…) : plus direct et sans filtre de périmètre à construire.",
  },
  boond_actions_create: {
    instead: "`boond_actions_update` pour compléter une action déjà enregistrée plutôt que d'en créer un doublon.",
  },
  boond_actions_update: {
    instead: "`boond_actions_create` si l'action n'existe pas encore.",
  },

  // ---- absences / planning / validations ----
  boond_absences_search: {
    when: "pour retrouver des demandes d'absence et leur état de validation.",
    instead:
      "`boond_planning_absences_search` pour la vue calendaire (qui est absent quand), et " +
      "`boond_validations_search` pour ce qui reste en attente de validation.",
  },
  boond_planning_absences_search: {
    when: "pour savoir qui est absent sur une période — une vue calendaire, pas un suivi de demandes.",
    instead:
      "`boond_absences_search` pour les demandes elles-mêmes (motif, état de validation, demandeur), " +
      "que cette vue ne détaille pas.",
  },
  boond_validations_search: {
    when: "pour lister ce qui attend une validation managériale sur une plage de mois.",
    instead:
      "`boond_absences_search`, `boond_expenses_search` ou `boond_timesheets_search` pour les documents " +
      "eux-mêmes : celui-ci renvoie l'en-cours de validation, pas leur contenu.",
  },
  boond_notifications_search: {
    instead:
      "`boond_validations_search` pour ce qui requiert réellement une action de validation — une notification " +
      "n'est qu'un message.",
  },

  // ---- temps ----
  boond_timesheets_search: {
    when: "pour balayer les CRA de plusieurs ressources sur une période.",
    instead:
      "`boond_resources_timesheets` quand on part d'une ressource précise, et `boond_timesheets_get` pour le " +
      "détail jour par jour d'un CRA.",
  },
  boond_timesheets_get: {
    when: "après une recherche, pour le détail jour par jour d'un CRA identifié.",
    instead: "`boond_resources_timesheets` pour lister les CRA d'une ressource sans connaître leurs ID.",
  },
  boond_resources_timesheets: {
    when: "pour lister les CRA d'une ressource sur un mois donné, sans connaître leurs ID.",
    instead:
      "`boond_timesheets_get` pour le détail d'un CRA précis, `boond_timesheets_search` pour couvrir " +
      "plusieurs ressources d'un coup.",
  },

  // ---- notes de frais ----
  boond_expenses_search: {
    when: "avant toute création : l'API ne déduplique pas, deux notes de frais peuvent coexister sur le même couple (ressource, mois).",
    instead: "`boond_expenses_get` pour le détail des lignes d'une note de frais identifiée.",
  },
  boond_expenses_default: {
    when: "systématiquement avant `boond_expenses_create` — c'est la seule source des codes de types de frais et des couples (projet, prestation) imputables.",
    instead:
      "rien d'autre : `boond_application_dictionary` ne publie aucune table de types de frais, et `/agencies/{id}` " +
      "ne renvoie qu'un nom. Il n'existe pas de chemin alternatif.",
  },
  boond_expenses_create: {
    instead:
      "`boond_expenses_update` pour ajouter des lignes à un mois déjà ouvert — mais `actualExpenses` y **remplace** " +
      "tout le tableau, ce qui efface les lignes existantes si elles ne sont pas renvoyées.",
  },

  // ---- achats / factures / paiements ----
  boond_purchases_search: {
    when: "pour suivre les engagements de dépense et la sous-traitance.",
    instead:
      "`boond_provider_invoices_search` pour les factures effectivement reçues : l'achat est l'engagement, " +
      "la facture fournisseur le document qui le solde.",
  },
  boond_invoices_search: {
    when: "pour suivre la facturation client (encours, retards, règlements attendus).",
    instead:
      "`boond_provider_invoices_search` pour les factures d'achat — celui-ci ne couvre que le sens vente, " +
      "et les deux ne partagent pas d'endpoint.",
  },
  boond_payments_search: {
    when: "pour suivre les règlements enregistrés.",
    instead:
      "`boond_provider_invoices_search` pour les factures fournisseur et `boond_purchases_search` pour les " +
      "engagements : un paiement est adossé à un achat, il ne le remplace pas.",
  },
  boond_orders_search: {
    when: "pour suivre les bons de commande client.",
    instead: "`boond_invoices_search` pour la facturation qui en découle, `boond_orders_get` si l'ID est connu.",
  },

  // ---- livraisons / positionnements / avantages ----
  boond_deliveries_search: {
    when: "pour retrouver des prestations (lignes de mission facturables) sur un périmètre.",
    instead: "`boond_projects_deliveries_groupments` quand on part d'un projet connu — plus direct.",
  },
  boond_positionings_search: {
    when: "pour suivre l'avancement des profils proposés, plusieurs affaires confondues.",
    instead:
      "les onglets `positionings` (`boond_candidates_positionings`, `boond_opportunities_positionings`, " +
      "`boond_resources_positionings`) quand on part d'une entité connue.",
  },
  boond_positionings_update: {
    when: "pour faire avancer l'état d'un positionnement (proposé → retenu → refusé).",
    instead: "`boond_positionings_create` si le positionnement n'existe pas encore.",
  },
  boond_advantages_search: {
    instead: "`boond_resources_advantages` quand on part d'une ressource précise.",
  },

  // ---- dossier technique ----
  boond_resources_technical_data_update: {
    when: "pour mettre à jour le dossier technique d'une ressource (compétences, formations, langues…).",
    instead:
      "`boond_resources_reference_create` / `_update` / `_delete` pour les seules expériences professionnelles : " +
      "elles vivent dans le même bloc, mais ces outils évitent d'avoir à republier le tableau entier.",
  },
  boond_resources_reference_create: {
    instead:
      "`boond_resources_technical_data_update` pour les autres blocs du dossier technique (compétences, " +
      "formations, langues), que cet outil ne touche pas.",
  },
  boond_resources_reference_update: {
    when: "pour corriger une expérience professionnelle existante.",
    instead: "`boond_resources_reference_create` pour en ajouter une nouvelle.",
  },
  boond_resources_reference_delete: {
    when: "pour retirer une expérience saisie par erreur, sur demande explicite de l'utilisateur.",
    instead: "`boond_resources_reference_update` pour corriger une référence plutôt que la détruire.",
  },

  // ---- audit ----
  boond_logs_search: {
    when: "pour retracer qui a modifié quoi et quand.",
    instead:
      "le `_get` du domaine concerné (`boond_candidates_get`, `boond_projects_get`…) pour l'état *actuel* " +
      "d'un enregistrement : celui-ci ne renvoie que l'historique des modifications.",
  },

  // ---- les six grandes recherches : le risque est la confusion de référentiel ----
  boond_candidates_search: {
    instead:
      "`boond_resources_search` pour les collaborateurs internes — candidats et ressources sont deux " +
      "référentiels distincts, et une personne recrutée cesse d'être trouvable ici.",
  },
  boond_resources_search: {
    instead:
      "`boond_candidates_search` pour les profils externes en cours de recrutement — deux référentiels " +
      "distincts, un candidat n'apparaît pas ici avant son embauche.",
  },
  boond_companies_search: {
    instead:
      "`boond_contacts_search` pour les personnes physiques ; noter aussi que `/companies` n'expose aucun " +
      "filtre de type, seulement `states`.",
  },
  boond_contacts_search: {
    instead:
      "`boond_companies_search` pour les sociétés elles-mêmes, `boond_candidates_search` / " +
      "`boond_resources_search` pour les profils — un contact est un interlocuteur client, pas un profil.",
  },
  boond_opportunities_search: {
    instead: "`boond_projects_search` une fois l'affaire gagnée : le projet est la suite de l'opportunité.",
  },
  boond_projects_search: {
    instead: "`boond_opportunities_search` pour l'avant-vente — un projet est une affaire déjà gagnée.",
  },
};

/**
 * Insert the guidance block after the description's first paragraph.
 *
 * Position is deliberate: the purpose sentence stays first (it is the only
 * thing guaranteed to be read in a 182-tool listing), the guidance comes
 * second, and the endpoint's filter vocabulary keeps its place below. That is
 * also the order the composed templates produce, so the whole catalogue reads
 * the same way regardless of which path built the description.
 */
export function injectUsageGuidance(description: string, guidance: UsageGuidance): string {
  const lines = [
    guidance.when ? `Quand : ${guidance.when}` : undefined,
    guidance.instead ? `Plutôt que : ${guidance.instead}` : undefined,
  ].filter((l): l is string => l !== undefined);
  if (lines.length === 0) return description;

  const block = lines.join("\n");
  const split = description.indexOf("\n\n");
  if (split === -1) return `${description}\n\n${block}`;
  return `${description.slice(0, split)}\n\n${block}${description.slice(split)}`;
}

/** Apply the table to one tool config, if it has an entry and no guidance yet. */
export function withUsageGuidance<T extends { description?: string }>(name: string, config: T): T {
  const guidance = Object.hasOwn(USAGE_GUIDANCE, name) ? USAGE_GUIDANCE[name] : undefined;
  if (guidance === undefined) return config;
  const description = config.description;
  if (typeof description !== "string" || description.length === 0) return config;
  // A description that already carries the section wins — the table is a
  // backfill, not an override.
  if (/^(Quand|Plutôt que) :/m.test(description)) return config;
  return { ...config, description: injectUsageGuidance(description, guidance) };
}
