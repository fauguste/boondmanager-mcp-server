# Libellés personnalisés du dictionnaire (dictionary overrides)

L'API BoondManager exige des **IDs numériques** pour les champs pilotés par le
dictionnaire de l'instance : le type d'une action (`typeOf`, cf.
`setting.action.*`) et l'état d'une entité (`state`, cf. `setting.state.*`).
Ces IDs varient d'une instance à l'autre dès que le dictionnaire a été
personnalisé (libellés anglais, types d'action métier ajoutés, états
réordonnés…). Le modèle doit alors d'abord interroger
`boond_application_dictionary` pour retrouver le bon ID, ou risque d'envoyer
un ID erroné.

Les *dictionary overrides* permettent de déclarer une fois pour toutes le
mapping **libellé → ID** propre à votre instance. Le serveur :

- accepte alors ces libellés en entrée (`typeOf` de `boond_actions_create`,
  champs `state` des créations/modifications) et les **résout automatiquement**
  en ID numérique avant l'appel API ;
- **enrichit les descriptions** des outils/champs concernés avec la liste des
  libellés acceptés, pour que le modèle les utilise spontanément ;
- expose le mapping chargé via la ressource MCP `boond://dictionary/overrides`.

## Configuration

Variable d'environnement `BOOND_DICTIONARY_OVERRIDES`, avec **deux modes** :

1. **JSON inline** — la valeur commence par `{` :

   ```bash
   export BOOND_DICTIONARY_OVERRIDES='{"action":{"contact":{"Call":61,"Email":63}}}'
   ```

2. **Chemin de fichier** — toute autre valeur est interprétée comme le chemin
   d'un fichier JSON UTF-8 :

   ```bash
   export BOOND_DICTIONARY_OVERRIDES="/etc/boond/dictionary-overrides.json"
   ```

Dans l'extension Claude Desktop (`.mcpb`), le champ « Libellés personnalisés
du dictionnaire » de la configuration accepte les deux mêmes formes.

## Format

```json
{
  "action": {
    "contact": { "Call": 61, "Email": 63, "Meeting": 62 },
    "candidate": { "Call": 40, "Interview": 42 },
    "resource": { "Call": 20 },
    "opportunity": {},
    "project": {}
  },
  "state": {
    "candidate": { "Interviewed": 2, "Hired": 5 },
    "opportunity": { "Won": 6, "Lost": 7 },
    "project": { "In progress": 1 }
  }
}
```

- Les deux sections `action` et `state` sont **optionnelles** (déclarez
  seulement ce dont vous avez besoin ; les sous-objets vides sont ignorés).
- Entités valides pour `action` : `contact`, `candidate`, `resource`,
  `opportunity`, `project` (les clés de `setting.action.*`).
- Entités valides pour `state` : `candidate`, `resource`, `contact`,
  `company`, `opportunity`, `project`, `positioning`, `quotation`, `product`,
  `invoice`, `order`, `absence` (les clés de `setting.state.*`).
- Les valeurs sont les **IDs numériques** (entiers ≥ 0) tels qu'ils
  apparaissent dans `boond_application_dictionary` pour votre instance.
- Une clé d'entité inconnue est **ignorée avec un avertissement** dans les
  logs (les entrées valides restent actives).

## Comportement

- **`typeOf` de `boond_actions_create`** : accepte un ID numérique (inchangé)
  ou un libellé déclaré. Le libellé est résolu selon l'entité de rattachement
  (`contactId` → `action.contact`, `candidateId` → `action.candidate`, …),
  sans sensibilité à la casse ni aux espaces de tête/queue. Libellé inconnu →
  erreur explicite listant les libellés disponibles pour cette entité.
- **Champs `state`** des créations/modifications de candidats, ressources,
  sociétés, opportunités et projets : même résolution, au moment du parse.
  Un libellé inconnu fait échouer la validation (l'ID numérique reste
  toujours accepté).
- **Descriptions enrichies** : quand des overrides sont configurés, les
  descriptions des outils/champs concernés mentionnent les libellés acceptés
  (ex. « Libellés personnalisés acceptés (résolus automatiquement) :
  Call=61, Email=63 »). Sans overrides, les descriptions sont strictement
  inchangées.
- **Ressource MCP** : `boond://dictionary/overrides` renvoie le mapping chargé
  (ou `{ "configured": false }` si rien n'est configuré) — pratique pour
  vérifier ce que le serveur a réellement pris en compte.
- **Fail-open** : toute erreur (fichier introuvable, JSON invalide, structure
  invalide) est loguée en `warn` et désactive simplement les overrides. Le
  serveur **démarre toujours** et se comporte alors exactement comme sans la
  variable.

## Limites

- C'est une commodité **côté entrée** uniquement : les réponses de l'API ne
  sont **pas** traduites (un `state: 2` dans une réponse reste `2` ; utilisez
  les ressources `boond://dictionary/states/*` pour la correspondance).
- Le mapping n'est **pas validé contre votre instance** : si vous déclarez
  `"Call": 61` alors que l'ID réel est 16, l'API recevra 61. Vérifiez les IDs
  via `boond_application_dictionary`.
- Les filtres de recherche (`states`, `opportunityStates`…) continuent
  d'attendre des IDs numériques.
