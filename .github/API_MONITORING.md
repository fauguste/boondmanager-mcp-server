# Surveillance automatique de l'API BoondManager

## Vue d'ensemble

Ce système surveille les changements de l'API BoondManager en sondant les
fichiers RAML bruts de la documentation officielle, et crée des issues GitHub
pour chaque nouveauté détectée.

## Fonctionnement

### Déclenchement

- **Automatique** : Tous les lundis à 9h00 UTC (cron: `0 9 * * 1`)
- **Manuel** : Via l'onglet "Actions" → "Monitor BoondManager API Changes" → "Run workflow"

### Stratégie de sondage (pourquoi pas de scraping HTML ?)

La page d'index `https://doc.boondmanager.com/api-externe/raml-build/` est une
console JS derrière un WAF qui répond **403** aux clients non-navigateurs — le
scraping HTML n'a jamais rien capturé. En revanche, les fichiers RAML bruts
sous-jacents sont servis statiquement et répondent 200 :

```
resources/{domaine}/{fichier}.raml   # domaines en camelCase : businessUnits, providerInvoices…
traits/{trait}.raml
```

Le script `.github/scripts/api-monitor.mjs` :

1. **Construit la liste des domaines** : les clés de `API_PATHS` dans
   `src/constants.ts` (toujours synchrone avec le serveur) + `EXTRA_DOMAINS`
   (entités documentées par Boond non couvertes ici : `documents`, `apps`,
   `alerts`, …) — c'est ce qui détecte les nouveaux pans d'API.
2. **Sonde** chaque combinaison domaine × fichiers conventionnels
   (`search.raml`, `default.raml`, `information.raml`, `actions.raml`, …),
   concurrence 8, 1 retry.
3. **Hash** (SHA-256) le contenu de chaque fichier trouvé.
4. **Compare** avec `.github/api-snapshot.json` :
   - ➕ Ajouté : 404 → 200
   - ➖ Supprimé : 200 → 404
   - 🔄 Modifié : hash différent
5. **Rapport** : PR de mise à jour du snapshot + issue GitHub détaillée.

Garde-fous :
- Si un fichier *précédemment connu* échoue au sondage (erreur réseau, pas un
  404), le diff est sauté pour ce run — pas de fausse issue « endpoints
  supprimés ».
- Le snapshot n'est réécrit que si le contenu a changé : pas de PR
  hebdomadaire causée par le seul timestamp.

### Structure du snapshot

```json
{
  "formatVersion": 2,
  "timestamp": "2026-06-10T20:34:38.086Z",
  "url": "https://doc.boondmanager.com/api-externe/raml-build/",
  "endpointsCount": 152,
  "endpoints": [
    {
      "path": "resources/candidates/search.raml",
      "sha256": "…",
      "bytes": 13343,
      "description": "Search & create candidates"
    }
  ]
}
```

Un snapshot d'un format antérieur (ou vide) est traité comme une première
exécution : nouvelle baseline, pas d'issue.

### Issue créée

Quand des changements sont détectés, une issue est automatiquement créée avec :

- **Titre** : `[API] Nouveautés détectées dans BoondManager API (YYYY-MM-DD)`
- **Labels** : `enhancement`, `api-update`
- **Contenu** : fichiers RAML ajoutés / supprimés / modifiés + checklist
  d'actions recommandées (mise à jour des schémas Zod, des outils, des tests,
  de `TOOLS.md`, du `CHANGELOG.md`)

## Configuration

### Personnalisation du cron

Modifier la ligne dans `.github/workflows/api-monitor.yml` :

```yaml
schedule:
  - cron: '0 9 * * 1'
```

### Étendre la surveillance

- **Nouveau domaine côté serveur** : rien à faire — les clés de `API_PATHS`
  sont relues à chaque run.
- **Nouveau domaine externe à surveiller** : ajouter à `EXTRA_DOMAINS` dans
  `.github/scripts/api-monitor.mjs`.
- **Nouveau fichier conventionnel** : ajouter à `FILE_CANDIDATES`.

### Permissions requises

- `contents: write` (push de la branche de snapshot)
- `issues: write` / `pull-requests: write` (issue + PR)

## Dépendances

**Aucune.** Le script n'utilise que les modules natifs de Node 20 (`fetch`,
`node:crypto`, `node:fs`). C'est volontaire : le job dispose d'un token
capable d'ouvrir des issues/PRs, donc il n'exécute aucun code tiers.

## Artifacts

Chaque exécution génère un artifact disponible 90 jours :
- `changes.json` : détail des changements détectés
- `api-snapshot.json` : snapshot au moment de l'exécution

## Troubleshooting

### Aucune issue créée

- Vérifier les logs du run (`No changes detected` est l'issue la plus probable)
- Vérifier les permissions du workflow

### Échecs de sondage

Les fichiers RAML bruts ne sont pas derrière le challenge WAF, mais des 403
ponctuels restent possibles en rafale. Le script retry une fois par fichier ;
si des fichiers connus restent inaccessibles, le diff est sauté et retenté la
semaine suivante (`changes.json` contient alors un champ `error`).

### Test local

```bash
node .github/scripts/api-monitor.mjs
# Réécrit .github/api-snapshot.json si changements + changes.json (non versionné)
```

## Évolutions futures

- [ ] Diff sémantique du contenu RAML (paramètres ajoutés/supprimés) dans l'issue
- [ ] Notification Slack/Discord en plus de l'issue
- [ ] Découverte automatique des fichiers par domaine (si un index devient accessible)

## Références

- [Documentation BoondManager API](https://doc.boondmanager.com/api-externe/raml-build/)
- [GitHub Actions - Cron syntax](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule)
