# BoondManager MCP Server – Docker Image

[![Docker Hub](https://img.shields.io/docker/v/fauguste/boondmanager-mcp-server?label=Docker%20Hub&logo=docker&color=2496ED)](https://hub.docker.com/r/fauguste/boondmanager-mcp-server)
[![GHCR](https://img.shields.io/badge/GHCR-fauguste%2Fboondmanager--mcp--server-181717?logo=github)](https://github.com/fauguste/boondmanager-mcp-server/pkgs/container/boondmanager-mcp-server)
[![CI](https://github.com/fauguste/boondmanager-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/fauguste/boondmanager-mcp-server/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Serveur MCP (Model Context Protocol) pour l'API BoondManager en mode HTTP transport. Conçu pour les déploiements distants, gateways MCP et orchestrateurs multi-utilisateurs (LobeChat, Khoj, custom gateways).

**158 outils, 6 prompts, 20 ressources** exposés via une API HTTP/SSE. Documentation complète sur [GitHub](https://github.com/fauguste/boondmanager-mcp-server).

## Images disponibles

Deux registres, même image multi-architecture (`linux/amd64` + `linux/arm64`) :

- **Docker Hub** : `docker.io/fauguste/boondmanager-mcp-server`
- **GHCR** : `ghcr.io/fauguste/boondmanager-mcp-server`

**Tags** :
- `:2.0.0` (recommandé en production – version pinned)
- `:2.0` (dernier patch de la minor)
- `:2` (dernier minor de la major)
- `:latest` (edge – demos uniquement)

Les **prereleases** (`2.1.0-alpha`) publient uniquement le tag exact (`:2.1.0-alpha`), jamais `:latest` / `:2`.

## Usage rapide

### Pull & run

```bash
docker pull fauguste/boondmanager-mcp-server:2.0.0
docker run -d \
  --name boondmanager-mcp \
  -p 3000:3000 \
  -e MCP_TRANSPORT=http \
  fauguste/boondmanager-mcp-server:2.0.0
```

Le serveur écoute sur `http://0.0.0.0:3000/mcp` (0.0.0.0 par défaut dans l'image Docker).

### Docker Compose

```yaml
services:
  boondmanager-mcp:
    image: fauguste/boondmanager-mcp-server:2.0.0
    container_name: boondmanager-mcp
    ports:
      - "3000:3000"
    environment:
      MCP_TRANSPORT: http
      # Port/path (optionnels, defaults = 3000 / /mcp)
      MCP_HTTP_PORT: 3000
      MCP_HTTP_PATH: /mcp
      # Public URL (requis derrière un reverse proxy)
      MCP_HTTP_PUBLIC_URL: https://mcp.example.com/mcp
      # Stateful sessions (optionnel, default = false)
      MCP_HTTP_STATEFUL: "false"
      # Logging
      LOG_LEVEL: info
      LOG_FORMAT: json
      # BoondManager API base (optionnel si non-standard)
      BOOND_BASE_URL: https://ui.boondmanager.com/api
    restart: unless-stopped
```

## Authentication : OAuth2 Protected Resource

L'image Docker fonctionne en mode **HTTP transport** uniquement. L'authentification se fait via **OAuth2** :

1. Le **client MCP** (Claude Desktop, LobeChat, gateway, …) obtient un `access_token` auprès de BoondManager via le flow Authorization Code.
2. Chaque requête MCP transporte `Authorization: Bearer <access_token>`.
3. Le serveur **ne stocke aucun secret** : il forward le token tel quel vers l'API BoondManager.
4. Le client gère le refresh — le serveur n'est jamais impliqué.

**Discovery** : RFC 9728 protected-resource metadata publié à `/.well-known/oauth-protected-resource` + `/.well-known/oauth-protected-resource/mcp`. Les clients compatibles MCP l'utilisent pour auto-découvrir l'authorization server (BoondManager).

### Variables d'environnement – Auth

| Var | Défaut | Description |
|-----|--------|-------------|
| `MCP_HTTP_PUBLIC_URL` | `http://<host>:<port><path>` | URL publique advertised dans le discovery metadata. **Obligatoire** derrière un reverse proxy. |
| `BOOND_OAUTH_AUTHORIZATION_SERVER` | `https://ui.boondmanager.com` | Issuer URL de BoondManager, advertised dans `authorization_servers`. |
| `BOOND_OAUTH_SCOPES` | (vide) | Scopes space/comma-separated advertised dans `scopes_supported`. Vide = négociation directe client-Boond. |

Documentation complète : [`docs/oauth.md`](https://github.com/fauguste/boondmanager-mcp-server/blob/main/docs/oauth.md) sur GitHub.

## Variables d'environnement – Transport HTTP

| Var | Défaut | Description |
|-----|--------|-------------|
| `MCP_TRANSPORT` | `stdio` | **Obligatoire** : mettre `http` pour activer le transport HTTP |
| `MCP_HTTP_HOST` | `127.0.0.1` (Node), `0.0.0.0` (Docker) | Interface d'écoute. L'image Docker override à `0.0.0.0` pour bind all interfaces. |
| `MCP_HTTP_PORT` | `3000` | Port TCP |
| `MCP_HTTP_PATH` | `/mcp` | Endpoint path |
| `MCP_HTTP_STATEFUL` | `false` | `true` pour activer les sessions `Mcp-Session-Id` |
| `MCP_HTTP_JSON_RESPONSE` | `false` | `true` pour retourner JSON au lieu de streams SSE |
| `MCP_HTTP_SESSION_TTL_MS` | `1800000` (30 min) | Stateful only : idle window avant fermeture session |
| `MCP_HTTP_SESSION_SWEEP_INTERVAL_MS` | `300000` (5 min) | Stateful only : fréquence du sweep des sessions idle |
| `MCP_HTTP_ALLOWED_HOSTS` | `localhost,127.0.0.1,[::1]` (loopback) ou disabled (other) | Comma-separated allowlist de `Host` header hostnames (protection DNS rebinding CVE-2025-66414). `*` = opt-out explicite (reverse proxy only). |

## Variables d'environnement – BoondManager API

| Var | Défaut | Description |
|-----|--------|-------------|
| `BOOND_BASE_URL` | `https://ui.boondmanager.com/api` | Base URL de l'API BoondManager |
| `BOOND_HTTP_TIMEOUT_MS` | `30000` | Timeout par requête (ms) |
| `BOOND_HTTP_MAX_RETRIES` | `2` | Nombre de tentatives supplémentaires après échec. `0` = désactiver retries. |
| `BOOND_HTTP_RETRY_BASE_MS` | `200` | Backoff exponentiel avec full-jitter : base (ms) |
| `BOOND_HTTP_RETRY_MAX_MS` | `5000` | Backoff max (ms) |
| `BOOND_HTTP_RATE_LIMIT_RPS` | `10` | Client-side token bucket : requêtes/sec. `0` = désactiver. |
| `BOOND_HTTP_RATE_LIMIT_BURST` | `20` | Taille du burst autorisé |

## Variables d'environnement – Logging

| Var | Défaut | Description |
|-----|--------|-------------|
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `LOG_FORMAT` | `json` (prod) / `pretty` (dev) | `json` (structured, machine-readable) ou `pretty` (colorized, human-friendly) |

## Exemple derrière un reverse proxy (Traefik)

```yaml
services:
  traefik:
    image: traefik:v3.0
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command:
      - "--providers.docker=true"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.email=admin@example.com"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"

  boondmanager-mcp:
    image: fauguste/boondmanager-mcp-server:2.0.0
    environment:
      MCP_TRANSPORT: http
      MCP_HTTP_PUBLIC_URL: https://mcp.example.com/mcp
      LOG_LEVEL: info
      LOG_FORMAT: json
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.mcp.rule=Host(`mcp.example.com`) && PathPrefix(`/mcp`)"
      - "traefik.http.routers.mcp.entrypoints=websecure"
      - "traefik.http.routers.mcp.tls.certresolver=letsencrypt"
      - "traefik.http.services.mcp.loadbalancer.server.port=3000"
    restart: unless-stopped
```

**Important** : `MCP_HTTP_PUBLIC_URL` doit pointer vers l'URL publique (celle vue par le client MCP), pas l'adresse interne Docker. Sinon le discovery metadata publiera l'URL interne et le client ne pourra pas atteindre le serveur OAuth.

## Domaines couverts

**CRM & Commercial** : Candidats (10 tools), Ressources (15), Contacts (11), Sociétés (14), Opportunités (10)  
**Projets** : Projets (12), Positionnements (4), Livraisons/CRA (2), Achats (4)  
**Facturation** : Factures client (5), Factures fournisseur (2), Bons de commande (5), Paiements (2), Notes de frais (5), Produits (5)  
**RH & Temps** : Absences (5), Planning absences (1), Feuilles de temps (3), Contrats (2), Avantages (2)  
**Suivi d'activité** : Actions (4), Validations (2), Todolists (2)  
**Reporting** : Sociétés, Projets, Ressources, Synthèse, Plans de production (1 chacun)  
**Administration** : Comptes (2), Agences (2), Business Units (2), Poles (2), Roles (2), Calendriers (2), Drapeaux (2), Webhooks (2), Logs audit (2), Notifications (2), Fils de discussion (2), Application (2)

Catalogue complet : [`TOOLS.md`](https://github.com/fauguste/boondmanager-mcp-server/blob/main/TOOLS.md)

## Healthcheck

Le serveur n'expose pas de route `/health` dédiée — le check se fait via une requête MCP `initialize`. Exemple Docker healthcheck :

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "-X", "POST", "http://localhost:3000/mcp", "-H", "Content-Type: application/json", "-d", '{"method":"initialize","jsonrpc":"2.0","id":1,"params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"healthcheck","version":"1.0"}}}']
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 10s
```

Réponse 200 = serveur opérationnel (les appels MCP réels échoueront sans `Authorization: Bearer` valide, mais le healthcheck lui-même ne nécessite pas d'auth pour le check basique).

## Provenance & SBOM

Chaque image publiée inclut :
- **Provenance** (SLSA Build L3) — atteste de la source GitHub + commit SHA + workflow
- **SBOM** (SPDX) — bill of materials pour audit de dépendances

Vérification :

```bash
docker buildx imagetools inspect \
  --format "{{ json .Provenance }}" \
  fauguste/boondmanager-mcp-server:2.0.0
```

## Support & Contributions

- **Source & Documentation** : [github.com/fauguste/boondmanager-mcp-server](https://github.com/fauguste/boondmanager-mcp-server)
- **Issues** : [GitHub Issues](https://github.com/fauguste/boondmanager-mcp-server/issues)
- **Changelog** : [`CHANGELOG.md`](https://github.com/fauguste/boondmanager-mcp-server/blob/main/CHANGELOG.md)
- **Licence** : Apache-2.0

Contributions welcome via pull requests. Tests requis (`npm test`) avant merge.

## Liens rapides

- **npm** : [npmjs.com/package/boondmanager-mcp-server](https://www.npmjs.com/package/boondmanager-mcp-server)
- **MCP Registry** : [registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io/)
- **GHCR** : [ghcr.io/fauguste/boondmanager-mcp-server](https://github.com/fauguste/boondmanager-mcp-server/pkgs/container/boondmanager-mcp-server)

---

**Multi-arch ready** : `linux/amd64` + `linux/arm64` (x86 servers + Apple Silicon / Graviton).
