# Contribuer au projet

## Prerequis

- Node.js >= 18
- npm

## Installation

```bash
git clone https://github.com/fauguste/boondmanager-mcp-server.git
cd boondmanager-mcp-server
npm install
```

## Developpement

```bash
# Build
npm run build

# Mode watch
npm run dev

# Linter
npm run lint
npm run lint:fix

# Format code (Prettier)
npm run format
npm run format:check

# Type checking
npm run typecheck

# Tests
npm test
npm run test:watch
npm run test:coverage

# Regenerer TOOLS.md (apres avoir modifie des outils)
npm run docs:tools
npm run docs:tools:check  # Verifie que TOOLS.md est a jour (CI)
```

Le pre-commit hook (husky + lint-staged) formate et lint automatiquement les fichiers stages. Pour desactiver temporairement : `git commit --no-verify`.

## Workflow de contribution

1. Creer une branche depuis `main` : `git checkout -b feat/ma-fonctionnalite`
2. Coder les changements
3. Ajouter des tests unitaires
4. Verifier que tout passe :
   ```bash
   npm run format:check && npm run lint && npm run typecheck && npm test && npm run build && npm run docs:tools:check
   ```
5. Committer avec un message conventionnel :
   - `feat: ajouter l'outil de recherche de projets`
   - `fix: corriger la pagination des ressources`
   - `docs: mettre a jour le README`
   - `refactor: simplifier le client HTTP`
   - `test: ajouter les tests des schemas`
6. Ouvrir une Pull Request vers `main`

## Conventions de commit

Ce projet suit [Conventional Commits](https://www.conventionalcommits.org/) :

| Prefixe | Usage |
|---------|-------|
| `feat:` | Nouvelle fonctionnalite |
| `fix:` | Correction de bug |
| `docs:` | Documentation |
| `refactor:` | Refactoring sans changement fonctionnel |
| `test:` | Ajout ou modification de tests |
| `ci:` | Changements CI/CD |
| `chore:` | Maintenance (dependances, config...) |

## Ajouter un nouvel outil (domaine)

Voir la section **"Adding a New Domain (Tool)"** dans `CLAUDE.md` pour le workflow complet. En bref :

1. Creer `src/tools/{domain}.ts` avec `register{Domain}Tools(server)`
2. Exporter depuis `src/tools/index.ts`
3. Enregistrer dans `src/server.ts`
4. Creer `src/tools/{domain}.test.ts` (mock `registerTool`, verifie noms + annotations)
5. Executer `npm run docs:tools` pour regenerer `TOOLS.md`
6. Committer le tout (y compris `TOOLS.md`)

## Processus de release

1. Mettre a jour **simultanement** : `package.json`, `manifest.json`, `server.json` (CI verifie la coherence)
2. Ajouter une entree dans `CHANGELOG.md` sous `## [X.Y.Z] - YYYY-MM-DD`
3. Committer : `git commit -m "chore: release vX.Y.Z"`
4. Creer le tag : `git tag vX.Y.Z`
5. Pousser : `git push origin main --tags`
6. La GitHub Action `.github/workflows/release.yml` se charge de :
   - Publier sur npm avec `--provenance`
   - Creer la GitHub Release (corps extrait de `CHANGELOG.md`)
   - Publier sur MCP Registry
   - Builder l'image Docker multi-arch (GHCR)

## Protection de la branche main (recommande)

- Exiger au moins 1 review sur les PRs
- Exiger que les checks CI passent
- Exiger que la branche soit a jour avant merge
- Interdire les force push
