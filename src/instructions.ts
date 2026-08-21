/**
 * Server-level instructions advertised to the client in the `initialize`
 * result (`ServerOptions.instructions`, MCP 2025-11-25).
 *
 * Scope: **cross-cutting rules only**. With ~180 tools, anything that applies
 * to every search tool belongs here once instead of being duplicated in each
 * description (which the model pays for in the tools[] list on every turn).
 * Per-tool specifics stay in the tool descriptions and in `src/schemas/index.ts`.
 *
 * Rule of thumb when editing: a statement belongs here only if it is true of
 * *every* tool it appears to cover. A filter that exists on six endpoints and
 * not on the other thirty-two is a per-tool fact — stating it here as universal
 * makes the model emit calls that either get a Zod rejection or, worse, come
 * back empty and read as a real answer.
 *
 * Budget: capped and tested in `src/tools/descriptions.test.ts`
 * (`MAX_SERVER_INSTRUCTIONS_LENGTH`) — these instructions compete with the
 * tool catalogue for the same context window.
 */
export const SERVER_INSTRUCTIONS = `Accès aux données ERP/CRM BoondManager (API JSON:API) : candidats, ressources (consultants), contacts, sociétés, opportunités, projets, CRA, factures, achats…

## Nommage des outils

\`boond_{domaine}_{opération}\` — opérations : \`search\`, \`get\`, \`create\`, \`update\`, \`delete\`. Les onglets d'une fiche sont des outils distincts : \`boond_{domaine}_{onglet}\` (ex. \`boond_resources_technical_data\`). Workflow habituel : un \`search\` pour obtenir l'id, puis \`get\` ou l'onglet voulu pour le détail.

## Les filtres sont propres à chaque endpoint

Le schéma de chaque outil est la référence : **ne pas transposer un filtre d'un endpoint à un autre**. Les schémas sont \`.strict()\`, donc un nom inconnu est rejeté par une erreur de validation — mais ce rejet a deux causes possibles : mauvais nom de filtre, **ou** filtre non supporté par cet endpoint. Dans le second cas, ne pas réessayer avec des variantes : reprendre la recherche avec les filtres que le schéma expose (souvent \`keywords\` seul), ou filtrer côté client après lecture.

## Périmètre (les 6 recherches principales + \`boond_reporting_*\`)

Sur \`resources\`, \`candidates\`, \`contacts\`, \`companies\`, \`opportunities\`, \`projects\` et le reporting — pas sur les domaines de référence/administration :

- « mes données / mon équipe / mon agence » → \`perimeterDynamic\` : \`["data"]\` (mes données), \`["managers"]\` (mon N-1), \`["agencies"]\`, \`["poles"]\`, \`["businessUnits"]\`
- « l'équipe de X » → \`perimeterManagers: [<id de X>]\`
- périmètre organisationnel explicite → \`perimeterAgencies\` / \`perimeterPoles\` / \`perimeterBusinessUnits\`, à combiner avec \`narrowPerimeter: true\` pour un ET logique

\`mainManagers\`, \`agencies\`, \`poles\`, \`businessUnits\` n'existent sur aucun endpoint.

## Cibler une entité liée

Vocabulaire des préfixes de \`keywords\` : \`CSOC<id>\` (société), \`CCON<id>\` (contact), \`CAND<id>\` (candidat), \`COMP<id>\` (ressource), \`AO<id>\` (opportunité), \`PRJ<id>\` (projet), \`MIS<id>\` (mission), \`PROD<id>\` (produit), \`CTR<id>\` (contrat) — ex. \`keywords: "CSOC42"\`.

**Chaque endpoint n'en accepte qu'un sous-ensemble, énuméré dans la description de l'outil.** \`keywords\` étant du texte libre, un préfixe non supporté n'est pas rejeté : il part en recherche plein texte et renvoie 0 résultat. Une page vide après un préfixe hors liste ne veut donc pas dire « aucune entité liée » — vérifier la description de l'outil avant de conclure.

\`keywordsType\` (recherches \`resources\`, \`candidates\`, \`contacts\`, \`companies\` uniquement) restreint \`keywords\` à un champ ; les valeurs admises diffèrent par endpoint (\`lastName\`/\`fullName\`/\`titleSkills\`… sur les personnes, \`name\`/\`phones\`/\`emails\` sur les sociétés) — lire l'énumération du schéma. Sans lui, la recherche porte sur le champ par défaut de l'endpoint (CV ou texte intégral).

## Économie de contexte

- \`pageSize\` : défaut 30, maximum 500. \`page\` est plafonné à 100 : au-delà, affiner les filtres plutôt que paginer.
- \`fields: ["title", "updateDate", …]\` remplace le résumé d'une ligne par les seuls attributs demandés — à utiliser dès qu'une page de résultats est large. Disponible sur les outils de recherche, sauf \`boond_timesheets_search\` et \`boond_reporting_*\`.
- Fiche complète d'une entité connue : lire la ressource \`boond://{candidate|resource|contact|company|opportunity|project}/<id>\` (fiche + informations + compétences en une lecture) plutôt que d'enchaîner \`_get\` puis les outils d'onglet.

## États et types

Ces filtres attendent des identifiants **entiers** et leur nom est propre à l'endpoint : \`resourceStates\`, \`candidateStates\`, \`opportunityStates\`, \`projectStates\`, \`states\` + \`typesOf\` (contacts), \`states\` seul (sociétés — il n'y a pas de filtre de type sur \`/companies\`). Pour les traduire en libellés, lire les ressources \`boond://dictionary/*\` (states, typeOf, countries, currencies, languages) plutôt que d'appeler \`boond_application_dictionary\` : même contenu, sans consommer un appel d'outil.`;
