# Architecture du Système de Surveillance API

## Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────┐
│                    BoondManager API Monitor                     │
│                         (GitHub Actions)                         │
└─────────────────────────────────────────────────────────────────┘
                                │
                                │ Cron: Mon 9am UTC
                                ▼
        ┌───────────────────────────────────────────┐
        │   1. Fetch API Documentation              │
        │   https://doc.boondmanager.com/           │
        │   - User-Agent: Mozilla/5.0               │
        │   - Accept: text/html                     │
        └───────────────────────────────────────────┘
                                │
                                ▼
        ┌───────────────────────────────────────────┐
        │   2. Parse Endpoints                      │
        │   - Cheerio (HTML parsing)                │
        │   - Extract: method, path, description    │
        │   - Build endpoint list                   │
        └───────────────────────────────────────────┘
                                │
                                ▼
        ┌───────────────────────────────────────────┐
        │   3. Load Previous Snapshot               │
        │   .github/api-snapshot.json               │
        │   - timestamp, endpointsCount, endpoints  │
        └───────────────────────────────────────────┘
                                │
                                ▼
        ┌───────────────────────────────────────────┐
        │   4. Compare Snapshots                    │
        │   - Detect: added, removed, modified      │
        │   - Generate: changes.json                │
        └───────────────────────────────────────────┘
                                │
                ┌───────────────┴────────────────┐
                ▼                                ▼
    ┌─────────────────────┐        ┌────────────────────────┐
    │  No Changes         │        │  Changes Detected      │
    │  - Log notice       │        │  - Log warning         │
    │  - Skip issue       │        │  - Create issue        │
    └─────────────────────┘        └────────────────────────┘
                                                │
                                                ▼
                        ┌───────────────────────────────────────┐
                        │   5. Create GitHub Issue              │
                        │   - Title: [API] Nouveautés...        │
                        │   - Labels: enhancement, api-update   │
                        │   - Body: changes + checklist         │
                        └───────────────────────────────────────┘
                                                │
                                                ▼
                        ┌───────────────────────────────────────┐
                        │   6. Commit New Snapshot              │
                        │   - git add api-snapshot.json         │
                        │   - git commit -m "update [skip ci]"  │
                        │   - git push                          │
                        └───────────────────────────────────────┘
                                                │
                                                ▼
                        ┌───────────────────────────────────────┐
                        │   7. Upload Artifact                  │
                        │   - changes.json                      │
                        │   - api-snapshot.json                 │
                        │   - Retention: 90 days                │
                        └───────────────────────────────────────┘
```

---

## Composants

### 1. Workflow Principal (`api-monitor.yml`)

**Responsabilités**:
- Orchestration du pipeline complet
- Scraping de la documentation
- Détection des changements
- Création d'issues
- Commit des snapshots

**Déclencheurs**:
- `schedule`: Cron hebdomadaire (lundi 9h UTC)
- `workflow_dispatch`: Exécution manuelle

**Dépendances NPM** (installées dynamiquement):
- `axios` — Requêtes HTTP
- `cheerio` — Parsing HTML
- `diff` — Génération de diffs
- `@apidevtools/json-schema-ref-parser` — Parse JSON schemas

**Étapes**:
1. Checkout repository
2. Setup Node.js 20
3. Install dependencies
4. Fetch & parse API documentation
5. Compare snapshots
6. Commit changes (if any)
7. Create GitHub issue (if changes)
8. Upload artifact

### 2. Workflow de Test (`api-monitor.test.yml`)

**Responsabilités**:
- Validation du workflow principal
- Test de connectivité API
- Validation syntaxe YAML

**Déclencheurs**:
- `workflow_dispatch` uniquement (manuel)

**Utilité**:
- Éviter les déploiements cassés
- Tester avant modification du workflow principal
- Vérifier l'accessibilité de l'API BoondManager

### 3. Script Local (`test-api-monitor.cjs`)

**Responsabilités**:
- Tests en local sans GitHub Actions
- Prototypage de modifications
- Debugging

**Mode d'emploi**:
```bash
npm run api:monitor:test   # Dry-run
npm run api:monitor:save   # Save snapshot
```

**Limitations**:
- Parsing HTML simplifié (pas de Cheerio)
- Peut échouer avec 403 (IP locale bloquée)
- Snapshots manuels (pas de Git automation)

### 4. Snapshot (`api-snapshot.json`)

**Structure**:
```json
{
  "timestamp": "ISO-8601 datetime",
  "url": "https://doc.boondmanager.com/api-externe/raml-build/",
  "endpointsCount": 156,
  "endpoints": [
    {
      "type": "endpoint",
      "method": "GET|POST|PUT|DELETE|PATCH",
      "name": "resource_name",
      "path": "/api/path",
      "description": "Optional description"
    }
  ]
}
```

**Versioning**:
- Versionné dans Git
- Commit automatique après chaque scan
- Message: `chore: update BoondManager API snapshot [skip ci]`
- Historique = audit trail de l'évolution de l'API

### 5. Issue GitHub

**Template**: `.github/ISSUE_TEMPLATE/api-update.yml`

**Contenu**:
- **Titre**: `[API] Nouveautés détectées dans BoondManager API (YYYY-MM-DD)`
- **Labels**: `enhancement`, `api-update`, `automated`
- **Corps**:
  ```markdown
  ## 🔔 Changements détectés
  
  ### ➕ Nouveaux endpoints (N)
  - **GET** `/new/endpoint`
  
  ### ➖ Endpoints supprimés (M)
  - **DELETE** `/old/endpoint`
  
  ### 🔄 Endpoints modifiés (P)
  - `/modified/endpoint` — Description changée
  
  ---
  
  ### 📋 Actions recommandées
  - [ ] Examiner documentation officielle
  - [ ] Mettre à jour schémas Zod
  - [ ] Ajouter/modifier outils
  - [ ] Créer tests
  - [ ] Regénérer TOOLS.md
  - [ ] Documenter CHANGELOG.md
  ```

**Assignation**:
- Pas d'assignation automatique (configurable)
- Labels permettent le filtrage

### 6. Artifacts

**Nom**: `api-changes-{run_number}`

**Contenu**:
- `changes.json` — Détail des changements détectés
  ```json
  {
    "isFirstRun": false,
    "hasChanges": true,
    "changes": {
      "added": [...],
      "removed": [...],
      "modified": [...]
    }
  }
  ```
- `api-snapshot.json` — Snapshot complet du run

**Rétention**: 90 jours

**Utilité**:
- Audit des détections
- Debugging en cas de faux positifs
- Historique des changements API

---

## Flux de Données

```
BoondManager Docs (HTML)
          │
          ▼
    Cheerio Parser
          │
          ▼
  Endpoint Objects []
          │
          ▼
  Current Snapshot (JSON)
          │
          ├─────────────────┐
          │                 │
          ▼                 ▼
  Previous Snapshot    Comparison Logic
  (from Git)           (added/removed/modified)
          │                 │
          └────────┬────────┘
                   ▼
            Changes Detected?
                   │
         ┌─────────┴──────────┐
         │                    │
         NO                  YES
         │                    │
         ▼                    ▼
    Log notice          Create Issue
                             │
                             ▼
                        Commit Snapshot
                             │
                             ▼
                       Upload Artifact
```

---

## Sécurité

### Permissions GitHub Actions

```yaml
permissions:
  contents: write  # Commit snapshots
  issues: write    # Create issues
```

### Secrets

Aucun secret requis — utilise `GITHUB_TOKEN` automatique.

### Rate Limiting

**Protection BoondManager**:
- User-Agent réaliste
- Fréquence hebdomadaire (non-aggressive)
- Retry logic (pas de boucle infinie)

**Protection GitHub**:
- Commits avec `[skip ci]` pour éviter loops
- Artifacts limités à 90 jours
- Issues auto-closes possible (via webhook/bot externe)

---

## Performance

### Temps d'Exécution Moyen

| Étape | Temps | Notes |
|-------|-------|-------|
| Fetch API docs | 2-5s | Dépend de BoondManager |
| Parse HTML | 1-2s | Cheerio rapide |
| Compare snapshots | <1s | JSON diff |
| Create issue | 2-3s | gh CLI |
| Commit + push | 3-5s | Git automation |
| **Total** | **~10-15s** | Sans échecs |

### Optimisations Possibles

- ✅ **Cache** : Ajouter `actions/cache@v4` pour node_modules
- ✅ **Parallel** : Parser et Git operations en parallèle
- ✅ **Incremental** : Fetch seulement si `If-Modified-Since` indique changement
- ⏳ **Batch** : Grouper plusieurs runs en une seule issue mensuelle

---

## Évolutivité

### Scénarios de Croissance

| Métrique | Actuel | 1 an | 5 ans |
|----------|--------|------|-------|
| Endpoints API | 156 | 200 | 300 |
| Snapshot size | ~10 KB | ~15 KB | ~25 KB |
| Runs/an | 52 | 52 | 52 |
| Issues/an | ~10 | ~15 | ~20 |
| Commits/an | 52 | 52 | 52 |

### Limites Connues

- **Git repo size** : Les snapshots hebdomadaires ajoutent ~500 KB/an (négligeable)
- **GitHub API** : Rate limit de 5000 req/h (largement suffisant)
- **Artifacts** : Max 10 GB par repo (on utilise ~1 MB)

### Scaling Strategies

Si le système devient insuffisant :

1. **Multi-API** : Monitorer plusieurs APIs (BoondManager + autres)
2. **Diff avancé** : Utiliser `git-diff` au lieu de JSON.stringify
3. **ML Detection** : Classifier automatiquement la priorité des changements
4. **Dashboard** : Créer un Grafana/Prometheus dashboard

---

## Maintenance

### Checklist Mensuelle
- [ ] Vérifier exécutions réussies (Actions)
- [ ] Triage des issues créées
- [ ] Vérifier taille du repo (snapshots)

### Checklist Annuelle
- [ ] Réviser logique de détection
- [ ] Mettre à jour dépendances NPM
- [ ] Archiver anciennes issues
- [ ] Optimiser parsing (nouveaux sélecteurs)

---

## Références

- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [Cheerio API](https://cheerio.js.org/)
- [BoondManager API](https://doc.boondmanager.com/api-externe/raml-build/)

---

**Version**: 1.0.0  
**Date**: 2026-04-26  
**Auteur**: @fauguste
