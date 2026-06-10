# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
