/**
 * Server-level instructions advertised to the client in the `initialize`
 * result (`ServerOptions.instructions`, MCP 2025-11-25).
 *
 * Scope: **cross-cutting rules only**. With ~180 tools, anything that applies
 * to every search tool belongs here once instead of being duplicated in each
 * description (which the model pays for in the tools[] list on every turn).
 * Per-tool specifics stay in the tool descriptions and in `src/schemas/index.ts`.
 *
 * Budget: capped and tested in `src/tools/descriptions.test.ts`
 * (`MAX_SERVER_INSTRUCTIONS_LENGTH`) — these instructions compete with the
 * tool catalogue for the same context window.
 */
export const SERVER_INSTRUCTIONS = `Accès aux données ERP/CRM BoondManager (API JSON:API) : candidats, ressources (consultants), contacts, sociétés, opportunités, projets, CRA, factures, achats…

## Nommage des outils

\`boond_{domaine}_{opération}\` — opérations : \`search\`, \`get\`, \`create\`, \`update\`, \`delete\`. Les onglets d'une fiche sont des outils distincts : \`boond_{domaine}_{onglet}\` (ex. \`boond_resources_technical_data\`). Workflow habituel : un \`search\` pour obtenir l'id, puis \`get\` ou l'onglet voulu pour le détail.

## Périmètre : le piège le plus fréquent

Les schémas de recherche sont \`.strict()\` — un nom de filtre inconnu est **rejeté** par une erreur de validation, jamais ignoré silencieusement. \`mainManagers\`, \`agencies\`, \`poles\` et \`businessUnits\` n'existent pas. Utiliser :

- « mes données / mon équipe / mon agence » → \`perimeterDynamic\` : \`["data"]\` (mes données), \`["managers"]\` (mon N-1), \`["agencies"]\`, \`["poles"]\`, \`["businessUnits"]\`
- « l'équipe de X » → \`perimeterManagers: [<id de X>]\`
- périmètre organisationnel explicite → \`perimeterAgencies\` / \`perimeterPoles\` / \`perimeterBusinessUnits\`, à combiner avec \`narrowPerimeter: true\` pour un ET logique

## Cibler une entité liée

Préfixes acceptés dans \`keywords\` : \`CSOC<id>\` (société), \`CCON<id>\` (contact), \`CAND<id>\` (candidat), \`COMP<id>\` (ressource), \`AO<id>\` (opportunité), \`PRJ<id>\` (projet), \`MIS<id>\` (mission), \`PROD<id>\` (produit), \`CTR<id>\` (contrat) — ex. \`keywords: "CSOC42"\`. \`keywordsType\` restreint la recherche à un champ précis (\`lastName\`, \`fullName\` avec \`"NOM#PRENOM"\`, \`emails\`, \`phones\`, \`title\`…) ; sans lui, la recherche porte sur le CV / le texte intégral.

## Économie de contexte

- \`pageSize\` : défaut 30, maximum 500. \`page\` est plafonné à 100 : au-delà, affiner les filtres plutôt que paginer.
- \`fields: ["title", "updateDate", …]\` (les 6 outils de recherche principaux) remplace le résumé d'une ligne par les seuls attributs demandés — à utiliser dès qu'une page de résultats est large.

## États et types

Ces filtres attendent des identifiants **entiers**, propres à chaque endpoint (\`resourceStates\`, \`candidateStates\`, \`opportunityStates\`, \`projectStates\`, ou \`states\` / \`typesOf\` pour contacts et sociétés). Pour les traduire en libellés, lire les ressources \`boond://dictionary/*\` (states, typeOf, countries, currencies, languages) plutôt que d'appeler \`boond_application_dictionary\` : même contenu, sans consommer un appel d'outil.`;
