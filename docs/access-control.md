# Contrôle d'accès (restriction par domaine et par opération)

Ce serveur MCP expose par défaut l'intégralité de son catalogue (tous les
domaines, lecture comme écriture). Pour beaucoup de déploiements, on veut
**réduire ce que l'IA peut voir et faire** : exposer uniquement la
comptabilité, ou passer tout en lecture seule, etc. Cela se configure
entièrement par variables d'environnement, sans modifier le code.

## ⚠️ Ce n'est pas une frontière de sécurité dure

Ce filtre agit **côté MCP** : il décide quels outils/prompts sont *exposés au
modèle*. Le serveur continue d'utiliser les identifiants BoondManager
configurés. Si ces identifiants ont le droit d'écrire, le filtre ne révoque
rien côté API : il **masque** simplement les outils au modèle.

- **Frontière dure** = les droits du compte / rôle BoondManager (lecture
  seule, périmètre comptable, etc.). C'est là qu'on garantit qu'une écriture
  ou une lecture interdite sera **rejetée** (HTTP 403) quoi qu'il arrive.
- **Filtre MCP (ce document)** = ergonomie, économie de tokens de contexte, et
  garde-fou contre les actions accidentelles du modèle.

Les deux sont **complémentaires**. Pour un vrai cloisonnement, configurez
d'abord les droits BoondManager, puis utilisez ce filtre pour aligner la
surface exposée à l'IA.

## Variables d'environnement

| Variable | Effet | Exemple |
|----------|-------|---------|
| `BOOND_MCP_DOMAINS` | Liste blanche de domaines (CSV). Absente = tous les domaines. | `invoices,payments,application` |
| `BOOND_MCP_EXCLUDE_DOMAINS` | Liste noire de domaines (CSV). Appliquée **après** la liste blanche. | `candidates,resources` |
| `BOOND_MCP_OPERATIONS` | Liste blanche d'opérations (CSV) parmi `read,create,update,delete`. Absente = toutes. | `read,create,update` |
| `BOOND_MCP_READ_ONLY` | Raccourci booléen (`1`/`true`/`yes`). Équivaut à `BOOND_MCP_OPERATIONS=read`. | `true` |

Règles de résolution :

- **Domaines** : `effectif = (liste blanche ?? tous) − liste noire`. La liste
  noire l'emporte toujours.
- **Opérations** : si `BOOND_MCP_OPERATIONS` est défini, il prime ; sinon, si
  `BOOND_MCP_READ_ONLY` est vrai → `read` seulement ; sinon toutes. Si les
  deux sont définis, `BOOND_MCP_OPERATIONS` gagne (un `warn` est journalisé).
- **Tolérance aux fautes** : un domaine ou une opération inconnus sont
  **ignorés avec un avertissement** (le serveur ne plante pas). Si
  `BOOND_MCP_OPERATIONS` ne contient *que* des valeurs invalides, on retombe
  sur « toutes les opérations ».

### Comment une opération est déterminée

La catégorie d'un outil est déduite de ses annotations MCP (source de vérité,
pas de devinette sur le nom) :

| Opération | Annotations | Exemples d'outils |
|-----------|-------------|-------------------|
| `read` | `readOnlyHint: true` | `*_search`, `*_get`, onglets, `boond_workflow_*`, reporting |
| `create` | `readOnlyHint: false`, `idempotentHint: false` | `*_create` |
| `update` | `readOnlyHint: false`, `idempotentHint: true` | `*_update` |
| `delete` | `destructiveHint: true` | `*_delete` |

Un outil sans `readOnlyHint: true` est traité comme une écriture (défaut
prudent : il est masqué en mode lecture seule).

### Noms de domaines

Les domaines correspondent à ceux listés dans [TOOLS.md](../TOOLS.md) (et
`REGISTERED_DOMAINS`). Les domaines multi-mots s'écrivent indifféremment avec
tiret ou underscore : `provider-invoices` ou `provider_invoices`. La détection
ne repose **pas** sur une analyse du nom d'outil, donc `invoices` n'active
jamais par erreur `provider-invoices`.

## Effet sur les prompts, workflow-tools et resources

- **Prompts** : un prompt est coupé dès qu'**un** des domaines qu'il orchestre
  n'est pas autorisé, pour qu'un runbook ne pointe jamais vers un outil absent.
  Exemple : avec `BOOND_MCP_DOMAINS=invoices,application`, le prompt
  `factures_a_relancer` reste, mais `pipeline_commercial` (qui touche
  `opportunities`) disparaît.
- **Workflow-tools** (`boond_workflow_*`) : ce sont les miroirs 1:1 des
  prompts. Ils suivent **exactement** la même règle que les prompts (un prompt
  et son outil-miroir apparaissent ou disparaissent ensemble), et ne dépendent
  donc pas de la présence de `workflows` dans la liste blanche. Pour supprimer
  uniquement la forme « outil » tout en gardant les prompts :
  `BOOND_MCP_EXCLUDE_DOMAINS=workflows`.
- **Resources** (dictionnaires `boond://dictionary/*`, current-user) : **non
  filtrées**. Elles sont en lecture seule par nature et servent de substrat de
  résolution (libellés d'états/types). Elles restent disponibles quelle que
  soit la policy.

## Domaine `application` : un socle

Le domaine `application` fournit les dictionnaires (résolution des
états/types) et `current-user`. Beaucoup d'outils et de prompts s'appuient
dessus. Il **n'est pas** forcé (vous gardez le contrôle total), mais si vous
l'excluez, un avertissement est journalisé et la résolution des libellés sera
dégradée. En pratique, incluez `application` dans presque toutes vos listes
blanches.

## Exemples

### Comptabilité, en lecture seule

```bash
BOOND_MCP_READ_ONLY=true
BOOND_MCP_DOMAINS=invoices,provider-invoices,payments,orders,purchases,expenses,application
```

### Comptabilité, écriture autorisée mais sans suppression

```bash
BOOND_MCP_OPERATIONS=read,create,update
BOOND_MCP_DOMAINS=invoices,provider-invoices,payments,orders,purchases,expenses,application
```

### Gestion de projet uniquement

```bash
BOOND_MCP_DOMAINS=projects,deliveries,timesheets,resources,application
```

### Tout sauf le recrutement / RH

```bash
BOOND_MCP_EXCLUDE_DOMAINS=candidates,positionings
```

### Serveur 100 % lecture seule (tous domaines)

```bash
BOOND_MCP_READ_ONLY=true
```

## Exemple de configuration client (Claude Desktop / Cursor)

```json
{
  "mcpServers": {
    "boondmanager": {
      "command": "npx",
      "args": ["-y", "boondmanager-mcp-server"],
      "env": {
        "BOOND_USER_TOKEN": "…",
        "BOOND_CLIENT_TOKEN": "…",
        "BOOND_CLIENT_KEY": "…",
        "BOOND_MCP_DOMAINS": "invoices,payments,application",
        "BOOND_MCP_READ_ONLY": "true"
      }
    }
  }
}
```

## Vérification

Le filtre s'applique au démarrage. Quand une restriction est active, un log
`info` (`component: "access-policy"`) résume la policy effective. Côté client,
la liste d'outils (`tools/list`) et de prompts (`prompts/list`) reflète
directement la configuration.
