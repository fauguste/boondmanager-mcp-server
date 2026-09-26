import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_SEARCH_PAGE } from "../constants.js";
import { appendOverridesToDescription, resolveLabel } from "../config/dictionary-overrides.js";

// Client-side projection, shared by every search schema. Declared before
// `SearchSchema` because that schema embeds it (a `const` referenced during
// module init would otherwise hit the temporal dead zone).
//
// The description is deliberately terse: it is duplicated into ~32 tool
// schemas, so every character costs ~32 bytes of the `tools/list` payload.
export const fieldsField = z
  .array(z.string())
  .optional()
  .describe(
    "Projection : attributs à afficher par résultat (ex: ['title','updateDate']). " +
      "Absent = résumé standard. Noms inconnus ignorés."
  );

// ---- Reusable filter field helpers ----
// IMPORTANT: input field names below MUST match the BoondManager API query parameter names
// exactly (e.g., perimeterManagers, resourceStates, opportunityStates). buildSearchQuery
// passes them through as `key[]=value` for arrays. See https://doc.boondmanager.com/api-externe/
//
// Declared before `SearchSchema` (which embeds them) so module init doesn't hit
// the temporal dead zone — same reason as `fieldsField` above.
//
// The pagination ceilings carry an explicit message: the default Zod wording
// ("Too big: expected number to be <=100") says what was refused but not what
// to do instead, and a model that hit the page ceiling should refine its
// filters rather than retry one page lower.
export const pageField = z
  .number()
  .int()
  .min(1)
  .max(MAX_SEARCH_PAGE, {
    error: `page > ${MAX_SEARCH_PAGE} refusé (plafond MAX_SEARCH_PAGE) : affiner les filtres plutôt que paginer plus loin.`,
  })
  .default(1)
  .describe(`Numéro de page (défaut: 1, max: ${MAX_SEARCH_PAGE})`);
export const pageSizeField = z
  .number()
  .int()
  .min(1)
  .max(MAX_PAGE_SIZE, { error: `pageSize > ${MAX_PAGE_SIZE} refusé : maximum ${MAX_PAGE_SIZE} résultats par page.` })
  .default(DEFAULT_PAGE_SIZE)
  .describe(`Nombre de résultats par page (max: ${MAX_PAGE_SIZE}, défaut: ${DEFAULT_PAGE_SIZE})`);
export const sortField = z.string().optional().describe("Champ de tri (ex: lastName, firstName, updateDate)");
export const orderField = z.enum(["asc", "desc"]).optional().describe("Ordre de tri (asc/desc)");

/** `page` / `pageSize` / `fields` — every paginated search. */
export const paginationShape = {
  page: pageField,
  pageSize: pageSizeField,
  fields: fieldsField,
} as const;

/** `sort` / `order` + pagination — the six entity searches that accept sorting. */
export const sortedPaginationShape = {
  sort: sortField,
  order: orderField,
  ...paginationShape,
} as const;
// Integer-id filters take ids, and a model that passes labels ("actif",
// "Acme") gets an invalid_type issue. Point it at the resolution path in the
// message itself rather than making it re-read the field description — but at
// the RIGHT path: `boond://dictionary/*` holds state/type code tables and no
// entities, so sending a model there for `perimeterManagers: ["Jean Dupont"]`
// or `companies: ["Acme"]` is a dead end. Hence two flavours.
const DICTIONARY_ID_ERROR =
  "ID entier attendu (pas un libellé) : résoudre l'ID via les ressources `boond://dictionary/*` ou `boond_application_dictionary`.";
const ENTITY_ID_ERROR =
  "ID entier attendu (pas un nom) : récupérer l'ID via la recherche de l'entité concernée " +
  "(`boond_resources_search`, `boond_companies_search`, `boond_agencies_search`…) ou " +
  "`boond_application_current_user` — pas via `boond://dictionary/*`, qui ne contient que des états/types.";

/** Dictionary-backed filter (states, types, experience levels…). */
const intArray = (doc: string, error: string = DICTIONARY_ID_ERROR) =>
  z.array(z.number({ error }).int()).optional().describe(doc);

/** Filter taking *entity* ids (managers, companies, agencies, tags…). */
const entityIdArray = (doc: string) => intArray(doc, ENTITY_ID_ERROR);
const strArray = (doc: string) => z.array(z.string()).optional().describe(doc);

// Common search schema
export const SearchSchema = z
  .object({
    keywords: z.string().optional().describe("Mots-clés de recherche (nom, email, compétences...)"),
    ...paginationShape,
  })
  .strict();

// Shared `tools` (technologies/skills) filter. Centralised so every entity
// search exposes the same `#AND#` semantics to the model — previously the
// description ranged from the full explanation (resources) to a bare
// "IDs d'outils." (opportunities), so the model only learned about `#AND#`
// on some endpoints.
const toolsFilterField = strArray(
  "IDs d'outils/technos (dictionnaire setting.tool). Logique OU par défaut. " +
    "Pour ET, ajouter '#AND#' en 1er élément: tools=['#AND#','12','34']."
);

// Action timestamps: ISO 8601 with timezone, e.g. 2026-06-05T10:00:00+0200.
// Accepts the colon-less (+0200) and colon (+02:00) offset styles, an optional
// fractional-seconds part, and a trailing Z. The timezone is optional so the
// API can apply the account default. Surfaces a malformed value at the schema
// boundary instead of as an opaque 422.
const actionDateTimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:?\d{2}|Z)?$/;

// Shared "perimeter" filters available on every entity search (from RAML trait `searchable`).
// These are the CORRECT filters for "my team / my agency / my N-1" — NOT the old `mainManagers`.
const perimeterManagersField = entityIdArray(
  "IDs des managers (ressources). Conserve les entités dont le responsable est l'un de ces managers. " +
    "Pour 'mon équipe / N-1 d'une personne X', passer [X_id]. Obtenir son propre ID via boond_application_current_user."
);
const perimeterAgenciesField = entityIdArray(
  "IDs d'agences. Conserve les entités dont le responsable appartient à ces agences."
);
const perimeterPolesField = entityIdArray(
  "IDs de pôles. Conserve les entités dont le responsable appartient à ces pôles."
);
const perimeterBusinessUnitsField = entityIdArray(
  "IDs de business units. Conserve les entités dont le responsable appartient à ces BU."
);
const perimeterDynamicField = z
  .array(z.enum(["data", "agencies", "poles", "businessUnits", "managers"]))
  .optional()
  .describe(
    "Périmètre dynamique relatif à l'utilisateur courant (raccourci sans avoir à connaître son propre ID). " +
      "Valeurs : 'data' (mes propres données), 'managers' (mon équipe / mes N-1), 'agencies' (mes agences), " +
      "'poles' (mes pôles), 'businessUnits' (mes BU). Combinable."
  );
const narrowPerimeterField = z
  .boolean()
  .optional()
  .describe("Si true, jointure ET entre les filtres `perimeter*` (au lieu de OU par défaut).");
const startDateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .describe("Date de début (YYYY-MM-DD), à utiliser avec `period`.");
const endDateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .describe("Date de fin (YYYY-MM-DD), à utiliser avec `period`.");

// ---- Shared filters of the finance / activity searches (issue #248) ----
// `/invoices`, `/orders`, `/actions`, `/times-reports`, `/absences-reports`,
// `/deliveries-groupments` and `/payments` all declare the RAML trait
// `searchable`, so they take the six `perimeter*` filters — verified live on
// 2026-09-26 (`perimeterDynamic=data` reduced every one of them). The
// vocabulary below is per endpoint and was read from each `search.raml`.

/** `periodDynamic` — the relative windows the RAML lists on every dated search (no `startDate` / `endDate` needed). */
const periodDynamicField = z
  .enum([
    "today",
    "yesterday",
    "tomorrow",
    "thisWeek",
    "lastWeek",
    "nextWeek",
    "thisMonth",
    "lastMonth",
    "nextMonth",
    "thisTrimester",
    "lastTrimester",
    "nextTrimester",
    "thisSemester",
    "lastSemester",
    "nextSemester",
    "thisYear",
    "lastYear",
    "nextYear",
    "thisFiscalYear",
    "lastFiscalYear",
    "nextFiscalYear",
    "untilToday",
  ])
  .optional()
  .describe(
    "Fenêtre relative appliquée à `period` (à la place de `startDate` / `endDate`) : today, thisWeek, thisMonth, lastMonth, thisYear, untilToday…"
  );
const flagsField = entityIdArray("IDs de drapeaux (flags) — `boond_flags_search`.");
/** The validation workflow of a CRA / absence report is a string state, not a dictionary id (#250). */
const validationStatesField = z
  .array(z.enum(["waitingForValidation", "validated", "rejected"]))
  .optional()
  .describe("États du workflow de validation : waitingForValidation (à valider), validated, rejected.");
const resourceTypesField = intArray("IDs de types de ressource — `boond://dictionary/typeOf/resources`.");
const paymentMethodsField = intArray("IDs de modes de paiement — `boond://dictionary/paymentMethods`.");
const projectTypesFilterField = intArray("IDs de types de projet — `boond://dictionary/typeOf/projects`.");
const companiesFilterField = entityIdArray(
  "IDs de sociétés (filtre API natif, équivalent de `companyId` pour plusieurs sociétés)."
);

// ---- Shared shapes (issue #240) ----
// Composed by spread into the entity search schemas so a change to one field
// (a `.describe()`, the page-ceiling message) propagates everywhere. Before,
// the six perimeter fields were copied six times, `shields` five times and the
// `page`/`pageSize` pair ~16 times — ten of those copies had already lost the
// `MAX_SEARCH_PAGE` explanation `pageField` carries.

/** The six RAML-trait `searchable` perimeter filters, in API order. */
export const perimeterShape = {
  perimeterManagers: perimeterManagersField,
  perimeterAgencies: perimeterAgenciesField,
  perimeterPoles: perimeterPolesField,
  perimeterBusinessUnits: perimeterBusinessUnitsField,
  perimeterDynamic: perimeterDynamicField,
  narrowPerimeter: narrowPerimeterField,
} as const;

/** Completeness level of the conditional fields (RAML trait `shields`). */
export const shieldsField = z
  .array(z.enum(["uncomplete", "minimum", "complete"]))
  .optional()
  .describe("Niveau de complétude des champs conditionnels.");

/** `keywordsType` values shared by the two people endpoints (resources, candidates). */
export const peopleKeywordsTypeEnum = z.enum([
  "resumeTd",
  "lastName",
  "firstName",
  "fullName",
  "strictFullName",
  "emails",
  "title",
  "titleSkills",
  "phones",
  "reference",
  "resume",
  "td",
]);

/** `perimeterManagersType` — candidates and opportunities only. */
const perimeterManagersTypeField = z
  .enum(["main", "hr"])
  .optional()
  .describe("Type de responsable visé par `perimeterManagers`: 'main' (Main Manager) ou 'hr' (HR Manager).");

// ---- Resource search schema (collaborateurs internes) ----
// Source: https://doc.boondmanager.com/api-externe/raml-build/resources/resources/search.raml
export const ResourceSearchSchema = z
  .object({
    keywords: z
      .string()
      .optional()
      .describe(
        "Mots-clés (par défaut, recherche dans CV + dossier technique). Pour cibler un champ précis, " +
          "fournir aussi `keywordsType` (ex: lastName, firstName, fullName, emails, title, titleSkills, phones, reference)."
      ),
    keywordsType: peopleKeywordsTypeEnum
      .optional()
      .describe(
        "Champ ciblé par `keywords`. Défaut: 'resumeTd' (CV + dossier technique). " +
          "Pour 'fullName' utiliser `keywords = 'NOM#PRENOM'`."
      ),
    ...perimeterShape,
    resourceStates: intArray(
      "IDs d'états de ressource (dictionnaire setting.state.resource via boond_application_dictionary)."
    ),
    excludeResourceStates: intArray("IDs d'états de ressource à EXCLURE."),
    resourceTypes: intArray("IDs de types de ressource (dictionnaire setting.typeOf.resource)."),
    excludeResourceTypes: intArray("IDs de types de ressource à EXCLURE."),
    activityAreas: strArray("IDs de secteurs d'activité (dictionnaire setting.activityArea)."),
    expertiseAreas: strArray("IDs de domaines d'expertise (dictionnaire setting.expertiseArea)."),
    tools: toolsFilterField,
    experiences: intArray("IDs de niveaux d'expérience (dictionnaire setting.experience)."),
    trainings: strArray("IDs de formations (dictionnaire setting.training)."),
    mobilityAreas: strArray("IDs de zones de mobilité (dictionnaire setting.mobilityArea)."),
    languages: strArray(
      "Langues parlées au format `langueId|niveauId` (dictionnaires setting.languageSpoken et setting.languageLevel). Ex: ['anglais|courant']."
    ),
    flags: entityIdArray("IDs de tags (drapeaux) attachés à la ressource."),
    period: z
      .string()
      .optional()
      .describe(
        "Champ temporel pour filtrer par période. Valeurs courantes: 'available' (disponibilité), " +
          "'working' (en mission hors interne), 'workingAll', 'absent', 'idle', 'hired', 'left', " +
          "'employed', 'unemployed', 'updated', 'arrival', 'birthday', 'seniority', 'present', " +
          "'noAction'/'withActions'/'withoutActions'/'withAbsences'/'withoutAbsences'. " +
          "À combiner avec `startDate` + `endDate`."
      ),
    startDate: startDateField,
    endDate: endDateField,
    providerCompanies: entityIdArray("IDs de sociétés sous-traitantes (filtre pour ressources externes)."),
    coordinates: z
      .string()
      .optional()
      .describe("Coordonnées GPS 'latitude,longitude' pour recherche géographique. À combiner avec `geoDistance`."),
    location: z
      .string()
      .optional()
      .describe("Adresse texte (ville, etc.) pour recherche géographique. À combiner avec `geoDistance`."),
    geoDistance: z
      .number()
      .int()
      .min(5)
      .max(200)
      .optional()
      .describe(
        "Rayon en km pour la recherche géographique (5-200). Requis si `coordinates` ou `location` est fourni."
      ),
    excludeManager: z.boolean().optional().describe("Si true, ne retourne que les ressources sans compte manager."),
    shields: shieldsField,
    ...sortedPaginationShape,
  })
  .strict();

// ---- Candidate search schema ----
// Source: https://doc.boondmanager.com/api-externe/raml-build/resources/candidates/search.raml
export const CandidateSearchSchema = z
  .object({
    keywords: z
      .string()
      .optional()
      .describe("Mots-clés (par défaut, recherche dans CV + dossier technique). Combinable avec `keywordsType`."),
    keywordsType: peopleKeywordsTypeEnum.optional().describe("Champ ciblé par `keywords` (défaut: 'resumeTd')."),
    ...perimeterShape,
    perimeterManagersType: perimeterManagersTypeField,
    candidateStates: intArray(
      "IDs d'états de candidat (dictionnaire setting.state.candidate via boond_application_dictionary)."
    ),
    candidateTypes: intArray("IDs de types de candidat (dictionnaire setting.typeOf.resource)."),
    contractTypes: intArray("IDs de types de contrat recherchés (dictionnaire setting.typeOf.contract)."),
    availabilityTypes: intArray("IDs de types de disponibilité (dictionnaire setting.availability)."),
    activityAreas: strArray("IDs de secteurs d'activité (dictionnaire setting.activityArea)."),
    expertiseAreas: strArray("IDs de domaines d'expertise."),
    tools: toolsFilterField,
    experiences: intArray("IDs de niveaux d'expérience."),
    trainings: strArray("IDs de formations."),
    mobilityAreas: strArray("IDs de zones de mobilité."),
    languages: strArray("Langues au format `langueId|niveauId` (ex: ['anglais|courant'])."),
    evaluations: strArray("IDs d'évaluations."),
    sources: strArray("IDs de sources de recrutement (dictionnaire setting.source)."),
    flags: entityIdArray("IDs de tags."),
    period: z
      .string()
      .optional()
      .describe(
        "Filtre temporel : 'created', 'updated', 'available', " +
          "'noAction'/'withActions'/'withoutActions'. À combiner avec `startDate` + `endDate`."
      ),
    startDate: startDateField,
    endDate: endDateField,
    providerCompanies: entityIdArray("IDs de sociétés sous-traitantes."),
    coordinates: z.string().optional().describe("Coordonnées GPS 'lat,lon'. Requiert `geoDistance`."),
    location: z.string().optional().describe("Adresse texte. Requiert `geoDistance`."),
    geoDistance: z.number().int().min(5).max(200).optional().describe("Rayon km (5-200)."),
    shields: shieldsField,
    ...sortedPaginationShape,
  })
  .strict();

// ---- Contact search schema ----
// Source: https://doc.boondmanager.com/api-externe/raml-build/resources/contacts/search.raml
export const ContactSearchSchema = z
  .object({
    keywords: z
      .string()
      .optional()
      .describe(
        "Mots-clés (défaut: nom + prénom + société + fonction + périmètre technique). " +
          "Combinable avec `keywordsType`."
      ),
    keywordsType: z
      .enum([
        "default",
        "lastName",
        "firstName",
        "fullName",
        "strictFullName",
        "companyFullName",
        "emails",
        "phones",
        "socialNetworks",
      ])
      .optional()
      .describe(
        "Champ ciblé. Défaut: 'default'. Pour 'fullName' utiliser `keywords = 'NOM#PRENOM'`. " +
          "Pour 'companyFullName' utiliser `keywords = 'CSOCid#NOM#PRENOM'`."
      ),
    ...perimeterShape,
    states: intArray("IDs d'états de contact (dictionnaire setting.state.contact)."),
    companyStates: intArray("IDs d'états des sociétés rattachées (dictionnaire setting.state.company)."),
    typesOf: intArray(
      "IDs de types de contact (dictionnaire setting.typeOf.contact). " +
        "⚠️ Le paramètre s'appelle `typesOf` (avec un 's'), PAS `typeOf`."
    ),
    origins: strArray("IDs d'origines (dictionnaire setting.origin)."),
    activityAreas: strArray("IDs de secteurs d'activité de la société."),
    expertiseAreas: strArray("IDs de domaines d'expertise de la société."),
    tools: toolsFilterField,
    influencers: entityIdArray("IDs de contacts influenceurs."),
    flags: entityIdArray("IDs de tags."),
    period: z
      .string()
      .optional()
      .describe(
        "Filtre temporel : 'created', 'updated', 'noAction'/'withActions'/'withoutActions'. " +
          "À combiner avec `startDate` + `endDate`."
      ),
    startDate: startDateField,
    endDate: endDateField,
    completeness: strArray(
      "Filtre par complétude des champs au format `fieldId:mode` (fieldId: email/phone/socialNetworks ; " +
        "mode: empty/filled). Logique OU par défaut, '#AND#' en 1er pour ET. Ex: ['email:empty','phone:empty']."
    ),
    shields: shieldsField,
    ...sortedPaginationShape,
  })
  .strict();

// ---- Company search schema ----
// Source: https://doc.boondmanager.com/api-externe/raml-build/resources/companies/search.raml
export const CompanySearchSchema = z
  .object({
    keywords: z
      .string()
      .optional()
      .describe("Mots-clés (défaut: nom + ville + pays + expertise + informations). Combinable avec `keywordsType`."),
    keywordsType: z
      .enum(["default", "name", "phones", "emails", "socialNetworks"])
      .optional()
      .describe("Champ ciblé par `keywords`. Défaut: 'default'."),
    ...perimeterShape,
    states: intArray("IDs d'états de société (dictionnaire setting.state.company)."),
    expertiseAreas: strArray("IDs de domaines d'expertise (dictionnaire setting.expertiseArea)."),
    origins: strArray("IDs d'origines (dictionnaire setting.origin)."),
    influencers: entityIdArray("IDs d'influenceurs."),
    flags: entityIdArray("IDs de tags."),
    period: z
      .string()
      .optional()
      .describe(
        "Filtre temporel : 'created', 'updated', 'noAction'/'withActions'/'withoutActions'. " +
          "À combiner avec `startDate` + `endDate`."
      ),
    startDate: startDateField,
    endDate: endDateField,
    shields: shieldsField,
    ...sortedPaginationShape,
  })
  .strict();

// ---- Opportunity search schema ----
// Source: https://doc.boondmanager.com/api-externe/raml-build/resources/opportunities/search.raml
export const OpportunitySearchSchema = z
  .object({
    keywords: z
      .string()
      .optional()
      .describe(
        "Mots-clés. Pour cibler par ID préfixé : 'AOnnn' (opportunité), 'CSOCnnn' (société), " +
          "'CCONnnn' (contact), 'CANDnnn' (candidat), 'COMPnnn' (ressource), 'PRODnnn' (produit). " +
          "Sinon recherche plein texte sur titre/société."
      ),
    ...perimeterShape,
    perimeterManagersType: perimeterManagersTypeField,
    opportunityStates: intArray("IDs d'états d'opportunité (dictionnaire setting.state.opportunity)."),
    opportunityTypes: strArray("IDs de types d'opportunité (dictionnaire setting.typeOf.project)."),
    positioningStates: strArray("IDs d'états de positionnement, ou 'none' pour les opportunités sans positionnement."),
    expertiseAreas: strArray("IDs de domaines d'expertise."),
    activityAreas: strArray("IDs de secteurs d'activité."),
    tools: toolsFilterField,
    places: strArray("IDs de zones (dictionnaire setting.mobilityArea)."),
    durations: intArray("IDs de durées (dictionnaire setting.duration)."),
    origins: strArray("IDs d'origines."),
    flags: entityIdArray("IDs de tags."),
    period: z
      .string()
      .optional()
      .describe(
        "Filtre temporel : 'created' (création), 'started', 'closingDate' (date de closing), " +
          "'updated', 'updatedPositioning', 'noAction'/'withActions'/'withoutActions'. " +
          "À combiner avec `startDate` + `endDate`."
      ),
    startDate: startDateField,
    endDate: endDateField,
    shields: shieldsField,
    ...sortedPaginationShape,
  })
  .strict();

// ---- Project search schema ----
// Source: https://doc.boondmanager.com/api-externe/raml-build/resources/projects/search.raml
export const ProjectSearchSchema = z
  .object({
    keywords: z
      .string()
      .optional()
      .describe(
        "Mots-clés. Pour cibler par ID préfixé : 'PRJnnn' (projet), 'CSOCnnn' (société), " +
          "'CCONnnn' (contact), 'AOnnn' (opportunité), 'COMPnnn' (ressource), 'CTRnnn' (contrat)."
      ),
    ...perimeterShape,
    projectStates: intArray("IDs d'états de projet (dictionnaire setting.state.project)."),
    projectTypes: intArray("IDs de types de projet (dictionnaire setting.typeOf.project)."),
    companies: entityIdArray("IDs de sociétés clientes : projets rattachés à ces sociétés."),
    expertiseAreas: strArray("IDs de domaines d'expertise."),
    activityAreas: strArray("IDs de secteurs d'activité."),
    flags: entityIdArray("IDs de tags."),
    period: z
      .string()
      .optional()
      .describe(
        "Filtre temporel : 'running' (en cours), 'created', 'started', 'stopped', 'closed', 'updated', " +
          "'hasAdditionalDataOrPurchase'. À combiner avec `startDate` + `endDate`."
      ),
    startDate: startDateField,
    endDate: endDateField,
    ...sortedPaginationShape,
  })
  .strict();

// BoondManager entity ids are numeric. Constraining the schema to digits
// (rather than an open `z.string()`) prevents a caller from smuggling path
// segments, traversal sequences (`..`), or query syntax (`?`, `#`) into the
// id, which would otherwise be interpolated raw into the API path. See the
// defense-in-depth guard in boond-client.ts (`assertSafeApiPath`).
export const EntityIdSchema = z.string().regex(/^\d+$/, "L'identifiant BoondManager doit être numérique");

// Tab segments are also interpolated into the path; restrict them to a small
// safe alphabet (letters and hyphens, e.g. `technical-data`).
const TabSchema = z.string().regex(/^[a-zA-Z][a-zA-Z-]*$/, "Onglet invalide");

// ID param schema
export const IdSchema = z
  .object({
    id: EntityIdSchema.describe("Identifiant unique de l'entité BoondManager (numérique)"),
  })
  .strict();

// Document ids are the one exception to the numeric rule: entity relations
// expose them **suffixed** with the document's parent type
// (`{"resumes":{"data":[{"id":"123_resume"}]}}`). Validating them with
// `EntityIdSchema` rejected the id the caller was legitimately given, and
// stripping the suffix to satisfy the schema produces an id BoondManager
// answers with its app shell in HTTP 200 (see the `text/html` guard in
// `apiDownload`) — a silent failure. The suffix alphabet stays letters-only so
// the id still can't smuggle a path segment, `..`, `?` or `#` into the API
// path. Letters are allowed in both cases because Boond derives the suffix
// from camelCase parent types (`administrativeFile`).
/** `mode` of `boond_documents_get` (issue #263): extracted text by default, the raw bytes on demand. */
export const DocumentGetModeSchema = z
  .enum(["text", "raw"])
  .default("text")
  .describe(
    "text (défaut) : PDF et DOCX renvoyés en texte extrait côté serveur, images en contenu `image` ; raw : le fichier tel quel en ressource embarquée (base64)."
  );

export const DocumentIdSchema = z
  .object({
    id: z
      .string()
      .regex(
        /^\d+(_[A-Za-z]+)?$/,
        "L'identifiant de document doit être numérique, avec un suffixe optionnel (ex. 123_resume)"
      )
      .describe("Identifiant du document, tel qu'exposé par les relations d'entités (ex. 123_resume)"),
  })
  .strict();

export const DocumentGetSchema = DocumentIdSchema.extend({ mode: DocumentGetModeSchema }).strict();
export type DocumentGetInput = z.infer<typeof DocumentGetSchema>;

// ID + tab param schema
export const IdTabSchema = z
  .object({
    id: EntityIdSchema.describe("Identifiant unique de l'entité (numérique)"),
    tab: TabSchema.optional().describe(
      "Onglet spécifique à récupérer (information, technical, financial, actions, contracts, documents)"
    ),
  })
  .strict();

// ---- Dictionary-override-aware `state` field ----
// Accepts the usual numeric dictionary id, plus a custom label when the
// operator configured BOOND_DICTIONARY_OVERRIDES (see docs/dictionary-overrides.md).
// IMPORTANT: the label is resolved inside `z.preprocess`, i.e. at PARSE time,
// not at schema definition time -- so overrides injected after this module is
// imported (tests, late env) are honoured. Unknown labels are left as-is so
// the integer validation fails with an explicit error.
export const stateField = (entity: string, baseDescription: string) =>
  z
    .preprocess((value) => {
      if (typeof value === "string") {
        const resolved = resolveLabel("state", entity, value);
        if (resolved !== undefined) return resolved;
      }
      return value;
    }, z.coerce.number().int())
    .optional()
    .describe(appendOverridesToDescription(baseDescription, "state", entity));

// ---- Candidate schemas ----

export const CandidateCreateSchema = z
  .object({
    firstName: z.string().min(1).describe("Prénom du candidat"),
    lastName: z.string().min(1).describe("Nom de famille du candidat"),
    email1: z.string().email().optional().describe("Email principal"),
    phone1: z.string().optional().describe("Téléphone principal"),
    city: z.string().optional().describe("Ville"),
    country: z.string().optional().describe("Pays"),
    title: z.string().optional().describe("Titre du poste / fonction"),
    state: stateField("candidate", "État du candidat (0=en cours, 1=placé, 2=archivé...)"),
    mainSkills: z.string().optional().describe("Compétences principales (texte libre)"),
    note: z.string().optional().describe("Notes / commentaires"),
  })
  .strict();

export const PositioningUpdateSchema = z
  .object({
    id: EntityIdSchema.describe("ID du positionnement \u00e0 modifier"),
    state: stateField(
      "positioning",
      "État du positionnement : ID numérique de `boond://dictionary/states/positionings`"
    ),
    stateReasonTypeOf: z
      .number()
      .int()
      .optional()
      .describe("Motif d'\u00e9tat : ID num\u00e9rique du type de motif (stateReason.typeOf)"),
    stateReasonDetail: z.string().optional().describe("Motif d'\u00e9tat : d\u00e9tail libre (stateReason.detail)"),
    startDate: z.string().optional().describe("Date de d\u00e9but (YYYY-MM-DD, ou cha\u00eene vide pour effacer)"),
    endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD, ou cha\u00eene vide pour effacer)"),
    informationComments: z.string().max(250).optional().describe("Commentaires (max 250 caract\u00e8res)"),
  })
  .strict();

export const CandidateUpdateSchema = z
  .object({
    id: EntityIdSchema.describe("ID du candidat à modifier"),
    firstName: z.string().optional().describe("Prénom"),
    lastName: z.string().optional().describe("Nom"),
    email1: z.string().email().optional().describe("Email principal"),
    phone1: z.string().optional().describe("Téléphone"),
    city: z.string().optional().describe("Ville"),
    country: z.string().optional().describe("Pays"),
    title: z.string().optional().describe("Titre / fonction"),
    state: stateField("candidate", "État du candidat"),
    mainSkills: z.string().optional().describe("Compétences principales"),
    note: z.string().optional().describe("Notes"),
  })
  .strict();

// ---- Resource schemas ----

export const ResourceCreateSchema = z
  .object({
    firstName: z.string().min(1).describe("Prénom de la ressource/collaborateur"),
    lastName: z.string().min(1).describe("Nom de famille"),
    email1: z.string().email().optional().describe("Email principal"),
    phone1: z.string().optional().describe("Téléphone"),
    city: z.string().optional().describe("Ville"),
    country: z.string().optional().describe("Pays"),
    title: z.string().optional().describe("Titre / poste"),
    state: stateField("resource", "État de la ressource"),
    note: z.string().optional().describe("Notes"),
  })
  .strict();

export const ResourceUpdateSchema = z
  .object({
    id: EntityIdSchema.describe("ID de la ressource à modifier"),
    firstName: z.string().optional().describe("Prénom"),
    lastName: z.string().optional().describe("Nom"),
    email1: z.string().email().optional().describe("Email principal"),
    phone1: z.string().optional().describe("Téléphone"),
    city: z.string().optional().describe("Ville"),
    country: z.string().optional().describe("Pays"),
    title: z.string().optional().describe("Titre / poste"),
    state: stateField("resource", "État"),
    note: z.string().optional().describe("Notes"),
  })
  .strict();

// ---- Resource technical-data (DT) write schema ----
// Source: spec issue #79. PUT /resources/{id}/technical-data with type=resource.
const technicalDataToolItemSchema = z
  .object({
    tool: z
      .string()
      .min(1)
      .describe("Slug de l'outil (ex: 'aws', 'snowflake', 'microsoftazure'). Voir dictionnaire setting.tool."),
    level: z.number().int().min(1).max(4).describe("Niveau de maîtrise (1 = débutant, 4 = expert)."),
  })
  .strict();

const technicalDataLanguageItemSchema = z
  .object({
    language: z.string().min(1).describe("Langue (ex: 'Anglais', 'Espagnol')."),
    level: z.enum(["scolaire", "intermediaire", "courant", "bilingue", "maternel"]).describe("Niveau parlé."),
  })
  .strict();

export const ResourceTechnicalDataUpdateSchema = z
  .object({
    id: EntityIdSchema.describe("ID de la ressource dont le dossier technique est mis à jour."),
    mode: z
      .enum(["merge", "replace"])
      .default("merge")
      .describe(
        "'merge' (défaut) enrichit le DT sans rien écraser. 'replace' remplace intégralement chaque champ fourni."
      ),
    title: z.string().optional().describe("Titre / poste actuel."),
    summary: z.string().optional().describe("Résumé / synthèse du parcours."),
    skills: z.string().optional().describe("Compétences libres, séparées par virgule (ex: 'Python, AWS, GCP')."),
    experience: z.number().int().min(0).optional().describe("Années d'expérience."),
    training: z.string().optional().describe("Formations / parcours académique."),
    expertiseAreas: z.array(z.string()).optional().describe("Domaines d'expertise (texte libre, ex: 'Banque')."),
    activityAreas: z.array(z.string()).optional().describe("Secteurs d'activité."),
    tools: z.array(technicalDataToolItemSchema).optional().describe("Outils maîtrisés avec niveau (1-4)."),
    languages: z.array(technicalDataLanguageItemSchema).optional().describe("Langues parlées avec niveau."),
    diplomas: z
      .array(z.string())
      .optional()
      .describe("Diplômes (texte libre, ex: 'DUT Informatique - IUT Bordeaux (2016)')."),
  })
  .strict();

// ---- Reference (DT experience) schemas ----
// Validated live against the BoondManager API on 2026-05-20: references are NOT a
// standalone REST entity. They're sub-objects embedded in the resource's DT (the
// `attributes.references` array returned by `/resources/{id}/technical-data`).
// All CRUD on references therefore goes through `PUT /resources/{id}/technical-data`
// with the full `references` array.
//
// API quirks learned from probing:
// - `description` is REQUIRED for any new reference (1017 otherwise)
// - `startMonth` / `endMonth` accept int 1..12 OR string without leading zero ("5")
//   — "05" is rejected with 1002. We normalize to int via `z.coerce.number()`.
// - `startYear` / `endYear` accept int or string YYYY — coerced to int.
const referenceMonth = z.coerce
  .number()
  .int()
  .min(1)
  .max(12)
  .describe("Mois (1-12). Accepte int ou string ('5'). ⚠️ '05' avec leading zero est rejeté par l'API Boond.");
const referenceYear = z.coerce
  .number()
  .int()
  .min(1900)
  .max(2100)
  .describe("Année (ex: 2024). Accepte int ou string '2024'.");

export const ReferenceCreateSchema = z
  .object({
    resourceId: EntityIdSchema.describe("ID de la ressource à laquelle rattacher la référence."),
    title: z.string().min(1).describe("Intitulé du poste."),
    company: z.string().min(1).describe("Société / employeur."),
    description: z
      .string()
      .min(1)
      .describe("Description / missions / réalisations. ⚠️ Requis côté API Boond (1017 sans)."),
    location: z.string().optional().describe("Lieu (ville)."),
    startMonth: referenceMonth.optional(),
    startYear: referenceYear.optional(),
    endMonth: referenceMonth.optional(),
    endYear: referenceYear.optional(),
    skills: z.string().optional().describe("Compétences mobilisées (texte libre, séparées par virgule)."),
  })
  .strict();

export const ReferenceUpdateSchema = z
  .object({
    resourceId: EntityIdSchema.describe(
      "ID de la ressource portant la référence (les references sont embarquées dans le DT)."
    ),
    referenceId: EntityIdSchema.describe("ID de la référence à modifier."),
    title: z.string().optional().describe("Intitulé du poste."),
    company: z.string().optional().describe("Société / employeur."),
    description: z.string().optional().describe("Description / missions / réalisations."),
    location: z.string().optional().describe("Lieu (ville)."),
    startMonth: referenceMonth.optional(),
    startYear: referenceYear.optional(),
    endMonth: referenceMonth.optional(),
    endYear: referenceYear.optional(),
    skills: z.string().optional().describe("Compétences mobilisées."),
  })
  .strict();

export const ReferenceIdSchema = z
  .object({
    resourceId: EntityIdSchema.describe(
      "ID de la ressource portant la référence (les references sont embarquées dans le DT)."
    ),
    referenceId: EntityIdSchema.describe("ID de la référence à supprimer."),
  })
  .strict();

// ---- Contact schemas ----

export const ContactCreateSchema = z
  .object({
    firstName: z.string().min(1).describe("Prénom du contact"),
    lastName: z.string().min(1).describe("Nom de famille"),
    email1: z.string().email().optional().describe("Email principal"),
    phone1: z.string().optional().describe("Téléphone"),
    city: z.string().optional().describe("Ville"),
    country: z.string().optional().describe("Pays"),
    title: z.string().optional().describe("Titre / fonction"),
    companyId: EntityIdSchema.optional().describe("ID de la société associée"),
    note: z.string().optional().describe("Notes"),
  })
  .strict();

export const ContactUpdateSchema = z
  .object({
    id: EntityIdSchema.describe("ID du contact à modifier"),
    firstName: z.string().optional().describe("Prénom"),
    lastName: z.string().optional().describe("Nom"),
    email1: z.string().email().optional().describe("Email"),
    phone1: z.string().optional().describe("Téléphone"),
    city: z.string().optional().describe("Ville"),
    title: z.string().optional().describe("Titre / fonction"),
    note: z.string().optional().describe("Notes"),
  })
  .strict();

// ---- Company schemas ----

export const CompanyCreateSchema = z
  .object({
    name: z.string().min(1).describe("Nom de la société"),
    email1: z.string().email().optional().describe("Email de la société"),
    phone1: z.string().optional().describe("Téléphone"),
    city: z.string().optional().describe("Ville"),
    country: z.string().optional().describe("Pays"),
    website: z.string().optional().describe("Site web"),
    siret: z.string().optional().describe("Numéro SIRET"),
    state: stateField("company", "État de la société"),
    note: z.string().optional().describe("Notes"),
  })
  .strict();

export const CompanyUpdateSchema = z
  .object({
    id: EntityIdSchema.describe("ID de la société à modifier"),
    name: z.string().optional().describe("Nom"),
    email1: z.string().email().optional().describe("Email"),
    phone1: z.string().optional().describe("Téléphone"),
    city: z.string().optional().describe("Ville"),
    country: z.string().optional().describe("Pays"),
    website: z.string().optional().describe("Site web"),
    siret: z.string().optional().describe("Numéro SIRET"),
    state: stateField("company", "État"),
    note: z.string().optional().describe("Notes"),
  })
  .strict();

// ---- Opportunity schemas ----

// Writable fields shared by create and update. The attribute/relationship
// names mirror the official RAML (schemas/opportunities/information.json):
//  - `note` → /data/attributes/description (the API has no `note` attribute,
//    so the old direct pass-through was silently dropped — see issue #124)
//  - `typeOf`, `criteria`, `expertiseArea`, `turnoverEstimatedExcludingTax`
//    are plain attributes
//  - `companyId`/`contactId`/`poleId`/`hrManagerId`/`mainManagerId`/`agencyId`
//    become JSON:API relationships (resource types: company, contact, pole,
//    resource, resource, agency)
const opportunityWritableShape = {
  typeOf: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Type d'opportunité : ID numérique du dictionnaire setting.typeOf.project (ex: 1, 3), via boond_application_dictionary"
    ),
  companyId: EntityIdSchema.optional().describe("ID de la société cliente (relation company)"),
  contactId: EntityIdSchema.optional().describe("ID du contact associé (relation contact)"),
  state: stateField("opportunity", "État de l'opportunité"),
  startDate: z.string().optional().describe("Date de début prévue (YYYY-MM-DD ou 'immediate')"),
  endDate: z.string().optional().describe("Date de fin prévue (YYYY-MM-DD)"),
  note: z
    .string()
    .max(65000)
    .optional()
    .describe("Description de l'opportunité (mappée sur /data/attributes/description)"),
  criteria: z
    .string()
    .max(5000)
    .optional()
    .describe(
      "Critères / compétences recherchées (texte libre). Alimente le matching de boond_workflow_candidats_pour_opportunite."
    ),
  expertiseArea: z
    .string()
    .optional()
    .describe("Domaine d'expertise : ID du dictionnaire setting.expertiseArea (via boond_application_dictionary)"),
  turnoverEstimatedExcludingTax: z.coerce.number().optional().describe("Chiffre d'affaires estimé HT (montant)"),
  poleId: EntityIdSchema.optional().describe("ID du pôle (relation pole)"),
  hrManagerId: EntityIdSchema.optional().describe("ID de la ressource responsable RH (relation hrManager)"),
  mainManagerId: EntityIdSchema.optional().describe(
    "ID de la ressource responsable principal / commercial (relation mainManager)"
  ),
  agencyId: EntityIdSchema.optional().describe("ID de l'agence (relation agency)"),
} as const;

export const OpportunityCreateSchema = z
  .object({
    name: z.string().min(1).describe("Nom / titre de l'opportunité"),
    ...opportunityWritableShape,
  })
  .strict();

export const OpportunityUpdateSchema = z
  .object({
    id: EntityIdSchema.describe("ID de l'opportunité à modifier"),
    name: z.string().optional().describe("Nom / titre"),
    ...opportunityWritableShape,
  })
  .strict();

// ---- Action schemas ----

// Source: resources/actions/search.raml (filters verified live, issue #248).
export const ActionSearchSchema = z
  .object({
    keywords: z.string().optional().describe("Mots-clés de recherche"),
    candidateId: EntityIdSchema.optional().describe("Filtrer par ID candidat (référence keywords CAND<id>)"),
    resourceId: EntityIdSchema.optional().describe("Filtrer par ID ressource (référence keywords COMP<id>)"),
    contactId: EntityIdSchema.optional().describe("Filtrer par ID contact (référence keywords CCON<id>)"),
    companyId: EntityIdSchema.optional().describe("Filtrer par ID société (référence keywords CSOC<id>)"),
    opportunityId: EntityIdSchema.optional().describe("Filtrer par ID opportunité (référence keywords AO<id>)"),
    projectId: EntityIdSchema.optional().describe("Filtrer par ID projet (référence keywords PRJ<id>)"),
    orderId: EntityIdSchema.optional().describe("Filtrer par ID bon de commande (référence keywords BDC<id>)"),
    invoiceId: EntityIdSchema.optional().describe("Filtrer par ID facture (référence keywords FACT<id>)"),
    actionTypes: intArray(
      "IDs de types d'action — `boond://dictionary/actions/<entité>` (les types sont déclarés par entité de rattachement)."
    ),
    period: z
      .enum(["started", "created", "updated"])
      .optional()
      .describe("Champ de date borné par `startDate` / `endDate` : started (date de l'action), created, updated."),
    periodDynamic: periodDynamicField,
    startDate: startDateField,
    endDate: endDateField,
    flags: flagsField,
    ...perimeterShape,
    ...sortedPaginationShape,
  })
  .strict();

// POST /actions requires a polymorphic `dependsOn` relationship (the entity the
// action is attached to) and a numeric `typeOf` (dictionary id, see
// `setting.action.*` in /application/dictionary). Valid attributes are `title`
// and `text` (not subject/content) — anything else triggers a 422.
export const ActionCreateSchema = z
  .object({
    typeOf: z
      .union([z.coerce.number().int().min(0), z.string().min(1)])
      .describe(
        "Type d'action : ID numérique du dictionnaire (setting.action.*, via boond_application_dictionary) " +
          "ou libellé personnalisé si BOOND_DICTIONARY_OVERRIDES est configuré"
      ),
    title: z.string().optional().describe("Titre de l'action"),
    text: z.string().optional().describe("Contenu / notes de l'action"),
    startDate: z
      .string()
      .regex(actionDateTimeRegex)
      .optional()
      .describe("Date de début au format ISO 8601 avec timezone (ex: 2026-06-05T10:00:00+0200)"),
    endDate: z.string().regex(actionDateTimeRegex).optional().describe("Date de fin (même format que startDate)"),
    candidateId: EntityIdSchema.optional().describe("ID du candidat auquel rattacher l'action (dependsOn)"),
    resourceId: EntityIdSchema.optional().describe("ID de la ressource à laquelle rattacher l'action (dependsOn)"),
    contactId: EntityIdSchema.optional().describe("ID du contact auquel rattacher l'action (dependsOn)"),
    opportunityId: EntityIdSchema.optional().describe("ID de l'opportunité à laquelle rattacher l'action (dependsOn)"),
    projectId: EntityIdSchema.optional().describe("ID du projet auquel rattacher l'action (dependsOn)"),
    companyId: EntityIdSchema.optional().describe(
      "ID de la société associée (uniquement en complément d'un contactId)"
    ),
    positioningId: EntityIdSchema.optional().describe(
      "ID du positionnement à lier à l'action (relation positioning). Requis par l'API pour les types d'action liés aux positionnements (ex. RQ) — sans lui, erreur 422 « 1002 - Wrong or missing attribute (/data/relationships/positioning) »."
    ),
  })
  .strict();

// PUT /actions/{id} (PATCH renvoie 405). Mise à jour partielle des seuls
// attributs : aucune relation n'est envoyée, ce qui préserve le rattachement
// `dependsOn`/`positioning` et la synchronisation calendrier (event Outlook /
// Teams). `typeOf` accepte uniquement l'ID numérique du dictionnaire ici (pas
// de résolution de libellé, faute d'entité `dependsOn` connue sur l'update).
export const ActionUpdateSchema = z
  .object({
    id: EntityIdSchema.describe("ID de l'action à modifier"),
    typeOf: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Nouveau type : ID numérique du dictionnaire setting.action.* (via boond_application_dictionary)"),
    title: z.string().optional().describe("Nouveau titre de l'action"),
    text: z.string().optional().describe("Nouveau contenu / notes (HTML accepté). Remplace l'existant (pas d'ajout)."),
    startDate: z
      .string()
      .regex(actionDateTimeRegex)
      .optional()
      .describe("Date de début au format ISO 8601 avec timezone (ex: 2026-06-05T10:00:00+0200)"),
    endDate: z.string().regex(actionDateTimeRegex).optional().describe("Date de fin (même format que startDate)"),
  })
  .strict();

// ---- Timesheet schemas ----

export const ResourceTimesheetSchema = z
  .object({
    resourceId: EntityIdSchema.describe("ID de la ressource"),
    month: z.number().int().min(1).max(12).optional().describe("Mois (1-12). Si omis, mois courant."),
    year: z.number().int().min(2000).optional().describe("Année (ex: 2025). Si omis, année courante."),
  })
  .strict();

// `/times-reports` requires `startMonth` and `endMonth` in YYYY-MM form. Passing
// YYYY-MM-DD or omitting them surfaces a 422 "Missing required attribute" from
// the API, so the schema enforces both at the boundary.
export const TimesheetSearchSchema = z
  .object({
    startMonth: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .describe("Mois de début au format YYYY-MM (ex: '2025-01'). Requis."),
    endMonth: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .describe("Mois de fin au format YYYY-MM (ex: '2025-03'). Requis."),
    keywords: z.string().optional().describe("Mots-clés (préfixes 'TPS', 'COMP'...)."),
    resourceId: EntityIdSchema.optional().describe("Filtrer par ID ressource (référence keywords COMP<id>)"),
    resourceTypes: resourceTypesField,
    validationStates: validationStatesField,
    closed: z.boolean().optional().describe("true = CRA clôturés uniquement, false = non clôturés."),
    ...perimeterShape,
    ...sortedPaginationShape,
  })
  .strict();

// ---- Timesheet (CRA) write schemas (issue #249) ----
//
// A times report is a monthly container per resource (`term` + `resource`)
// whose lines live in `regularTimes[]` / `exceptionalTimes[]` — the exact
// twin of the expenses report (#179). The line shape below is the one the API
// *returns* (`GET /times-reports/{id}`, `models.time` in the dictionary, and
// the `plannedTimes` of `/times-reports/default`): `startDate`, `duration`,
// `workUnitType.reference`, `project`, `delivery`, `batch`. `state` is moved by
// the validation workflow (`validated`, `waitingForValidation`…) and is not a
// write field. See CLAUDE.md → *Timesheets* for what was and was not verified
// against the live API.
export const TimesheetLineSchema = z
  .object({
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("Jour saisi (YYYY-MM-DD). Doit tomber dans le mois `term` du CRA."),
    duration: z
      .number()
      .positive()
      .default(1)
      .describe("Durée en unités d'œuvre (jour par défaut : 1 = journée, 0.5 = demi-journée)."),
    workUnitTypeReference: z
      .number()
      .int()
      .default(1)
      .describe(
        "Code `reference` du type d'unité d'œuvre — voir `boond_timesheets_default` (`workUnitTypesAllowed` de la ressource). " +
          "1 = « Normale » (production) sur les tenants observés ; les absences (congés, RTT, maladie…) ont leurs propres codes."
      ),
    projectId: EntityIdSchema.optional().describe(
      "ID du projet imputé. Requis pour une activité de production ; absent pour une absence. Couples autorisés : `boond_timesheets_default`."
    ),
    deliveryId: EntityIdSchema.optional().describe(
      "ID de la prestation (delivery) imputée. Requis avec `projectId` pour la production — voir `boond_timesheets_default`."
    ),
    batchId: EntityIdSchema.optional().describe("ID du lot. Absent = aucun lot."),
  })
  .strict();

export const TimesheetCreateSchema = z
  .object({
    resourceId: EntityIdSchema.describe("ID de la ressource (le collaborateur dont c'est le CRA)."),
    agencyId: EntityIdSchema.optional().describe(
      "ID de l'agence — voir `boond_timesheets_default`. Déduite de la ressource si omise."
    ),
    term: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .describe("Mois du CRA (YYYY-MM). Un CRA = un mois × une ressource ; l'API ne déduplique pas."),
    informationComments: z.string().optional().describe("Commentaires du CRA."),
    regularTimes: z
      .array(TimesheetLineSchema)
      .optional()
      .describe("Lignes d'activité normale (production et absences). Omettre pour créer un CRA vide."),
    exceptionalTimes: z
      .array(TimesheetLineSchema)
      .optional()
      .describe(
        "Lignes d'activité exceptionnelle (interventions, astreintes) — types `exceptionalTime` / `exceptionalCalendar`."
      ),
  })
  .strict();

export const TimesheetUpdateSchema = z
  .object({
    id: EntityIdSchema.describe("ID du CRA à modifier"),
    informationComments: z.string().optional().describe("Commentaires"),
    closed: z.boolean().optional().describe("Clôturer le CRA"),
    regularTimes: z
      .array(TimesheetLineSchema)
      .optional()
      .describe(
        "⚠️ Remplace TOUTES les lignes d'activité normale — envoyer la liste complète (relire le CRA avec `boond_timesheets_get` et fusionner), pas seulement les ajouts."
      ),
    exceptionalTimes: z
      .array(TimesheetLineSchema)
      .optional()
      .describe("⚠️ Remplace TOUTES les lignes d'activité exceptionnelle — même règle que `regularTimes`."),
  })
  .strict();

export const TimesheetDefaultSchema = z
  .object({
    resourceId: EntityIdSchema.describe("ID de la ressource"),
    term: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .describe("Mois du CRA (YYYY-MM)"),
    agencyId: EntityIdSchema.optional().describe("ID de l'agence, si la ressource en a plusieurs"),
  })
  .strict();

export type TimesheetLineInput = z.infer<typeof TimesheetLineSchema>;
export type TimesheetCreateInput = z.infer<typeof TimesheetCreateSchema>;
export type TimesheetUpdateInput = z.infer<typeof TimesheetUpdateSchema>;
export type TimesheetDefaultInput = z.infer<typeof TimesheetDefaultSchema>;

export const TimesheetGetSchema = z
  .object({
    id: EntityIdSchema.describe("Identifiant unique de la feuille de temps"),
  })
  .strict();

// ---- Project schemas ----

export const ProjectCreateSchema = z
  .object({
    name: z.string().min(1).describe("Nom du projet / mission"),
    companyId: EntityIdSchema.optional().describe("ID de la société cliente"),
    contactId: EntityIdSchema.optional().describe("ID du contact associé"),
    opportunityId: EntityIdSchema.optional().describe("ID de l'opportunité liée"),
    typeOf: z.number().int().optional().describe("Type de projet (ID du dictionnaire setting.typeOf.project)"),
    state: stateField("project", "État du projet (0=en cours, 1=terminé, 2=archivé...)"),
    startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
    note: z.string().optional().describe("Notes / description du projet"),
  })
  .strict();

export const ProjectUpdateSchema = z
  .object({
    id: EntityIdSchema.describe("ID du projet à modifier"),
    name: z.string().optional().describe("Nom du projet"),
    typeOf: z.number().int().optional().describe("Type de projet (ID du dictionnaire setting.typeOf.project)"),
    state: stateField("project", "État du projet"),
    startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
    note: z.string().optional().describe("Notes"),
  })
  .strict();

// ---- Invoice schemas ----

export const InvoiceCreateSchema = z
  .object({
    reference: z.string().optional().describe("Référence de la facture"),
    orderId: EntityIdSchema.optional().describe("ID du bon de commande associé"),
    state: stateField(
      "invoice",
      "État de la facture : ID de `boond://dictionary/states/invoices` (ex: 0 = Création, 1 = Transmis au client)"
    ),
    invoiceDate: z.string().optional().describe("Date de facturation (YYYY-MM-DD)"),
    expectedPaymentDate: z.string().optional().describe("Date d'échéance/paiement attendu (YYYY-MM-DD)"),
    amountExcludingTax: z.number().optional().describe("Montant HT"),
    taxRate: z.number().optional().describe("Taux de TVA (%)"),
    invoiceRecords: z.array(z.record(z.string(), z.unknown())).optional().describe("Lignes de facture Boond"),
    invoicePayments: z.array(z.record(z.string(), z.unknown())).optional().describe("Paiements client de la facture"),
    note: z.string().optional().describe("Notes / commentaires"),
  })
  .strict();

export const InvoiceUpdateSchema = z
  .object({
    id: EntityIdSchema.describe("ID de la facture à modifier"),
    reference: z.string().optional().describe("Référence de la facture"),
    state: stateField(
      "invoice",
      "État de la facture : ID de `boond://dictionary/states/invoices` (ex: 0 = Création, 1 = Transmis au client)"
    ),
    invoiceDate: z.string().optional().describe("Date de facturation (YYYY-MM-DD)"),
    expectedPaymentDate: z.string().optional().describe("Date d'échéance/paiement attendu (YYYY-MM-DD)"),
    amountExcludingTax: z.number().optional().describe("Montant HT"),
    taxRate: z.number().optional().describe("Taux de TVA (%)"),
    invoiceRecords: z.array(z.record(z.string(), z.unknown())).optional().describe("Lignes de facture Boond"),
    invoicePayments: z.array(z.record(z.string(), z.unknown())).optional().describe("Paiements client de la facture"),
    note: z.string().optional().describe("Notes"),
  })
  .strict();

// Source: resources/invoices/search.raml (filters verified live, issue #248).
export const InvoiceSearchSchema = z
  .object({
    keywords: z.string().optional().describe("Mots-clés de recherche (référence, société...)"),
    companyId: EntityIdSchema.optional().describe("Filtrer par ID société (référence keywords CSOC<id>)"),
    projectId: EntityIdSchema.optional().describe("Filtrer par ID projet (référence keywords PRJ<id>)"),
    contactId: EntityIdSchema.optional().describe("Filtrer par ID contact (référence keywords CCON<id>)"),
    orderId: EntityIdSchema.optional().describe("Filtrer par ID bon de commande (référence keywords BDC<id>)"),
    states: intArray(
      "IDs d'états de facture — `boond://dictionary/states/invoices` (ex. impayées = tous les états sauf « payée »)."
    ),
    projectTypes: projectTypesFilterField,
    paymentMethods: paymentMethodsField,
    companies: companiesFilterField,
    closed: z
      .boolean()
      .optional()
      .describe("true = factures / avoirs clôturés uniquement, false = non clôturés uniquement."),
    creditNote: z.boolean().optional().describe("true = avoirs uniquement, false = factures uniquement."),
    period: z
      .enum(["created", "updated", "expectedPayment", "performedPayment", "period"])
      .optional()
      .describe(
        "Champ de date borné par `startDate` / `endDate` : created, updated, expectedPayment (échéance), performedPayment (règlement), period (période facturée, défaut)."
      ),
    periodDynamic: periodDynamicField,
    startDate: startDateField,
    endDate: endDateField,
    flags: flagsField,
    ...perimeterShape,
    ...sortedPaginationShape,
  })
  .strict();

// ---- Order schemas (Bons de commande) ----

export const OrderCreateSchema = z
  .object({
    reference: z.string().optional().describe("Référence du bon de commande"),
    companyId: EntityIdSchema.optional().describe("ID de la société"),
    projectId: EntityIdSchema.optional().describe("ID du projet associé"),
    state: stateField("order", "État du bon de commande : ID de `boond://dictionary/states/orders`"),
    orderDate: z.string().optional().describe("Date du bon de commande (YYYY-MM-DD)"),
    startDate: z.string().optional().describe("Date de début couverte (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("Date de fin couverte (YYYY-MM-DD)"),
    amountExcludingTax: z.number().optional().describe("Montant HT"),
    customerAgreement: z.boolean().optional().describe("Accord client reçu"),
    schedules: z.array(z.record(z.string(), z.unknown())).optional().describe("Lignes/échéances de commande"),
    note: z.string().optional().describe("Notes / commentaires"),
  })
  .strict();

export const OrderUpdateSchema = z
  .object({
    id: EntityIdSchema.describe("ID du bon de commande à modifier"),
    reference: z.string().optional().describe("Référence"),
    state: stateField("order", "État du bon de commande : ID de `boond://dictionary/states/orders`"),
    orderDate: z.string().optional().describe("Date (YYYY-MM-DD)"),
    startDate: z.string().optional().describe("Date de début couverte (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("Date de fin couverte (YYYY-MM-DD)"),
    amountExcludingTax: z.number().optional().describe("Montant HT"),
    customerAgreement: z.boolean().optional().describe("Accord client reçu"),
    schedules: z.array(z.record(z.string(), z.unknown())).optional().describe("Lignes/échéances de commande"),
    note: z.string().optional().describe("Notes"),
  })
  .strict();

// Source: resources/orders/search.raml (filters verified live, issue #248).
export const OrderSearchSchema = z
  .object({
    keywords: z.string().optional().describe("Mots-clés de recherche"),
    companyId: EntityIdSchema.optional().describe("Filtrer par ID société (référence keywords CSOC<id>)"),
    projectId: EntityIdSchema.optional().describe("Filtrer par ID projet (référence keywords PRJ<id>)"),
    contactId: EntityIdSchema.optional().describe("Filtrer par ID contact (référence keywords CCON<id>)"),
    states: intArray("IDs d'états de bon de commande — `boond://dictionary/states/orders`."),
    projectTypes: projectTypesFilterField,
    paymentMethods: paymentMethodsField,
    companies: companiesFilterField,
    customerAgreement: z.boolean().optional().describe("true = accord client reçu uniquement, false = sans accord."),
    exceededOrderedTurnover: z
      .boolean()
      .optional()
      .describe("true = commandes dont le facturé dépasse le montant commandé."),
    period: z
      .enum(["created", "updated", "period"])
      .optional()
      .describe("Champ de date borné par `startDate` / `endDate` : created, updated, period (période couverte)."),
    periodDynamic: periodDynamicField,
    startDate: startDateField,
    endDate: endDateField,
    flags: flagsField,
    ...perimeterShape,
    ...sortedPaginationShape,
  })
  .strict();

// ---- Delivery schemas (Livraisons / CRA) ----

// Source: resources/deliveriesGroupments/search.raml — the list route of the
// deliveries domain (filters verified live, issue #248).
export const DeliverySearchSchema = z
  .object({
    keywords: z.string().optional().describe("Mots-clés de recherche"),
    projectId: EntityIdSchema.optional().describe("Filtrer par ID projet (référence keywords PRJ<id>)"),
    companyId: EntityIdSchema.optional().describe("Filtrer par ID société (référence keywords CSOC<id>)"),
    resourceId: EntityIdSchema.optional().describe("Filtrer par ID ressource (référence keywords COMP<id>)"),
    opportunityId: EntityIdSchema.optional().describe("Filtrer par ID opportunité (référence keywords AO<id>)"),
    projectTypes: projectTypesFilterField,
    projectStates: intArray("IDs d'états de projet — `boond://dictionary/states/projects`."),
    deliveryStates: intArray("IDs d'états de prestation — `boond://dictionary/states/deliveries`."),
    expertiseAreas: strArray("Domaines d'expertise — `boond://dictionary/expertiseAreas`."),
    transferType: z
      .enum(["master", "slave", "none", "notSlave", "notMaster", "missing"])
      .optional()
      .describe("Filtre sur les transferts de prestation (master / slave / none / notSlave / notMaster / missing)."),
    period: z
      .enum(["started", "updated", "stopped", "projectRunning", "running", "hasAdditionalDataOrPurchase"])
      .optional()
      .describe(
        "Champ de date borné par `startDate` / `endDate` : started, stopped, updated, running (prestations en cours sur la fenêtre), projectRunning (projet en cours)."
      ),
    periodDynamic: periodDynamicField,
    startDate: startDateField,
    endDate: endDateField,
    companies: companiesFilterField,
    flags: flagsField,
    ...perimeterShape,
    ...sortedPaginationShape,
  })
  .strict();

export const DeliveryCreateSchema = z
  .object({
    projectId: EntityIdSchema.describe("ID du projet"),
    resourceId: EntityIdSchema.describe("ID de la ressource portée par la prestation"),
    title: z.string().optional().describe("Titre de la prestation/livraison"),
    typeOf: z.number().int().optional().describe("Type de prestation : ID de `boond://dictionary/typeOf/deliveries`"),
    state: stateField("delivery", "État de la prestation : ID de `boond://dictionary/states/deliveries`"),
    startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
    quantity: z.number().optional().describe("Nombre de jours / quantité"),
    unitPrice: z.number().optional().describe("Prix journalier HT"),
    averageDailyCost: z.number().optional().describe("Coût journalier moyen"),
    forceAverageDailyPriceExcludingTax: z.boolean().optional().describe("Forcer le prix journalier HT"),
    note: z.string().optional().describe("Notes, mappées vers informationComments"),
  })
  .strict();

// PUT /deliveries/{id} — attributes only, the project / resource attachment
// is not moved by an update (issue #252; write path not exercised, see CLAUDE.md).
export const DeliveryUpdateSchema = z
  .object({
    id: EntityIdSchema.describe("ID de la prestation à modifier"),
    title: z.string().optional().describe("Titre de la prestation"),
    typeOf: z.number().int().optional().describe("Type de prestation : ID de `boond://dictionary/typeOf/deliveries`"),
    state: stateField("delivery", "État de la prestation : ID de `boond://dictionary/states/deliveries`"),
    startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
    endDate: z
      .string()
      .optional()
      .describe("Date de fin (YYYY-MM-DD) — prolonger une prestation = repousser cette date"),
    quantity: z.number().optional().describe("Nombre de jours / quantité (`numberOfDaysInvoicedOrQuantity`)"),
    unitPrice: z.number().optional().describe("Prix journalier HT (`averageDailyPriceExcludingTax`, forcé)"),
    averageDailyCost: z.number().optional().describe("Coût journalier moyen"),
    note: z.string().optional().describe("Notes, mappées vers informationComments"),
  })
  .strict();

// ---- Absence schemas ----

/** `GET /absences-reports/default?resource=&agency=` (issue #257) — the absence types are published there only. */
export const AbsenceDefaultSchema = z
  .object({
    resourceId: EntityIdSchema.describe("ID de la ressource (requis par l'API)."),
    agencyId: EntityIdSchema.optional().describe("ID de l'agence — déduite de la ressource si omise."),
  })
  .strict();
export type AbsenceDefaultInput = z.infer<typeof AbsenceDefaultSchema>;

export const AbsenceCreateSchema = z
  .object({
    resourceId: EntityIdSchema.describe("ID de la ressource en absence"),
    typeOf: z
      .string()
      .min(1)
      .describe(
        "Libellé de l'absence (congé payé, RTT, maladie, sans solde...) — porté par `title` ; le type effectif est `workUnitTypeReference`."
      ),
    startDate: z.string().min(1).describe("Date de début (YYYY-MM-DD)"),
    endDate: z.string().min(1).describe("Date de fin (YYYY-MM-DD)"),
    duration: z.number().optional().describe("Durée en jours ; calculée automatiquement si absente"),
    workUnitTypeReference: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "Code `reference` du type d'absence, publié par `boond_absences_default` (`workUnitTypesAllowed` de la ressource : RTT, maladie, congés payés…) — nulle part ailleurs. Défaut 1 (à confirmer avec le default)."
      ),
    absencesPeriods: z.array(z.record(z.string(), z.unknown())).optional().describe("Périodes d'absence Boond brutes"),
    // No `state` (issue #250): on `/absences-reports` it is a validation-workflow
    // string (`waitingForValidation`, `validated`…), not a dictionary integer,
    // and it is moved by the workflow — same finding as `/expenses-reports`.
    note: z.string().optional().describe("Commentaire / motif"),
  })
  .strict();

export const AbsenceUpdateSchema = z
  .object({
    id: EntityIdSchema.describe("ID de l'absence à modifier"),
    startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
    note: z.string().optional().describe("Commentaire / motif"),
  })
  .strict();

export const AbsenceSearchSchema = z
  .object({
    keywords: z.string().optional().describe("Mots-clés de recherche"),
    resourceId: EntityIdSchema.optional().describe("Filtrer par ID ressource (référence keywords COMP<id>)"),
    // Both are REQUIRED by `GET /absences-reports` (422 `1017 - Missing required
    // attribute` otherwise — caught by scripts/smoke-live.mjs, issue #244).
    // Declaring them optional made the tool fail on its most natural call.
    startMonth: z
      .string()
      .regex(/^\d{4}-\d{2}$/, "Format attendu : YYYY-MM")
      .describe("Mois de début de période (YYYY-MM) — obligatoire pour l'API"),
    endMonth: z
      .string()
      .regex(/^\d{4}-\d{2}$/, "Format attendu : YYYY-MM")
      .describe("Mois de fin de période (YYYY-MM) — obligatoire pour l'API"),
    resourceTypes: resourceTypesField,
    validationStates: validationStatesField,
    ...perimeterShape,
    ...sortedPaginationShape,
  })
  .strict();

// ---- Contract search (issue #253) ----
// There is no collection GET on `/contracts` (WAF 403 page, the RAML only
// documents `post`) and no `/resources/{id}/contracts` tab (404) — probed live
// on 2026-09-26. A resource's contracts are only reachable through
// `/resources/{id}/administrative` (`included` of type `contract`). This schema
// therefore drives a *composed* search: the resource filters select the
// resources to scan, the contract filters are applied server-side to what
// their administrative tabs return.
export const ContractSearchSchema = z
  .object({
    resourceId: EntityIdSchema.optional().describe(
      "ID d'une ressource : ne lit que ses contrats (aucune recherche de ressources)."
    ),
    keywords: z.string().optional().describe("Mots-clés de la recherche de ressources (nom, prénom…)."),
    resourceStates: intArray("IDs d'états de ressource à parcourir — `boond://dictionary/states/resources`."),
    resourceTypes: resourceTypesField,
    ...perimeterShape,
    contractTypes: intArray("IDs de types de contrat à retenir — `boond://dictionary/typeOf/contracts` (CDI, CDD…)."),
    period: z
      .enum(["running", "ending", "starting", "probationEnding"])
      .optional()
      .describe(
        "Fenêtre `startDate` / `endDate` appliquée côté serveur : running (contrat en cours sur la fenêtre), ending (fin de contrat dans la fenêtre), starting (début dans la fenêtre), probationEnding (fin de période d'essai — `probationEndDate` ou `renewalProbationEndDate` — dans la fenêtre)."
      ),
    startDate: startDateField,
    endDate: endDateField,
    ...paginationShape,
  })
  .strict();

// ---- Validation decision (issue #251) ----
// `PUT /validations/{id}` with the workflow state the RAML enumerates on
// `validationStates` (`validated` | `rejected`). No RAML documents the write;
// the route follows the pattern of every other single-entity PUT and has NOT
// been exercised (production tenant) — see CLAUDE.md → *Validations*.
export const ValidationDecisionSchema = z
  .object({
    id: EntityIdSchema.describe(
      "ID de la validation (ligne de `boond_validations_search`), pas celui du CRA / de la note / de l'absence."
    ),
    decision: z
      .enum(["validate", "reject"])
      .describe(
        "validate → `validated` ; reject → `rejected` (confirmation demandée à l'utilisateur si le client la supporte)."
      ),
    reason: z.string().optional().describe("Motif, recommandé sur un refus — transmis dans `reason`."),
  })
  .strict();
export type ValidationDecisionInput = z.infer<typeof ValidationDecisionSchema>;

// ---- Expense schemas (Notes de frais) ----

/**
 * The write model for `/expenses-reports` was verified field by field against
 * the live API (the RAML documents `post: description: Create an expenses` and
 * nothing else, and `/application/dictionary` publishes the attribute list but
 * not the required set).
 *
 * The entity is a **monthly container per resource** (`term` + `resource`) whose
 * lines live in the `actualExpenses` array — there is no such thing as a
 * standalone expense line endpoint. Consequences that the previous schema got
 * wrong, each one a 422:
 *
 * - `amount` / `expenseDate` / `typeOf` / `currency` are **line** attributes,
 *   not report attributes. A report-level payload carrying them created nothing.
 * - `exchangeRateAgency` is **required** on create (`1002` otherwise).
 * - `note` is spelled `informationComments`.
 * - `state` is accepted and then **ignored**, on POST *and* PUT: the state is
 *   moved by the validation workflow, never by a write. Exposing it as an input
 *   promised something the API does not do, so it is gone from both schemas.
 * - `data.type` is ignored by the API, so the historical `"expense"` type string
 *   was never the bug.
 *
 * A line's required set is larger than it looks: besides `startDate`,
 * `activityType`, `project`, `delivery` and the amount, the API also demands
 * `batch`, `isKilometricExpense`, `reinvoiced`, `currency` and `exchangeRate` —
 * it reports them in waves, one 422 per group, so a caller discovering them by
 * trial and error needs five round-trips. They are therefore `.default()`ed here
 * on their overwhelmingly common values rather than left to the model.
 *
 * `batch` is the sharp edge: it must be **present** and its `id` must be
 * `null` when the line is not attached to a batch. `{ id: "0" }` and `{ id: 0 }`
 * are both rejected (`1002`), which is why `batchId` maps to `{ id: null }`
 * rather than being dropped like every other undefined value.
 *
 * HT/VAT: `amountIncludingTax` (TTC) and `tax` (a **rate** in %, not an amount)
 * are what persist. `amountExcludingTax` and `taxAmount` are accepted on write
 * and silently recomputed — they are not echoed back — so there is nothing to
 * add for them and nothing is lost by omitting them.
 */
const EXPENSE_ACTIVITY_TYPES = ["production", "internal", "absence"] as const;

export const ExpenseLineSchema = z
  .object({
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("Date du frais (YYYY-MM-DD). Doit tomber dans le mois `term` de la note de frais."),
    expenseTypeReference: z
      .number()
      .int()
      .optional()
      .describe(
        "Code du type de frais (`reference`), à lire via `boond_expenses_default` — " +
          "les types de frais sont définis par agence et ne figurent PAS dans `boond_application_dictionary`. " +
          "À omettre pour un frais kilométrique."
      ),
    amountIncludingTax: z
      .number()
      .optional()
      .describe("Montant TTC. Ignoré pour un frais kilométrique (recalculé = km × barème)."),
    tax: z
      .number()
      .optional()
      .describe("Taux de TVA en % (ex: 20 pour 20 %) — un taux, pas un montant. Défaut API: 0."),
    isKilometricExpense: z
      .boolean()
      .default(false)
      .describe(
        "`true` pour un frais kilométrique : renseigner `numberOfKilometers` et omettre `expenseTypeReference`."
      ),
    numberOfKilometers: z.number().optional().describe("Nombre de kilomètres (frais kilométrique uniquement)."),
    activityType: z.enum(EXPENSE_ACTIVITY_TYPES).default("production").describe("Type d'activité rattachée au frais."),
    projectId: EntityIdSchema.describe(
      "ID du projet à imputer. Obligatoire — les couples (projet, prestation) autorisés sont donnés par `boond_expenses_default`."
    ),
    deliveryId: EntityIdSchema.describe(
      "ID de la prestation (delivery) à imputer. Obligatoire — voir `boond_expenses_default`."
    ),
    batchId: EntityIdSchema.optional().describe("ID du lot. Absent = aucun lot."),
    reinvoiced: z.boolean().default(false).describe("Frais refacturable au client."),
    currency: z.number().int().default(0).describe("ID de devise (`setting.currency`, 0 = EUR)."),
    exchangeRate: z.number().default(1).describe("Taux de change vers la devise agence."),
    title: z.string().optional().describe("Description libre de la ligne (marchand, motif, invités...)."),
    file: z
      .string()
      .optional()
      .describe(
        "ID du justificatif déjà téléversé, suffixé (ex: `52979_proof`). " +
          "Un fichier doit d'abord être créé via `boond_documents_create` (`parentType: 'expensesReport'`)."
      ),
  })
  .strict();

export const ExpenseCreateSchema = z
  .object({
    resourceId: EntityIdSchema.describe("ID de la ressource (le collaborateur qui a engagé les frais)."),
    agencyId: EntityIdSchema.optional().describe(
      "ID de l'agence — voir `boond_expenses_default`. Déduit de la ressource si omis."
    ),
    term: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .describe("Mois de la note de frais (YYYY-MM). Une note de frais = un mois × une ressource."),
    exchangeRateAgency: z.number().default(1).describe("Taux de change agence. Obligatoire côté API."),
    currencyAgency: z.number().int().optional().describe("ID de devise de l'agence (`setting.currency`)."),
    informationComments: z.string().optional().describe("Commentaires de la note de frais."),
    advance: z.number().optional().describe("Avance à reprendre."),
    ratePerKilometerTypeReference: z
      .number()
      .int()
      .optional()
      .describe("Code du barème kilométrique (`reference`) — voir `boond_expenses_default`."),
    actualExpenses: z
      .array(ExpenseLineSchema)
      .optional()
      .describe("Lignes de frais réels. Omettre pour créer une note de frais vide."),
  })
  .strict();

export const ExpenseUpdateSchema = z
  .object({
    id: EntityIdSchema.describe("ID de la note de frais à modifier"),
    exchangeRateAgency: z.number().optional().describe("Taux de change agence"),
    currencyAgency: z.number().int().optional().describe("ID de devise de l'agence"),
    informationComments: z.string().optional().describe("Commentaires"),
    advance: z.number().optional().describe("Avance à reprendre"),
    closed: z.boolean().optional().describe("Clôturer la note de frais"),
    ratePerKilometerTypeReference: z.number().int().optional().describe("Code du barème kilométrique"),
    actualExpenses: z
      .array(ExpenseLineSchema)
      .optional()
      .describe(
        "⚠️ REMPLACE l'intégralité des lignes existantes. Pour ajouter une ligne, relire la note via " +
          "`boond_expenses_get` et renvoyer l'ensemble des lignes. Omettre pour ne toucher qu'aux autres champs."
      ),
  })
  .strict();

export const ExpenseDefaultSchema = z
  .object({
    resourceId: EntityIdSchema.describe("ID de la ressource"),
    term: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .describe("Mois ciblé (YYYY-MM)"),
    agencyId: EntityIdSchema.optional().describe("ID de l'agence (optionnel — déduit de la ressource)"),
  })
  .strict();

export const ExpenseSearchSchema = z
  .object({
    keywords: z.string().optional().describe("Mots-clés de recherche"),
    resourceId: EntityIdSchema.optional().describe("Filtrer par ID ressource (référence keywords COMP<id>)"),
    projectId: EntityIdSchema.optional().describe("Filtrer par ID projet (référence keywords PRJ<id>)"),
    startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
    ...paginationShape,
  })
  .strict();

// ---- Product schemas ----

export const ProductCreateSchema = z
  .object({
    name: z.string().min(1).describe("Nom du produit"),
    reference: z.string().optional().describe("Référence du produit"),
    unitPrice: z.number().optional().describe("Prix unitaire HT"),
    taxRate: z.number().optional().describe("Taux de TVA (%)"),
    state: z.number().int().optional().describe("État du produit"),
    note: z.string().optional().describe("Description du produit"),
  })
  .strict();

export const ProductUpdateSchema = z
  .object({
    id: EntityIdSchema.describe("ID du produit à modifier"),
    name: z.string().optional().describe("Nom du produit"),
    reference: z.string().optional().describe("Référence"),
    unitPrice: z.number().optional().describe("Prix unitaire HT"),
    taxRate: z.number().optional().describe("Taux de TVA (%)"),
    state: z.number().int().optional().describe("État"),
    note: z.string().optional().describe("Description"),
  })
  .strict();

// ---- Positioning schemas ----

export const PositioningCreateSchema = z
  .object({
    candidateId: EntityIdSchema.optional().describe("ID du candidat positionné"),
    resourceId: EntityIdSchema.optional().describe("ID de la ressource positionnée"),
    projectId: EntityIdSchema.optional().describe("ID du projet"),
    opportunityId: EntityIdSchema.optional().describe("ID de l'opportunité"),
    state: stateField(
      "positioning",
      "État du positionnement : ID de `boond://dictionary/states/positionings` (`won` rattache le positionnement à un projet)"
    ),
    startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
    note: z.string().optional().describe("Notes / commentaires"),
  })
  .strict();

export const PositioningSearchSchema = z
  .object({
    keywords: z
      .string()
      .optional()
      .describe(
        "Mots-clés de recherche. L'API y accepte aussi des références d'entités (AO<id>, CAND<id>, COMP<id>...) — les filtres *Id ci-dessous sont convertis automatiquement en de telles références."
      ),
    candidateId: EntityIdSchema.optional().describe(
      "Filtrer par ID candidat (envoyé à l'API comme référence keywords CAND<id>)"
    ),
    resourceId: EntityIdSchema.optional().describe(
      "Filtrer par ID ressource (envoyé à l'API comme référence keywords COMP<id>)"
    ),
    opportunityId: EntityIdSchema.optional().describe(
      "Filtrer par ID opportunité (envoyé à l'API comme référence keywords AO<id>)"
    ),
    companyId: EntityIdSchema.optional().describe(
      "Filtrer par ID société (envoyé à l'API comme référence keywords CSOC<id>)"
    ),
    contactId: EntityIdSchema.optional().describe(
      "Filtrer par ID contact (envoyé à l'API comme référence keywords CCON<id>)"
    ),
    productId: EntityIdSchema.optional().describe(
      "Filtrer par ID produit (envoyé à l'API comme référence keywords PROD<id>)"
    ),
    ...paginationShape,
  })
  .strict();

// ---- Payment schemas ----

// Source: resources/payments/search.raml (filters verified live, issue #248).
export const PaymentSearchSchema = z
  .object({
    keywords: z.string().optional().describe("Mots-clés de recherche"),
    purchaseId: EntityIdSchema.optional().describe("Filtrer par ID achat (référence keywords ACH<id>)"),
    companyId: EntityIdSchema.optional().describe("Filtrer par ID société (référence keywords CSOC<id>)"),
    projectId: EntityIdSchema.optional().describe("Filtrer par ID projet (référence keywords PRJ<id>)"),
    resourceId: EntityIdSchema.optional().describe("Filtrer par ID ressource (référence keywords COMP<id>)"),
    contactId: EntityIdSchema.optional().describe("Filtrer par ID contact (référence keywords CCON<id>)"),
    paymentStates: intArray("IDs d'états de paiement — `boond://dictionary/states/payments`."),
    paymentMethods: paymentMethodsField,
    purchaseTypes: intArray("IDs de types d'achat — `boond://dictionary/typeOf/purchases`."),
    subscriptionTypes: intArray(
      "IDs de types d'abonnement (`setting.typeOf.subscription` via `boond_application_dictionary`)."
    ),
    period: z
      .enum(["created", "updated", "createdPurchase", "subscription", "expected", "performed", "billing"])
      .optional()
      .describe(
        "Champ de date borné par `startDate` / `endDate` : expected (échéance), performed (règlement effectif), created, updated, createdPurchase, subscription, billing."
      ),
    periodDynamic: periodDynamicField,
    startDate: startDateField,
    endDate: endDateField,
    excludeProviderInvoice: z
      .boolean()
      .optional()
      .describe("true = exclure les paiements adossés à une facture fournisseur."),
    deliveryPurchases: z.boolean().optional().describe("true = paiements des achats liés à une prestation uniquement."),
    flags: flagsField,
    ...perimeterShape,
    ...sortedPaginationShape,
  })
  .strict();

export const PaymentCreateSchema = z
  .object({
    purchaseId: EntityIdSchema.describe("ID de l'achat réglé"),
    paymentDate: z.string().optional().describe("Date du paiement (YYYY-MM-DD), mappée vers date"),
    performedDate: z.string().optional().describe("Date de paiement effectif (YYYY-MM-DD)"),
    expectedDate: z.string().optional().describe("Date de paiement attendu (YYYY-MM-DD)"),
    startDate: z.string().optional().describe("Date de début couverte (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("Date de fin couverte (YYYY-MM-DD)"),
    amount: z.number().optional().describe("Montant HT du paiement, mappé vers amountExcludingTax"),
    amountExcludingTax: z.number().optional().describe("Montant HT du paiement"),
    state: stateField("payment", "État du paiement : ID de `boond://dictionary/states/payments`"),
    paymentMethod: z.number().int().optional().describe("Mode de paiement : ID de `boond://dictionary/paymentMethods`"),
    taxRates: z.array(z.number()).optional().describe("Taux de taxes Boond"),
    reference: z.string().optional().describe("Référence bancaire ou règlement"),
    note: z.string().optional().describe("Note interne, mappée vers informationComments"),
  })
  .strict();

// PUT /payments/{id} — issue #252 (write path not exercised, see CLAUDE.md).
export const PaymentUpdateSchema = z
  .object({
    id: EntityIdSchema.describe("ID du paiement à modifier"),
    paymentDate: z.string().optional().describe("Date du paiement (YYYY-MM-DD), mappée vers date"),
    performedDate: z.string().optional().describe("Date de paiement effectif (YYYY-MM-DD) — régulariser un règlement"),
    expectedDate: z.string().optional().describe("Date de paiement attendu (YYYY-MM-DD)"),
    startDate: z.string().optional().describe("Date de début couverte (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("Date de fin couverte (YYYY-MM-DD)"),
    amount: z.number().optional().describe("Montant HT, mappé vers amountExcludingTax"),
    amountExcludingTax: z.number().optional().describe("Montant HT"),
    amountIncludingTax: z.number().optional().describe("Montant TTC"),
    state: stateField("payment", "État du paiement : ID de `boond://dictionary/states/payments`"),
    paymentMethod: z.number().int().optional().describe("Mode de paiement : ID de `boond://dictionary/paymentMethods`"),
    taxRates: z.array(z.number()).optional().describe("Taux de taxes Boond"),
    reference: z.string().optional().describe("Référence bancaire ou règlement (`number`)"),
    note: z.string().optional().describe("Note interne, mappée vers informationComments"),
  })
  .strict();

// ---- Purchase schemas (achats / sous-traitance) ----

export const PurchaseSearchSchema = z
  .object({
    keywords: z.string().optional().describe("Mots-clés de recherche"),
    companyId: EntityIdSchema.optional().describe("Filtrer par ID société (référence keywords CSOC<id>)"),
    projectId: EntityIdSchema.optional().describe("Filtrer par ID projet (référence keywords PRJ<id>)"),
    ...paginationShape,
  })
  .strict();

export const PurchaseCreateSchema = z
  .object({
    title: z.string().optional().describe("Titre de l'achat/sous-traitance"),
    companyId: EntityIdSchema.optional().describe("ID de la société fournisseur"),
    contactId: EntityIdSchema.optional().describe("ID du contact fournisseur"),
    projectId: EntityIdSchema.optional().describe("ID du projet associé"),
    state: stateField("purchase", "État de l'achat : ID de `boond://dictionary/states/purchases`"),
    startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
    note: z.string().optional().describe("Notes / commentaires"),
  })
  .strict();

// PUT /purchases/{id}/information (RAML `purchases/information.raml`, issue #252).
export const PurchaseUpdateSchema = z
  .object({
    id: EntityIdSchema.describe("ID de l'achat à modifier"),
    title: z.string().optional().describe("Titre de l'achat/sous-traitance"),
    typeOf: z.number().int().optional().describe("Type d'achat : ID de `boond://dictionary/typeOf/purchases`"),
    state: stateField("purchase", "État de l'achat : ID de `boond://dictionary/states/purchases`"),
    companyId: EntityIdSchema.optional().describe("ID de la société fournisseur"),
    contactId: EntityIdSchema.optional().describe("ID du contact fournisseur"),
    projectId: EntityIdSchema.optional().describe("ID du projet associé"),
    startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
    quantity: z.number().optional().describe("Quantité"),
    amountExcludingTax: z.number().optional().describe("Montant unitaire HT"),
    taxRate: z.number().optional().describe("Taux de TVA (%) — `boond://dictionary/taxRates`"),
    paymentMethod: z.number().int().optional().describe("Mode de paiement : ID de `boond://dictionary/paymentMethods`"),
    paymentTerm: z
      .number()
      .int()
      .optional()
      .describe("Condition de paiement : ID de `boond://dictionary/paymentTerms`"),
    note: z.string().optional().describe("Notes / commentaires (`informationComments`)"),
  })
  .strict();

// ---- Provider invoice schemas (factures fournisseur) ----

export const ProviderInvoiceSearchSchema = z
  .object({
    keywords: z.string().optional().describe("Mots-clés de recherche"),
    companyId: EntityIdSchema.optional().describe("Filtrer par ID société fournisseur (référence keywords CSOC<id>)"),
    resourceId: EntityIdSchema.optional().describe("Filtrer par ID ressource (référence keywords COMP<id>)"),
    ...paginationShape,
  })
  .strict();

export const ProviderInvoiceCreateSchema = z
  .object({
    reference: z.string().min(1).describe("Référence de la facture fournisseur"),
    resourceId: EntityIdSchema.describe("ID de la ressource portée par la facture fournisseur"),
    companyId: EntityIdSchema.optional().describe("ID de la société fournisseur, mappé vers providerCompany"),
    contactId: EntityIdSchema.optional().describe("ID du contact fournisseur, mappé vers providerContact"),
    invoiceDate: z.string().optional().describe("Date de facture (YYYY-MM-DD)"),
    startDate: z.string().min(1).describe("Date de début de période (YYYY-MM-DD)"),
    endDate: z.string().min(1).describe("Date de fin de période (YYYY-MM-DD)"),
    amountExcludingTax: z.number().optional().describe("Montant HT"),
    amountIncludingTax: z.number().optional().describe("Montant TTC"),
    currency: z.number().optional().describe("Devise Boond"),
    exchangeRate: z.number().optional().describe("Taux de change"),
    currencyAgency: z.number().optional().describe("Devise agence"),
    exchangeRateAgency: z.number().optional().describe("Taux de change agence"),
    state: stateField(
      "providerinvoice",
      "État de la facture fournisseur : ID de `boond://dictionary/states/provider-invoices`"
    ),
  })
  .strict();

// PUT /provider-invoices/{id} — issue #252 (write path not exercised, see CLAUDE.md).
export const ProviderInvoiceUpdateSchema = z
  .object({
    id: EntityIdSchema.describe("ID de la facture fournisseur à modifier"),
    reference: z.string().optional().describe("Référence de la facture fournisseur"),
    invoiceDate: z.string().optional().describe("Date de facture (YYYY-MM-DD)"),
    startDate: z.string().optional().describe("Date de début de période (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("Date de fin de période (YYYY-MM-DD)"),
    dueDate: z.string().optional().describe("Date d'échéance (YYYY-MM-DD)"),
    paidDate: z.string().optional().describe("Date de règlement (YYYY-MM-DD) — marquer la facture payée"),
    amountExcludingTax: z.number().optional().describe("Montant HT"),
    amountIncludingTax: z.number().optional().describe("Montant TTC"),
    state: stateField(
      "providerinvoice",
      "État de la facture fournisseur : ID de `boond://dictionary/states/provider-invoices`"
    ),
  })
  .strict();

// ---- Contract schemas ----

export const ContractCreateSchema = z
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
    note: z.string().optional().describe("Notes / commentaires (`informationComments`)"),
  })
  .strict();

// PUT /contracts/{id} — issue #252 (write path not exercised, see CLAUDE.md).
export const ContractUpdateSchema = z
  .object({
    id: EntityIdSchema.describe("ID du contrat à modifier"),
    typeOf: z.number().int().optional().describe("Type de contrat : ID de `boond://dictionary/typeOf/contracts`"),
    startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD) — prolonger un CDD = repousser cette date"),
    endReason: z.number().int().optional().describe("Motif de fin : ID de `boond://dictionary/contractEndReasons`"),
    probationEndDate: z.string().optional().describe("Fin de période d'essai initiale (YYYY-MM-DD)"),
    renewalProbationEndDate: z.string().optional().describe("Fin de période d'essai renouvelée (YYYY-MM-DD)"),
    monthlySalary: z.number().optional().describe("Salaire mensuel"),
    annualSalary: z.number().optional().describe("Salaire annuel"),
    numberOfWorkingDays: z.number().optional().describe("Nombre de jours ouvrés annuel"),
    note: z.string().optional().describe("Notes / commentaires (`informationComments`)"),
  })
  .strict();

// ---- Advantage schemas ----

// `GET /advantages` does not exist (the RAML only has POST there, and the live
// API answers with a WAF 403 page); advantages are listed per resource via
// `GET /resources/{id}/advantages` (issue #247). Hence a required `resourceId`.
export const AdvantageSearchSchema = z
  .object({
    resourceId: EntityIdSchema.describe(
      "ID de la ressource dont on liste les avantages (route /resources/{id}/advantages)"
    ),
    advantageTypes: strArray(
      "Types d'avantage à conserver, au format `<reference>_<agencyId>` (référence du type + ID d'agence, ex: '2_1')."
    ),
    ...paginationShape,
  })
  .strict();

// ---- Application schemas ----

// ---- Validation schemas ----
// `/validations` requires `startMonth` + `endMonth` (YYYY-MM). Optional filters
// from the official RAML follow.
export const ValidationSearchSchema = z
  .object({
    startMonth: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .describe("Mois de début YYYY-MM. Requis."),
    endMonth: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .describe("Mois de fin YYYY-MM. Requis."),
    keywords: z
      .string()
      .optional()
      .describe("Mots-clés. Préfixes acceptés : 'TPS' (CRA), 'EXP' (frais), 'ABS' (absence), 'COMP' (ressource)."),
    documentTypes: z
      .array(z.enum(["absencesReport", "timesReport", "expensesReport"]))
      .optional()
      .describe("Types de documents à valider."),
    resourceTypes: z
      .array(z.number().int())
      .optional()
      .describe("IDs de types de ressource (dictionnaire setting.typeOf.resource)."),
    validationStates: z
      .array(z.enum(["waitingForValidation", "validated", "rejected"]))
      .optional()
      .describe("États de validation."),
    validationAlerts: z.boolean().optional().describe("Filtrer sur les validations avec alertes."),
    ...paginationShape,
  })
  .strict();

// ---- Notification schemas ----
// `/notifications` requires the singular `category` (activity/thread/corporate)
// per the official RAML. Optional `state` filters read/unread; `parentType`
// narrows by entity module.
export const NotificationSearchSchema = z
  .object({
    category: z
      .enum(["activity", "thread", "corporate"])
      .describe(
        "Catégorie (requis): 'activity' (notifications d'activité), 'thread' (messages), 'corporate' (annonces)."
      ),
    state: z.enum(["new", "read"]).optional().describe("Filtrer par état de lecture."),
    parentType: z
      .array(z.string())
      .optional()
      .describe("Types de modules parents (ex: 'contract', 'global', 'project'...)."),
    ...paginationShape,
  })
  .strict();

// ---- Reporting schemas ----
// Sources (one search.raml per endpoint):
//   https://doc.boondmanager.com/api-externe/raml-build/resources/reportingCompanies/search.raml
//   .../reportingProjects/search.raml  .../reportingResources/search.raml
//   .../reportingSynthesis/search.raml .../reportingProductionPlans/search.raml
// Every reporting endpoint carries the `searchable` trait (perimeter filters)
// plus endpoint-specific filters. These were previously dropped — only
// startDate/endDate/keywords were forwarded — so a "filtered" reporting query
// silently returned the full perimeter. Each tool now exposes its real filters.
//
// `period`/`periodDynamic` value sets are large and differ slightly per endpoint,
// so they stay `z.string()` (documented in the description) rather than a strict
// enum that could reject a value the API actually accepts. The small, stable
// enums (reportingCategory, reportingType, positioningPeriod, useCache) are typed.
const reportingPeriodField = z
  .string()
  .optional()
  .describe(
    "Découpage temporel : 'onePeriod' (unique, entre startDate/endDate), 'dynamicPeriod' (selon periodDynamic), " +
      "'monthly' (6 mois depuis startDate), 'quarterly', 'semiAnnual', 'annual'. La synthèse accepte aussi 'weekly'."
  );
const reportingPeriodDynamicField = z
  .string()
  .optional()
  .describe(
    "Période dynamique relative à aujourd'hui (avec period='dynamicPeriod') : today, thisWeek, thisMonth, " +
      "thisTrimester, thisSemester, thisYear, thisFiscalYear, yesterday, lastWeek, lastMonth, lastTrimester, " +
      "lastSemester, lastYear, lastFiscalYear, tomorrow, nextWeek, nextMonth, nextTrimester, nextSemester, " +
      "nextYear, nextFiscalYear, lastCustomPeriod, nextCustomPeriod."
  );
const reportingPeriodDynamicParametersField = z
  .string()
  .optional()
  .describe("Paramètres de la période personnalisée (utilisé avec periodDynamic=lastCustomPeriod/nextCustomPeriod).");
const reportingScorecardsField = strArray("IDs des scorecards (indicateurs) à retourner.");
const reportingUseCacheField = z
  .enum(["withCache", "withoutCache"])
  .optional()
  .describe("Cache de reporting : 'withCache' (valeurs mises en cache) ou 'withoutCache' (recalcul, défaut).");
const reportingResourcesField = entityIdArray("Filtrer sur ces IDs de ressources.");
const reportingProjectsField = entityIdArray("Filtrer sur ces IDs de projets.");
const reportingContactsField = entityIdArray("Filtrer sur ces IDs de contacts.");
const reportingCompaniesField = entityIdArray("Filtrer sur ces IDs de sociétés.");
const reportingMaxField = (entity: string) =>
  z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe(`Nombre de ${entity} par page (1-10, défaut 1). Le nombre de résultats = ${entity} × indicateurs.`);

// Perimeter + period filters shared by every reporting endpoint (searchable trait).
const reportingCommonFields = {
  keywords: z.string().optional().describe("Mots-clés."),
  perimeterManagers: perimeterManagersField,
  perimeterAgencies: perimeterAgenciesField,
  perimeterPoles: perimeterPolesField,
  perimeterBusinessUnits: perimeterBusinessUnitsField,
  perimeterDynamic: perimeterDynamicField,
  narrowPerimeter: narrowPerimeterField,
  periodDynamic: reportingPeriodDynamicField,
  periodDynamicParameters: reportingPeriodDynamicParametersField,
  scorecards: reportingScorecardsField,
  useCache: reportingUseCacheField,
  page: pageField,
  pageSize: pageSizeField,
};

const requiredDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe(`${label} (YYYY-MM-DD). Requis par l'API.`);
const optionalDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(`${label} (YYYY-MM-DD).`);

export const ReportingCompaniesSchema = z
  .object({
    ...reportingCommonFields,
    startDate: requiredDate("Date de début"),
    endDate: requiredDate("Date de fin"),
    companiesStates: intArray("IDs d'états de sociétés (dictionnaire setting.state.company)."),
    maxCompanies: reportingMaxField("sociétés"),
    showPercentage: z.boolean().optional().describe("Afficher les valeurs en pourcentage plutôt qu'en valeur réelle."),
    companies: reportingCompaniesField,
  })
  .strict();

export const ReportingProjectsSchema = z
  .object({
    ...reportingCommonFields,
    startDate: optionalDate("Date de début"),
    endDate: optionalDate("Date de fin"),
    projectTypes: intArray("IDs de types de projets (dictionnaire setting.typeOf.project)."),
    projectStates: intArray("IDs d'états de projets (dictionnaire setting.state.project)."),
    maxProjects: reportingMaxField("projets"),
    resources: reportingResourcesField,
    projects: reportingProjectsField,
    contacts: reportingContactsField,
    companies: reportingCompaniesField,
  })
  .strict();

export const ReportingResourcesSchema = z
  .object({
    ...reportingCommonFields,
    startDate: optionalDate("Date de début"),
    endDate: optionalDate("Date de fin"),
    reportingCategory: z
      .enum(["showByResources", "showByPeriods"])
      .optional()
      .describe("Vue : 'showByResources' (défaut, sans returnedPeriod) ou 'showByPeriods' (returnedPeriod requis)."),
    maxResources: reportingMaxField("ressources"),
    resourceTypes: intArray("IDs de types de ressources (dictionnaire setting.typeOf.resource)."),
    resourceStates: intArray("IDs d'états de ressources (dictionnaire setting.state.resource)."),
    period: reportingPeriodField,
    resources: reportingResourcesField,
    projects: reportingProjectsField,
    contacts: reportingContactsField,
    companies: reportingCompaniesField,
  })
  .strict();

export const ReportingSynthesisSchema = z
  .object({
    ...reportingCommonFields,
    startDate: requiredDate("Date de début"),
    endDate: optionalDate("Date de fin"),
    reportingType: z
      .enum(["realData", "targetsData"])
      .optional()
      .describe("Type de données : 'realData' (défaut, réel) ou 'targetsData' (objectifs)."),
    reportingCategory: z
      .enum([
        "commercialSynthesis",
        "humanResourcesSynthesis",
        "recruitmentSynthesis",
        "activityExpensesSynthesis",
        "billingSynthesis",
        "globalSynthesis",
      ])
      .optional()
      .describe(
        "Catégorie de synthèse (défaut 'commercialSynthesis') : commercial, RH, recrutement, activité & frais, " +
          "facturation, ou globale. `resources` n'est pas disponible hors d'une vue par ressources."
      ),
    period: reportingPeriodField,
    resources: reportingResourcesField,
    projects: reportingProjectsField,
    contacts: reportingContactsField,
    companies: reportingCompaniesField,
    compareIndicators: strArray("Indicateurs à comparer entre deux périodes."),
    compareIndicatorsPeriod: z
      .string()
      .optional()
      .describe("Période de comparaison des indicateurs (défaut 'period')."),
  })
  .strict();

export const ReportingProductionPlansSchema = z
  .object({
    ...reportingCommonFields,
    startDate: requiredDate("Date de début"),
    endDate: requiredDate("Date de fin"),
    resourceTypes: intArray("IDs de types de ressources (dictionnaire setting.typeOf.resource)."),
    resourceStates: intArray("IDs d'états de ressources (dictionnaire setting.state.resource)."),
    positioningStates: intArray("IDs d'états de positionnement (dictionnaire setting.state.positioning)."),
    positioningPeriod: z
      .enum(["created", "running"])
      .optional()
      .describe("'created' (positionnements créés entre les dates, défaut) ou 'running' (en cours sur la période)."),
    showContracts: z.boolean().optional().describe("Afficher les contrats associés."),
    projects: reportingProjectsField,
    contacts: reportingContactsField,
    companies: reportingCompaniesField,
  })
  .strict();

export const DictionaryGetSchema = z
  .object({
    dictionaryType: z
      .string()
      .min(1)
      .describe(
        "Chemin dotté relatif à `data` de /application/dictionary (ex: setting.state.resource, setting.typeOf.project, setting.action.candidate, setting.tool, country, languages). La forme « states/resources » (slash) n'est pas valide."
      ),
  })
  .strict();

// ---- Documents ----
// Source: https://doc.boondmanager.com/api-externe/raml-build/resources/documents/search.raml
// L'upload passe par `fileUrl` uniquement : l'API BoondManager télécharge le
// fichier elle-même, le serveur MCP ne bufferise jamais d'octets de fichier
// (et n'expose pas de lecture du système de fichiers local).
export const DocumentParentTypes = [
  "action",
  "resourceResume",
  "candidateResume",
  "resource",
  "candidate",
  "expensesReport",
  "timesReport",
  "absencesReport",
  "payment",
  "company",
  "project",
  "order",
  "product",
  "purchase",
  "delivery",
  "groupment",
  "inactivity",
  "positioning",
  "followeddocument",
  "appentity",
  "contract",
  "invoice",
  "providerinvoice",
] as const;

export const DocumentCreateSchema = z
  .object({
    parentType: z
      .enum(DocumentParentTypes)
      .describe(
        "Type d'entité parente. Notables : 'candidateResume' (CV de candidat), 'resourceResume' (CV de ressource), " +
          "'candidate'/'resource' (dossier administratif), 'company', 'project', 'invoice'..."
      ),
    parentId: z.number().int().min(1).describe("ID de l'entité parente"),
    fileUrl: z
      .string()
      .url()
      .describe("URL (https) du fichier à téléverser — BoondManager télécharge le fichier depuis cette URL."),
    parsing: z
      .boolean()
      .optional()
      .describe("Lancer le parsing IA du CV après upload (uniquement pour parentType=candidateResume)."),
  })
  .strict();

export type SearchInput = z.infer<typeof SearchSchema>;
export type ResourceSearchInput = z.infer<typeof ResourceSearchSchema>;
export type CandidateSearchInput = z.infer<typeof CandidateSearchSchema>;
export type ContactSearchInput = z.infer<typeof ContactSearchSchema>;
export type CompanySearchInput = z.infer<typeof CompanySearchSchema>;
export type OpportunitySearchInput = z.infer<typeof OpportunitySearchSchema>;
export type ProjectSearchInput = z.infer<typeof ProjectSearchSchema>;
export type IdInput = z.infer<typeof IdSchema>;
export type IdTabInput = z.infer<typeof IdTabSchema>;
export type DocumentIdInput = z.infer<typeof DocumentIdSchema>;
export type ResourceTimesheetInput = z.infer<typeof ResourceTimesheetSchema>;
export type TimesheetSearchInput = z.infer<typeof TimesheetSearchSchema>;
export type TimesheetGetInput = z.infer<typeof TimesheetGetSchema>;
export type DictionaryGetInput = z.infer<typeof DictionaryGetSchema>;
export type ResourceTechnicalDataUpdateInput = z.infer<typeof ResourceTechnicalDataUpdateSchema>;
export type ReferenceCreateInput = z.infer<typeof ReferenceCreateSchema>;
export type ReferenceUpdateInput = z.infer<typeof ReferenceUpdateSchema>;
export type ReferenceIdInput = z.infer<typeof ReferenceIdSchema>;
export type DocumentCreateInput = z.infer<typeof DocumentCreateSchema>;
export type ReportingCompaniesInput = z.infer<typeof ReportingCompaniesSchema>;
export type ReportingProjectsInput = z.infer<typeof ReportingProjectsSchema>;
export type ReportingResourcesInput = z.infer<typeof ReportingResourcesSchema>;
export type ReportingSynthesisInput = z.infer<typeof ReportingSynthesisSchema>;
export type ReportingProductionPlansInput = z.infer<typeof ReportingProductionPlansSchema>;
export type ExpenseLineInput = z.infer<typeof ExpenseLineSchema>;
export type ExpenseCreateInput = z.infer<typeof ExpenseCreateSchema>;
export type ExpenseUpdateInput = z.infer<typeof ExpenseUpdateSchema>;
export type ExpenseDefaultInput = z.infer<typeof ExpenseDefaultSchema>;
export type ContractSearchInput = z.infer<typeof ContractSearchSchema>;
