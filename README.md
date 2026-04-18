# BoondManager MCP Server

[![CI](https://github.com/fauguste/boondmanager-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/fauguste/boondmanager-mcp-server/actions/workflows/ci.yml)
[![CodeQL](https://github.com/fauguste/boondmanager-mcp-server/actions/workflows/codeql.yml/badge.svg)](https://github.com/fauguste/boondmanager-mcp-server/actions/workflows/codeql.yml)
[![npm version](https://img.shields.io/npm/v/boondmanager-mcp-server.svg)](https://www.npmjs.com/package/boondmanager-mcp-server)
[![npm downloads](https://img.shields.io/npm/dm/boondmanager-mcp-server.svg)](https://www.npmjs.com/package/boondmanager-mcp-server)
[![Node.js](https://img.shields.io/node/v/boondmanager-mcp-server.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Serveur MCP (Model Context Protocol) pour l'API BoondManager, permettant a Claude (Desktop, Cowork, Code) de rechercher, consulter, creer et modifier des enregistrements dans votre instance BoondManager.

**158 outils** couvrant **36 domaines** de l'API BoondManager.

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

## Configuration

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

## Transports

Le serveur supporte deux transports MCP, selectionnables via la variable d'environnement `MCP_TRANSPORT`.

| Transport | Valeur | Cas d'usage |
|-----------|--------|-------------|
| **stdio** (defaut) | `stdio` ou non defini | Claude Desktop, Claude Code, integration locale |
| **Streamable HTTP** | `http` (alias : `streamable-http`) | Gateway MCP, deploiement distant, conteneurs |

### Streamable HTTP (pour les gateways MCP)

Depuis la v1.4.0, le serveur peut etre expose en HTTP (specification MCP Streamable HTTP 2025-03-26) afin d'etre branche derriere une passerelle MCP ou deploye comme service.

```bash
export MCP_TRANSPORT=http
export MCP_HTTP_HOST=0.0.0.0        # defaut: 127.0.0.1
export MCP_HTTP_PORT=3000           # defaut: 3000
export MCP_HTTP_PATH=/mcp           # defaut: /mcp
export MCP_HTTP_BEARER_TOKEN=xxx    # optionnel: protege l'endpoint
export BOOND_API_TOKEN=...          # (credentials BoondManager, comme en stdio)

npx boondmanager-mcp-server
# 🚀 BoondManager MCP Server running (streamable HTTP transport)
# 📡 Endpoint: http://0.0.0.0:3000/mcp
# 🔑 Mode: stateless
```

**Variables d'environnement HTTP**

| Variable | Defaut | Description |
|----------|--------|-------------|
| `MCP_TRANSPORT` | `stdio` | `http` pour activer le transport HTTP |
| `MCP_HTTP_HOST` | `127.0.0.1` | Interface d'ecoute (`0.0.0.0` pour exposer) |
| `MCP_HTTP_PORT` | `3000` | Port TCP |
| `MCP_HTTP_PATH` | `/mcp` | Chemin HTTP de l'endpoint MCP |
| `MCP_HTTP_STATEFUL` | `false` | `true` pour activer le mode stateful (session `Mcp-Session-Id`) |
| `MCP_HTTP_BEARER_TOKEN` | _(vide)_ | Si defini, le serveur exige `Authorization: Bearer <token>` |
| `MCP_HTTP_JSON_RESPONSE` | `false` | `true` pour forcer des reponses JSON (sans SSE) |

**Stateless (defaut)** : chaque requete HTTP POST est independante, idealement adapte a un gateway qui multiplexe plusieurs serveurs MCP. Aucune session n'est conservee cote serveur.

**Stateful** : le serveur genere un `Mcp-Session-Id` a l'initialisation que le client doit renvoyer dans chaque requete suivante. Utile pour les clients MCP natifs qui beneficient du streaming SSE et des notifications serveur.

#### Exemple : verifier l'endpoint

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-06-18",
      "capabilities": {},
      "clientInfo": { "name": "curl", "version": "1.0" }
    }
  }'
```

#### Exemple : Claude Code via HTTP

```bash
claude mcp add --transport http \
  --header "Authorization: Bearer votre_token_local" \
  boondmanager https://mcp.votre-domaine.com/mcp
```

#### Exemple : configuration `.mcp.json` HTTP

```json
{
  "mcpServers": {
    "boondmanager": {
      "type": "http",
      "url": "https://mcp.votre-domaine.com/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_HTTP_BEARER_TOKEN}"
      }
    }
  }
}
```

#### Exemple : Docker

```bash
docker run --rm -p 3000:3000 \
  -e MCP_TRANSPORT=http \
  -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_HTTP_BEARER_TOKEN=$(openssl rand -hex 32) \
  -e BOOND_API_TOKEN=$BOOND_API_TOKEN \
  node:20-alpine \
  npx -y boondmanager-mcp-server
```

> **Securite** : en HTTP, les credentials BoondManager restent cote serveur (variables d'environnement du conteneur). Seul le token MCP (`MCP_HTTP_BEARER_TOKEN`) circule entre le client et le serveur. Derriere un reverse proxy, ajoutez TLS (HTTPS) et limitez l'acces reseau au gateway.

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

## Licence

MIT - Silamir
