# BoondManager MCP Server

[![CI](https://github.com/fauguste/boondmanager-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/fauguste/boondmanager-mcp-server/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/boondmanager-mcp-server.svg)](https://www.npmjs.com/package/boondmanager-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Serveur MCP (Model Context Protocol) pour l'API BoondManager, permettant à Claude (Desktop, Cowork, Code) de rechercher, consulter, créer et modifier des enregistrements dans votre instance BoondManager.

## 🎯 Domaines couverts

| Domaine | Outils | Description |
|---------|--------|-------------|
| **Candidats** | search, get, create, update, delete + 4 onglets | Gestion du vivier de candidats |
| **Ressources** | search, get, create, update, delete + 6 onglets | Gestion des collaborateurs/consultants |
| **Contacts** | search, get, create, update, delete + 3 onglets | Contacts clients et partenaires |
| **Sociétés** | search, get, create, update, delete + 3 onglets | Entreprises clientes et prospects |
| **Opportunités** | search, get, create, update, delete + 3 onglets | Pipeline commercial |
| **Actions** | search, get, create, delete | Suivi d'activité (appels, emails, RDV) |
| **Feuilles de temps** | search, get, resource timesheets | Consultation des temps saisis |
| **Projets** | search, get, create, update, delete + 4 onglets | Gestion des missions / projets |
| **Factures** | search, get, create, update, delete | Facturation client |
| **Bons de commande** | search, get, create, update, delete | Bons de commande |
| **Livraisons / CRA** | search, get | Comptes rendus d'activité |
| **Absences** | search, get, create, update, delete | Congés, RTT, maladie |
| **Notes de frais** | search, get, create, update, delete | Remboursement de frais |
| **Produits** | search, get, create, update, delete | Catalogue de produits/prestations |
| **Positionnements** | search, get, create, delete | Placement candidats/ressources |
| **Paiements** | search, get | Suivi des règlements |
| **Avantages** | search, get | Tickets restaurant, mutuelle, primes... |
| **Application** | dictionnaire, utilisateur courant | Dictionnaires de référence et profil |

**Total : 84 outils**

### Détail des onglets par entité

| Entité | Onglets disponibles |
|--------|-------------------|
| Candidats | information, technical, actions, documents |
| Ressources | information, technical, financial, actions, contracts, documents |
| Contacts | information, actions, documents |
| Sociétés | information, actions, documents |
| Opportunités | information, actions, documents |
| Projets | information, planning, actions, documents |

## 📋 Prérequis

- Node.js >= 20
- Un compte BoondManager avec accès API activé
- L'option "Allow API Rest calls using BasicAuth authentication" activée dans la configuration BoondManager (si BasicAuth)

## 🚀 Installation

```bash
git clone <votre-repo>/boondmanager-mcp-server
cd boondmanager-mcp-server
npm install
npm run build
```

## ⚙️ Configuration

### Variables d'environnement

**Option 1 : BasicAuth (recommandé pour démarrer)**
```bash
export BOOND_USER="votre_login"
export BOOND_PASSWORD="votre_mot_de_passe"
```

**Option 2 : Token API (JWT)**
```bash
export BOOND_API_TOKEN="votre_token_jwt"
```

**Option 3 : URL personnalisée (si instance dédiée)**
```bash
export BOOND_BASE_URL="https://votre-instance.boondmanager.com/api"
```

### Configuration Claude Desktop / Cowork

Ajoutez dans votre fichier de configuration Claude :

**macOS** : `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows** : `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "boondmanager": {
      "command": "node",
      "args": ["/chemin/absolu/vers/boondmanager-mcp-server/dist/index.js"],
      "env": {
        "BOOND_USER": "votre_login",
        "BOOND_PASSWORD": "votre_mot_de_passe"
      }
    }
  }
}
```

## 💬 Exemples d'utilisation

Une fois configuré, vous pouvez demander à Claude :

- *"Recherche les candidats avec des compétences en React à Paris"*
- *"Montre-moi les détails de la ressource #12345"*
- *"Crée un nouveau contact Jean Dupont chez Acme Corp"*
- *"Liste toutes les opportunités en cours"*
- *"Quelles sont les actions récentes sur le candidat #789 ?"*
- *"Mets à jour l'email du contact #456"*
- *"Affiche les feuilles de temps de la ressource #100 pour mars 2025"*
- *"Crée un projet Mission Alpha pour la société #42"*
- *"Recherche les factures en attente de paiement"*
- *"Liste les absences prévues ce mois-ci"*
- *"Affiche les notes de frais de la ressource #200"*
- *"Quels sont les bons de commande du projet #55 ?"*
- *"Récupère le dictionnaire des types d'actions"*
- *"Positionne le candidat #10 sur l'opportunité #20"*
- *"Affiche le planning du projet #33"*

## 🏗️ Architecture

```
boondmanager-mcp-server/
├── src/
│   ├── index.ts              # Point d'entrée MCP (stdio)
│   ├── constants.ts          # Configuration et constantes
│   ├── types.ts              # Types TypeScript (JSON:API)
│   ├── services/
│   │   └── boond-client.ts   # Client HTTP API BoondManager
│   ├── schemas/
│   │   └── index.ts          # Schémas Zod (validation)
│   └── tools/
│       ├── index.ts          # Export barrel
│       ├── crud-factory.ts   # Factory générique CRUD (DRY)
│       ├── candidates.ts     # Outils candidats (CRUD + onglets)
│       ├── resources.ts      # Outils ressources (CRUD + onglets)
│       ├── contacts.ts       # Outils contacts (CRUD + onglets)
│       ├── companies.ts      # Outils sociétés (CRUD + onglets)
│       ├── opportunities.ts  # Outils opportunités (CRUD + onglets)
│       ├── actions.ts        # Outils actions
│       ├── timesheets.ts     # Outils feuilles de temps
│       ├── projects.ts       # Outils projets (CRUD + onglets)
│       ├── invoices.ts       # Outils factures
│       ├── orders.ts         # Outils bons de commande
│       ├── deliveries.ts     # Outils livraisons / CRA
│       ├── absences.ts       # Outils absences
│       ├── expenses.ts       # Outils notes de frais
│       ├── products.ts       # Outils produits
│       ├── positionings.ts   # Outils positionnements
│       ├── payments.ts       # Outils paiements
│       ├── advantages.ts     # Outils avantages
│       └── application.ts    # Outils application (dictionnaires)
├── dist/                     # Build JavaScript
├── .github/                  # CI/CD, templates, Dependabot
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.js
└── README.md
```

## 🔒 Sécurité

- Les credentials ne transitent jamais via le réseau MCP — ils sont configurés en variables d'environnement locales
- Le serveur tourne en local (stdio), pas de port réseau exposé
- Compatible avec les exigences ISO 27001
- L'API BoondManager est hébergée en France et conforme RGPD

## 🔧 Développement

```bash
# Mode watch pour le développement
npm run dev

# Build
npm run build

# Lancer le serveur
npm start

# Tests
npm test
npm run test:coverage

# Lint
npm run lint
npm run typecheck
```

## 📚 Ressources

- [Documentation API BoondManager](https://doc.boondmanager.com/api-externe/)
- [Collection Postman BoondManager](https://www.postman.com/boondmanager)
- [Spécification MCP](https://modelcontextprotocol.io/)
- [pyboondmanager (référence Python)](https://github.com/tominardi/pyboondmanager)

## 📄 Licence

MIT - Silamir
