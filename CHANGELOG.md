# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

Première UI interactive : le serveur implémente **MCP Apps** (`io.modelcontextprotocol/ui`), la première extension officielle du protocole ([#169](https://github.com/fauguste/boondmanager-mcp-server/issues/169)). Catalogue : **181 outils, 11 prompts, 22 ressources + 1 ressource UI**.

### Added

- **Tableau de bord reporting interactif** (`ui://boond/reporting` + `boond_reporting_dashboard`). Sur les clients qui implémentent MCP Apps (Claude web et desktop, ChatGPT, VS Code Copilot, Cursor, Goose, MCPJam…), un appel du nouvel outil rend un dashboard dans une iframe sandboxée : tri par colonne (souris **et** clavier), graphe à barres SVG, changement de reporting et de période, clic sur une ligne pour la fiche détaillée, bouton « Ouvrir dans BoondManager ». Le drill-down et le changement de reporting passent par `tools/call` **sans repasser par le modèle**.
- **La donnée de reporting est enfin pivotée.** Les cinq endpoints `/reporting-*` répondent en format long : une ligne JSON:API par couple (entité × indicateur) — une page de 2 projets fait 54 lignes. `boond_reporting_dashboard` reconstruit le tableau attendu (entités en lignes, indicateurs en colonnes) et le renvoie en `structuredContent` typé par un `outputSchema` dédié — l'app en est un consommateur typé, contrairement aux outils `get` qui restent volontairement en texte seul. Trois formes réelles de réponse sont couvertes : indicateurs **avec** `dependsOn` (projets, ressources, sociétés → pivot), **sans** (synthèse → une ligne par KPI avec colonnes valeur/cible), et entités brutes sans scorecard (plans de production). Deux pièges de l'API sont traités et testés : deux indicateurs peuvent partager une `reference` en ne différant que par `scorecard.dictionaryId` (`numberOfOpportunitiesPerStates` est émis une fois par état — les replier perdrait toutes les valeurs sauf une), et `meta.totals.rows` compte les lignes d'indicateurs alors que `meta.totals.dependsOn` compte les entités, seul « total » qui ait un sens une fois pivoté.
- **`max`, un plafond de pagination uniforme** sur le dashboard, mappé vers `maxProjects` / `maxResources` / `maxCompanies` selon le `report` choisi ; les filtres non acceptés par l'endpoint sélectionné ne sont **pas transmis** (l'API les ignorerait en silence, et une liste non filtrée serait présentée comme filtrée). Les endpoints qui exigent `startDate` + `endDate` sont refusés avec un message explicite plutôt que renvoyés vers un 422 de l'API.
- `_meta.ui.visibility: ["model", "app"]` sur les cinq outils `boond_reporting_*` : l'app peut les rappeler pour le drill-down. Sans effet sur les clients qui n'implémentent pas l'extension.

### Changed

- `npm run build` exécute désormais `scripts/copy-ui-assets.mjs` après `tsc` : `src/ui/assets/*.html` est copié dans `dist/ui/assets/`, pour que le même chemin relatif résolve depuis `src/` sous vitest et depuis `dist/` à l'exécution. L'asset est présent dans le tarball npm et dans le bundle `.mcpb` (vérifié). Les builds navigateur/React de `@modelcontextprotocol/ext-apps` — inutilisés côté serveur — sont exclus du `.mcpb` (~700 Ko).
- `TOOLS.md` liste les ressources `ui://` dans une section distincte, avec l'outil qui les rend : ce ne sont pas des dictionnaires.
- **Les ressources `ui://` sont filtrées par la politique d'accès**, exception explicite à l'invariant « les ressources ne sont jamais filtrées ». Cet invariant vise le substrat de résolution (dictionnaires, `current-user`), utile quels que soient les outils exposés ; une ressource `ui://` est la surface de rendu d'un domaine précis, et l'annoncer alors que `BOOND_MCP_DOMAINS` masque le reporting listerait une UI qu'aucun outil ne peut alimenter.

### Security

- **Aucune donnée BoondManager n'est interpolée dans le HTML côté serveur.** L'asset est statique ; la donnée arrive exclusivement par `tools/call` et est insérée via `textContent`, jamais `innerHTML` — les noms de sociétés, références de projets et notes CRM sont du contenu utilisateur.
- **CSP sans aucun domaine autorisé** (`connectDomains`/`resourceDomains`/`frameDomains`/`baseUriDomains` vides) et **aucune permission navigateur demandée**. Comme une violation serait silencieuse et ne se verrait que chez le client, `src/ui/index.test.ts` la déplace au build : l'asset est refusé s'il contient un `<script src=`, un `<link href=`, un `@import`, une URL distante (hors espace de noms SVG), un `fetch`/`XMLHttpRequest`/`WebSocket`, ou une affectation de balisage (`innerHTML`, `document.write`, `eval`).

### Documentation

- Nouveau `docs/mcp-apps.md` : ce qui est exposé, pourquoi le pivot est fait côté serveur, la dégradation gracieuse, le contrat CSP, la politique d'accès, comment tester (Claude Desktop / MCPJam), et la procédure pour ajouter une UI.
- `README.md` : section *Tableau de bord interactif (MCP Apps)* avec capture d'écran (données anonymisées).
- `CLAUDE.md` : nouvelle section *MCP Apps*, et *MCP Spec Level* mentionne l'extension (elle ne change pas la révision négociée).

## [2.11.0] - 2026-08-06

Qualité d'usage : les rejets de schéma deviennent une boucle d'auto-correction pour le modèle, la réduction de périmètre devient praticable sans connaître les 38 domaines, les icônes protocolaires arrivent et l'ordre de `tools/list` est verrouillé ([#168](https://github.com/fauguste/boondmanager-mcp-server/issues/168)). Catalogue inchangé : **180 outils, 11 prompts, 22 ressources**.

### Added

- **Rejets de filtres auto-correctifs** (SEP-1303) : un appel `boond_*_search` avec un mauvais nom de filtre ne renvoie plus « Unrecognized key: "mainManagers" » mais la correction — `Filtre inconnu « mainManagers » → utiliser `perimeterManagers` : IDs des managers dont on veut l'équipe (pour « mes données / mon équipe », `perimeterDynamic: ["data"|"managers"]`)`, suivie de la liste des filtres acceptés. Nouvelle table `src/schemas/filter-aliases.ts` (confusions globales + par endpoint : `states` → `resourceStates` / `candidateStates` / `opportunityStates` / `projectStates` selon la route, `typeOf` → `typesOf` sur les contacts, absence de filtre de type sur `/companies`, `maxResults` → `pageSize`…), repli « vouliez-vous dire » par distance d'édition pour les simples fautes de frappe, et URI de la ressource `boond://dictionary/*` à lire quand la valeur est un ID d'état/type. Le message est installé par `src/tools/validation-wrapper.ts` sur les outils de recherche — `*_search` **ou** `openWorldHint: true`, ce qui couvre aussi la famille `boond_reporting_*`, qui porte le même vocabulaire piégeux sans le suffixe — via un Proxy de registration par domaine (`src/tools/registration-decorators.ts`) : aucun des 38 fichiers de domaine ne change. Une correction n'est proposée que si l'endpoint accepte réellement le filtre de remplacement (sinon le modèle enchaînerait un 2ᵉ rejet puis abandonnerait le filtre, présentant une liste non filtrée comme filtrée), le nombre de lignes de correction est plafonné, et les tables sont lues via `Object.hasOwn` (un filtre nommé `constructor` ne résout plus vers `Object.prototype`). **Le `inputSchema` annoncé reste strictement identique** (`additionalProperties: false` compris, vérifié par test), et il n'y a **aucun second parse** sur le chemin chaud — contrairement aux deux options envisagées dans l'issue, la validation reste celle du SDK, seul son message change. À noter : la conversion en *tool error* (`isError: true`) exigée par SEP-1303 était déjà faite par le SDK 1.30 ; ce qui manquait était un message exploitable.
- **Profils d'accès préconfigurés** : nouvelle variable `BOOND_MCP_PROFILE` (`recruiting`, `sales`, `finance`, `delivery`, `admin` ; CSV = union, casse indifférente) définie dans `src/config/profiles.ts`. Réduire le périmètre exposé ne demande plus de composer `BOOND_MCP_DOMAINS` en connaissant les 38 domaines : `BOOND_MCP_PROFILE=finance` expose 59 outils au lieu de 180 (40 en lecture seule). Précédence explicite et testée : `BOOND_MCP_DOMAINS` > `BOOND_MCP_PROFILE` > tout, puis `BOOND_MCP_EXCLUDE_DOMAINS` dans tous les cas (deny gagne toujours) ; l'axe opérations (`BOOND_MCP_OPERATIONS` / `BOOND_MCP_READ_ONLY`) reste orthogonal. Un profil inconnu est ignoré avec un warning, jamais fatal, et ne produit jamais une surface vide. `application` est présent dans tous les profils (il porte la résolution dictionnaire / `current-user`) ; `resources` est présent dans `recruiting`, `sales` et `delivery` — 8 des 11 prompts l'orchestrent, et un prompt est coupé dès qu'un seul de ses domaines manque : l'exclure faisait tomber `recruiting` à 2 prompts et `sales` à 1, soit ~10 outils gagnés contre la quasi-totalité des runbooks. `finance` et `admin` ne l'incluent pas (aucun de leurs runbooks n'y touche) : la règle est de compter les prompts conservés, profil par profil, pas d'ajouter `resources` partout. Comptages par profil (générés) : `recruiting` 88 outils / 9 prompts, `sales` 96 / 8, `finance` 59 / 1, `delivery` 53 / 5, `admin` 18 / 0. Exposé comme `mcp_profile` dans `manifest.json::user_config` ; contenu de chaque profil et comptages **générés** dans `docs/access-control.md`.
- **Icônes au niveau protocole** (SEP-973) : outils, prompts et ressources portent désormais une icône **par domaine** (38 glyphes réutilisés, pas 180), en SVG inline `data:` URI — rien à héberger, aucun fetch côté client. Coût mesuré : **~40 Kio, soit ~14 % du payload `tools/list`** (295 Kio) ; plafonné par test, en absolu et en part du payload (`src/tools/descriptions.test.ts`) ainsi qu'icône par icône (`src/icons.test.ts`). Nouvelle variable **`BOOND_MCP_ICONS=0|false|no|off`** pour les déploiements qui ne les affichent pas (passerelles, clients texte). Le SDK 1.30 type `icons` sur `Tool`/`Prompt` mais ne les émet pas (ses handlers `tools/list` / `prompts/list` reconstruisent chaque entrée champ par champ), d'où un décorateur de réponses branché via l'API publique `Server.setRequestHandler` (`src/icons.ts`) ; les ressources, dont le listing propage toute la config, les portent nativement. `TOOLS.md` les ignore volontairement (c'est un catalogue texte).
- **Ordre de `tools/list` verrouillé par test** : devenu recommandation protocolaire dans la révision 2026-07-28 (cache client + taux de hit du prompt cache). Trois tests dans `src/server.test.ts` — deux `registerAll` successifs produisent la même séquence, deux serveurs réels annoncent le même ordre au client, et cette séquence est exactement la concaténation des registrars dans l'ordre de `TOOL_REGISTRARS`. L'invariant est documenté au-dessus du tableau : son ordre est une garantie protocolaire, pas une commodité de lecture.
- **Installation en un formulaire dans Claude Code : plugin + marketplace** ([#174](https://github.com/fauguste/boondmanager-mcp-server/issues/174)). `/plugin marketplace add fauguste/boondmanager-mcp-server` puis `/plugin install boondmanager-mcp@boondmanager` → le formulaire des **14 mêmes options** que l'extension `.mcpb` s'affiche, et le serveur MCP local (stdio) démarre. Plus de `claude mcp add` avec trois secrets collés à la main : les 5 champs sensibles vont dans le Keychain (`sensitive: true` réservé à eux — le Keychain partage un budget d'environ 2 Ko **avec les tokens OAuth de Claude Code**), les options non sensibles dans `pluginConfigs` du `settings.json` utilisateur. `manifest.json` **reste la source de vérité unique** : `plugins/boondmanager-mcp/.claude-plugin/plugin.json` et `plugins/boondmanager-mcp/.mcp.json` sont **générés** par `scripts/generate-plugin-manifest.mjs` (`npm run plugin:manifest`, drift bloqué en CI comme pour `TOOLS.md`) — deux copies écrites à la main des mêmes 14 options auraient divergé au premier ajout d'option. Le générateur porte toutes les différences de format (`user_config` → `userConfig`, `display_name` → `displayName`, `repository` objet → URL, clés MCPB non transposables écartées) et **refuse** un champ d'option qu'il ne sait pas mapper. Le plugin lance `npx boondmanager-mcp-server@X.Y.Z` **épinglé** : le payload copié dans le cache utilisateur est deux petits JSON, et la version installée est auditable. Ce pin est la copie de version qui se fossilise sans bruit (un vieux pin réinstalle indéfiniment une vieille release sans que rien ne le signale), d'où sa propre ligne dans le contrôle de cohérence de version en CI, aux côtés de `plugin.json` et `marketplace.json`. Ce canal **ne remplace ni le `.mcpb`** (Claude Desktop) **ni le MCP Registry** (index mirroré par les agrégateurs) : trois publics, trois formats. Transport stdio uniquement — l'OAuth du transport HTTP reste réservé aux passerelles. À noter : Claude Code déclare la capability `elicitation`, donc la confirmation de suppression fonctionne sur ce canal (pas de repli en suppression directe).

### Changed

- **Confirmation de suppression : enum titré au lieu d'un booléen** (SEP-1330 / SEP-1034). `confirmDeletion()` demande maintenant un `confirmation` de type `string` avec `oneOf: [{const:"delete",title:"Supprimer définitivement"},{const:"cancel",title:"Annuler"}]` et `default: "cancel"` — la réponse sûre est celle pré-sélectionnée, et la conséquence est dans le libellé de l'option (une case « Confirmer la suppression » est facile à cocher par erreur, et pré-cochée par certains hôtes). L'interprétation est stricte dans la direction sûre : seuls `confirmation: "delete"` — ou l'ancien `confirm: true`, **toujours honoré** — déclenchent la suppression ; `cancel`, une valeur inconnue ou un `content` vide annulent (`deleted: false` + `reason`). Le champ n'est volontairement **pas** `required` : le SDK valide la réponse contre ce schéma avec Ajv et un rejet lève une exception, qui retomberait dans le repli « supprimer quand même ». Et parce que ce rejet reste possible malgré tout (un hôte qui n'implémente pas les enums titrés affiche un champ texte libre, l'utilisateur tape « annuler »), une réponse hors-schéma est explicitement traitée comme un **refus** (`reason: "invalid-confirmation-response"`) et non comme un aller-retour cassé — supprimer sur un « non » explicite serait irréversible. Inchangé : sans capability `elicitation`, ou si le transport échoue, le comportement historique (suppression directe) s'applique. **Note de compatibilité** : un client qui répondait en dur `confirm: false` obtient désormais la raison `not-confirmed` au lieu de `confirm=false` (même issue : rien n'est supprimé).
- **Plafonds de pagination qui s'expliquent** : `page > 100` répond « plafond MAX_SEARCH_PAGE : affiner les filtres plutôt que paginer plus loin » et `pageSize > 500` cite la limite, au lieu du « Too big: expected number to be <=100 » par défaut de Zod. De même, un filtre de dictionnaire recevant un libellé (`resourceStates: ["actif"]`) répond « ID entier attendu (pas un libellé) : résoudre l'ID via les ressources `boond://dictionary/*` ou `boond_application_dictionary` » — tandis qu'un filtre d'**IDs d'entités** (`perimeterManagers`, `companies`, `flags`, `influencers`, `reporting*`…) renvoie vers la recherche de l'entité concernée, les dictionnaires ne contenant que des états/types.
- **Une variable d'environnement définie mais vide compte partout comme « non configurée »**, invariant désormais verrouillé par tests. Les deux canaux d'installation packagés (extension `.mcpb`, plugin Claude Code) substituent `${user_config.KEY}` dans les **14** variables `BOOND_*` : elles sont donc toujours *définies*, y compris pour les options que l'utilisateur n'a jamais touchées — un formulaire à moitié rempli livre des chaînes vides, pas des clés absentes. Trois formes doivent se lire « non configuré » : `""`, des espaces seuls, et un `"${…}"` non substitué. C'est le miroir de la règle `MCP_HTTP_ALLOWED_HOSTS` (une valeur vide ne doit jamais désactiver silencieusement un contrôle) : ici elle ne doit jamais *activer* silencieusement une restriction, ce qui masquerait l'essentiel du catalogue sans cause visible. Corrigé au passage : `envOrUndefined` (`boond-client.ts`) acceptait une valeur composée uniquement d'espaces, si bien que `BOOND_BASE_URL=" "` devenait l'URL de base des requêtes et échouait en erreur de fetch opaque. Les deux booléens (`mcp_read_only`, `confirm_delete`) arrivent comme des *chaînes* et portent un `default` explicite : `"false"` ne se lit pas « renseigné, donc actif », et toute valeur ambiguë tranche dans la direction sûre (toutes opérations autorisées, confirmation de suppression *conservée*).

### Documentation

- `docs/access-control.md` : section *Profils préconfigurés* (contenu, comptages d'outils/prompts générés depuis les registrations réelles, cumul de profils, précédence) et mention de `BOOND_MCP_PROFILE` dans le tableau des variables. Y est aussi documentée la raison de la présence de `resources` dans presque tous les profils (un prompt est coupé dès qu'un seul de ses domaines manque) et la façon de revenir à un périmètre plus strict via `BOOND_MCP_EXCLUDE_DOMAINS`.
- `README.md` : `BOOND_MCP_PROFILE` et `BOOND_MCP_ICONS` (avec le coût mesuré) documentés. Nouvelle section *Installation → Claude Code (plugin, recommandé)* : les trois commandes, où atterrissent les secrets, le préfixe d'outil côté client (`mcp__boondmanager__boond_*`, celui à utiliser dans une allow-list de permissions) et la façon de passer à une nouvelle version ; l'ancienne section devient *Claude Code (manuel, `claude mcp add`)*.
- `docs/distribution.md` : ligne *Claude Code plugin marketplace* dans *Where it ships*, 7ᵉ point de vérification post-tag (le rafraîchissement se fait chez l'utilisateur : c'est le seul canal où « publié » et « ce que les gens ont » peuvent diverger durablement) et section *Channel boundaries* disant explicitement ce que chaque format ne remplace pas.
- `CLAUDE.md` : nouvelles sections *Icons (SEP-973)* et *Deterministic `tools/list` Order* ; §*Search Filter Naming* dit maintenant ce qui se passe réellement sur un mauvais nom de filtre (et pourquoi c'est un wrapper de **schéma**, pas de handler : le SDK valide avant d'appeler le handler) ; §*Delete Confirmation* et §*Access Control* mises à jour.

## [2.10.0] - 2026-08-04

Remise à niveau sur la révision de spec MCP **2025-11-25** (celle que le SDK négocie déjà), fermeture d'un trou de validation HTTP et sortie de la fenêtre EOL de Node 20 ([#167](https://github.com/fauguste/boondmanager-mcp-server/issues/167)). Catalogue inchangé : **180 outils, 11 prompts, 22 ressources**.

> ⚠️ **BREAKING** : le prérequis runtime passe à **Node.js >= 22**. Node 20 est en fin de vie depuis le 2026-04-30 et n'est plus testé en CI. Les utilisateurs restés en 20 doivent mettre à jour leur runtime (l'image Docker tournait déjà sur Node 26).

### Added

- **`instructions` au niveau serveur** : le serveur annonce désormais, dans le résultat d'`initialize`, un jeu de règles transverses (`src/instructions.ts`) — convention de nommage `boond_{domaine}_{opération}`, filtres de périmètre (`perimeterDynamic` / `perimeterManagers` / `perimeterAgencies` + `narrowPerimeter`, et le rejet de `mainManagers` & co par les schémas `.strict()`), vocabulaire préfixé de `keywords` (`CSOC`, `CCON`, `CAND`, `COMP`, `AO`, `PRJ`, `MIS`, `PROD`, `CTR`), économie de contexte (`fields`, `pageSize`, plafond `page ≤ 100`) et résolution des états/types via les ressources `boond://dictionary/*`. Chaque règle est **rattachée aux endpoints qui l'acceptent réellement** : le périmètre aux 6 recherches principales + `boond_reporting_*` (les domaines de référence n'exposent que `keywords`/`page`/`pageSize`), `keywordsType` aux 4 schémas qui le déclarent, `typesOf` aux contacts seuls — les sociétés n'ont pas de filtre de type. Le bloc dit aussi qu'un rejet `.strict()` peut signifier « filtre non supporté par cet endpoint » et pas seulement « mauvais nom », et qu'un préfixe `keywords` hors liste n'est pas rejeté mais renvoie 0 résultat (à ne pas lire comme « aucune entité liée »). Un nouveau `src/instructions.test.ts` épingle ces affirmations aux schémas Zod correspondants pour qu'elles ne puissent pas diverger. Longueur plafonnée à 4000 caractères et testée (3,7 Ko aujourd'hui).
- **`Implementation.description`** (nouveauté 2025-11-25) : l'identité annoncée à l'`initialize` porte désormais une description, lue depuis `package.json` — pas de source de vérité supplémentaire à synchroniser au moment des releases.

### Security

- **Validation de l'en-tête `Origin`** (exigence de la spec 2025-11-25) : le transport HTTP renvoie désormais un `403 Forbidden` sur un `Origin` hors liste blanche, en complément de la validation `Host` déjà en place (anti DNS rebinding). Nouvelle variable `MCP_HTTP_ALLOWED_ORIGINS`, mêmes sémantiques que `MCP_HTTP_ALLOWED_HOSTS` (`*` seul = désactivation explicite, `*` mélangé = ignoré + warning ; une valeur vide n'est **pas** une désactivation et retombe sur le défaut). En écoute loopback, le défaut accepte **toute origine loopback quel que soit le port** (`http`/`https` sur `localhost` / `127.0.0.1` / `[::1]`) plus l'origine de `MCP_HTTP_PUBLIC_URL` si elle est définie : rien n'est *servi* depuis le port MCP, donc les origines légitimes sont d'autres ports locaux (MCP Inspector sur `:6274`, un serveur de dev sur `:5173`) ou l'URL publique du reverse proxy. La propriété anti-rebinding est intacte — une origine distante reçoit toujours un `403`, la comparaison portant sur le *littéral* du hostname (`http://127.0.0.1.nip.io` est rejeté). Une liste explicitement configurée reste, elle, comparée à l'identique (port compris). **Une requête sans `Origin` reste acceptée** (curl, gateways, clients MCP non-navigateur) ; `/healthz` et le document de découverte RFC 9728 (`/.well-known/oauth-protected-resource*`) sont exemptés — ce dernier est public, sans credential, et n'est consulté par un navigateur que parce qu'un `401` l'y a envoyé : un `403` y bloquerait le bootstrap OAuth.

### Changed

- **Prérequis Node.js : >= 22** (`package.json::engines`, `manifest.json::compatibility.runtimes`). Matrice CI `[20, 22, 24]` → `[22, 24, 26]` ; les étapes épinglées sur Node 22 (validation MCPB, drift check `TOOLS.md`, cohérence des versions, upload de couverture) restent dans la matrice. Workflows `api-monitor` passés de Node 20 à 22.
- **Boilerplate transverse retiré des descriptions d'outils** : la ligne « Périmètre orga : `perimeterAgencies`… » et l'avertissement « utilisez les filtres structurés / noms exacts de l'API », identiques dans les 6 descriptions de recherche, sont supprimés au profit du bloc `instructions` — 1,9 Ko de moins dans `tools/list`. Le bilan net sur le budget de contexte reste **+1,8 Ko par session** (bloc de 3,7 Ko) : les spécificités par endpoint (préfixes `keywords` admis, valeurs de `keywordsType`, tri) restent volontairement dans les descriptions, puisque c'est précisément là que le modèle doit aller les chercher. Un test vérifie que ces deux formulations ne réapparaissent pas côté outils. Au passage, `resources.ts` affirmait qu'un nom de filtre inconnu était « silencieusement ignoré » — c'est faux, les schémas sont `.strict()`.
- **Dev-dependencies** : bump de `typescript-eslint` (8.65.0 → 8.66.0) et `lint-staged` (17.2.0 → 17.3.0) — lockfile uniquement, rien n'est embarqué dans le paquet publié.

### Fixed

- **Démarrage résilient à un `package.json` malformé** : `readPackageManifest()` faisait ses accès de propriétés hors du `try`, si bien qu'un fichier se parsant en `null` (ou en scalaire) provoquait un `TypeError` à l'évaluation du module — serveur qui ne démarre plus, avec une pile d'import opaque. Le résultat du parse est désormais validé comme objet avant usage, et les placeholders (`0.0.0-unknown`) reprennent leur rôle. Trois cas de dégradation sont couverts par des tests.

### Documentation

- `CLAUDE.md` : nouvelles sections *MCP Spec Level* (révision négociée = celle du SDK, `2025-11-25` ; révision publiée = `2026-07-28`, suivie dans [#170](https://github.com/fauguste/boondmanager-mcp-server/issues/170)) et *Server Identity & Instructions* ; références obsolètes « 2025-03-26 » / « 2025-06-18 » corrigées.
- `README.md`, `README-docker.md` : `MCP_HTTP_ALLOWED_ORIGINS` documentée (défaut loopback port-agnostique, exemptions, sémantique de la valeur vide), prérequis Node mis à jour.
- `docs/oauth.md` : note à l'attention des intégrateurs — la DCR ([RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591)) est dépréciée dans la révision 2026-07-28 au profit des *Client ID Metadata Documents*, et les clients doivent valider le paramètre `iss` ([RFC 9207](https://datatracker.ietf.org/doc/html/rfc9207)). Côté serveur (protected resource), rien à changer.

## [2.9.0] - 2026-08-03

Lisibilité des résultats de recherche sur les entités transactionnelles et généralisation de la projection `fields` à l'ensemble des outils de recherche. Catalogue inchangé : **180 outils, 11 prompts, 22 ressources** — l'évolution porte sur les schémas d'entrée et le rendu des listes.

### Added

- **`fields` généralisé à tous les outils de recherche** ([#172](https://github.com/fauguste/boondmanager-mcp-server/pull/172)) : la projection côté client, jusqu'ici réservée aux six outils de recherche principaux, est ajoutée au `SearchSchema` de base et aux douze schémas qui en étaient dépourvus (`/actions`, `/invoices`, `/orders`, `/deliveries`, `/payments`, `/purchases`, `/absences`, `/advantages`, `/positionings`, `/provider-invoices`, `/notifications`, `/validations`). Les domaines à fort volume disposent désormais de la même échappatoire économe en tokens que les autres : `fields: ["number", "date"]` remplace la ligne de résumé standard, au lieu d'un `_get` par ligne. `boond_timesheets_search` et la famille `boond_reporting_*` en sont volontairement exclus — ils passent par leurs propres formateurs, le paramètre serait accepté puis silencieusement ignoré. Un nouveau `src/tools/fields-projection.test.ts` verrouille le passage de `params.fields` pour les douze outils écrits à la main.

### Fixed

- **Lignes de résultats identifiables sur les entités sans nom ni titre** ([#172](https://github.com/fauguste/boondmanager-mcp-server/pull/172)) : `/invoices`, `/orders`, `/actions`, `/deliveries-groupments` et `/projects` s'affichaient en en-tête nu (`[order #1234] | Statut: 1`) alors que les attributs métier étaient déjà dans la charge utile. `formatEntitySummary` retombe désormais sur les identifiants métier — `number`, `reference`, la date (ou la fenêtre `startDate`→`endDate`), jusqu'à deux montants de chiffre d'affaires, `typeOf` et un extrait de `text` libellé `Note: "…"` — **uniquement** lorsque la ligne n'a ni `firstName`/`lastName`, ni `name`, ni `title`, ni `value`. `/resources` et `/opportunities` portent aussi `reference` et des montants mais se lisent déjà bien : le repli reste désactivé pour eux et leur sortie est inchangée octet pour octet (verrouillé par des tests de régression).
- **Robustesse de l'extrait `text`** : l'extrait n'est produit que si `text` est une chaîne (`text: null` n'imprime plus `null`, un objet imbriqué plus `[object Object]`), il est libellé et cité pour que le modèle le lise comme une donnée et non comme du texte serveur. Le strip HTML `/<[^>]*>/` — qui mangeait le texte utilisateur entre un `<` et un `>` ultérieur (`Relancer si < 3 jours > sinon cloturer`) — est remplacé par un motif exigeant un nom de balise et gérant les valeurs d'attributs entre guillemets ; les commentaires HTML sont retirés et les entités décodées. La troncature s'effectue sur les points de code, donc un emoji sur la limite ne peut plus devenir un demi-surrogate.
- **Troncature des listes sur les frontières de ligne** : les lignes enrichies font dépasser `CHARACTER_LIMIT` à une page de 500 résultats `/actions` ; la coupe au milieu d'une ligne émettait une demi-ligne d'apparence complète et masquait le décompte. Le message de troncature indique maintenant `shown/total ligne(s) affichée(s)`.
- **Cohérence texte / `structuredContent`** : `buildListStructured` projette à travers le même sac `entity.attributes ?? entity` que le chemin texte — les lignes plates de référence (`/calendars`, charges de dictionnaire) revenaient en identifiants nus. Les lignes plates sans `id` sont rendues `[item]`, comme dans le résumé standard, au lieu de `[#?]`. Un `renderAttributeValue()` partagé garantit que les montants en forme d'objet s'affichent identiquement sur les deux chemins, et `hasValueIdentity()` corrige l'asymétrie sur `value` falsy (`null` / `""` imprimaient un jeton bidon *et* supprimaient le repli ; un `0` numérique reste une étiquette valide).

### Changed

- **Description de `fields` resserrée** (271 → 125 caractères) : elle est dupliquée dans ~32 schémas d'outils, ce qui rend ~4,7 Ko de la charge utile `tools/list`.
- **Dépendances runtime (transitives)** : bump de `hono` (4.12.31 → 4.12.34, [GHSA-8j4g-w8fx-2239](https://github.com/advisories/GHSA-8j4g-w8fx-2239) — ReDoS dans le middleware CORS) et d'`ip-address` (10.2.0 → 10.4.0, [GHSA-mwp4-54f8-5fhr](https://github.com/advisories/GHSA-mwp4-54f8-5fhr) — octets à zéro non significatif décodés en décimal, contournement SSRF). Toutes deux transitives du SDK MCP (`@hono/node-server`, `express-rate-limit`) et non utilisées par le serveur — le transport HTTP s'appuie sur `node:http`. Lockfile uniquement, `package.json` inchangé ; `npm audit` : 2 → 0 vulnérabilité.

## [2.8.3] - 2026-08-03

Release de maintenance : correctifs de sécurité des dépendances transitives, mise à jour du SDK MCP et de la chaîne d'outillage CI. Aucun changement fonctionnel. Catalogue inchangé : **180 outils, 11 prompts, 22 ressources**.

### Security

- **Deux advisories transitives corrigées** (`npm audit` : 2 → 0 vulnérabilité côté runtime) :
  - `fast-uri` (3.1.4 → 3.1.5) — [GHSA-7p8r-x3mc-p8w7](https://github.com/advisories/GHSA-7p8r-x3mc-p8w7), *host confusion* via introducteur d'autorité `\` (severity high). Dépendance transitive d'`ajv` (8.17.1 → 8.18.0).
  - `@hono/node-server` (1.19.14 → 2.0.12) — [GHSA-frvp-7c67-39w9](https://github.com/advisories/GHSA-frvp-7c67-39w9), *path traversal* dans `serve-static` sous Windows via backslash encodé `%5C` (severity moderate). Rendu possible par l'élargissement de plage du SDK MCP 1.30.0 (`^1.19.9 || ^2.0.5`). Dépendance transitive du SDK, non utilisée directement par le serveur (le transport HTTP s'appuie sur `node:http`) ; lockfile uniquement, aucun changement de `package.json`.

### Changed

- **SDK MCP** ([#163](https://github.com/fauguste/boondmanager-mcp-server/pull/163)) : bump de `@modelcontextprotocol/sdk` (1.29.0 → 1.30.0) — la nouvelle version élargit sa plage `@hono/node-server` (`^1.19.9 || ^2.0.5`). Aucun ajustement de code nécessaire.
- **Dev-dependencies** ([#161](https://github.com/fauguste/boondmanager-mcp-server/pull/161), [#164](https://github.com/fauguste/boondmanager-mcp-server/pull/164)) : bump d'`eslint` (10.7.0 → 10.8.0), `typescript-eslint` (8.64.0 → 8.65.0), `prettier` (3.9.5 → 3.9.6), `lint-staged` (17.1.0 → 17.2.0) et `@types/node` (26.1.1 → 26.1.2) — lockfile uniquement, rien n'est embarqué dans le paquet publié.
- **GitHub Actions** ([#162](https://github.com/fauguste/boondmanager-mcp-server/pull/162), [#166](https://github.com/fauguste/boondmanager-mcp-server/pull/166)) : bump d'`actions/checkout` (v7.0.0 → v7.0.1), `github/codeql-action` (v4.37.1 → v4.37.4) et `docker/login-action` — digests réépinglés dans tous les workflows.
- **Image Docker** ([#165](https://github.com/fauguste/boondmanager-mcp-server/pull/165)) : bump du digest de l'image de base `node:26-alpine`, la reconstruction embarque les derniers correctifs amont.

## [2.8.2] - 2026-07-23

Release de maintenance : mises à jour de sécurité et de correctifs des dépendances (Dependabot) et fiabilisation des tests HTTP. Aucun changement fonctionnel. Catalogue inchangé : **180 outils, 11 prompts, 22 ressources**.

### Changed

- **Dépendances runtime (transitives)** : bump de `hono` (4.12.25 → 4.12.31, [#159](https://github.com/fauguste/boondmanager-mcp-server/pull/159)), `body-parser` (2.2.2 → 2.3.0, [#157](https://github.com/fauguste/boondmanager-mcp-server/pull/157)) et `fast-uri` (3.1.2 → 3.1.4, [#160](https://github.com/fauguste/boondmanager-mcp-server/pull/160)) — correctifs amont, lockfile uniquement.
- **Dev-dependencies** : bump de `brace-expansion` (5.0.6 → 5.0.8, [#155](https://github.com/fauguste/boondmanager-mcp-server/pull/155), [#158](https://github.com/fauguste/boondmanager-mcp-server/pull/158)) et du groupe dev-dependencies ([#150](https://github.com/fauguste/boondmanager-mcp-server/pull/150), [#153](https://github.com/fauguste/boondmanager-mcp-server/pull/153)) — rien n'est embarqué dans le paquet publié.
- **GitHub Actions & image de base** : bump des groupes d'actions Dependabot ([#151](https://github.com/fauguste/boondmanager-mcp-server/pull/151), [#154](https://github.com/fauguste/boondmanager-mcp-server/pull/154)) et de l'image Docker Node ([#149](https://github.com/fauguste/boondmanager-mcp-server/pull/149)).

### Fixed

- **Fiabilisation des tests HTTP** ([#156](https://github.com/fauguste/boondmanager-mcp-server/pull/156)) : suppression de la flakiness `EADDRINUSE` en utilisant des ports éphémères.

## [2.8.1] - 2026-07-08

Correctif du plafond `maxResults` par route (signalement de l'équipe technique BoondManager) et mises à jour de maintenance (Dependabot). Catalogue inchangé : **180 outils, 11 prompts, 22 ressources**.

### Fixed

- **Respect du plafond `maxResults` de BoondManager sur la route `/actions`** ([#148](https://github.com/fauguste/boondmanager-mcp-server/pull/148)) : l'équipe technique de BoondManager a signalé que des appels à `/api/actions` avec `maxResults > 100` provoquent des dépassements mémoire de leur côté (alertes internes, puis repli silencieux sur 30). Les outils de recherche ne passent plus directement par `apiRequest` mais par une nouvelle couche `apiSearch` qui applique un plafond `maxResults` par route (`ROUTE_MAX_RESULTS` dans `src/constants.ts`, `/actions` → 100). Quand la taille de page demandée dépasse le plafond de la route, la requête est **découpée de façon transparente** en tranches ≤ plafond, puis les pages sont fusionnées : l'appelant reçoit sa page complète (jusqu'à 500) « d'un coup », mais BoondManager ne reçoit jamais `maxResults` au-delà du plafond. Aucune régression sur les autres routes (chemin rapide à appel unique, plafond par défaut = `MAX_PAGE_SIZE`). Pour plafonner une future route, il suffit d'ajouter une entrée à `ROUTE_MAX_RESULTS`.

### Changed

- **Dev-dependencies** ([#144](https://github.com/fauguste/boondmanager-mcp-server/pull/144), [#146](https://github.com/fauguste/boondmanager-mcp-server/pull/146)) : mise à jour de la chaîne de build/test (vitest, typescript-eslint, @types/node, …) — lockfile uniquement, rien n'est embarqué dans le paquet publié.
- **GitHub Actions** ([#139](https://github.com/fauguste/boondmanager-mcp-server/pull/139), [#140](https://github.com/fauguste/boondmanager-mcp-server/pull/140), [#143](https://github.com/fauguste/boondmanager-mcp-server/pull/143), [#145](https://github.com/fauguste/boondmanager-mcp-server/pull/145), [#147](https://github.com/fauguste/boondmanager-mcp-server/pull/147)) : bump de `codeql-action` (4.36.3), `docker/build-push-action` (7.3.0), `docker/login-action` (4.4.0), `docker/setup-qemu-action` (4.2.0), `docker/setup-buildx-action` ; regroupement des mises à jour d'actions Dependabot ([#145](https://github.com/fauguste/boondmanager-mcp-server/pull/145)).
- **Image Docker** : la reconstruction embarque les derniers correctifs de l'image de base Node.

## [2.8.0] - 2026-06-29

Extension des capacités d'écriture (4 nouveaux outils `*_create`) et nouveau mode d'authentification statique pour le transport HTTP. Catalogue : **180 outils** (176 → 180), 11 prompts, 22 ressources.

### Added

- **Quatre nouveaux outils de création** ([#135](https://github.com/fauguste/boondmanager-mcp-server/pull/135)), complétant la couverture write des domaines de gestion :
  - **`boond_deliveries_create`** : créer une prestation / livraison.
  - **`boond_payments_create`** : créer un paiement.
  - **`boond_provider_invoices_create`** : créer une facture fournisseur.
  - **`boond_timesheets_create`** : créer une feuille de temps.
- **Authentification HTTP statique** ([#135](https://github.com/fauguste/boondmanager-mcp-server/pull/135)) : nouvelle variable `BOOND_HTTP_STATIC_AUTH` (`true`/`1`/`yes`). Quand elle est activée, le transport HTTP utilise les credentials d'environnement (JWT statique, comme en stdio) au lieu d'exiger un `Authorization: Bearer` OAuth par requête. Pensé pour les déploiements mono-locataire, les pipelines CI et les passerelles internes (ex. Hermes) qui n'ont pas de flux OAuth. Le serveur refuse de démarrer (`exit 1`) si le mode est activé sans credentials (`BOOND_USER_TOKEN` + `BOOND_CLIENT_TOKEN` + `BOOND_CLIENT_KEY`, ou `BOOND_API_TOKEN`). Absente ou désactivée, le comportement reste le mode OAuth2 *protected resource* par défaut. Merci @DemeulemeesterxMaxime pour la contribution.

## [2.7.1] - 2026-06-26

Correctif du `405 Method Not Allowed` sur la mise à jour des principales entités. Aucun changement de catalogue — toujours **176 outils, 11 prompts, 22 ressources**.

### Fixed

- **Les outils `*_update` renvoyaient systématiquement `405 Method Not Allowed` (PATCH sur la ressource de base)** ([#134](https://github.com/fauguste/boondmanager-mcp-server/issues/134)) : comme pour les opportunités ([#124](https://github.com/fauguste/boondmanager-mcp-server/issues/124)), l'API BoondManager n'accepte pas `PATCH` sur la ressource de base de ces entités. La mise à jour cible désormais `PUT /{entité}/{id}/information` (endpoint documenté dans la RAML). Le corps reste partiel — seuls les champs fournis sont envoyés. Entités corrigées : **candidates, contacts, companies, resources, projects, products, invoices, orders**. Merci @ebktva pour le signalement détaillé et l'analyse de la cause racine.

## [2.7.0] - 2026-06-19

Nouvel outil `boond_actions_update` pour modifier une action sans la supprimer/recréer. Catalogue : **176 outils** (175 → 176), 11 prompts, 22 ressources.

### Added

- **`boond_actions_update`** ([#125](https://github.com/fauguste/boondmanager-mcp-server/issues/125)) : met à jour une action existante via `PUT /actions/{id}` (mise à jour partielle — seuls les champs fournis sont envoyés). Champs modifiables : `typeOf`, `title`, `text`, `startDate`, `endDate`. **Aucune relation n'est transmise dans le corps** : le rattachement `dependsOn`, le `positioning` et la synchronisation calendrier (event Outlook/Teams + invités) sont préservés. C'est l'intérêt principal face à l'ancien contournement *delete + recreate*, qui supprimait l'événement Outlook. Merci @Antoine-Engibex pour le signalement et la proposition détaillée.

### Fixed

- **`PATCH /actions/{id}` renvoyait `405 Method Not Allowed`** ([#125](https://github.com/fauguste/boondmanager-mcp-server/issues/125)) : l'endpoint des actions n'accepte que `PUT` (vérifié en réel ; `bodyPut.json` documenté côté RAML). Le nouvel outil utilise `PUT` directement.

## [2.6.3] - 2026-06-19

Suite de la correction d'`boond_opportunities_create`/`update` : exposition des champs métier manquants et correction du `405` à la mise à jour ([#124](https://github.com/fauguste/boondmanager-mcp-server/issues/124)). Aucun changement de catalogue — toujours **175 outils, 11 prompts, 22 ressources**.

### Fixed

- **`boond_opportunities_update` renvoyait systématiquement `405 Method Not Allowed` (PATCH /opportunities/{id})** ([#124](https://github.com/fauguste/boondmanager-mcp-server/issues/124)) : l'API BoondManager n'accepte pas `PATCH` sur la ressource de base. La mise à jour cible désormais `PUT /opportunities/{id}/information` (endpoint documenté dans la RAML). Le corps reste partiel — seuls les champs fournis sont envoyés. Le `crud-factory` gagne une option `pathSuffix` pour router une mise à jour vers une sous-ressource.
- **`note` ne renseignait pas la description de l'opportunité** ([#124](https://github.com/fauguste/boondmanager-mcp-server/issues/124)) : l'API n'a pas d'attribut `note` ; le paramètre était silencieusement ignoré et `description` restait vide. `note` est désormais mappé sur `/data/attributes/description`.

### Added

- **`boond_opportunities_create` / `boond_opportunities_update` exposent les champs métier principaux** ([#124](https://github.com/fauguste/boondmanager-mcp-server/issues/124)), mappés sur les attributs/relations exacts de la RAML :
  - Attributs : `typeOf` (type d'opportunité, dictionnaire `setting.typeOf.project`), `criteria` (critères / compétences recherchées — alimente le matching de `boond_workflow_candidats_pour_opportunite`), `expertiseArea` (dictionnaire `setting.expertiseArea`), `turnoverEstimatedExcludingTax` (CA estimé HT).
  - Relations : `poleId` (pole), `hrManagerId` (resource), `mainManagerId` (resource), `agencyId` (agency) — en complément de `companyId`/`contactId`.

## [2.6.2] - 2026-06-18

Correctif de l'outil `boond_opportunities_create` (et `boond_opportunities_update`) qui échouait systématiquement. Aucun changement de catalogue — toujours **175 outils, 11 prompts, 22 ressources**.

### Fixed

- **`boond_opportunities_create` renvoyait toujours `422 — 1017 Missing required attribute /data/attributes/title`** ([#113](https://github.com/fauguste/boondmanager-mcp-server/issues/113)) : le champ `name` du schéma était transmis tel quel dans les attributs JSON:API, alors que l'API BoondManager attend le titre de l'opportunité sous `/data/attributes/title`. L'attribut `title` n'était donc jamais envoyé et la création échouait quel que soit l'input. Le handler mappe désormais `name` → `title` à la création et à la mise à jour (`boond_opportunities_update`). Lors d'un update, `title` reste omis si `name` n'est pas fourni, donc le titre existant n'est pas écrasé.

## [2.6.1] - 2026-06-15

Correctif de packaging : le bundle `.mcpb` passe de ~40 Mo à ~3 Mo et redevient installable sur les hôtes qui appliquent une limite de taille (Claude Cowork / Claude Desktop). Aucun changement de comportement des outils — toujours **175 outils, 11 prompts, 22 ressources**.

### Fixed

- **`.mcpb` de ~40 Mo silencieusement rejeté à l'installation** : la CI packageait le bundle après un `npm ci` complet, embarquant toutes les devDependencies dans `node_modules` (vitest, typescript, eslint, rolldown, lightningcss…) — inutiles au runtime mais ~37 Mo de poids mort. La release `release.yml` exécute désormais `npm prune --omit=dev` (après `npm publish`, car `prepublishOnly` relance `tsc`) avant `mcpb pack` ; le bundle tombe à ~3 Mo.
- **`pino-pretty` déclaré en devDependency alors qu'il est requis au runtime** : `src/services/logger.ts` charge `pino-pretty` comme transport par défaut (sauf `LOG_FORMAT=json` ou `NODE_ENV=production`). En devDependency, il manquait dès qu'on n'embarquait pas tout le `node_modules` — donc le bundle allégé **et** le package npm (`npx boondmanager-mcp-server` chez un consommateur) crashaient au démarrage. Déplacé en `dependencies`.

### Changed

- `.mcpbignore` étendu pour exclure du `node_modules` embarqué les artefacts inutiles au runtime (`*.map`, `*.md`, dossiers `test/`/`tests/`/`__tests__/`/`examples/`).
- Hook `prepare` rendu tolérant (`husky || true`) pour qu'un cycle npm déclenché par l'hôte n'échoue pas en l'absence de `.git`.

## [2.6.0] - 2026-06-15

Les 5 outils de reporting acceptent enfin leurs vrais filtres par endpoint — une requête « filtrée » ne renvoie plus tout le périmètre autorisé. Merci @Antoine-Engibex pour la contribution.

### Fixed

- **Filtres des 5 outils de reporting silencieusement ignorés** (#110) : `boond_reporting_companies/projects/resources/synthesis/production_plans` ne transmettaient que `startDate`/`endDate`/`keywords`/`page`/`pageSize` — tout autre `queryParameter` de la RAML était abandonné, donc un reporting « filtré » renvoyait l'intégralité du périmètre autorisé (même classe de bug que les filtres de positionnements corrigés en #107). Chaque endpoint reçoit désormais un schéma Zod `.strict()` dédié, modelé sur sa `search.raml` :
  - companies : `companiesStates`, `companies[]`, `maxCompanies`, `showPercentage` (+ dates requises)
  - projects : `projectTypes`, `projectStates`, `maxProjects`, `resources`/`projects`/`contacts`/`companies[]`
  - resources : `reportingCategory`, `resourceTypes`, `resourceStates`, `period`, `maxResources`, ids d'entités
  - synthesis : `reportingType`, `reportingCategory`, `period`, `compareIndicators` (+ `startDate` requis)
  - production-plans : `positioningStates`, `positioningPeriod`, `showContracts` (+ dates requises)

  Tous exposent en plus les filtres de périmètre partagés (`perimeterDynamic`/`perimeterManagers`/`perimeterAgencies`/`perimeterPoles`/`perimeterBusinessUnits`/`narrowPerimeter`, `periodDynamic`). Les schémas restant `.strict()`, un mauvais nom de filtre (ex. `agencies` au lieu de `perimeterAgencies`) est rejeté plutôt que silencieusement ignoré. Aucun nouvel outil (toujours **175**), catalogue inchangé.

### Changed

- Montée de versions des dépendances : image de base Node Docker (#112) et groupe de dev-dependencies (#111, 4 mises à jour).

## [2.5.0] - 2026-06-12

Les positionnements deviennent pleinement pilotables (lecture réparée, mise à jour d'état, actions liées), et les instances aux dictionnaires personnalisés peuvent déclarer leurs libellés. Merci @Antoine-Engibex pour les quatre contributions de cette version.

### Added

- **`boond_positionings_update`** (#108) : mise à jour d'un positionnement via `PUT /positionings/{id}` — état (`state`), motif (`stateReasonTypeOf`/`stateReasonDetail`, repliés en `stateReason {typeOf, detail}`), dates et commentaires. Permet de faire avancer un positionnement dans le pipeline (Positionned → CF Sent → RQ → Won…). Registration dédiée car l'API exige un PUT là où la crud-factory émet un PATCH ; contrat identique à la factory (annotations, `MutationOutputSchema`, `structuredContent {id, type}`). Le serveur expose désormais **175 outils**.
- **Libellés de dictionnaire personnalisés** via `BOOND_DICTIONARY_OVERRIDES` (#105) : variable optionnelle (JSON inline ou chemin de fichier) déclarant le mapping label → ID par section (`action`/`state`) et par entité, pour les instances BoondManager dont les libellés sont personnalisés. Quand elle est configurée : `boond_actions_create` accepte un libellé pour `typeOf` (résolu selon l'entité `dependsOn`, erreur explicite avec les libellés disponibles si inconnu), les champs `state` des create/update (candidates, resources, companies, opportunities, projects) acceptent un libellé, les descriptions d'outils sont enrichies des tables label=ID, et une ressource MCP `boond://dictionary/overrides` expose la config. Fail-open (config absente/invalide → warn + comportement historique), résolution insensible à la casse. Exposée dans `user_config` du manifest MCPB ; documentation : `docs/dictionary-overrides.md`. Sans la variable, comportement inchangé à l'octet près.

### Fixed

- **Onglets tronqués au premier élément** (#107) : les outils d'onglets (ex. `boond_resources_positionings`, `boond_candidates_actions`) ne montraient que le premier élément des listes (`formatDetailResponse` ne lisait que `data[0]`). Nouveau formateur `formatTabResponse` (tableau → « N élément(s) » + toutes les entités, avec la troncature habituelle) appliqué aux boucles d'onglets des 6 entités principales.
- **Filtres de `boond_positionings_search` silencieusement ignorés** (#107) : `GET /positionings` filtre par références dans `keywords` (`AO<id>`, `CAND<id>`, `COMP<id>`, `CSOC<id>`, `CCON<id>`, `PROD<id>`), pas par paramètres dédiés — une recherche « filtrée » renvoyait toute la base. Le handler convertit désormais `candidateId`/`resourceId`/`opportunityId`/`companyId`/`contactId`/`productId` en tokens keywords ; `projectId` est retiré (aucun équivalent API, il n'a jamais filtré).
- **Actions liées à un positionnement impossibles à créer** (#106) : l'API rejette `POST /actions` en 422 « 1002 - Wrong or missing attribute (/data/relationships/positioning) » pour certains types d'action (ex. entretiens « RQ »), relation non documentée dans le schéma officiel. `boond_actions_create` accepte un `positioningId` optionnel et envoie la relation `positioning` correspondante ; sans lui, payload inchangé.

### Changed

- Comptes du catalogue alignés partout (README, manifests, CLAUDE.md) : **175 outils, 11 prompts, 22 ressources, 38 domaines**.

## [2.4.0] - 2026-06-10

Six évolutions produit : documents/CV, sorties structurées, confirmation des suppressions, économie de tokens, healthcheck HTTP, et réparation du moniteur d'API.

### Added

- **Domaine `documents`** (`src/tools/documents.ts`) — 3 outils :
  - `boond_documents_get` : télécharge un document (CV de candidat/ressource, justificatif, contrat…) et le retourne en ressource MCP embarquée (base64 pour les binaires, texte brut pour les fichiers texte, plafond 5 Mo). Les IDs se trouvent dans les onglets des entités (ex. `boond_candidates_information` → relations `resumes`/`files`).
  - `boond_documents_create` : téléversement **par URL uniquement** (`fileUrl` — BoondManager télécharge le fichier côté serveur, le serveur MCP ne lit jamais de fichier local), avec option `parsing` (analyse IA du CV pour `candidateResume`).
  - `boond_documents_delete` : via la factory (confirmation + sortie structurée).
  - Nouvelles primitives client : `apiDownload()` (binaire) et `apiUploadForm()` (multipart) dans `boond-client.ts`.
- **Sorties structurées MCP** (`outputSchema` + `structuredContent`) sur les outils de la crud-factory : `search` retourne `{ total, count, items: [{id, type, summary|attributes}] }` (compact — jamais les ressources JSON:API complètes), `create`/`update` retournent `{ id, type }`, `delete` retourne `{ id, deleted, reason? }`. Les outils `get` restent volontairement texte seul (leur texte est déjà le JSON complet — le dupliquer doublerait la charge).
- **Confirmation des suppressions par élicitation MCP** (spec 2025-06-18) : chaque `boond_*_delete` demande confirmation à l'utilisateur quand le client déclare la capacité `elicitation`. Refus/annulation → suppression avortée. Clients sans la capacité (ou échec du round-trip) → comportement historique. Opt-out : `BOOND_MCP_CONFIRM_DELETE=0` (toggle `confirm_delete` dans le manifest MCPB). Les 8 deletes hors factory (absences, actions, expenses, invoices, orders, positionings, purchases, références de ressources) ont été alignés.
- **Paramètre `fields` sur les 6 recherches principales** (resources, candidates, contacts, companies, opportunities, projects) : projection côté client des attributs affichés par résultat (ex. `fields: ["title","updateDate"]`) — réduit fortement la consommation de contexte sur les grandes pages. Jamais transmis à l'API.
- **`GET /healthz` sur le transport HTTP** : sonde de vivacité non authentifiée (exemptée de la validation Host pour que les probes Docker/K8s passent), retourne `{ status, version, mode, sessions }`. Le `HEALTHCHECK` de l'image Docker l'utilise désormais.

### Fixed

- **Moniteur d'API réparé** (`.github/scripts/api-monitor.mjs`) : le scraping HTML de la page d'index RAML n'a jamais fonctionné (403 WAF — le snapshot restait à 0 endpoint). Le moniteur sonde désormais les fichiers RAML bruts (accessibles statiquement, 152 fichiers sur 50 domaines), hashe leur contenu et diffe contre le snapshot. Zéro dépendance npm (fetch natif — le job a un token issues/PR, il n'exécute plus de code tiers). Le snapshot n'est réécrit que si le contenu change (plus de PR hebdomadaire vide), et un échec réseau sur un fichier connu saute le diff au lieu de générer de fausses suppressions.

## [2.3.0] - 2026-06-10

Durcissement de sécurité issu d'un audit complet (code applicatif, transport HTTP, chaîne d'approvisionnement CI/CD).

### Security

- **Validation des identifiants d'entité** (`src/schemas/index.ts`, `src/services/boond-client.ts`) : les `id` sont désormais strictement numériques et un garde-fou centralisé (`assertSafeApiPath`) rejette toute traversée de chemin (`..`), injection de query (`?`/`#`) ou encodage suspect (`%`/`\`) avant la construction de l'URL. Empêche le contournement du filtre d'accès par domaine via un `id` du type `../invoices/5`.
- **Limite de taille du corps de requête HTTP** (`src/transports/http.ts`) : pré-check `Content-Length` + garde en streaming à 1 Mio, réponse `413`. Borne la mémoire qu'une requête authentifiée peut forcer à bufferiser.
- **Plafond de sessions en mode stateful** (`MCP_HTTP_MAX_SESSIONS`, défaut `1000`) : nouvelles `initialize` rejetées en `503` une fois le plafond atteint (après un balayage des sessions inactives). Évite l'épuisement mémoire par création illimitée de sessions.
- **Validation de l'en-tête Host durcie** : un `*` dans `MCP_HTTP_ALLOWED_HOSTS` ne désactive la validation que s'il est la **seule** entrée ; mêlé à de vrais hôtes il est ignoré (avec avertissement) plutôt que d'ouvrir à tous.
- **JWT à expiration optionnelle** (`BOOND_JWT_TTL_SECONDS`) : régénère le JWT par requête avec des claims `iat`/`exp` pour qu'un token fuité ne soit pas rejouable indéfiniment. Désactivé par défaut (comportement historique préservé).
- **Chaîne d'approvisionnement CI/CD** :
  - Toutes les GitHub Actions tierces (et `actions/*`) épinglées par SHA de commit (Dependabot maintient les pins).
  - `mcp-publisher` épinglé en version + vérification du checksum SHA-256 avant exécution (remplace un téléchargement `latest` non vérifié exécuté avec des droits d'écriture).
  - `@anthropic-ai/mcpb` épinglé en version (`ci.yml`, `release.yml`).
  - Image Docker de base épinglée par digest d'index multi-arch (`Dockerfile`).
  - `release.yml` : `persist-credentials: false` au checkout (le job ne pousse pas via git).
  - `api-monitor.yml` : dépendances npm épinglées + `--ignore-scripts`, dépendance inutilisée retirée, mise à jour du snapshot via **PR** au lieu d'un push direct sur `main`, contenu scrapé échappé avant insertion dans l'issue.
- **Vulnérabilités de dépendances** : `hono` et `brace-expansion` (transitives) mises à jour — `npm audit` revient à zéro vulnérabilité.

### Removed

- Fichiers de travail temporaires sous `.github/` (`GIT_COMMANDS.sh`, `COMMIT_MESSAGE.txt`, etc.) et stanza Dependabot `pip` sans manifeste Python.

## [2.2.0] - 2026-06-08

Restriction d'accès configurable par variables d'environnement : limiter les domaines exposés et/ou bloquer les écritures, sans modifier le code.

### Added

- **Filtrage par domaine et par opération** (`src/config/access-policy.ts`). Quatre variables, toutes optionnelles (absentes = surface complète, comportement historique) :
  - `BOOND_MCP_DOMAINS` : liste blanche de domaines (CSV). Tirets ou underscores acceptés.
  - `BOOND_MCP_EXCLUDE_DOMAINS` : liste noire (CSV), appliquée après la liste blanche (la liste noire l'emporte).
  - `BOOND_MCP_OPERATIONS` : opérations autorisées (CSV) parmi `read,create,update,delete`. Prioritaire sur le raccourci ci-dessous.
  - `BOOND_MCP_READ_ONLY` : raccourci booléen (`1`/`true`/`yes`) equivalent a `BOOND_MCP_OPERATIONS=read`.
- **Cohérence prompts / workflow-tools** : chaque prompt déclare les domaines qu'il orchestre (`domains[]`) ; un prompt et son outil miroir `boond_workflow_*` sont coupés ensemble dès qu'un de ces domaines est filtré, pour qu'aucun runbook ne pointe vers un outil absent.
- **Exposition côté MCPB** : les quatre options sont disponibles dans `user_config` de `manifest.json` (toggles dans l'UI Claude Desktop).
- **Documentation dédiée** : `docs/access-control.md` (règles de résolution, exemples, et avertissement de sécurité).

### Changed

- `REGISTERED_DOMAINS` déplacé dans `src/constants.ts` ; nouveau `TOOL_REGISTRARS` exporté depuis `src/server.ts` couplant chaque domaine à sa fonction d'enregistrement. La détection de domaine ne repose plus sur une analyse du nom d'outil (plus de faux positif entre `invoices` et `provider-invoices`). Le générateur de `TOOLS.md` réutilise cette liste unique.

### Why

Réduire la surface exposée au modèle économise des tokens de contexte et sert de garde-fou contre les actions accidentelles. Ce filtre n'est pas une frontière de sécurité dure : les droits du compte BoondManager restent la vraie barrière. Le filtre vit dans `createMcpServer` (signatures de policy optionnelles), donc `TOOLS.md` n'est jamais impacté et le drift-check CI reste vert.

## [2.1.1] - 2026-06-08

Correctif de la création d'action (`boond_actions_create`), alignée sur les exigences réelles de l'API BoondManager, plus mises à jour de dépendances.

### Fixed

- **Création d'action — relation `dependsOn` obligatoire** (`src/tools/actions.ts`, `src/schemas/index.ts`) : l'API `POST /actions` exige une relation polymorphe `dependsOn` pointant vers l'entité à laquelle l'action est rattachée (sinon 422 « Missing required relationship »). Le tool envoie désormais cette relation à partir du premier identifiant fourni parmi `contactId`, `candidateId`, `resourceId`, `opportunityId` ou `projectId`, et renvoie une erreur explicite si aucun n'est présent. `companyId` n'est accepté qu'en complément d'un `contactId` (une action ne peut pas être rattachée directement à une société).
- **`ActionCreateSchema` aligné sur l'API** : `typeOf` devient un ID numérique de dictionnaire (`setting.action.*`, via `boond_application_dictionary`) au lieu d'une chaîne libre ; les attributs sont `title` / `text` (et non `subject` / `content`) ; ajout de `opportunityId` et `projectId` comme cibles de rattachement ; dates au format ISO avec timezone.

### Changed

- **Dépendances** : `hono` 4.12.18 → 4.12.23 (#93), bumps des dev-dependencies (`@types/node`, `typescript-eslint`, …) (#90, #92, #97), `peter-evans/dockerhub-description` v4 → v5 (#89), image Docker de base `node` 22-alpine → 26-alpine (#88).
- **CI** : ajout de Node 24 à la matrice de tests (#91).

## [2.1.0] - 2026-05-27

Mécanisme de notification de mise à jour pour les installations `.mcpb` dans Claude Desktop (et tous les autres canaux : stdio CLI, transport HTTP, conteneur Docker).

### Added

- **Notification de version au démarrage** (`src/services/update-checker.ts`) : au boot, le serveur interroge `https://registry.npmjs.org/boondmanager-mcp-server/latest` (timeout 3s) et, si une release plus récente que la version locale existe, émet un log `warn` structuré (`event: "update_available"`, current, latest, url) via le logger pino central. Claude Desktop capture stderr dans son panneau Developer logs, où la notification est visible. L'utilisateur télécharge ensuite le nouveau `.mcpb` manuellement depuis GitHub Releases. Fire-and-forget : ne bloque jamais le boot, fail-silent sur erreur réseau / 4xx-5xx / JSON malformé / semver invalide. Actif sur les deux transports (stdio + HTTP).
- **Opt-out** : `BOOND_DISABLE_UPDATE_CHECK=1` (ou `true` / `yes`) désactive entièrement le check. Pour les environnements air-gapped, CI, ou tout déploiement où l'appel sortant vers npm est indésirable.

### Why

MCPB 0.3 n'expose aucun champ `update_url` et l'auto-update natif de Claude Desktop ne s'applique qu'aux extensions du répertoire curaté Anthropic. Pour les `.mcpb` tiers distribués via GitHub Releases, la notification stderr est l'équivalent pratique le plus proche — l'utilisateur sait qu'une nouvelle version existe sans avoir à surveiller le repo.

## [2.0.1] - 2026-05-25

Patch de publication : synchronisation automatique de la description Docker Hub.

### Added

- **README-docker.md dédié** (10 438 chars, sous la limite Docker Hub 25k) focalisé sur l'usage Docker : pull/run, OAuth2 protected resource, env vars HTTP, exemples compose, reverse proxy, healthcheck, multi-arch, provenance/SBOM. Remplace le README principal (31k chars, trop long) pour le champ "Overview" Docker Hub.
- **Sync automatique Docker Hub** dans `release.yml` : nouveau step `peter-evans/dockerhub-description@v4` après le push de l'image, qui sync `README-docker.md` → champ "Overview" + `short-description` depuis la description GitHub du repo. Skip prereleases + forks sans `DOCKERHUB_TOKEN`. `enable-url-completion: true` réécrit les liens relatifs en absolus vers GitHub raw (badges fonctionnent).

### Changed

- **Scope requis `DOCKERHUB_TOKEN`** : documentation clarifiée — le token doit avoir **Read, Write, Delete** (pas "Public Repo Read-only") pour pusher la description (write-only operation).

## [2.0.0] - 2026-05-23

> **Promotion de [`2.0.0-alpha`](#200-alpha---2026-05-21) en stable** apres smoke test reel : conteneur Docker pull/run depuis Docker Hub, discovery `/.well-known/oauth-protected-resource` + 401 challenge `WWW-Authenticate` verifies, rejet du scheme non-Bearer confirme, handshake MCP `initialize` traverse end-to-end (serverInfo `2.0.0-alpha`, protocol `2025-06-18`).

Aucun changement de code par rapport a 2.0.0-alpha. Seule difference : README mis a jour (badges Docker Hub + GHCR, section *Docker (image officielle)* qui liste les deux registres miroirs avec leurs liens, note sur le scoping des tags de prerelease). Pour le contenu fonctionnel de la 2.x, voir l'entree 2.0.0-alpha ci-dessous.

### Migration depuis 1.x

- **Transport stdio** : aucune action. JWT / BasicAuth via env vars (`BOOND_USER_TOKEN` + `BOOND_CLIENT_TOKEN` + `BOOND_CLIENT_KEY`, ou `BOOND_API_TOKEN`, ou `BOOND_USER` + `BOOND_PASSWORD`) fonctionnent comme avant.
- **Transport HTTP** : breaking. Si tu utilisais `MCP_HTTP_BEARER_TOKEN` comme shared secret transport-level, supprime-le — il a disparu (il est remplace par l'OAuth Bearer per-user porte par chaque requete). Si tu publiais des credentials Boond cote serveur (env vars JWT/BasicAuth sur le conteneur HTTP), supprime-les egalement — le serveur n'en a plus besoin. A la place : enregistre une App OAuth2 dans BoondManager (*Administration -> Apps -> Security*) et configure ton client MCP pour qu'il fasse la danse OAuth contre Boond, le serveur ne fait que forwarder le Bearer. Procedure complete dans `docs/oauth.md`.

## [2.0.0-alpha] - 2026-05-21

> **Breaking change majeur** : le transport HTTP passe d'une auth shared-secret + JWT cote serveur a une auth OAuth2 *protected resource* (le Bearer token est porte par chaque requete MCP). Pas de migration possible — c'est une nouvelle architecture, d'ou le bump majeur. Le transport stdio reste inchange. Voir `docs/oauth.md` pour la procedure complete.

### Added

- **OAuth2 protected resource sur le transport HTTP.** Le serveur HTTP devient un *protected resource* (spec MCP Authorization 2025-06-18 + RFC 9728) : **aucun secret n'est detenu cote serveur** (pas de `client_secret`, pas de refresh token, pas de stockage utilisateur). Chaque requete MCP doit porter `Authorization: Bearer <boond_access_token>` ; le serveur transmet le token verbatim a BoondManager. Le **client MCP** (Claude Desktop, Claude Code, gateway…) execute la danse OAuth contre BoondManager directement et gere son propre refresh. Multi-tenant par construction : chaque utilisateur agit sous sa propre identite Boond (audit log preserve).
- **Discovery RFC 9728** : nouvel endpoint public `/.well-known/oauth-protected-resource` (et son variant path-suffixe `…/{MCP_HTTP_PATH}` per §3.2) qui annonce `resource`, `authorization_servers`, `bearer_methods_supported`, et `scopes_supported`. Les 401 emettent un challenge `WWW-Authenticate: Bearer realm="…", resource_metadata="…"` permettant aux clients MCP conformes de decouvrir automatiquement l'authorization server BoondManager.
- **Provider d'auth dynamique** dans `boond-client` (`initClientWithAuth()` + `oauthContextAuth`) : resolution de l'en-tête par requete via `AsyncLocalStorage`, qui isole les Bearer tokens entre utilisateurs concurrents sur la meme instance HTTP.
- **Packaging Docker** entierement stateless (HTTP+OAuth2) : `Dockerfile` sans volume, `docker-compose.yml` reduit a un seul service, `.env.example` qui ne contient que des variables optionnelles. Plus de profile `bootstrap`, plus de credentials a persister. L'healthcheck cible le endpoint de discovery (200 sans auth).
- **Publication Docker dual-registry.** Le workflow `release.yml` pousse maintenant l'image multi-arch a la fois sur GHCR (`ghcr.io/fauguste/boondmanager-mcp-server`) et sur Docker Hub (`docker.io/{DOCKERHUB_USERNAME}/boondmanager-mcp-server`), avec les memes tags `:X.Y.Z` / `:X.Y` / `:X` / `:latest`. La publication Docker Hub est conditionnee a la presence du secret `DOCKERHUB_TOKEN`, pour que les forks sans configuration ne fassent pas echouer le release.
- **Nouveau workflow manuel `.github/workflows/docker-publish.yml`** (`workflow_dispatch`) pour pousser un tag ad-hoc (RC, branche feature, re-publication) sur les deux registries sans re-couper de release npm. Inputs : `tag`, `ref` (git ref), `platforms`, `push_latest`.
- Documentation complete : `docs/oauth.md` reecrit avec le bon modele (client-side OAuth, server passthrough, discovery), section *Authentication* de `CLAUDE.md`, section HTTP du README.

### Changed

- **`BoondConfig` passe a un `BoondAuthProvider` async** (resolution per-request) ; `initClient()` (stdio) reste inchange du point de vue API. Stdio garde les 3 methodes JWT / BasicAuth existantes (`BOOND_USER_TOKEN`+`CLIENT_TOKEN`+`CLIENT_KEY`, `BOOND_API_TOKEN`, `BOOND_USER`+`PASSWORD`).
- **Nouvelle variable `MCP_HTTP_PUBLIC_URL`** pour annoncer la bonne URL externe derriere un reverse proxy.

### Removed

- **`MCP_HTTP_BEARER_TOKEN`** : superflu — l'auth est portee par le Bearer OAuth2 du user, pas par un secret partage cote transport.
- **CLI `boondmanager-mcp-oauth-login`** + bin + script `oauth:login` : plus de bootstrap serveur, le client fait la danse OAuth directement.

### Tests

- **+34 tests** (`src/services/oauth.test.ts` reecrit : 25 tests sur l'extraction Bearer, l'AsyncLocalStorage, la metadata RFC 9728 ; nouveau bloc `oauthContextAuth` dans `boond-client.test.ts` qui couvre l'isolation multi-tenant concurrente ; +6 tests d'integration HTTP couvrant 401+challenge, discovery sur les deux variants, override de l'authorization server). **471 tests passants** au total.

## [1.9.1] - 2026-05-20

Patch correctif sur les trois outils `boond_resources_reference_{create,update,delete}` introduits en 1.9.0. La spec d'origine (issue #79) supposait des endpoints REST autonomes (`POST /resources/{id}/references`, `PUT /references/{id}`, `DELETE /references/{id}`) — sondage live de l'API : aucun de ces endpoints n'existe. Les références sont **embarquées** dans le DT (sous-objet `attributes.references[]` de `/resources/{id}/technical-data`), donc tout le CRUD passe par un `PUT /resources/{id}/technical-data` avec la liste complète à jour.

### Corrigé

- **`boond_resources_reference_create`** (`src/tools/resources.ts`, `src/schemas/index.ts`) — GET DT courant, append de la nouvelle référence, PUT de la liste complète. `description` devient requis côté schéma : sans, l'API renvoie `1017 - Missing required attribute`.
- **`boond_resources_reference_update`** — requiert désormais `resourceId` en plus de `referenceId` (le tool doit fetch le DT pour patcher). Read-modify-write : GET, localise la référence par id, patch uniquement les champs fournis, PUT. Si l'id n'est pas trouvé, retourne `isError: true` avec la liste des ids existants au lieu de laisser passer un 404 opaque.
- **`boond_resources_reference_delete`** — même pattern read-modify-write, ref filtrée par id. Requiert aussi `resourceId`.
- **Sanitization `normalizeReferenceForApi`** (exportée) — l'API Boond renvoie `""` sur GET pour les dates vides mais **rejette `""` en PUT** (`1002 - Wrong or missing attribute`). Sans normalisation, un PUT qui ré-émet la liste existante échoue sur chaque référence ayant des dates non remplies. Strip les valeurs `null` / `undefined` / `""` de chaque référence avant l'envoi.
- **Schéma dates** — `startMonth` / `endMonth` coerces vers int 1..12, `startYear` / `endYear` vers int 4 chiffres. L'API rejette explicitement `"05"` (`1002`) — accepte int `5` ou string `"5"`.

### Tests

- **+2 tests** dans `src/tools/resources.test.ts` couvrant `isError: true` quand l'id de référence est introuvable (sur update et delete). **442 tests passants** (vs 440 en 1.9.0).
- **Validé live** sur Damien FRANCES (#36639, 7 références) : `reference_update` a rempli `startMonth: 5 / startYear: 2024 / endMonth: 1 / endYear: 2026` sur la référence Silamir Group, les 6 autres références préservées intactes, title/company/description de la référence patchée non touchés.

## [1.9.0] - 2026-05-20

Le dossier technique (DT) d'une ressource passe en écriture. Jusqu'ici, `boond_resources_technical_data` permettait seulement de lire (compétences, outils, langues, expertises, références), et la seule route d'update côté ressources (`boond_resources_update`) ne couvrait que les champs d'identité. Cas d'usage déclencheur : le formulaire Google Forms envoyé aux consultants Silamir doit pouvoir réinjecter en masse les compétences/expériences déclarées sans saisie manuelle ressource par ressource.

### Ajouté

- **`boond_resources_technical_data_update`** (`src/tools/resources.ts`, `src/schemas/index.ts`) — `PUT /resources/{id}/technical-data`. Deux modes :
  - `mode: "merge"` (défaut, recommandé pour automation) — enrichit sans rien écraser : `skills` (CSV) dédupliquées en case-insensitive avec préservation du casing existant ; `tools` / `languages` ajoutés uniquement si le slug/la langue est nouveau (les niveaux existants ne sont **jamais** écrasés) ; `expertiseAreas` / `activityAreas` / `diplomas` unionnés ; `title` / `summary` / `training` / `experience` ne sont remplis QUE si actuellement vides. Si rien ne change, l'outil court-circuite sans PUT.
  - `mode: "replace"` — remplace intégralement chaque champ fourni.
  Les clés absentes de l'appel ne sont jamais émises dans la requête → garde-fou contre l'écrasement implicite d'une valeur existante par `""`.
- **`boond_resources_reference_create`** — `POST /resources/{id}/references`. Crée une expérience professionnelle rattachée au DT (champs requis : `resourceId`, `title`, `company`).
- **`boond_resources_reference_update`** — `PUT /references/{id}`. Met à jour une référence existante ; seuls les champs explicitement fournis sont envoyés à l'API (cas d'usage type : ajouter `startMonth`/`startYear`/`endMonth`/`endYear` sans toucher au titre ni à la description).
- **`boond_resources_reference_delete`** — `DELETE /references/{id}`, flag `destructiveHint`.

Le helper `mergeTechnicalData` est exporté pour les tests unitaires. Catalogue auto-régénéré : 167 → **171 outils**.

Closes #79.

### Tests

- **+15 tests dans `src/tools/resources.test.ts`** (registration, annotations, handlers `technical_data_update` / `reference_create` / `reference_update` / `reference_delete`) + 7 tests isolés du merge couvrant : skills CSV case-insensitive, niveau d'outil/langue préservé sur entrée existante, scalaires non écrasés quand déjà remplis, dédup string-arrays. **440 tests passants** (vs 425 en 1.8.2).
- **Validé en live** sur le profil de l'auteur contre `https://ui.boondmanager.com/api` : lecture DT, PUT merge ajoutant un skill + un diplôme de test (les 2 diplômes existants et les 3 outils restent intacts), rollback ramenant le DT à l'état initial.

## [1.8.2] - 2026-05-08

Correction d'authentification : le client n'arrivait plus à se connecter à BoondManager via la méthode JWT (auto-construit ou pré-construit). L'API renvoyait `422 - Signature verification failed (parameter: jwt)` à chaque requête. Cause : le JWT était envoyé dans `Authorization: Bearer …`, alors que la spec officielle BoondManager exige le header dédié `X-Jwt-Client-Boondmanager`. Le mode BasicAuth (`BOOND_USER` + `BOOND_PASSWORD`) restait fonctionnel via `Authorization: Basic …`.

### Corrigé

- **Header d'auth JWT** (`src/services/boond-client.ts`, `src/types.ts`) — `initClient()` route désormais le JWT (auto-construit depuis `BOOND_USER_TOKEN` + `BOOND_CLIENT_TOKEN` + `BOOND_CLIENT_KEY`, ou pré-construit via `BOOND_API_TOKEN`) dans le header `X-Jwt-Client-Boondmanager` (constante exportée `JWT_HEADER_NAME`). BasicAuth continue d'utiliser `Authorization: Basic …`. `BoondConfig` passe de `{ baseUrl, authHeader }` à `{ baseUrl, authHeaderName, authHeaderValue }` pour porter le nom du header. Validé contre l'API réelle : `GET /application/current-user` répond désormais `200 OK`.

### Tests

- **+3 tests dans `src/services/boond-client.test.ts`** (`apiRequest auth header routing`) qui pinnent le contrat : JWT auto-construit → `X-Jwt-Client-Boondmanager` (pas d'`Authorization`), `BOOND_API_TOKEN` → idem, BasicAuth → `Authorization: Basic …`. **425 tests passants** (vs 422 en 1.8.1).

## [1.8.1] - 2026-05-04

Durcissement sécurité du transport HTTP et relèvement du plancher SDK pour fermer trois CVE remontées par les scanners marketplace.

### Sécurité

- **SDK MCP : plancher relevé à `^1.29.0`** (`package.json`) — la borne basse `^1.12.1` exposait la bibliothèque à trois avis publiés depuis :
  - `GHSA-345p-7cg4-v4c7` / **CVE-2026-25536** — fuite inter-clients via réutilisation d'instances `server`/`transport` (corrigé en 1.26.0).
  - `GHSA-8r9q-7v3j-jr4g` / **CVE-2026-0621** — ReDoS dans `UriTemplate` sur les patterns explosés (`{/id*}`, `{?tags*}`) (corrigé en 1.25.2).
  - `GHSA-w48q-cv73-mx4w` / **CVE-2025-66414** — la protection DNS rebinding n'était pas activée par défaut (atténué en 1.24.0, mais nécessite une configuration explicite côté serveur custom).
  Le lockfile résolvait déjà 1.29.0, mais la borne basse permettait à un consommateur de retomber sur une version vulnérable. La nouvelle borne ferme ce trou.
- **Validation du `Host` header dans le transport HTTP** (`src/transports/http.ts`) — atténue **CVE-2025-66414** au-delà du SDK lui-même. Quand le serveur écoute sur une interface loopback (`127.0.0.1`, `::1`, `localhost`), seuls les `Host` ∈ `{localhost, 127.0.0.1, [::1]}` sont acceptés ; un site malveillant qui exploiterait un DNS rebinding pour pointer un domaine arbitraire sur le port local du MCP reçoit désormais un `403 Invalid Host`. Sur un bind non-loopback (Docker, gateway), la validation est désactivée par défaut pour ne pas casser les déploiements derrière un reverse proxy ; pour activer une allow-list explicite, configurer `MCP_HTTP_ALLOWED_HOSTS=mcp.example.com,mcp.internal`. `MCP_HTTP_ALLOWED_HOSTS=*` est le bypass explicite documenté.

### Tests

- 6 tests supplémentaires dans `src/transports/http.test.ts` couvrent : parsing de `MCP_HTTP_ALLOWED_HOSTS`, sélection de la liste par défaut selon l'interface bind, opt-out via `*`, rejet d'un `Host` non listé (HTTP 403 avec message `Invalid Host: <name>`), acceptation d'un `Host` listé.

## [1.8.0] - 2026-05-04

Workaround pour les clients MCP qui mishandlent les prompts : 11 nouveaux outils `boond_workflow_*` qui exposent les mêmes runbooks que les prompts existants, mais via la surface `tools/list`.

### Contexte

Symptôme observé sur **claude.ai (Cowork) > menu connecteur > prompt** : après saisie des paramètres et validation, au lieu d'injecter le runbook comme message utilisateur, le client le sérialise comme une pièce jointe virtuelle nommée `{prompt_name}_text` que le modèle tente de `Read` depuis le dossier d'uploads — fichier qui n'existe pas, donc le modèle demande à l'utilisateur de réessayer ou d'attacher le fichier. Bug côté client (la réponse `prompts/get` côté serveur reste conforme à la spec MCP), mais bloquant côté UX.

### Ajouté

- **11 outils `boond_workflow_*`** (`src/tools/workflows.ts`) miroir 1:1 des prompts existants : `synthese_equipe`, `pipeline_commercial`, `factures_a_relancer`, `candidats_pour_opportunite`, `fiche_consultant`, `recap_hebdo`, `staffing_disponible`, `fin_de_mission`, `cartographie_competences`, `cvs_a_mettre_a_jour`, `recherche_profil_competences`. Chaque outil partage **exactement** le `build()` et l'`argsSchema` de son prompt source (export de `PROMPTS` depuis `src/prompts/index.ts`) — pas de duplication. Annotations : `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false` (le runbook est synthétisé localement, l'agent l'exécute ensuite via les autres outils Boond).
- **Tests** : `src/tools/workflows.test.ts` (7 tests) — vérifie la parité tool↔prompt sur les noms, le schéma d'arguments, les annotations, et l'égalité `tool.callback({}) === prompt.build({})` pour `synthese_equipe`. Total : **413 tests passants** (vs 406 en 1.7.5).

### Aucune rupture

- Les **11 prompts MCP restent enregistrés** — Claude Desktop / Claude Code continuent de les utiliser comme avant. Les nouveaux outils sont une surface additionnelle, pas un remplacement. Le total monte à **167 outils** (156 + 11 workflows), 11 prompts, 21 ressources. Les 156 outils existants, leurs noms, schémas et annotations sont strictement inchangés.

### Comment l'utiliser dans claude.ai (Cowork)

Plus besoin de passer par le menu prompts : décrire la tâche en langage naturel et le modèle choisit le `boond_workflow_*` correspondant (`« fais-moi la synthèse de l'équipe de Jean Dupont sur le mois en cours »` → `boond_workflow_synthese_equipe`).

## [1.7.5] - 2026-05-04

Tournée de bugfixes après un test bout-en-bout du serveur contre un tenant BoondManager réel : sept outils renvoyaient soit un 422 « 1017 - Missing required attribute » silencieux (paramètre manquant côté schéma), soit un crash JavaScript, soit un message d'erreur opaque. Tous corrigés.

### Corrigé

- **`boond_timesheets_search` — schéma aligné sur l'API** (`src/schemas/index.ts`, `src/tools/timesheets.ts`) — l'endpoint `/times-reports` exige `startMonth` + `endMonth` au format `YYYY-MM` ; le schéma envoyait `startDate`/`endDate` au format `YYYY-MM-DD`. Conséquence : tout appel renvoyait un 422 quels que soient les arguments. Le schéma rejette maintenant les appels sans `startMonth`/`endMonth` (regex `^\d{4}-\d{2}$`) et la description du tool annonce les champs requis.
- **`boond_validations_search` — nouveau schéma RAML-fidèle** (`ValidationSearchSchema`) — `startMonth`/`endMonth` désormais requis (mêmes contraintes qu'au-dessus), plus les filtres officiels `documentTypes` (`absencesReport`/`timesReport`/`expensesReport`), `validationStates` (`waitingForValidation`/`validated`/`rejected`), `resourceTypes`, `validationAlerts`, `keywords` (préfixes `TPS`/`EXP`/`ABS`/`COMP`).
- **`boond_notifications_search` — `category` enforced** (`NotificationSearchSchema`) — l'endpoint refuse toute requête sans le paramètre singulier `category` ∈ {`activity`, `thread`, `corporate`}. Schéma typé en `z.enum`, plus filtres optionnels `state` (`new`/`read`) et `parentType[]`.
- **`boond_reporting_*` — schémas de date par endpoint** (`ReportingDateRequiredSchema` / `ReportingDateOptionalSchema`) — `companies`, `resources`, `synthesis` et `production_plans` exigent `startDate` + `endDate` (YYYY-MM-DD) ; `projects` les accepte mais ne les requiert pas. La factory `registerReportingTools` choisit le schéma adapté par endpoint.
- **`boond_calendars_search` — plus de crash sur réponse non JSON:API** (`src/services/boond-client.ts::formatEntitySummary`) — `/calendars` retourne des items plats `{iso, value, subCalendars}` sans le wrapper `attributes` ; l'ancien formatter accédait à `attributes.firstName` et levait `Cannot read properties of undefined`. Le formatter accepte maintenant les deux formes (avec/sans wrapper) et émet `value` + `ISO:` pour les items dictionnaires.
- **Erreurs API plus actionnables** (`parseBoondErrorBody`) — `errors[].source.parameter` (et `source.pointer` à défaut) est désormais surfacé dans le message. `1017 - Missing required attribute` devient `1017 - Missing required attribute (parameter: startMonth)` — l'agent (humain ou LLM) sait quoi corriger.
- **Détection des blocs Cloudflare WAF** (`formatApiError`) — quand le corps de réponse 4xx est une page de challenge Cloudflare (`<title>Attention Required! | Cloudflare</title>`, `cf-ray`, …), le message d'erreur le signale explicitement (`request blocked by Cloudflare WAF before reaching the API`) au lieu d'afficher le HTML brut suivi du faux indice « the user lacks permission ». Évite les fausses pistes côté debug quand la requête n'a jamais atteint BoondManager.

### Tests

- **+5 tests unitaires** ciblant les fixes : surface de `source.parameter`/`source.pointer` dans `parseBoondErrorBody`, détection des pages de challenge Cloudflare dans `formatApiError`, formatter défensif `formatEntitySummary` sur entités sans wrapper `attributes`, rejet du nouveau `TimesheetSearchSchema` sans `startMonth`/`endMonth` ou en `YYYY-MM-DD`. **406 tests passants** (vs 401 en 1.7.4).

### Aucune rupture côté outils

- Les noms d'outils, le nombre d'outils (156) et les arguments existants des autres tools sont inchangés. Seuls les **paramètres requis** des 4 tools listés ci-dessus changent — mais ces tools renvoyaient un 422 si on ne passait pas ces paramètres, donc tout caller fonctionnel passait déjà l'équivalent (ou n'arrivait pas à utiliser le tool). Le rejet est désormais en amont (schéma Zod) avec un message explicite.

## [1.7.4] - 2026-05-03

Hotfix metadata du bundle `.mcpb` : ajoute la déclaration `prompts_generated: true` au `manifest.json` pour que Claude Desktop accepte les 11 prompts dynamiques.

### Corrigé

- **`manifest.json` — `prompts_generated: true`** — sans cette déclaration, Claude Desktop loggait `[warn] Extension BoondManager MCP Server attempted undeclared prompt: synthese_equipe` à chaque tentative d'attachement de prompt et bloquait l'appel `prompts/get` **côté client** (1 ms après émission, jamais reçu par le serveur). Symptôme côté UI : "Failed to attach prompt. You can try again." Le manifest avait déjà `tools_generated: true` pour les 156 outils générés dynamiquement ; le pendant pour les prompts manquait simplement. Cf. [spec MCPB MANIFEST.md](https://github.com/anthropics/mcpb/blob/main/MANIFEST.md) — un client conforme "should only look for tools/prompts present in the manifest.json" sauf si les flags `*_generated: true` sont posés.

### Aucune rupture

- Aucun changement de code (TypeScript inchangé). Seuls `manifest.json`, `package.json`, `server.json` et `package-lock.json` sont touchés. **Tous les utilisateurs ayant installé un `.mcpb` v1.7.3 ou antérieur doivent réinstaller** pour pouvoir attacher les prompts (`synthese_equipe`, `pipeline_commercial`, `staffing_disponible`, etc.) dans Claude Desktop.

## [1.7.3] - 2026-05-03

Hotfix critique de l'outil `boond_application_dictionary` et des ressources `boond://dictionary/*` : depuis l'origine, ces deux surfaces appelaient un endpoint qui n'existe pas (`/application/dictionaries/{slug}`, pluriel) et retournaient systématiquement un **404 BoondManager**, ce qui bloquait notamment l'attachement de ressources dans Claude Desktop ("Failed to attach resource"). L'API officielle expose en réalité un endpoint unique `/application/dictionary` (singulier) qui renvoie l'intégralité des dictionnaires en une seule réponse, structurée en `data.setting.*`, `data.country`, `data.languages`.

### Corrigé

- **Endpoint dictionnaire** — le tool `boond_application_dictionary` et toutes les ressources `boond://dictionary/*` appellent désormais `GET /application/dictionary` (cf. `https://doc.boondmanager.com/api-externe/raml-build/resources/application/dictionary.raml`). Le paramètre `dictionaryType` accepte un **chemin dotté** dans la réponse (`setting.state.resource`, `setting.tool`, `country`, …) au lieu de l'ancien slug pluriel inopérant. Un message d'aide explicite est renvoyé si le chemin n'existe pas (avec rappel : "states/resources" → "setting.state.resource").
- **Ressources MCP recalibrées** — la liste exposée reflète désormais ce qui existe vraiment côté API. Slugs supprimés (404 garanti) : `states/absences`, `typeOf/candidates`, `typeOf/actions`, `typeOf/absences`. Slugs ajoutés (utiles aux prompts staffing/skills) : `tools`, `expertiseAreas`, `experiences`, `activityAreas`, `mobilityAreas`. Total ressources : **21** (vs 20 en 1.7.2).

### Ajouté

- **Cache mémoire du dictionnaire** (`src/services/dictionary.ts`) — la réponse `/application/dictionary` est volumineuse (centaines de Ko) et stable. Elle est désormais récupérée **une seule fois par process** (TTL configurable via `BOOND_DICTIONARY_TTL_MS`, défaut 1h), avec déduplication des appels concurrents (un seul fetch en parallèle pour N reads simultanés au démarrage de session). Erreurs réseau ne polluent pas le cache (le prochain appel re-tente). Tests : `src/services/dictionary.test.ts` couvre cache hit, force-refresh, expiration TTL, dedup concurrent, retry après échec, et résolution de chemin (segments imbriqués, paths inconnus, paths vides). Service exporté `resetDictionaryCacheForTests()` pour les tests qui en ont besoin.

### Aucune rupture

- Les 156 outils, 11 prompts, schémas Zod et endpoints autres que `/application/dictionary` sont strictement inchangés. Côté UX : l'outil `boond_application_dictionary` accepte le même nom de paramètre (`dictionaryType`) — seules les valeurs valides changent (dotté plutôt que slash).

## [1.7.2] - 2026-05-02

Hotfix critique du bundle `.mcpb` (bloquant depuis la 1.6.0) et amélioration ergonomique des prompts (saisie par nom au lieu de l'ID).

### Corrigé

- **`.mcpbignore`** — le pattern `src/` (non ancré) excluait **récursivement** tous les dossiers `src/` du bundle, y compris `node_modules/real-require/src/index.js`. Or `real-require` est une dépendance transitive de **Pino** (logger structuré introduit en 1.6.0) et son `package.json` pointe `main: "src/index.js"` — donc dès que Pino chargeait `real-require` au démarrage, `uncaughtException`, le process MCP mourait juste après avoir répondu à `initialize`. Symptôme côté Claude Desktop : `Server transport closed unexpectedly` immédiatement après la connexion, sans la moindre trace dans `mcp-server-*.log` (l'erreur partait dans `main.log`). Tous les patterns critiques sont désormais ancrés à la racine (`/src/`, `/tsconfig.json`, `/.github/`, `/coverage/`, `/.vscode/`, `/.idea/`, `/.claude/`, `/CLAUDE.md`, `/eslint.config.js`). Les patterns de fichiers (`*.test.ts`, `*.log`, `.env*`, etc.) restent intentionnellement non-ancrés. **Tous les utilisateurs ayant installé un `.mcpb` v1.6.0/1.7.0/1.7.1 sont concernés et doivent mettre à jour.**

### Ajouté

- **Résolution polymorphe ID / nom dans tous les prompts** (`src/prompts/index.ts`) — les arguments `manager_id`, `society_id`, `opportunity_id`, `resource_id`, `agency_id` acceptent désormais soit un ID numérique (comportement antérieur, inchangé), soit un libellé textuel (« Prénom Nom », nom de société, intitulé d'opportunité, nom d'agence). Quand l'entrée n'est pas numérique, le runbook injecte une étape préalable de résolution via le `*_search` correspondant (avec `keywords` + `pageSize: 5`) et utilise un placeholder (`<MANAGER_ID>`, `<SOCIETE_ID>`, …) que le LLM substitue par l'`id` retenu. Si plusieurs candidats matchent, le prompt demande confirmation à l'utilisateur. Couvre les 10 prompts qui prennent une référence d'entité ; `recap_hebdo` est inchangé (pas d'ID en entrée). Tests : 11 nouveaux cas dans `src/prompts/index.test.ts` couvrant chaque prompt + un test négatif vérifiant que les IDs numériques bypassent toujours la résolution. Aucun changement pour les anciens appels qui passaient un ID numérique.

### Aucune rupture

- Les 156 outils, 11 prompts existants, 20 ressources et schémas Zod sont strictement inchangés. Les noms d'arguments des prompts (`manager_id`, etc.) sont préservés — seule la sémantique d'entrée s'élargit.

## [1.7.1] - 2026-05-02

Patch metadata pour finaliser la publication de 1.7.0 sur le **MCP Registry** et **GHCR**. La 1.7.0 a bien été publiée sur **npm** et **GitHub Releases** (`.mcpb` attaché), mais les étapes suivantes du workflow ont échoué — corrigé ici. Aucun changement de comportement côté serveur (mêmes 156 outils, 11 prompts, 20 ressources).

### Corrigé

- `package.json`, `manifest.json`, `server.json` : la `description` introduite en 1.7.0 (`"... 156 tools, 11 prompts, 20 resources across 36 domains for ERP/CRM data"`, 104 caractères) dépassait la limite de **100 caractères** imposée par le MCP Registry (`mcp-publisher` rejet 422 `body.description: expected length <= 100`). Conséquence en 1.7.0 : la publication MCP Registry et la construction de l'image Docker (étapes ultérieures du job) n'avaient pas pu s'exécuter. 1.7.1 raccourcit la description à `"MCP Server for BoondManager API - 156 tools, 11 prompts, 20 resources (ERP/CRM)"` (79 caractères) et republie l'ensemble (npm + GitHub Release + .mcpb + MCP Registry + GHCR).

### Note

- Pour les utilisateurs ayant déjà installé 1.7.0 via npm ou via le bundle Claude Desktop, **aucune action n'est requise** — le code et les outils sont strictement identiques entre 1.7.0 et 1.7.1, seules les chaînes de description des manifestes changent.

## [1.7.0] - 2026-05-02

Release axée sur les **workflows ressources / staffing** et l'**observabilité de l'API BoondManager**. Cinq nouveaux prompts MCP couvrent les usages quotidiens des managers et chargés de staffing, et un système de monitoring hebdomadaire détecte les évolutions de l'API officielle pour anticiper les ruptures côté serveur.

### Ajouté

- **5 nouveaux prompts MCP staffing & compétences** (`src/prompts/index.ts`) — passe de 6 à **11 prompts** pré-orchestrés :
  - `staffing_disponible` — qui est dispo bientôt, avec quelles compétences, sur quel périmètre.
  - `fin_de_mission` — détecte les missions qui se terminent dans les N prochaines semaines pour préparer le re-staffing.
  - `cartographie_competences` — recense les compétences de l'équipe (CV + skills déclarées) et les croise avec un périmètre manager / agence.
  - `cvs_a_mettre_a_jour` — repère les consultants dont le CV est ancien ou incomplet pour un audit qualité.
  - `recherche_profil_competences` — recherche multi-sources (resources + candidates) avec scoping manager / agence et gestion de la disponibilité.
  Chaque prompt utilise les filtres officiels (`perimeterDynamic`, `perimeterManagers`, `available`, `keywordsType: titleSkills`, etc.) — le serveur fournit le runbook, le LLM exécute. Catalogue auto-régénéré dans `TOOLS.md` (11 prompts).
- **Système de monitoring de l'API BoondManager** (`.github/workflows/api-monitor.yml`) — workflow GitHub Actions hebdomadaire (lundis 9h UTC) qui scrappe la documentation officielle (`https://doc.boondmanager.com/api-externe/raml-build/`), compare avec le snapshot précédent (`.github/api-snapshot.json`), et **ouvre une issue GitHub automatiquement** si de nouvelles ressources / paramètres sont détectés. Permet d'anticiper les changements amont avant qu'ils ne cassent les schémas Zod côté serveur. Le workflow dépose aussi des artefacts (snapshot brut + diff) pour audit. Workflow de test (`api-monitor.test.yml`) déclenchable manuellement pour valider le scraper sans bruit dans les issues. Documentation complète dans `.github/API_MONITORING.md`, `.github/ARCHITECTURE.md` et `.github/DEPLOYMENT_CHECKLIST.md`.
- **Script de test local du monitor** (`scripts/test-api-monitor.cjs`) — exécutable hors CI (`npm run api:monitor:test` / `--save`) pour itérer sur le scraper sans pousser à GitHub.

### Corrigé

- **Robustesse du scraper API** (`api-monitor.yml` + `api-monitor.test.yml`) — gestion explicite des HTTP 403 renvoyés par Cloudflare/WAF lors d'exécutions depuis des IPs filtrées. Ajout de headers HTTP réalistes (User-Agent, Accept, Accept-Language) pour traverser la protection, détection du header `cf-ray` pour identifier un blocage Cloudflare, sortie propre avec message informatif au lieu d'un échec silencieux. Timeout passé de 10 s à 30 s pour absorber la latence du site officiel.

### Améliorations internes

- **Documentation README** — section "Prompts" enrichie avec la liste complète des 11 prompts, instructions d'invocation et exemples d'usage côté client MCP.
- **Permissions GitHub Actions explicites** — `api-monitor.test.yml` déclare désormais `permissions: { contents: read }` (alerte CodeQL résolue).
- **Mises à jour de dépendances** (Dependabot, sans rupture) :
  - `actions/checkout@4 → 6`, `actions/upload-artifact@4 → 7`
  - `docker/setup-qemu-action@3 → 4`, `docker/login-action@3 → 4`, `docker/build-push-action@6 → 7`
  - groupe `dev-dependencies` (3 paquets) — TypeScript-eslint et outils de test alignés.

### Aucune rupture

- Les 156 outils, 6 prompts existants, 20 ressources et schémas Zod sont strictement inchangés. Les 5 nouveaux prompts s'ajoutent et n'écrasent rien.
- Le système de monitoring est **purement observationnel** : aucun appel sortant supplémentaire à l'API BoondManager depuis le serveur MCP, aucune dépendance d'exécution ajoutée — tout vit dans `.github/` et `scripts/`.

## [1.6.0] - 2026-04-26

Release axée sur l'**ergonomie développeur, la qualité du code et la robustesse en production**. Ajout du formatage automatique, d'un logger structuré pour l'observabilité, de validations strictes sur les métadonnées MCP, et d'un plafond de pagination pour éviter les requêtes excessives.

### Ajouté

- **Prettier + Husky + lint-staged** — formatage automatique du code (TypeScript, JSON) au commit via pre-commit hooks. Configuration : 2 espaces, single quotes, trailing commas ES5, pas de point-virgule sauf nécessaire. Commandes : `npm run format`, `npm run format:check`.
- **Logger structuré (Pino)** — journalisation structurée avec niveaux configurables (`LOG_LEVEL`: trace/debug/info/warn/error/fatal) et formats (`LOG_FORMAT`: json/pretty). Chaque requête HTTP reçoit un `corrId` (8 hex) pour tracer les appels dans la stack. Utilisé dans le transport HTTP pour loguer les requêtes/réponses et les erreurs. Implementation : `src/services/logger.ts`.
- **Validation des longueurs de descriptions** — tests automatiques (`src/tools/descriptions.test.ts`) qui vérifient que les descriptions MCP ne dépassent pas les limites : tools ≤2000 chars, prompts ≤3000 chars, resources ≤1000 chars. Garde-fou contre la dilution du contexte LLM. Fait échouer la CI si une description est trop longue.
- **Plafond de pagination sur les recherches** — `MAX_SEARCH_PAGE = 100` (configurable dans `src/constants.ts`). À 500 résultats/page, page 100 = 50 000 enregistrements — au-delà, le modèle doit affiner les filtres au lieu d'itérer indéfiniment. Les schémas Zod rejettent `page > MAX_SEARCH_PAGE` à la validation d'entrée avec un message d'erreur clair. Rationale documentée dans `CLAUDE.md`.
- **Utilisation de `package.json` pour `SERVER_VERSION`** — le transport HTTP lit la version depuis `package.json` plutôt qu'une constante codée en dur. Une seule source de vérité pour la version du serveur.

### Amélioré

- **Documentation développeur** — section "Search Pagination Limits" ajoutée dans `CLAUDE.md` expliquant le pourquoi du plafond (éviter les spirales de pagination avec `openWorldHint: true`) et comment ça marche (validation Zod côté client).
- **Couverture de tests** — 4 nouveaux tests pour les limites de descriptions (tools, prompts, resources) + 1 test pour la validation de `MAX_SEARCH_PAGE`.

### Aucune rupture

- Les outils, prompts et ressources existants sont inchangés — les descriptions qui respectaient déjà les limites passent sans modification.
- Le comportement de recherche reste identique pour les requêtes ≤100 pages — la limite n'affecte que les cas extrêmes (non-filtrés ou trop larges).

## [1.5.3] - 2026-04-26

Patch metadata pour finaliser la publication de 1.5.2 sur le MCP Registry
et GHCR. La 1.5.2 a bien été publiée sur **npm** et **GitHub Releases**
(`.mcpb` attaché), mais les étapes suivantes du workflow ont échoué à
cause d'un format de schéma incompatible dans `server.json` — résolu ici.
Aucun changement de comportement côté serveur.

### Corrigé

- `server.json` : `icons[].sizes` était une chaîne (`"128x128"`), le
  binaire `mcp-publisher` (Go) attend un tableau de chaînes
  (`["128x128"]`). Le JSON Schema MCP Registry tolérait les deux formes,
  pas le publisher. Conséquence en 1.5.2 : la publication MCP Registry
  et la construction de l'image Docker (étapes ultérieures) n'avaient
  pas pu s'exécuter. 1.5.3 republie l'ensemble (npm + GitHub Release
  +.mcpb + MCP Registry + GHCR) avec la correction.

### Note

- Pour les utilisateurs ayant déjà installé 1.5.2 via npm ou via le
  bundle Claude Desktop, **aucune action n'est requise** — le code et
  les outils sont strictement identiques entre 1.5.2 et 1.5.3, seule la
  forme du fichier de métadonnées MCP Registry change.

## [1.5.2] - 2026-04-26

Release principalement orientée **distribution, ergonomie pour le LLM et
qualité d'exploitation**. Aucune rupture sur les outils existants — les
six schémas de recherche corrigés en 1.5.1 sont conservés tels quels. Les
nouveautés ci-dessous s'ajoutent par-dessus.

### Ajouté

- **Prompts MCP pré-orchestrés** (`src/prompts/`) — 6 templates qui
  enchaînent les bons appels d'outils avec les bons filtres officiels
  (`perimeterDynamic`, `perimeterManagers`, `period`, etc.) :
  `synthese_equipe`, `pipeline_commercial`, `factures_a_relancer`,
  `candidats_pour_opportunite`, `fiche_consultant`, `recap_hebdo`.
  Visible comme slash-command dans les clients qui supportent les
  prompts MCP. Le serveur n'exécute rien — il fournit le runbook au
  modèle.
- **Ressources MCP (dictionnaires)** (`src/resources/`) — 19 ressources
  statiques sous `boond://dictionary/*` (états + types pour les six
  domaines de recherche, plus pays / devises / langues) et
  `boond://application/current-user`. Permet au modèle de traduire un
  `state` ou `typeOf` entier en libellé via une lecture de ressource
  plutôt qu'un appel d'outil. Mime-type `application/json`.
- **Image Docker multi-arch sur GHCR** —
  `ghcr.io/fauguste/boondmanager-mcp-server` publiée à chaque tag
  (`linux/amd64` + `linux/arm64`) avec provenance et SBOM. Démarre par
  défaut en transport HTTP sur `0.0.0.0:3000`. Tags `:X.Y.Z`, `:X.Y`,
  `:X`, `:latest`.
- **Listing Smithery** (`smithery.yaml` à la racine) — config
  d'installation un-clic avec UI pour les 7 paramètres d'auth Boond.
  Synchronisé à chaque push sur `main`.
- **`SECURITY.md`** — politique de divulgation responsable, canal
  privilégié = GitHub Security Advisory privé, tableau des versions
  supportées, scope in/out, garanties sur la gestion des credentials
  (env vars uniquement, aucune persistance, aucun log).
- **Catalogue d'outils auto-généré** (`TOOLS.md`) — 156 outils, 6
  prompts, 20 ressources groupés par domaine (alphabétique). Régénéré
  via `npm run docs:tools`. Une étape CI (`npm run docs:tools:check`)
  fait échouer le build si le catalogue dérive du code source.
- **Documentation distribution** (`docs/distribution.md`) — source
  unique de vérité pour ce qui est publié où (npm, MCP Registry,
  GitHub Releases .mcpb, GHCR, LobeHub, Smithery), comment chaque canal
  est synchronisé, et la checklist post-release en 6 points.
- **`CHANGELOG.md`** — nouvelles entrées en français,
  systématiquement extraites par le workflow Release pour le corps de
  la GitHub Release.
- **Métadonnées `server.json`** — `title`, `websiteUrl`, `repository`,
  `icons[]` (logo via `raw.githubusercontent.com`) pour enrichir la
  fiche MCP Registry et les marketplaces qui en découlent (LobeHub).
- **README** — sections "Ressources MCP", "Prompts pré-orchestrés",
  exemple Docker GHCR, mention Smithery / LobeChat.

### Modifié

- **Messages d'erreur API** (`src/services/boond-client.ts`) — sur
  réponse non-2xx, `parseBoondErrorBody()` extrait `errors[].detail`
  (et `title` quand distinct) du JSON:API d'erreur de Boond, et
  `formatApiError()` produit un message focalisé avec un *hint*
  spécifique par statut (401/403/404/422/429/5xx). Le corps brut n'est
  inclus qu'en repli quand le parsing échoue. Avant : ~500 caractères de
  JSON brut illisibles ; après : `BoondManager API 422 …: 422 -
  password mismatch` + diagnostic.
- **Licence** — passage de **MIT à Apache-2.0**. Voir `LICENSE` et le
  nouveau `NOTICE`. Aucune action utilisateur requise pour les binaires
  déjà installés ; les futurs forks doivent intégrer le `NOTICE`.

### Documentation interne

- **`CLAUDE.md`** rafraîchi — section "Search Filter Naming (CRITICAL)"
  qui cristallise la table de correspondance officielle
  (`mainManagers → perimeterManagers`, `states → resourceStates / candidateStates / opportunityStates / projectStates / typesOf` selon
  l'endpoint, vocabulaire `period` par endpoint, préfixes `keywords`
  `CSOC<id>` / `CCON<id>` / etc.) pour qu'aucun futur agent ne
  redécouvre les noms à tâtons. Sections "Adding a Prompt" et "Adding
  a Resource" ajoutées, "CI/CD" mis à jour avec les 4 publications de
  release et le drift check du catalogue.

### CI/CD

- **`docs:tools:check`** branché dans le workflow CI (Node 22) — toute
  PR qui ajoute / renomme / supprime un tool, prompt ou ressource doit
  régénérer `TOOLS.md` (le check fait échouer le build sinon).
- **Workflow Release étendu** — étapes Docker (QEMU + Buildx + login
  GHCR + build-push multi-arch) en plus des publications npm + MCP
  Registry + GitHub Release existantes.

## [1.5.1] - 2026-04-25

Correctif critique des filtres de recherche structurés introduits en 1.5.0 (#29).
Les filtres étaient silencieusement ignorés par l'API BoondManager parce que les
noms de champs en entrée ne correspondaient pas à la spec officielle RAML
(https://doc.boondmanager.com/api-externe/). Les six outils de recherche —
resources, candidates, contacts, companies, opportunities, projects — ont été
vérifiés en direct sur un tenant réel après cette correction : tous les filtres
annoncés s'appliquent désormais.

### Corrigé
- `boond_resources_search`, `boond_candidates_search`, `boond_contacts_search`,
  `boond_companies_search`, `boond_opportunities_search`,
  `boond_projects_search` : les paramètres d'entrée correspondent maintenant
  exactement aux noms attendus par l'API. Avant, le schéma acceptait des noms
  comme `mainManagers`, `states`, `agencies`, `poles`, `businessUnits`,
  `skills`, `typeOf`, `company`, `contact` que l'API n'honorait jamais —
  chaque appel renvoyait le total non filtré.

### Modifié (rupture sur les inputs des 6 outils de recherche)
- Filtres manager / agence / pôle / BU renommés et unifiés sur les six
  endpoints (issus du trait RAML partagé `searchable`) :
  - `mainManagers` → `perimeterManagers` (IDs entiers)
  - `agencies` → `perimeterAgencies` (IDs entiers)
  - `poles` → `perimeterPoles` (IDs entiers)
  - `businessUnits` → `perimeterBusinessUnits` (IDs entiers)
  - nouveau `perimeterDynamic` (`["data"|"managers"|"agencies"|"poles"|"businessUnits"]`)
    pour cibler « mes données / mes N-1 / mes agences » sans avoir à
    récupérer son propre userId au préalable
  - nouveau `narrowPerimeter` (booléen) : passe les jointures `perimeter*`
    en ET au lieu du OU par défaut
- Filtres états / types renommés par endpoint pour coller à l'API (IDs
  entiers issus de `boond_application_dictionary`) :
  - resources : `states` → `resourceStates`, `typeOf` → `resourceTypes`,
    plus `excludeResourceStates` / `excludeResourceTypes`
  - candidates : `states` → `candidateStates`, `typeOf` → `candidateTypes`
  - opportunities : `states` → `opportunityStates`,
    `typeOf` → `opportunityTypes`
  - projects : `states` → `projectStates`, `typeOf` → `projectTypes`
  - contacts : `typeOf` → `typesOf` (avec un `s` final) ; `states` et
    `companyStates` conservés
  - companies : `states` conservé ; le filtre `typeOf` retiré car
    l'endpoint `/companies` ne le supporte pas en search
- Filtres relationnels : `company` / `contact` (singulier) remplacés par
  `companies` (tableau pluriel, projets seulement) ou par la syntaxe de
  préfixe documentée dans `keywords` (`CSOC<id>`, `CCON<id>`, `CAND<id>`,
  `COMP<id>`, `AO<id>`, `PROD<id>`, `CTR<id>`, `MIS<id>`, `PRJ<id>`)
- Vocabulaire de `period` aligné sur l'API par endpoint (ex. `running`,
  `created`, `started`, `closed`, `available`, `working`, `closingDate`,
  `updatedPositioning`, `withActions`, `withoutActions`, `noAction`, …) —
  l'ancienne enum `creation`/`update`/`startDate`/`endDate` était fausse
- Pagination : `MAX_PAGE_SIZE` passé de 100 à 500 (limite officielle de
  l'API) et `DEFAULT_PAGE_SIZE` de 20 à 30 (défaut officiel)

### Ajouté
- `keywordsType` sur resources / candidates / contacts / companies — permet
  de cibler un champ précis pour la recherche texte (`lastName`,
  `firstName`, `fullName` avec `"NOM#PRENOM"`, `emails`, `phones`, `title`,
  `titleSkills`, `reference`, `resume`, `td`, `socialNetworks`, …).
  Auparavant, la recherche se faisait par défaut dans le CV uniquement,
  sans moyen de surcharger.
- Recherche géographique sur resources et candidates : `coordinates`
  (`"lat,lon"`) ou `location` (adresse libre) combinés à `geoDistance`
  (5–200 km)
- Mode ET pour `tools` : préfixer le tableau par `"#AND#"` pour exiger
  tous les outils listés (par défaut : OU)
- Nouveaux filtres branchés sur l'API :
  - resources : `expertiseAreas`, `experiences`, `trainings`,
    `mobilityAreas`, `languages` (`langueId|niveauId`), `flags`,
    `providerCompanies`, `excludeManager`, `shields`
  - candidates : `expertiseAreas`, `experiences`, `trainings`,
    `mobilityAreas`, `languages`, `flags`, `evaluations`, `sources`,
    `availabilityTypes`, `contractTypes`, `providerCompanies`, `shields`,
    `perimeterManagersType` (`"main"|"hr"`)
  - contacts : `expertiseAreas`, `tools`, `influencers`, `flags`,
    `completeness` (ex. `["email:empty","phone:empty"]`), `shields`
  - companies : `expertiseAreas`, `origins`, `influencers`, `flags`,
    `shields`
  - opportunities : `expertiseAreas`, `tools`, `places`, `durations`,
    `origins`, `flags`, `positioningStates`, `shields`,
    `perimeterManagersType`
  - projects : `expertiseAreas`, `flags`
- Descriptions des six outils de recherche réécrites avec des exemples
  d'appel concrets (mes données / mon équipe, par état, par période, par
  entité liée) pour que le modèle choisisse le bon filtre du premier coup

### Notes
- La validation `strict` est conservée sur chaque schéma de recherche : tout
  appelant qui passerait encore l'ancien nom (`mainManagers`, `agencies`,
  etc.) recevra un rejet clair plutôt qu'un résultat silencieusement non
  filtré.
- Les 274 tests unitaires existants passent ; la vérification en direct sur
  un tenant réel confirme que chaque filtre restreint bien les résultats.

## [1.5.0] - 2026-04-24

### Ajouté
- Schémas Zod structurés pour les recherches resources, candidates,
  contacts, companies, opportunities, projects, avec champs typés (#29)
- Sérialisation des paramètres tableau en notation `key[]=v1&key[]=v2`
- `registerSearchTool` accepte désormais des overrides schema / title /
  description

### Note
- Les filtres structurés introduits en 1.5.0 ne s'appliquaient pas
  réellement sur l'API BoondManager (mauvais noms de paramètres).
  Utiliser 1.5.1 — c'est la version qui rend opérationnel le design des
  filtres de 1.5.0.
