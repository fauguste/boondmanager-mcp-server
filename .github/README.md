# GitHub Workflows & Automation

Ce dossier contient les workflows GitHub Actions et la configuration pour l'automatisation du projet BoondManager MCP Server.

## 📋 Workflows

### 🔄 CI/CD Principaux

| Workflow | Déclenchement | Description |
|----------|--------------|-------------|
| **ci.yml** | Push/PR → `main` | Tests, lint, typecheck, couverture, MCPB validation |
| **release.yml** | Tags `v*` | Publication npm, GitHub Releases, MCP Registry, GHCR |
| **codeql.yml** | Push/PR, schedule | Analyse de sécurité statique (CodeQL) |

### 🔔 Surveillance API

| Workflow | Déclenchement | Description |
|----------|--------------|-------------|
| **api-monitor.yml** | Cron hebdo (Lun 9h) | Surveille les changements dans l'API BoondManager |
| **api-monitor.test.yml** | Manuel uniquement | Test du système de surveillance |

#### api-monitor.yml — Surveillance automatique

**Objectif**: Détecter automatiquement les nouveautés dans la documentation officielle de l'API BoondManager et créer des issues GitHub pour faciliter la maintenance.

**Fonctionnement**:

1. **Scraping** de `https://doc.boondmanager.com/api-externe/raml-build/`
2. **Comparaison** avec le snapshot précédent (`api-snapshot.json`)
3. **Détection** des endpoints ajoutés/supprimés/modifiés
4. **Création d'issue** automatique si changements détectés
5. **Commit** du nouveau snapshot

**Déclenchement**:
- **Automatique**: Tous les lundis à 9h00 UTC
- **Manuel**: Via Actions → "Monitor BoondManager API Changes" → "Run workflow"

**Sorties**:
- Issue GitHub avec label `enhancement`, `api-update`
- Commit du snapshot dans `.github/api-snapshot.json`
- Artifact `api-changes-{run_number}` (90 jours de rétention)

**Documentation complète**: Voir [API_MONITORING.md](./API_MONITORING.md)

#### api-monitor.test.yml — Tests

Workflow de test pour valider:
- Syntaxe YAML du workflow principal
- Accessibilité de la documentation BoondManager
- Installation des dépendances (axios, cheerio, diff)

**Usage**: Actions → "Test API Monitor Workflow" → "Run workflow"

## 📁 Fichiers de Configuration

| Fichier | Description |
|---------|-------------|
| **api-snapshot.json** | Snapshot de référence de l'API BoondManager |
| **API_MONITORING.md** | Documentation détaillée du système de surveillance |
| **README.md** | Ce fichier |

### api-snapshot.json

Structure du snapshot:

```json
{
  "timestamp": "2026-04-26T09:00:00.000Z",
  "url": "https://doc.boondmanager.com/api-externe/raml-build/",
  "endpointsCount": 156,
  "endpoints": [
    {
      "type": "endpoint",
      "method": "GET",
      "name": "resources/search",
      "description": "Recherche de ressources avec filtres..."
    }
  ]
}
```

**Gestion**:
- ✅ **Versionné** dans Git (historique des changements API)
- ✅ **Auto-mis à jour** par le workflow hebdomadaire
- ✅ **Commit automatique** avec message `[skip ci]` (évite loop CI)

## 🧪 Tests Locaux

Pour tester le système de surveillance en local:

```bash
# Test simple (lecture seule)
npm run api:monitor:test

# Test + sauvegarde du snapshot
npm run api:monitor:save
```

Le script local (`scripts/test-api-monitor.js`) utilise uniquement les modules Node.js natifs + https pour minimiser les dépendances.

## 🔐 Permissions

Les workflows requièrent les permissions suivantes (configurées dans chaque workflow YAML):

### api-monitor.yml
```yaml
permissions:
  contents: write  # Commit du snapshot
  issues: write    # Création d'issues
```

### ci.yml
```yaml
permissions:
  contents: read
  id-token: write  # Pour OIDC
```

### release.yml
```yaml
permissions:
  contents: write  # GitHub Releases
  packages: write  # GHCR
  id-token: write  # npm provenance + MCP Registry
```

## 📊 Artifacts

Les workflows génèrent les artifacts suivants:

| Workflow | Artifact | Rétention | Contenu |
|----------|----------|-----------|---------|
| **api-monitor** | `api-changes-{run}` | 90 jours | `changes.json` + `api-snapshot.json` |
| **ci** | `coverage-{node-version}` | 30 jours | Rapports de couverture V8 |
| **release** | `.mcpb` bundle | Permanent | Attaché à la GitHub Release |

## 🚀 Déploiement

### Modifier le planning de surveillance

Pour changer la fréquence du monitoring, éditer `api-monitor.yml`:

```yaml
on:
  schedule:
    - cron: '0 9 * * 1'  # minute heure jour-mois mois jour-semaine
```

Exemples:
- `0 9 * * 1` : Lundi 9h
- `0 14 * * 3` : Mercredi 14h
- `0 6 1 * *` : 1er du mois 6h
- `0 */12 * * *` : Toutes les 12h

### Désactiver la surveillance

Pour désactiver temporairement:

1. **Via l'interface GitHub**:
   - Actions → "Monitor BoondManager API Changes" → "⋯" → "Disable workflow"

2. **Via le code**:
   - Commenter la section `schedule:` dans `api-monitor.yml`
   - Garder `workflow_dispatch:` pour les exécutions manuelles

## 🐛 Troubleshooting

### Issue non créée malgré des changements

**Diagnostic**:
1. Vérifier les logs du workflow (onglet "Actions")
2. Télécharger l'artifact `api-changes-{run}` et inspecter `changes.json`
3. Vérifier les permissions du workflow

**Solutions**:
- S'assurer que `contents: write` et `issues: write` sont présents
- Vérifier que le token `GITHUB_TOKEN` a les droits nécessaires
- Consulter les logs de l'étape "Create GitHub issue for changes"

### Faux positifs (changements mineurs détectés)

**Cause**: Le système détecte tout changement JSON, même cosmétique (espace, ordre).

**Solutions**:
1. Ajuster la logique de comparaison dans le script Node.js
2. Ajouter une whitelist de champs à ignorer
3. Normaliser le JSON avant comparaison (tri des clés)

### Rate limiting BoondManager

Si trop de requêtes vers la documentation:

**Solutions**:
1. Réduire la fréquence du cron (ex: hebdomadaire → mensuel)
2. Ajouter un cache avec `actions/cache@v4`
3. Utiliser `If-Modified-Since` header HTTP

### Snapshot git conflict

Si plusieurs PRs modifient `api-snapshot.json`:

**Solutions**:
1. Le workflow commit avec `[skip ci]` pour éviter les loops
2. En cas de conflit manuel, accepter la version la plus récente (par timestamp)
3. Ou relancer le workflow après merge pour regénérer

## 📚 Références

- [Documentation BoondManager API](https://doc.boondmanager.com/api-externe/raml-build/)
- [GitHub Actions - Events](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows)
- [GitHub Actions - Cron syntax](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule)
- [GitHub CLI - gh issue create](https://cli.github.com/manual/gh_issue_create)
- [Blog GitHub: Workflows Testing & Validation](https://github.github.com/gh-aw/blog/2026-01-13-meet-the-workflows-testing-validation/)

## 🛠️ Maintenance

### Checklist mensuelle

- [ ] Vérifier que le workflow `api-monitor` s'exécute correctement
- [ ] Consulter les issues créées et leur statut
- [ ] Mettre à jour les dépendances du workflow si nécessaire
- [ ] Vérifier la taille du snapshot (< 1 MB pour perf Git)

### Checklist annuelle

- [ ] Réviser la logique de détection (faux positifs/négatifs)
- [ ] Optimiser le scraping (nouveaux sélecteurs CSS si structure doc change)
- [ ] Archiver les anciennes issues d'API update (label `archived`)
- [ ] Évaluer l'ajout de métriques (Prometheus, DataDog, etc.)

---

**Dernière mise à jour**: 2026-04-26  
**Maintenu par**: @fauguste
