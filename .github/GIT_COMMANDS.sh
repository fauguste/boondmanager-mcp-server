#!/bin/bash
#
# Commandes Git pour déployer le système de monitoring API BoondManager
# Usage: bash .github/GIT_COMMANDS.sh
#

set -e  # Exit on error

echo "╔══════════════════════════════════════════════════════════════════════════════╗"
echo "║          Déploiement du Système de Monitoring API BoondManager              ║"
echo "╚══════════════════════════════════════════════════════════════════════════════╝"
echo ""

# 1. Vérifier qu'on est sur la branche main
current_branch=$(git branch --show-current)
if [ "$current_branch" != "main" ]; then
  echo "⚠️  Attention: Vous n'êtes pas sur la branche 'main' (branche actuelle: $current_branch)"
  read -p "Continuer quand même? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Déploiement annulé"
    exit 1
  fi
fi

# 2. Vérifier l'état Git
echo "📊 État Git actuel:"
git status --short
echo ""

# 3. Ajouter tous les fichiers
echo "➕ Ajout des fichiers..."
git add .github/ scripts/ MONITORING_SETUP_SUMMARY.md CLAUDE.md package.json .gitignore

# 4. Vérifier les fichiers stagés
echo ""
echo "📋 Fichiers à commiter:"
git status --short
echo ""

# 5. Confirmer avant commit
read -p "Confirmer le commit? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Commit annulé"
  exit 1
fi

# 6. Commit avec le message préparé
echo "💾 Création du commit..."
git commit -F .github/COMMIT_MESSAGE.txt

# 7. Afficher le commit
echo ""
echo "✅ Commit créé:"
git log -1 --oneline
echo ""

# 8. Confirmer avant push
read -p "Pusher vers origin/$current_branch? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "⚠️  Push annulé (commit local seulement)"
  echo "   Pour pusher plus tard: git push origin $current_branch"
  exit 0
fi

# 9. Push
echo "🚀 Push vers origin/$current_branch..."
git push origin "$current_branch"

# 10. Résumé final
echo ""
echo "╔══════════════════════════════════════════════════════════════════════════════╗"
echo "║                          ✅ DÉPLOIEMENT RÉUSSI !                            ║"
echo "╚══════════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "🎯 Prochaines étapes:"
echo ""
echo "  1. Vérifier que le workflow apparaît dans GitHub Actions"
echo "     👉 https://github.com/$(git config --get remote.origin.url | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/actions"
echo ""
echo "  2. Déclencher le workflow manuellement (première fois)"
echo "     👉 Actions → 'Monitor BoondManager API Changes' → 'Run workflow'"
echo ""
echo "  3. Vérifier le snapshot initial créé"
echo "     👉 .github/api-snapshot.json"
echo ""
echo "  4. Attendre le premier cron automatique"
echo "     👉 Lundi prochain à 9h00 UTC"
echo ""
echo "📚 Documentation:"
echo "  • .github/DEPLOYMENT_CHECKLIST.md"
echo "  • .github/API_MONITORING.md"
echo "  • .github/ARCHITECTURE.md"
echo ""
