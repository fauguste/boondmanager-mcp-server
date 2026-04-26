# ✅ Checklist de Déploiement — Monitoring API BoondManager

## Avant le Commit

- [ ] Tous les fichiers créés sont présents (voir liste ci-dessous)
- [ ] `.gitignore` mis à jour avec les exclusions
- [ ] `package.json` contient les scripts `api:monitor:test` et `api:monitor:save`
- [ ] `CLAUDE.md` documente le nouveau workflow
- [ ] Script local renommé en `.cjs` (CommonJS)

### Liste des Fichiers à Commiter

```
✅ .github/workflows/api-monitor.yml
✅ .github/workflows/api-monitor.test.yml
✅ .github/API_MONITORING.md
✅ .github/README.md
✅ .github/ARCHITECTURE.md
✅ .github/DEPLOYMENT_CHECKLIST.md
✅ .github/COMMIT_MESSAGE.txt
✅ .github/api-snapshot.json
✅ .github/ISSUE_TEMPLATE/api-update.yml
✅ scripts/test-api-monitor.cjs
✅ MONITORING_SETUP_SUMMARY.md
✅ CLAUDE.md (modifié)
✅ package.json (modifié)
✅ .gitignore (modifié)
```

---

## Étape 1 : Tests Locaux

### 1.1 Vérifier la Syntaxe du Script
```bash
node scripts/test-api-monitor.cjs
```

**Résultat attendu**:
- ✅ Script démarre sans erreur de syntaxe
- ⚠️ Peut échouer avec HTTP 403 (normal en local)
- ✅ Affiche le résumé final

### 1.2 Vérifier les Scripts NPM
```bash
npm run api:monitor:test
```

**Résultat attendu**:
- ✅ Commande reconnue
- ⚠️ Peut échouer avec 403 (IPs locales bloquées)

---

## Étape 2 : Commit & Push

### 2.1 Ajouter les Fichiers
```bash
git add .github/ scripts/ MONITORING_SETUP_SUMMARY.md CLAUDE.md package.json .gitignore
```

### 2.2 Vérifier le Staging
```bash
git status
```

**Vérifier que tous les fichiers de la liste ci-dessus sont présents.**

### 2.3 Commit
```bash
git commit -F .github/COMMIT_MESSAGE.txt
```

Ou copier-coller le message depuis `.github/COMMIT_MESSAGE.txt`.

### 2.4 Push
```bash
git push origin main
```

---

## Étape 3 : Vérifications Post-Push

### 3.1 Workflow Visible dans GitHub Actions
1. Aller sur GitHub → Onglet "Actions"
2. Vérifier que "Monitor BoondManager API Changes" apparaît dans la liste

**Résultat attendu**:
- ✅ Workflow visible
- ✅ Badge "workflow" vert (pas d'erreur de syntaxe)

### 3.2 Vérifier les Permissions
1. Actions → "Monitor BoondManager API Changes" → "..." → "View workflow"
2. Vérifier la section `permissions:` dans le YAML

**Résultat attendu**:
```yaml
permissions:
  contents: write
  issues: write
```

---

## Étape 4 : Premier Lancement Manuel

### 4.1 Déclencher le Workflow
1. GitHub → Actions
2. "Monitor BoondManager API Changes"
3. "Run workflow" → Branch: `main` → "Run workflow"

### 4.2 Surveiller l'Exécution
- ✅ Étape "Fetch BoondManager API documentation" → Succès
- ✅ Étape "Commit snapshot changes" → Commit créé
- ✅ Étape "Create GitHub issue" → **Skippé** (première exécution = baseline)

**Temps d'exécution attendu**: ~10-15 secondes

### 4.3 Vérifier le Snapshot
1. Retourner sur le repo
2. Vérifier qu'un commit a été créé : `chore: update BoondManager API snapshot [skip ci]`
3. Ouvrir `.github/api-snapshot.json`

**Résultat attendu**:
```json
{
  "timestamp": "2026-04-26T...",
  "url": "https://doc.boondmanager.com/api-externe/raml-build/",
  "endpointsCount": 150+,
  "endpoints": [...]
}
```

### 4.4 Vérifier l'Artifact
1. Actions → Run récent → Scroll down → "Artifacts"
2. Télécharger `api-changes-{run_number}`

**Résultat attendu**:
- ✅ `changes.json` contient `{"isFirstRun": true}`
- ✅ `api-snapshot.json` non-vide

---

## Étape 5 : Test de Détection de Changements (Optionnel)

### 5.1 Simuler un Changement
Modifier manuellement `.github/api-snapshot.json` :
```bash
# Supprimer un endpoint de la liste
# OU changer endpointsCount
```

### 5.2 Relancer le Workflow
Actions → "Run workflow"

### 5.3 Vérifier qu'une Issue est Créée
1. Onglet "Issues"
2. Vérifier la présence d'une nouvelle issue :
   - Titre: `[API] Nouveautés détectées dans BoondManager API (...)`
   - Labels: `enhancement`, `api-update`, `automated`

**Résultat attendu**:
- ✅ Issue créée avec détails complets
- ✅ Checklist présente
- ✅ Lien vers documentation

### 5.4 Restaurer le Snapshot
```bash
git checkout .github/api-snapshot.json
git commit -m "test: restore snapshot after test"
git push
```

---

## Étape 6 : Configurer le Cron (Production)

### 6.1 Vérifier la Configuration Actuelle
Dans `.github/workflows/api-monitor.yml`:
```yaml
on:
  schedule:
    - cron: '0 9 * * 1'  # Lundi 9h UTC
```

### 6.2 Ajuster si Nécessaire
Exemples de crons alternatifs :
- `0 14 * * 3` : Mercredi 14h UTC
- `0 6 1 * *` : 1er du mois 6h UTC
- `0 */12 * * *` : Toutes les 12h

### 6.3 Commit + Push si Modifié
```bash
git add .github/workflows/api-monitor.yml
git commit -m "chore: adjust API monitor cron schedule"
git push
```

---

## Étape 7 : Documentation & Communication

### 7.1 Mettre à Jour le README Principal (Optionnel)
Ajouter une section "API Monitoring" dans `README.md` :
```markdown
## 🔔 API Monitoring

Ce projet surveille automatiquement les changements dans l'API BoondManager.
Voir [.github/API_MONITORING.md](.github/API_MONITORING.md) pour plus de détails.
```

### 7.2 Communiquer avec l'Équipe
- Informer l'équipe de la mise en place du système
- Expliquer le rôle des issues auto-créées
- Partager `.github/API_MONITORING.md` pour référence

---

## ✅ Checklist Finale

- [ ] Workflow visible dans Actions
- [ ] Premier run manuel réussi
- [ ] Snapshot initial créé et commité
- [ ] Artifact téléchargeable
- [ ] (Test optionnel) Issue créée lors de simulation
- [ ] Cron configuré pour production
- [ ] Documentation accessible
- [ ] Équipe informée

---

## 🎉 Déploiement Terminé !

Le système est maintenant opérationnel. Il s'exécutera automatiquement :
- **Prochaine exécution**: Lundi prochain à 9h00 UTC
- **Fréquence**: Hebdomadaire
- **Action requise**: Aucune (tout est automatique)

### Prochaines Étapes

1. **Attendre le premier cron automatique** (lundi suivant)
2. **Vérifier qu'aucune issue n'est créée** si pas de changements
3. **Traiter les issues** si changements détectés
4. **Ajuster la configuration** si nécessaire (fréquence, parsing, etc.)

---

## 🐛 En Cas de Problème

### Workflow Échoue
1. Consulter les logs : Actions → Run failed → Étape en erreur
2. Vérifier les permissions : `contents: write`, `issues: write`
3. Tester en local : `npm run api:monitor:test`
4. Consulter : `.github/API_MONITORING.md` section Troubleshooting

### Issue Non Créée
1. Télécharger l'artifact `api-changes-{run}`
2. Inspecter `changes.json` → `hasChanges: true` ?
3. Vérifier les logs de l'étape "Create GitHub issue"

### Faux Positifs
1. Ajuster la logique de comparaison dans le script Node.js
2. Normaliser le JSON avant comparaison
3. Ajouter une whitelist de champs à ignorer

---

**Support**: Voir [.github/API_MONITORING.md](.github/API_MONITORING.md)  
**Architecture**: Voir [.github/ARCHITECTURE.md](.github/ARCHITECTURE.md)  
**Changelog**: Voir `MONITORING_SETUP_SUMMARY.md`
