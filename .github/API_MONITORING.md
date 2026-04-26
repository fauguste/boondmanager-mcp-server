# Surveillance automatique de l'API BoondManager

## Vue d'ensemble

Ce système surveille automatiquement les changements dans la documentation officielle de l'API BoondManager et crée des issues GitHub pour chaque nouveauté détectée.

## Fonctionnement

### Déclenchement

- **Automatique** : Tous les lundis à 9h00 UTC (cron: `0 9 * * 1`)
- **Manuel** : Via l'onglet "Actions" → "Monitor BoondManager API Changes" → "Run workflow"

### Workflow

1. **Récupération** : Scrape la documentation officielle à `https://doc.boondmanager.com/api-externe/raml-build/`
2. **Comparaison** : Compare avec le snapshot précédent (`.github/api-snapshot.json`)
3. **Détection** :
   - ➕ Nouveaux endpoints
   - ➖ Endpoints supprimés
   - 🔄 Endpoints modifiés
4. **Rapport** :
   - Commit du nouveau snapshot
   - Création d'une issue GitHub avec les détails
   - Upload d'un artifact avec les changements

### Structure du snapshot

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
      "description": "Recherche de ressources..."
    }
  ]
}
```

### Issue créée

Quand des changements sont détectés, une issue est automatiquement créée avec :

- **Titre** : `[API] Nouveautés détectées dans BoondManager API (YYYY-MM-DD)`
- **Labels** : `enhancement`, `api-update`
- **Contenu** :
  - Liste des endpoints ajoutés
  - Liste des endpoints supprimés
  - Liste des endpoints modifiés
  - Checklist d'actions recommandées

### Actions recommandées (checklist dans l'issue)

Quand une issue est créée, suivre ces étapes :

1. ✅ **Examiner** la documentation officielle
2. ✅ **Mettre à jour** les schémas Zod (`src/schemas/`)
3. ✅ **Ajouter** les nouveaux outils (`src/tools/`)
4. ✅ **Créer** les tests correspondants
5. ✅ **Regénérer** `TOOLS.md` via `npm run docs:tools`
6. ✅ **Documenter** dans `CHANGELOG.md`

## Configuration

### Personnalisation du cron

Modifier la ligne dans `.github/workflows/api-monitor.yml` :

```yaml
schedule:
  - cron: '0 9 * * 1'  # Format: minute heure jour-du-mois mois jour-de-la-semaine
```

Exemples :
- `0 9 * * 1` : Tous les lundis à 9h00
- `0 14 * * 3` : Tous les mercredis à 14h00
- `0 6 1 * *` : Le 1er de chaque mois à 6h00
- `0 */6 * * *` : Toutes les 6 heures

### Permissions requises

Le workflow nécessite :
- `contents: write` (pour commit du snapshot)
- `issues: write` (pour créer les issues)

Ces permissions sont configurées dans le workflow et héritent des paramètres du repo.

## Dépendances

Le workflow installe dynamiquement :
- `axios` : Requêtes HTTP
- `cheerio` : Parse HTML
- `diff` : Génération de diffs
- `@apidevtools/json-schema-ref-parser` : Parse de schémas JSON

Aucune modification de `package.json` n'est nécessaire.

## Artifacts

Chaque exécution génère un artifact disponible 90 jours :
- `changes.json` : Détail des changements détectés
- `api-snapshot.json` : Snapshot de l'API au moment de l'exécution

Accès : Actions → Run → "Artifacts" en bas de page

## Troubleshooting

### Aucune issue créée

- Vérifier que des changements ont été détectés dans les logs
- Vérifier les permissions du workflow
- Vérifier que le token GitHub a les droits `issues: write`

### Faux positifs

Le système détecte des changements même mineurs (reformulation de description). Pour affiner :
1. Ajuster la logique de comparaison dans le script Node.js
2. Ajouter une whitelist de changements à ignorer

### Rate limiting ou 403 Forbidden

Si la documentation BoondManager bloque les requêtes (HTTP 403) ou a un rate limit :

**Causes possibles**:
- Protection anti-bot (Cloudflare, WAF)
- Rate limiting strict
- Blocage des User-Agents non-navigateurs

**Solutions**:
1. Le workflow utilise des User-Agents réalistes
2. Les IPs GitHub Actions sont généralement whitelistées
3. Si blocage persistant : contacter BoondManager
4. Espacer les exécutions (cron moins fréquent)
5. Ajouter un cache avec `actions/cache`
6. Utiliser `If-Modified-Since` header HTTP

**Note**: Les tests locaux peuvent échouer (403) alors que GitHub Actions réussit (IPs différentes)

## Évolutions futures

- [ ] Scraping RAML plus approfondi (types, paramètres, exemples)
- [ ] Détection de changements de version d'API
- [ ] Génération automatique de stubs de code pour nouveaux endpoints
- [ ] Notification Slack/Discord en plus de l'issue
- [ ] Comparaison de schémas JSON:API (structures de réponse)

## Références

- [Documentation BoondManager API](https://doc.boondmanager.com/api-externe/raml-build/)
- [GitHub Actions - Cron syntax](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule)
- [GitHub CLI - gh issue create](https://cli.github.com/manual/gh_issue_create)
- [Blog GitHub : Workflows Testing & Validation](https://github.github.com/gh-aw/blog/2026-01-13-meet-the-workflows-testing-validation/)
