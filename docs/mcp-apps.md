# MCP Apps — interfaces interactives

Ce serveur implémente **MCP Apps**, la première extension officielle du
protocole MCP (`io.modelcontextprotocol/ui`, spécification `2026-01-26`). Un
outil peut désigner une ressource `ui://` servie en
`text/html;profile=mcp-app` ; le client la rend dans une iframe sandboxée, et
l'iframe reparle à l'hôte en JSON-RPC 2.0 par-dessus `postMessage`, avec accès à
`tools/call` et `resources/read`.

Aujourd'hui une seule UI est livrée : le **tableau de bord reporting**.

---

## Ce qui est exposé

| | |
|---|---|
| Ressource | `ui://boond/reporting` (`text/html;profile=mcp-app`) |
| Outil | `boond_reporting_dashboard` (`_meta.ui.resourceUri` → la ressource) |
| Outils rappelables par l'app | les 5 `boond_reporting_*` + les `boond_{projects,companies,resources}_get` |
| Réseau sortant depuis l'iframe | **aucun** — CSP vide, données uniquement via `tools/call` |
| Permissions navigateur demandées | **aucune** |

`boond_reporting_dashboard` interroge l'un des cinq endpoints
`/reporting-*` selon son argument `report`, puis **pivote** la réponse.

### Pourquoi un pivot serveur

Les endpoints de reporting répondent en format long : une ligne JSON:API par
couple (entité × indicateur), avec `attributes.scorecard.reference`,
`attributes.value` (toujours une chaîne) et `relationships.dependsOn` vers
l'entité. Une page de 2 projets = 54 lignes. Le handler reconstruit le tableau
attendu — entités en lignes, indicateurs en colonnes — et le renvoie en
`structuredContent`. Trois formes réelles, deux mises en page :

| Endpoint | Forme de la réponse | `layout` |
|---|---|---|
| `/reporting-projects`, `-resources`, `-companies` | indicateurs **avec** `dependsOn` | `entities` (pivot) |
| `/reporting-synthesis` | indicateurs **sans** `dependsOn` (KPIs globaux) | `indicators` (1 ligne par KPI, colonnes `value`/`target`) |
| `/reporting-production-plans` | entités brutes, pas de scorecard | `entities` (colonnes = attributs) |

Deux détails que le pivot doit respecter, et qui ont chacun un test :

- deux indicateurs peuvent partager une `reference` et ne différer que par
  `scorecard.dictionaryId` (`numberOfOpportunitiesPerStates` est émis une fois
  par état) — les replier sur la même colonne perdrait toutes les valeurs sauf
  la dernière ;
- `meta.totals.rows` compte les **lignes d'indicateurs**, `meta.totals.dependsOn`
  compte les **entités** : une fois pivoté, c'est le second qui est le « total ».

## Dégradation gracieuse

Ce n'est pas une option, c'est un prérequis testé.

- L'outil est enregistré **inconditionnellement**. Les capacités du client ne
  sont connues qu'après `initialize`, alors que l'enregistrement a lieu à la
  construction du serveur — et en HTTP stateless un `McpServer` neuf est créé à
  chaque POST, donc il n'y a pas de session dans laquelle ré-enregistrer.
  `_meta.ui.resourceUri` est simplement inerte pour un hôte qui n'implémente pas
  l'extension.
- Le handler renvoie **toujours** un tableau Markdown lisible (`content`) *et*
  le `structuredContent` typé.
- La capacité client n'est consultée (`clientSupportsUi()`) que pour la partie
  *additive* : attacher un bloc `resource_link` vers `ui://boond/reporting`, qui
  ne serait que du bruit pour un client incapable de le lire.

## Contrainte CSP

L'hôte rend la page dans une iframe sandboxée dont la politique de base est
`default-src 'none'`, script et style limités à `'self' 'unsafe-inline'`. Ce
serveur ne déclare **aucun** domaine autorisé
(`connectDomains`/`resourceDomains`/`frameDomains`/`baseUriDomains` vides), donc
tout ce que la page tenterait de charger serait bloqué — silencieusement, et
seulement chez le client.

`src/ui/index.test.ts` déplace cette panne au build : l'asset est refusé s'il
contient un `<script src=`, un `<link href=`, un `@import`, une URL distante
(hors espace de noms SVG), un `fetch`/`XMLHttpRequest`/`WebSocket`, ou une
affectation de balisage (`innerHTML`, `document.write`, `eval`).

## Sécurité

- **Aucune donnée BoondManager n'est interpolée dans le HTML côté serveur.**
  L'asset est un fichier statique ; la donnée arrive exclusivement par
  `tools/call` et est insérée via `textContent` / `document.createElement`,
  jamais via `innerHTML`. Les noms de sociétés, références de projets et notes
  CRM sont du contenu utilisateur : ils doivent atteindre le DOM en tant que
  texte.
- Aucune permission navigateur n'est demandée (caméra, micro, géolocalisation,
  presse-papier).
- La seule sortie hors du bac à sable est `ui/open-link`, proposée uniquement
  quand l'hôte annonce la capacité `openLinks`, et vers une URL construite à
  partir de `webAppBaseUrl` (dérivé de `BOOND_BASE_URL`) — pas d'URL venant de
  la donnée.

## Politique d'accès

Les ressources de référence (`boond://dictionary/*`, `current-user`) ne sont
**jamais** filtrées : c'est le substrat de résolution, utile quels que soient
les outils exposés. Les ressources `ui://` sont l'exception explicite : ce sont
les surfaces de rendu d'un domaine précis. `ui://boond/reporting` suit donc le
domaine `reporting` — `BOOND_MCP_EXCLUDE_DOMAINS=reporting` (ou une allow-list
qui ne le contient pas) la retire aussi, sinon le client listerait une UI qu'aucun
outil ne peut alimenter.

## Tester

### Dans Claude Desktop / Claude Code

Installer le serveur normalement, puis demander par exemple :

> Montre-moi le reporting projets du 1er janvier au 30 juin 2026

Le dashboard doit s'afficher : sélecteur de reporting, tableau triable (clic ou
`Entrée` sur un en-tête), graphe à barres, clic sur une ligne pour la fiche
détaillée, bouton « Ouvrir dans BoondManager ».

### Avec MCPJam / MCP Inspector

`resources/read` sur `ui://boond/reporting` doit renvoyer un unique contenu en
`text/html;profile=mcp-app` avec `_meta.ui`. `tools/list` doit montrer
`_meta.ui.resourceUri` sur `boond_reporting_dashboard`.

### Vérifier l'absence de requête sortante

Onglet Réseau du client pendant le rendu : l'iframe ne doit émettre aucune
requête. Le seul trafic est celui du serveur MCP vers l'API BoondManager.

## Ajouter une UI

1. Écrire `src/ui/assets/<nom>.html` — autonome (CSS et JS inline), thème clair
   **et** sombre (`prefers-color-scheme` **et** `[data-theme]`, l'hôte annonce le
   sien dans `hostContext.theme`), navigable au clavier.
2. Ajouter une entrée à `UI_RESOURCES` dans `src/ui/index.ts` (`name`, `uri`,
   `title`, `description`, `asset`, `domain`). Le domaine détermine le filtrage
   par la politique d'accès.
3. Sur l'outil qui la rend : `_meta: appToolMeta({ resourceUri, visibility: ["model", "app"] })`,
   un `outputSchema` dédié (l'app est un consommateur typé), et un `content`
   texte qui reste exploitable sans UI.
4. Sur les outils que l'app doit pouvoir rappeler :
   `_meta: appToolMeta({ visibility: ["model", "app"] })`.
5. `npm run docs:tools` (TOOLS.md liste les ressources `ui://` à part) puis
   `npm test`. La boucle de garde CSP de `src/ui/index.test.ts` s'applique
   automatiquement au nouvel asset.

## Notes d'implémentation

- **Le pont JSON-RPC de la page est écrit à la main** (~80 lignes). L'asset doit
  tenir dans un seul fichier autonome et le dépôt n'a pas de bundler ; le format
  de fil est du JSON-RPC 2.0 en clair vers `window.parent`, exactement ce
  qu'implémente le `PostMessageTransport` de `@modelcontextprotocol/ext-apps`.
  Le paquet officiel est bien utilisé, mais côté serveur (`registerAppResource`,
  `getUiCapability`, `RESOURCE_MIME_TYPE`, `RESOURCE_URI_META_KEY`).
- **Les types du paquet ne sont pas importables** :
  `@modelcontextprotocol/ext-apps@1.7.5` réexporte ses types via un
  `export * from "./types"` sans extension, ce que la résolution `Node16` de ce
  projet ne résout pas — le type s'effondre silencieusement en `any`. Les deux
  objets réellement émis sont donc retypés dans `src/ui/index.ts` et épinglés
  champ par champ par les tests. À supprimer quand l'amont corrigera ses
  réexports.
- **L'asset est copié dans `dist/` par `scripts/copy-ui-assets.mjs`** (branché
  sur `npm run build`), pour que le même chemin relatif résolve depuis `src/`
  sous vitest et depuis `dist/` à l'exécution. Il est présent dans le tarball npm
  (`files: ["dist"]`) et dans le bundle `.mcpb`.
- **Limite connue** : `production_plans` renvoie des ressources dont l'essentiel
  (livraisons, positionnements) est dans `relationships`/`included` ; le tableau
  n'affiche que leurs attributs propres. Un calendrier interactif dédié est la
  suite prévue.
