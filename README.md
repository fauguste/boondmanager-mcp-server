# BoondManager MCP Server

[![CI](https://github.com/fauguste/boondmanager-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/fauguste/boondmanager-mcp-server/actions/workflows/ci.yml)
[![CodeQL](https://github.com/fauguste/boondmanager-mcp-server/actions/workflows/codeql.yml/badge.svg)](https://github.com/fauguste/boondmanager-mcp-server/actions/workflows/codeql.yml)
[![npm version](https://img.shields.io/npm/v/boondmanager-mcp-server.svg)](https://www.npmjs.com/package/boondmanager-mcp-server)
[![npm downloads](https://img.shields.io/npm/dm/boondmanager-mcp-server.svg)](https://www.npmjs.com/package/boondmanager-mcp-server)
[![Node.js](https://img.shields.io/node/v/boondmanager-mcp-server.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io/)
[![Docker Hub](https://img.shields.io/docker/v/fauguste/boondmanager-mcp-server?label=Docker%20Hub&logo=docker&color=2496ED)](https://hub.docker.com/r/fauguste/boondmanager-mcp-server)
[![GHCR](https://img.shields.io/badge/GHCR-fauguste%2Fboondmanager--mcp--server-181717?logo=github)](https://github.com/fauguste/boondmanager-mcp-server/pkgs/container/boondmanager-mcp-server)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Serveur MCP (Model Context Protocol) pour l'API BoondManager, permettant a Claude (Desktop, Cowork, Code) de rechercher, consulter, creer et modifier des enregistrements dans votre instance BoondManager.

**158 outils** couvrant **36 domaines** de l'API BoondManager. Voir [TOOLS.md](./TOOLS.md) pour le catalogue auto-généré (outils + prompts + ressources).

## Domaines couverts

### CRM & Commercial

| Domaine | Outils | Operations |
|---------|--------|------------|
| **Candidats** | 10 | CRUD + information, technical-data, administrative, actions, positionings |
| **Ressources** | 15 | CRUD + information, technical-data, administrative, advantages, actions, positionings, projects, times-reports, expenses-reports, absences-reports |
| **Contacts** | 11 | CRUD + information, actions, opportunities, projects, orders, invoices |
| **Societes** | 14 | CRUD + information, contacts, actions, opportunities, projects, orders, invoices, purchases, provider-invoices |
| **Opportunites** | 10 | CRUD + information, actions, positionings, projects, simulation |

### Gestion de projets

| Domaine | Outils | Operations |
|---------|--------|------------|
| **Projets** | 12 | CRUD + information, actions, simulation, deliveries-groupments, orders, purchases, productivity |
| **Positionnements** | 4 | search, get, create, delete |
| **Livraisons / CRA** | 2 | search, get |
| **Achats / Sous-traitance** | 4 | search, get, create, delete |

### Facturation & Finance

| Domaine | Outils | Operations |
|---------|--------|------------|
| **Factures client** | 5 | CRUD complet |
| **Factures fournisseur** | 2 | search, get |
| **Bons de commande** | 5 | CRUD complet |
| **Paiements** | 2 | search, get |
| **Notes de frais** | 5 | CRUD complet |
| **Produits** | 5 | CRUD complet |

### RH & Temps

| Domaine | Outils | Operations |
|---------|--------|------------|
| **Absences** | 5 | CRUD complet |
| **Planning absences** | 1 | search (vue globale) |
| **Feuilles de temps** | 3 | search, get, resource timesheets |
| **Contrats** | 2 | get, create |
| **Avantages** | 2 | search, get |

### Suivi d'activite

| Domaine | Outils | Operations |
|---------|--------|------------|
| **Actions** | 4 | search, get, create, delete |
| **Validations** | 2 | search, get |
| **Todolists** | 2 | search, get |

### Reporting

| Domaine | Outils | Operations |
|---------|--------|------------|
| **Reporting societes** | 1 | search |
| **Reporting projets** | 1 | search |
| **Reporting ressources** | 1 | search |
| **Reporting synthese** | 1 | search |
| **Reporting plans de production** | 1 | search |

### Administration & Configuration

| Domaine | Outils | Operations |
|---------|--------|------------|
| **Comptes utilisateurs** | 2 | search, get |
| **Agences** | 2 | search, get |
| **Business Units** | 2 | search, get |
| **Poles** | 2 | search, get |
| **Roles** | 2 | search, get |
| **Calendriers** | 2 | search, get |
| **Drapeaux / Etiquettes** | 2 | search, get |
| **Webhooks** | 2 | search, get |
| **Logs d'audit** | 2 | search, get |
| **Notifications** | 2 | search, get |
| **Fils de discussion** | 2 | search, get |
| **Application** | 2 | dictionnaire, utilisateur courant |

### Detail des onglets par entite

Les entites principales disposent d'outils dedies par onglet pour un acces cible :

| Entite | Onglets disponibles |
|--------|-------------------|
| Candidats | information, technical-data, administrative, actions, positionings |
| Ressources | information, technical-data, administrative, advantages, actions, positionings, projects, times-reports, expenses-reports, absences-reports |
| Contacts | information, actions, opportunities, projects, orders, invoices |
| Societes | information, contacts, actions, opportunities, projects, orders, invoices, purchases, provider-invoices |
| Opportunites | information, actions, positionings, projects, simulation |
| Projets | information, actions, simulation, deliveries-groupments, orders, purchases, productivity |

## Ressources MCP (dictionnaires)

Le serveur expose les dictionnaires de reference Boond comme **ressources MCP** (clients qui en supportent l'affichage : Claude Desktop, MCP Inspector, etc.). Permet au modele de traduire un `state` ou `typeOf` entier en libelle sans appel d'outil supplementaire.

| URI | Contenu |
|-----|---------|
| `boond://application/current-user` | Profil de l'utilisateur courant (id, agence, permissions) |
| `boond://dictionary/states/{entity}` | Etats par entite : `resources`, `candidates`, `contacts`, `companies`, `opportunities`, `projects`, `invoices`, `orders`, `positionings`, `absences` |
| `boond://dictionary/typeOf/{entity}` | Types par entite : `resources`, `candidates`, `contacts`, `projects`, `actions`, `absences` |
| `boond://dictionary/countries` | Liste des pays |
| `boond://dictionary/currencies` | Liste des devises |
| `boond://dictionary/languages` | Liste des langues |

Pour les dictionnaires hors de cette liste curee, l'outil `boond_application_dictionary` reste disponible.

## Prompts pre-orchestres

En plus des outils, le serveur expose des **prompts MCP** (templates pre-cables) qui orchestrent les bons appels d'outils dans le bon ordre pour les workflows recurrents. Visibles dans les clients qui supportent les prompts (Claude Desktop, **Cowork**, Claude Code, MCP Inspector...) sous forme de slash-commands ou de menu.

### Workflows transverses

| Prompt | Usage |
|--------|-------|
| `synthese_equipe` | Etat d'une equipe : qui fait quoi, qui est absent, qui est dispo (par defaut : mon equipe). |
| `pipeline_commercial` | Opportunites avec closing dans une periode : repartition par etat, CA pondere, top 10. |
| `factures_a_relancer` | Factures impayees dont l'echeance est depassee, regroupees par societe. |
| `candidats_pour_opportunite` | A partir d'une opportunite, propose les candidats actifs qui matchent (outils, expertise, mobilite, dispo). |
| `fiche_consultant` | Vue 360 d'une ressource : info + technique + positionnements + absences + CRA recents. |
| `recap_hebdo` | Recap hebdomadaire : pipeline qui a bouge, equipe absente, projets actifs, actions a mener. |

### Ressources, competences & CV

| Prompt | Usage |
|--------|-------|
| `staffing_disponible` | Consultants internes disponibles sur une fenetre donnee (filtre optionnel par competences libres et perimetre), tries par dispo croissante avec top 3 prioritaires. |
| `fin_de_mission` | Anticipation des fins de mission sous N jours (defaut 60). Marque en **urgent** les fins <= 15j sans relais identifie. |
| `cartographie_competences` | Cartographie des competences d'un perimetre (equipe / agence) : top N, competences rares (bus-factor), saturees, manquantes vs opportunites ouvertes. |
| `cvs_a_mettre_a_jour` | Audit fraicheur des CV / dossiers techniques (seuil d'obsolescence configurable). Priorise les ressources bientot sur le marche. |
| `recherche_profil_competences` | Recherche multi-source (ressources internes + candidats) par mix de competences libres, sans opportunite requise. Classe par adequation /10. |

### Comment invoquer un prompt

Les prompts MCP sont des **modeles de message utilisateur** : tu les invoques toi-meme, le LLM execute ensuite le runbook qu'ils contiennent. Aucun filtre BoondManager a connaitre — tout est embarque cote serveur.

**Claude Desktop / Cowork / MCP Inspector** : tape `/` dans la barre de saisie, choisis le prompt dans la liste, remplis les arguments dans le formulaire qui s'affiche, valide.

**Claude Code** : pareil, `/` puis selection ; les arguments sont demandes inline.

**Fallback (clients sans UI dediee aux prompts)** : cite le prompt par son nom dans une demande libre, le client va recuperer la definition via le protocole MCP. Exemple : *"lance le runbook `staffing_disponible` entre le 1er juin et le 1er septembre 2026, competences Java Spring AWS"*.

Exemples d'invocation des prompts ressources / competences / CV :

```
/staffing_disponible
  start_date  = 2026-06-01
  end_date    = 2026-09-01
  competences = Java Spring AWS Kubernetes
  manager_id  = (vide -> mon equipe)
```

```
/fin_de_mission
  horizon_jours = 30
```

```
/cartographie_competences
  agency_id = 7
  top_n     = 15
```

```
/cvs_a_mettre_a_jour
  seuil_mois = 6
```

```
/recherche_profil_competences
  competences        = .NET Azure DevOps
  experience_min     = 5 ans
  dispo_avant        = 2026-07-15
  inclure_candidats  = oui
```

> Apres modification de la config Claude (`claude_desktop_config.json` etc.), **redemarrer le client** : la liste des prompts MCP n'est pas hot-reloadee.

## Prerequis

- Node.js >= 20
- Un compte BoondManager avec acces API active
- L'option "Allow API Rest calls using BasicAuth authentication" activee dans la configuration BoondManager (si BasicAuth)

## Installation

### Claude Desktop (one-click)

Telechargez le fichier `.mcpb` depuis la [derniere release GitHub](https://github.com/fauguste/boondmanager-mcp-server/releases/latest), puis dans Claude Desktop : **Fichier > Installer une extension...** et selectionnez le fichier. Les identifiants sont demandes a l'installation et stockes de maniere chiffree (Keychain macOS / Credential Manager Windows).

### Claude Code

```bash
# Avec un token API (recommande)
claude mcp add --transport stdio --env BOOND_API_TOKEN=votre_token_jwt \
  boondmanager -- npx -y boondmanager-mcp-server

# Avec BasicAuth
claude mcp add --transport stdio \
  --env BOOND_USER=votre_login \
  --env BOOND_PASSWORD=votre_mot_de_passe \
  boondmanager -- npx -y boondmanager-mcp-server
```

> **Windows** : ajoutez `cmd /c` avant `npx` :
> ```bash
> claude mcp add --transport stdio --env BOOND_API_TOKEN=votre_token \
>   boondmanager -- cmd /c npx -y boondmanager-mcp-server
> ```

Pour rendre le serveur disponible dans tous vos projets, ajoutez `--scope user` :

```bash
claude mcp add --transport stdio --scope user \
  --env BOOND_API_TOKEN=votre_token_jwt \
  boondmanager -- npx -y boondmanager-mcp-server
```

### Claude Code - Configuration partagee en equipe

Ajoutez un fichier `.mcp.json` a la racine de votre projet (a commiter dans git) :

```json
{
  "mcpServers": {
    "boondmanager": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "boondmanager-mcp-server"],
      "env": {
        "BOOND_API_TOKEN": "${BOOND_API_TOKEN}"
      }
    }
  }
}
```

Chaque membre de l'equipe n'a qu'a definir la variable d'environnement `BOOND_API_TOKEN` sur sa machine. Le fichier `.mcp.json` supporte la syntaxe `${VAR}` et `${VAR:-default}` pour les variables d'environnement.

### Claude Code Enterprise (deploiement administre)

Les administrateurs peuvent deployer le serveur MCP pour tous les utilisateurs via le fichier `managed-mcp.json` :

| OS | Chemin |
|----|--------|
| macOS | `/Library/Application Support/ClaudeCode/managed-mcp.json` |
| Linux / WSL | `/etc/claude-code/managed-mcp.json` |
| Windows | `C:\Program Files\ClaudeCode\managed-mcp.json` |

```json
{
  "mcpServers": {
    "boondmanager": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "boondmanager-mcp-server"],
      "env": {
        "BOOND_API_TOKEN": "${BOOND_API_TOKEN}",
        "BOOND_BASE_URL": "https://votre-instance.boondmanager.com/api"
      }
    }
  }
}
```

Ce fichier prend le controle exclusif des serveurs MCP : les utilisateurs ne peuvent pas ajouter ou modifier de serveurs en dehors de cette configuration.

Pour restreindre les serveurs autorises tout en laissant les utilisateurs en ajouter, utilisez plutot `managed-settings.json` :

```json
{
  "allowedMcpServers": [
    { "serverName": "boondmanager" }
  ]
}
```

### Claude Desktop / Cowork (configuration manuelle)

Ajoutez dans votre fichier de configuration Claude :

**macOS** : `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows** : `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "boondmanager": {
      "command": "npx",
      "args": ["-y", "boondmanager-mcp-server"],
      "env": {
        "BOOND_API_TOKEN": "votre_token_jwt"
      }
    }
  }
}
```

### Via npm

```bash
npx boondmanager-mcp-server
```

Ou installation globale :

```bash
npm install -g boondmanager-mcp-server
boondmanager-mcp-server
```

### Depuis les sources

```bash
git clone https://github.com/fauguste/boondmanager-mcp-server.git
cd boondmanager-mcp-server
npm install
npm run build
```

### Smithery

Le serveur est aussi disponible sur [Smithery](https://smithery.ai/server/@fauguste/boondmanager-mcp-server). La configuration est dans `smithery.yaml` à la racine du repo : Smithery propose une UI avec les champs d'authentification (JWT auto / JWT pré-construit / BasicAuth) et installe le serveur via `npx`.

### LobeChat / LobeHub

Le serveur est listé sur le [marketplace MCP de LobeHub](https://lobehub.com/mcp/fauguste-boondmanager-mcp-server). Dans LobeChat (auto-hebergé ou cloud), ajouter le MCP via **Reglages > Plugins > MCP > Ajouter** avec :

```json
{
  "name": "boondmanager",
  "command": "npx",
  "args": ["-y", "boondmanager-mcp-server"],
  "env": {
    "BOOND_USER_TOKEN": "<votre_user_token>",
    "BOOND_CLIENT_TOKEN": "<votre_client_token>",
    "BOOND_CLIENT_KEY": "<votre_client_key>"
  }
}
```

Ou utiliser le transport HTTP (voir section [Transports](#transports)) pour un deploiement partage en mode gateway.

## Configuration

### Logs

Le serveur utilise [pino](https://getpino.io/) pour des logs structures JSON (agrégateurs, observabilité).

| Variable | Défaut | Description |
|----------|--------|-------------|
| `LOG_LEVEL` | `info` | Niveau de log : `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `LOG_FORMAT` | (auto) | `json` pour JSON pur, sinon pino-pretty en dev |

En production (`NODE_ENV=production`), les logs sont en JSON par défaut. En dev, le format pretty (colorisé) est actif sauf si `LOG_FORMAT=json`. Chaque requête HTTP reçoit un `corrId` (8 hex) pour tracer la requête dans les logs.

### Authentification

**Option 1 : Token API JWT (recommande)**
```bash
export BOOND_API_TOKEN="votre_token_jwt"
```

**Option 2 : BasicAuth**
```bash
export BOOND_USER="votre_login"
export BOOND_PASSWORD="votre_mot_de_passe"
```

### URL personnalisee (si instance dediee)

```bash
export BOOND_BASE_URL="https://votre-instance.boondmanager.com/api"
```

Par defaut, l'URL est `https://ui.boondmanager.com/api`.

### Delai d'expiration HTTP

Chaque requete vers l'API BoondManager expire au bout de **30 secondes** par defaut. Pour les tenants lents ou des rapports volumineux, augmenter via :

```bash
export BOOND_HTTP_TIMEOUT_MS=60000   # 60 s
```

Si une requete depasse le delai, le serveur renvoie une erreur explicite mentionnant `BOOND_HTTP_TIMEOUT_MS` plutot que de rester bloque indefiniment.

### Tentatives en cas d'echec transitoire

Le client HTTP retente automatiquement les erreurs **transitoires** avec un backoff exponentiel + jitter :

- **GET** : retry sur `5xx`, `429`, erreurs reseau (`ECONNRESET`, etc.) et timeouts (GET etant idempotent).
- **POST / PUT / PATCH / DELETE** : retry **uniquement sur `429`** afin d'eviter de dupliquer une ecriture cote serveur. Les `5xx` et erreurs reseau remontent immediatement.
- L'en-tete `Retry-After` (en secondes ou en HTTP-date) est honore et plafonne a `BOOND_HTTP_RETRY_MAX_MS`.

| Variable | Defaut | Description |
|----------|--------|-------------|
| `BOOND_HTTP_MAX_RETRIES` | `2` | Nombre maximal de tentatives supplementaires (3 essais au total). `0` desactive entierement les retries. |
| `BOOND_HTTP_RETRY_BASE_MS` | `200` | Delai de base utilise pour le backoff exponentiel (`base * 2^attempt`, avec jitter). |
| `BOOND_HTTP_RETRY_MAX_MS` | `5000` | Plafond du delai entre deux tentatives. |

### Limitation de debit (rate limiting)

Pour eviter qu'une boucle d'outils emballee n'inonde l'API (et n'enchaine les `429`), le client applique un **token bucket** local. Defauts : **10 req/s** soutenu, **rafale 20** — invisible en usage interactif normal. Les retentatives consomment aussi un jeton.

| Variable | Defaut | Description |
|----------|--------|-------------|
| `BOOND_HTTP_RATE_LIMIT_RPS` | `10` | Debit soutenu (requetes/seconde). `0` desactive completement. |
| `BOOND_HTTP_RATE_LIMIT_BURST` | `20` | Capacite du bucket = taille maximale de rafale immediate. |

### Restriction d'accès (domaines / lecture seule)

Vous pouvez restreindre **ce que l'IA voit et peut faire**, entièrement par
variables d'environnement : exposer seulement certains domaines (ex. la
comptabilité), et/ou bloquer les écritures et suppressions.

| Variable | Effet |
|----------|-------|
| `BOOND_MCP_DOMAINS` | Liste blanche de domaines (CSV). Absente = tous. Ex. `invoices,payments,application` |
| `BOOND_MCP_EXCLUDE_DOMAINS` | Liste noire de domaines (CSV), appliquée après la liste blanche. Ex. `candidates,resources` |
| `BOOND_MCP_OPERATIONS` | Opérations autorisées (CSV) parmi `read,create,update,delete`. Absente = toutes. |
| `BOOND_MCP_READ_ONLY` | Raccourci : `true` équivaut à `BOOND_MCP_OPERATIONS=read` (tout en lecture seule). |

> ⚠️ **Ce n'est pas une frontière de sécurité dure.** Le filtre masque des
> outils à l'IA mais n'altère pas les droits du compte BoondManager utilisé.
> Pour un vrai cloisonnement, configurez d'abord les droits du compte/rôle
> BoondManager (lecture seule, périmètre comptable…) ; ce filtre vient en
> complément (économie de tokens, garde-fou anti-action accidentelle).

Guide complet, règles de résolution et exemples : [docs/access-control.md](docs/access-control.md).

## Transports

Le serveur supporte deux transports MCP, selectionnables via la variable d'environnement `MCP_TRANSPORT`.

| Transport | Valeur | Cas d'usage |
|-----------|--------|-------------|
| **stdio** (defaut) | `stdio` ou non defini | Claude Desktop, Claude Code, integration locale |
| **Streamable HTTP** | `http` (alias : `streamable-http`) | Gateway MCP, deploiement distant, conteneurs |

### Streamable HTTP (pour les gateways MCP)

Depuis la v1.4.0, le serveur peut etre expose en HTTP (specification MCP Streamable HTTP 2025-03-26) afin d'etre branche derriere une passerelle MCP ou deploye comme service.

> **Authentification BoondManager : OAuth2 protected resource.** Le serveur HTTP **ne detient aucun secret** (ni `client_secret`, ni refresh token, ni stockage utilisateur). Chaque requete MCP doit porter `Authorization: Bearer <boond_access_token>` ; le serveur transmet le token tel quel a BoondManager. C'est le **client MCP** (Claude Desktop, Claude Code, gateway…) qui fait la danse OAuth contre BoondManager et qui gere le refresh. Procedure complete : [docs/oauth.md](docs/oauth.md).

```bash
export MCP_TRANSPORT=http
export MCP_HTTP_HOST=0.0.0.0        # defaut: 127.0.0.1
export MCP_HTTP_PORT=3000           # defaut: 3000
export MCP_HTTP_PATH=/mcp           # defaut: /mcp
# Optionnel: requis uniquement derriere un reverse proxy, pour que
# la discovery annonce la bonne URL publique.
export MCP_HTTP_PUBLIC_URL=https://mcp.votre-domaine.com/mcp

npx boondmanager-mcp-server
# 🚀 BoondManager MCP Server running (streamable HTTP transport)
# 📡 Endpoint: http://0.0.0.0:3000/mcp
# 🔑 Mode: stateless
# 🔐 Boond auth: OAuth2 (per-request Bearer from MCP client)
```

**Variables d'environnement HTTP**

| Variable | Defaut | Description |
|----------|--------|-------------|
| `MCP_TRANSPORT` | `stdio` | `http` pour activer le transport HTTP |
| `MCP_HTTP_HOST` | `127.0.0.1` | Interface d'ecoute (`0.0.0.0` pour exposer) |
| `MCP_HTTP_PORT` | `3000` | Port TCP |
| `MCP_HTTP_PATH` | `/mcp` | Chemin HTTP de l'endpoint MCP |
| `MCP_HTTP_STATEFUL` | `false` | `true` pour activer le mode stateful (session `Mcp-Session-Id`) |
| `MCP_HTTP_JSON_RESPONSE` | `false` | `true` pour forcer des reponses JSON (sans SSE) |
| `MCP_HTTP_PUBLIC_URL` | _(derivee)_ | URL publique annoncee dans la discovery OAuth2 (`resource`) et le challenge `WWW-Authenticate`. Requise derriere un reverse proxy. |
| `MCP_HTTP_SESSION_TTL_MS` | `1800000` (30 min) | En mode stateful, duree d'inactivite au-dela de laquelle une session est fermee. |
| `MCP_HTTP_SESSION_SWEEP_INTERVAL_MS` | `300000` (5 min) | Frequence de balayage des sessions inactives. |
| `MCP_HTTP_ALLOWED_HOSTS` | _(auto)_ | Liste blanche du header `Host` (anti DNS rebinding, CVE-2025-66414). `*` pour desactiver explicitement. |

**Variables OAuth2 — discovery (toutes optionnelles)**

| Variable | Defaut | Description |
|----------|--------|-------------|
| `BOOND_OAUTH_AUTHORIZATION_SERVER` | `https://ui.boondmanager.com` | Issuer de l'authorization server BoondManager, annonce dans `authorization_servers` |
| `BOOND_OAUTH_SCOPES` | _(vide)_ | Scopes annonces dans `scopes_supported` (espace ou virgule). Vide = le client negocie directement avec Boond. |

**Stateless (defaut)** : chaque requete HTTP POST est independante, idealement adapte a un gateway qui multiplexe plusieurs serveurs MCP. Aucune session n'est conservee cote serveur.

**Stateful** : le serveur genere un `Mcp-Session-Id` a l'initialisation que le client doit renvoyer dans chaque requete suivante. Utile pour les clients MCP natifs qui beneficient du streaming SSE et des notifications serveur.

#### Exemple : discovery + 401 challenge

```bash
# Public, pas d'auth -> documente OU envoyer le user pour autoriser
curl -s http://localhost:3000/.well-known/oauth-protected-resource | jq .
# {
#   "resource": "http://0.0.0.0:3000/mcp",
#   "authorization_servers": ["https://ui.boondmanager.com"],
#   "bearer_methods_supported": ["header"]
# }

# Appel MCP sans token -> 401 + WWW-Authenticate qui pointe vers la discovery
curl -s -o /dev/null -w "%{http_code}\n%header{www-authenticate}\n" \
  -X POST http://localhost:3000/mcp -d '{}'
# 401
# Bearer realm="http://0.0.0.0:3000/mcp", resource_metadata="http://0.0.0.0:3000/.well-known/oauth-protected-resource/mcp"
```

#### Exemple : Claude Code via HTTP

Avec un client MCP conforme a la spec MCP Authorization 2025-06-18, la decouverte OAuth est automatique :

```bash
claude mcp add --transport http boondmanager https://mcp.votre-domaine.com/mcp
# Le client recoit le 401 + WWW-Authenticate, fetch la metadata, ouvre
# le navigateur pour autoriser l'App BoondManager, puis re-emet la requete
# avec le Bearer token recu.
```

#### Exemple : Docker (image officielle)

Une image Docker prete a l'emploi est publiee a chaque release sur deux registres miroirs, multi-arch (`linux/amd64` + `linux/arm64`) :

| Registre | Image | Page |
|---|---|---|
| GitHub Container Registry | `ghcr.io/fauguste/boondmanager-mcp-server` | [github.com/fauguste/boondmanager-mcp-server/pkgs/container/boondmanager-mcp-server](https://github.com/fauguste/boondmanager-mcp-server/pkgs/container/boondmanager-mcp-server) |
| Docker Hub | `docker.io/fauguste/boondmanager-mcp-server` | [hub.docker.com/r/fauguste/boondmanager-mcp-server](https://hub.docker.com/r/fauguste/boondmanager-mcp-server) |

Memes digests, memes tags — choisissez celui qui s'aligne avec votre tooling. L'image demarre par defaut en transport HTTP, sur le port 3000, sur l'interface `0.0.0.0`. **Aucun volume, aucun secret a stocker** — le serveur est stateless par construction.

```bash
# Via GHCR (authentification GitHub si registre prive)
docker run -d --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e MCP_HTTP_PUBLIC_URL=https://mcp.votre-domaine.com/mcp \
  --name boondmanager-mcp \
  ghcr.io/fauguste/boondmanager-mcp-server:latest

# Ou via Docker Hub (anonyme)
docker run -d --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e MCP_HTTP_PUBLIC_URL=https://mcp.votre-domaine.com/mcp \
  --name boondmanager-mcp \
  fauguste/boondmanager-mcp-server:latest
```

Tags disponibles sur les deux registres : `:latest`, `:X`, `:X.Y`, `:X.Y.Z` pour chaque release stable (la version exacte est recommandee pour la prod). Les **prereleases** (par exemple `:2.0.0-alpha`) sont publiees **uniquement sous leur tag pinne** — ni `:latest`, ni `:X`, ni `:X.Y` ne bougent. Variables d'environnement supportees : voir [Configuration](#configuration) et [Transports](#transports).

#### Exemple : docker-compose

Le repo embarque un `docker-compose.yml` pret a l'emploi : un seul service stateless, aucun volume, aucun secret cote serveur.

```bash
# Optionnel : surcharger MCP_HTTP_PUBLIC_URL si fronted par un reverse proxy
cp .env.example .env

docker compose up -d
docker compose logs -f mcp
```

> **Securite** : le serveur HTTP est stateless et ne stocke aucun secret BoondManager. Chaque utilisateur authentifie le serveur via son propre token OAuth2 (issu de sa propre App BoondManager), et toutes les actions sont attribuees a son identite dans l'audit log Boond. Derriere un reverse proxy : terminez TLS (HTTPS), forwardez l'en-tete `Authorization`, et reglez `MCP_HTTP_PUBLIC_URL` sur l'URL publique pour que la discovery soit coherente.

## Exemples d'utilisation

Une fois configure, vous pouvez demander a Claude :

**CRM & Commercial**
- *"Recherche les candidats avec des competences en React a Paris"*
- *"Montre-moi les details techniques de la ressource #12345"*
- *"Cree un nouveau contact Jean Dupont chez Acme Corp"*
- *"Liste toutes les opportunites en cours"*
- *"Quels sont les positionnements de l'opportunite #20 ?"*

**Gestion de projets**
- *"Cree un projet Mission Alpha pour la societe #42"*
- *"Affiche le planning du projet #33"*
- *"Quels sont les bons de commande du projet #55 ?"*
- *"Affiche la productivite du projet #12"*

**Facturation & Finance**
- *"Recherche les factures en attente de paiement"*
- *"Liste les factures fournisseur de la societe #100"*
- *"Affiche les achats du projet #55"*

**RH & Temps**
- *"Affiche les feuilles de temps de la ressource #100 pour mars 2025"*
- *"Liste les absences prevues ce mois-ci"*
- *"Affiche les notes de frais de la ressource #200"*
- *"Quels sont les avantages de la ressource #50 ?"*

**Suivi d'activite**
- *"Quelles sont les actions recentes sur le candidat #789 ?"*
- *"Affiche les validations en attente"*
- *"Liste les taches de ma todolist"*

**Reporting**
- *"Affiche le reporting de synthese globale"*
- *"Quel est le reporting de productivite des ressources ?"*

**Administration**
- *"Recupere le dictionnaire des types d'actions"*
- *"Liste les agences et business units"*
- *"Affiche les webhooks configures"*

## Architecture

```
boondmanager-mcp-server/
├── src/
│   ├── index.ts              # Point d'entree MCP (selection du transport)
│   ├── server.ts             # Factory createMcpServer() + liste des domaines
│   ├── constants.ts          # Configuration, API paths, onglets
│   ├── types.ts              # Types TypeScript (JSON:API)
│   ├── transports/
│   │   └── http.ts           # Transport Streamable HTTP (gateway/remote)
│   ├── services/
│   │   └── boond-client.ts   # Client HTTP API BoondManager
│   ├── schemas/
│   │   └── index.ts          # Schemas Zod (validation des entrees)
│   └── tools/
│       ├── index.ts          # Barrel export de tous les domaines
│       ├── crud-factory.ts   # Factory generique CRUD (DRY)
│       ├── candidates.ts     # 10 outils (CRUD + 5 onglets)
│       ├── resources.ts      # 15 outils (CRUD + 10 onglets)
│       ├── contacts.ts       # 11 outils (CRUD + 6 onglets)
│       ├── companies.ts      # 14 outils (CRUD + 9 onglets)
│       ├── opportunities.ts  # 10 outils (CRUD + 5 onglets)
│       ├── projects.ts       # 12 outils (CRUD + 7 onglets)
│       ├── actions.ts        # 4 outils
│       ├── timesheets.ts     # 3 outils
│       ├── invoices.ts       # 5 outils
│       ├── orders.ts         # 5 outils
│       ├── deliveries.ts     # 2 outils
│       ├── absences.ts       # 5 outils
│       ├── expenses.ts       # 5 outils
│       ├── products.ts       # 5 outils
│       ├── positionings.ts   # 4 outils
│       ├── payments.ts       # 2 outils
│       ├── advantages.ts     # 2 outils
│       ├── contracts.ts      # 2 outils
│       ├── purchases.ts      # 4 outils
│       ├── provider-invoices.ts # 2 outils
│       ├── accounts.ts       # 2 outils
│       ├── agencies.ts       # 2 outils
│       ├── business-units.ts # 2 outils
│       ├── poles.ts          # 2 outils
│       ├── roles.ts          # 2 outils
│       ├── calendars.ts      # 2 outils
│       ├── flags.ts          # 2 outils
│       ├── webhooks.ts       # 2 outils
│       ├── logs.ts           # 2 outils
│       ├── notifications.ts  # 2 outils
│       ├── threads.ts        # 2 outils
│       ├── todolists.ts      # 2 outils
│       ├── validations.ts    # 2 outils
│       ├── reporting.ts      # 5 outils
│       ├── planning-absences.ts # 1 outil
│       └── application.ts    # 2 outils
├── dist/                     # Build JavaScript
├── .github/                  # CI/CD, templates, Dependabot
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.js
└── README.md
```

## Securite

- Les credentials BoondManager (JWT ou BasicAuth) ne transitent jamais via le protocole MCP -- ils sont configures en variables d'environnement cote serveur uniquement
- En mode **stdio**, le serveur tourne en local, aucun port reseau n'est expose
- En mode **streamable HTTP**, protegez l'endpoint avec `MCP_HTTP_BEARER_TOKEN` + TLS (HTTPS via reverse proxy) et restreignez l'acces reseau a votre gateway
- Compatible avec les exigences ISO 27001
- L'API BoondManager est hebergee en France et conforme RGPD
- Authentification BoondManager : JWT (recommande), BasicAuth, ou JWT construit automatiquement a partir des composants

## Developpement

```bash
# Mode watch pour le developpement
npm run dev

# Build
npm run build

# Lancer le serveur
npm start

# Tests
npm test               # 255 tests
npm run test:coverage  # Avec couverture

# Qualite
npm run lint
npm run typecheck
```

### Stack technique

- **Runtime** : Node.js >= 20 (ES2022)
- **Langage** : TypeScript 5.8+ (mode strict)
- **MCP SDK** : @modelcontextprotocol/sdk 1.12+
- **Validation** : Zod 4
- **Tests** : Vitest 4 + couverture V8
- **Lint** : ESLint 10 + typescript-eslint
- **Transports** : stdio (defaut) + Streamable HTTP (MCP 2025-03-26)

## Ressources

- [Documentation API BoondManager](https://doc.boondmanager.com/api-externe/)
- [Collection Postman BoondManager](https://www.postman.com/boondmanager)
- [Specification MCP](https://modelcontextprotocol.io/)
- [pyboondmanager (reference Python)](https://github.com/tominardi/pyboondmanager)
- [Catalogue d'outils auto-genere (TOOLS.md)](./TOOLS.md)
- [Distribution & marketplaces (docs/distribution.md)](./docs/distribution.md)

## Licence

Apache License 2.0 - Copyright (c) 2025 Frédéric Auguste

Voir [LICENSE](./LICENSE) et [NOTICE](./NOTICE) pour les détails.
