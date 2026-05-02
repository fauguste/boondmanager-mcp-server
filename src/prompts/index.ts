import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Pre-orchestrated MCP prompts for the most common Boond workflows.
 *
 * Why: the search tools alone require the LLM to discover the right filter
 * combination on its own — it works, but it costs tokens and a few wrong
 * turns. A prompt names the goal ("synthese_equipe", "pipeline_commercial",
 * …) and embeds the exact tool sequence + filter names the model should
 * use. From the user's perspective it's a single command instead of a
 * multi-turn conversation.
 *
 * Each prompt resolves to a user message. We deliberately do NOT execute
 * the tools server-side here — the LLM still drives, the prompt just gives
 * it the runbook. This keeps the LLM in control of error handling and
 * follow-up questions.
 */

const userMessage = (text: string) => ({
  messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
});

interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  argsSchema: z.ZodRawShape;
  build: (args: Record<string, string | undefined>) => string;
}

const PROMPTS: PromptDefinition[] = [
  {
    name: "synthese_equipe",
    title: "Synthèse d'une équipe",
    description:
      "Produit un état d'équipe : qui est sur quoi, qui est absent, qui est disponible. " +
      "Si manager_id est omis, utilise l'utilisateur courant comme manager.",
    argsSchema: {
      manager_id: z
        .string()
        .optional()
        .describe(
          "ID du manager (ressource Boond). Si absent, l'outil `boond_application_current_user` doit être appelé pour le récupérer."
        ),
      periode: z
        .string()
        .optional()
        .describe("Période d'analyse libre (ex: 'cette semaine', 'avril 2026'). Défaut: mois en cours."),
    },
    build: ({ manager_id, periode }) => {
      const periodeText = periode || "le mois en cours";
      const managerStep = manager_id
        ? `Le manager ciblé est l'ID ${manager_id}.`
        : "Commence par appeler `boond_application_current_user` pour obtenir mon ID utilisateur, puis utilise-le comme `manager_id`.";
      return [
        `Produis une synthèse de l'équipe pour ${periodeText}.`,
        "",
        managerStep,
        "",
        "Étapes :",
        "1. Lister les membres de l'équipe : `boond_resources_search` avec `perimeterManagers: [<manager_id>]` et `resourceStates` pour ne garder que les actifs (récupère les états valides via `boond_application_dictionary` avec `setting.state.resource` si besoin).",
        "2. Pour chaque ressource retournée, récupérer en parallèle :",
        "   - `boond_resources_positionings` (qui est sur quel projet)",
        "   - `boond_resources_absences_reports` (absences validées/à venir)",
        "   - `boond_resources_times_reports` (CRA récent, pour confirmer l'occupation)",
        "3. Synthétiser un tableau par personne : nom, projet courant, % occupation, absences sur la période, disponibilité.",
        "4. Conclure par les signaux faibles (sur-/sous-charge, absences non couvertes, ressources sans positionnement).",
      ].join("\n");
    },
  },

  {
    name: "pipeline_commercial",
    title: "Pipeline commercial sur une période",
    description:
      "Analyse les opportunités commerciales avec closing prévu dans la période donnée : " +
      "répartition par état, CA pondéré, top opportunités.",
    argsSchema: {
      date_debut: z.string().describe("Début de période (YYYY-MM-DD)."),
      date_fin: z.string().describe("Fin de période (YYYY-MM-DD)."),
      manager_id: z
        .string()
        .optional()
        .describe(
          "ID du commercial. Si absent, scope = équipe de l'utilisateur courant via `perimeterDynamic: ['data']`."
        ),
    },
    build: ({ date_debut, date_fin, manager_id }) => {
      const scopeFilter = manager_id
        ? `\`perimeterManagers: [${manager_id}]\``
        : "`perimeterDynamic: ['data']` (mes opportunités)";
      return [
        `Analyse mon pipeline commercial avec closing entre ${date_debut} et ${date_fin}.`,
        "",
        `Périmètre : ${scopeFilter}.`,
        "",
        "Étapes :",
        "1. Appeler `boond_opportunities_search` avec :",
        `   - \`period: "closingDate"\``,
        `   - \`startDate: "${date_debut}"\`, \`endDate: "${date_fin}"\``,
        `   - ${scopeFilter}`,
        "   - `pageSize: 100`",
        "2. Si plus de 100 résultats, paginer via `page`.",
        "3. Récupérer le dictionnaire des états via `boond_application_dictionary` avec `setting.state.opportunity` pour traduire les ID en libellés.",
        "4. Restituer :",
        "   - Nombre total d'opportunités, par état",
        "   - CA pondéré total (somme de `turnoverWeightedExcludingTax`)",
        "   - Top 10 par montant pondéré, avec société/contact/closingDate",
        "   - Risques : opportunités dont la closingDate est passée mais qui ne sont pas encore en état Gagnée/Perdue.",
      ].join("\n");
    },
  },

  {
    name: "factures_a_relancer",
    title: "Factures impayées à relancer",
    description:
      "Liste les factures impayées avec date d'échéance dépassée, regroupées par société. " +
      "Optionnellement filtrable sur une société spécifique.",
    argsSchema: {
      society_id: z.string().optional().describe("ID d'une société pour cibler la relance."),
    },
    build: ({ society_id }) => {
      return [
        "Identifie les factures à relancer (impayées dont l'échéance est dépassée).",
        "",
        "Étapes :",
        "1. Appeler `boond_invoices_search` :",
        society_id
          ? `   - \`companyId: "${society_id}"\``
          : "   - sans filtre société (toutes les factures du périmètre courant)",
        "   - `pageSize: 100`",
        "2. Récupérer le dictionnaire `setting.state.invoice` via `boond_application_dictionary` pour identifier les états « payée » / « partiellement payée » / etc.",
        "3. Filtrer côté agent : ne conserver que les factures dont l'état n'est PAS « payée » ET dont la `dueDate` est strictement antérieure à aujourd'hui.",
        "4. Pour chaque facture retenue, récupérer le détail via `boond_invoices_get` si nécessaire pour obtenir le contact/email de relance.",
        "5. Restituer un tableau groupé par société : société | nombre de factures impayées | total HT impayé | facture la plus ancienne (référence + jours de retard) | contact à relancer.",
        "6. Ajouter une ligne « Total » en bas.",
      ].join("\n");
    },
  },

  {
    name: "candidats_pour_opportunite",
    title: "Candidats correspondant à une opportunité",
    description:
      "À partir d'une opportunité (ses outils, expertise, mobilité), trouve les candidats actifs qui matchent.",
    argsSchema: {
      opportunity_id: z.string().describe("ID de l'opportunité à pourvoir."),
    },
    build: ({ opportunity_id }) => {
      return [
        `Identifie les candidats qui matchent l'opportunité ${opportunity_id}.`,
        "",
        "Étapes :",
        `1. Récupérer le détail de l'opportunité : \`boond_opportunities_get(id="${opportunity_id}")\` puis l'onglet \`information\` pour les attributs détaillés.`,
        "2. Extraire les critères : `tools`, `expertiseAreas`, `activityAreas`, `places` (mobilité), `durations`, `startDate`/`endDate`.",
        "3. Appeler `boond_candidates_search` avec :",
        '   - les `tools` extraits (logique OU par défaut ; si l\'opportunité est très exigeante, repasser avec `["#AND#", ...]` pour exiger toutes les compétences)',
        "   - `expertiseAreas` correspondants",
        "   - `mobilityAreas` matchant le lieu",
        "   - `candidateStates` actifs uniquement (consulter `setting.state.candidate` via `boond_application_dictionary`)",
        '   - `period: "available"` + `startDate`/`endDate` calés sur la mission, pour ne garder que les candidats disponibles',
        "   - `pageSize: 50`",
        "4. Pour les top 20 candidats retournés, récupérer `boond_candidates_technical_data` pour vérifier l'adéquation fine.",
        "5. Restituer un classement : nom | titre | dispo | note d'adéquation (sur 10) avec justification 1 ligne.",
      ].join("\n");
    },
  },

  {
    name: "fiche_consultant",
    title: "Fiche complète d'un collaborateur",
    description: "Vue 360° d'une ressource : info, profil technique, positionnements, absences, CRA récents.",
    argsSchema: {
      resource_id: z.string().describe("ID de la ressource."),
    },
    build: ({ resource_id }) => {
      return [
        `Produis la fiche complète de la ressource ${resource_id}.`,
        "",
        "Étapes (à exécuter en parallèle quand possible) :",
        `1. \`boond_resources_information(id="${resource_id}")\` — coordonnées et état civil`,
        `2. \`boond_resources_technical_data(id="${resource_id}")\` — compétences, formations, langues, CV`,
        `3. \`boond_resources_administrative(id="${resource_id}")\` — données RH (TJM, salaire, contrat) si autorisé`,
        `4. \`boond_resources_positionings(id="${resource_id}")\` — positionnements actifs et historiques`,
        `5. \`boond_resources_projects(id="${resource_id}")\` — projets passés/en cours`,
        `6. \`boond_resources_absences_reports(id="${resource_id}")\` — absences à venir et passées récentes`,
        `7. \`boond_resources_times_reports(id="${resource_id}")\` — CRA des 3 derniers mois`,
        "",
        "Restitution : un document structuré en sections (Identité / Profil technique / Mission actuelle / Historique projets / Disponibilité / RH si pertinent). Mettre en évidence : projet courant, prochaine date de fin de mission, prochaine absence, taux d'occupation moyen sur 3 mois.",
      ].join("\n");
    },
  },

  {
    name: "staffing_disponible",
    title: "Consultants disponibles pour un staffing",
    description:
      "Identifie les ressources internes disponibles pour un staffing sur une fenêtre donnée, " +
      "avec filtres optionnels par compétences (texte libre) et périmètre. " +
      "Trie par date de disponibilité croissante et propose les profils prioritaires à activer.",
    argsSchema: {
      start_date: z.string().describe("Début de fenêtre de staffing (YYYY-MM-DD)."),
      end_date: z.string().describe("Fin de fenêtre de staffing (YYYY-MM-DD)."),
      competences: z
        .string()
        .optional()
        .describe(
          "Compétences recherchées en texte libre (ex: 'Java Spring AWS'). Le modèle les mappera vers `tools` via le dictionnaire."
        ),
      manager_id: z
        .string()
        .optional()
        .describe(
          "ID d'un manager pour restreindre à son équipe. Si absent, scope = mon équipe via `perimeterDynamic: ['managers']`."
        ),
    },
    build: ({ start_date, end_date, competences, manager_id }) => {
      const scope = manager_id
        ? `\`perimeterManagers: [${manager_id}]\``
        : "`perimeterDynamic: ['managers']` (mon équipe / mes N-1)";
      const skillsStep = competences
        ? `1. Mapper les compétences « ${competences} » vers leurs IDs : \`boond_application_dictionary\` avec \`setting.tool\` (et éventuellement \`setting.expertiseArea\`).`
        : "1. Pas de filtre compétences fourni — passer directement à l'étape 2.";
      const toolsLine = competences
        ? "   - `tools: [...]` issus de l'étape 1 (logique OU ; pour exiger toutes les compétences, mettre `'#AND#'` en 1er élément)"
        : "";
      return [
        `Identifie les ressources internes disponibles pour un staffing entre ${start_date} et ${end_date}.`,
        "",
        `Périmètre : ${scope}.`,
        "",
        "Étapes :",
        skillsStep,
        "2. Appeler `boond_resources_search` avec :",
        `   - \`period: "available"\`, \`startDate: "${start_date}"\`, \`endDate: "${end_date}"\``,
        `   - ${scope}`,
        toolsLine,
        "   - `resourceStates: [...]` filtrés sur les états « actif » uniquement (consulter `setting.state.resource` via `boond_application_dictionary`)",
        '   - `pageSize: 50`, `sort: "availability"`, `order: "asc"`',
        "3. Pour les 15 premières ressources retournées (en parallèle) :",
        "   - `boond_resources_positionings` — vérifier qu'aucun positionnement actif ne couvre déjà la fenêtre",
        "   - `boond_resources_technical_data` — confirmer compétences clés et niveau d'expérience",
        "4. Restituer un tableau trié par date de disponibilité : ressource | titre | dispo le | compétences matchées | mobilité | manager | TJM cible.",
        "5. Conclure par les 3 profils prioritaires à activer + un signal si la pénurie est forte (< 5 résultats — suggérer d'élargir la fenêtre ou les compétences).",
      ]
        .filter(Boolean)
        .join("\n");
    },
  },

  {
    name: "fin_de_mission",
    title: "Anticipation des fins de mission",
    description:
      "Liste les ressources dont la mission se termine dans les prochains jours, " +
      "pour anticiper le repositionnement. Met en évidence les fins imminentes sans relais identifié.",
    argsSchema: {
      horizon_jours: z
        .string()
        .optional()
        .describe("Nombre de jours à anticiper (défaut: 60). Ex: '30' pour ne voir que les fins très proches."),
      manager_id: z
        .string()
        .optional()
        .describe(
          "ID d'un manager pour restreindre à son équipe. Si absent, scope = mon équipe via `perimeterDynamic: ['managers']`."
        ),
    },
    build: ({ horizon_jours, manager_id }) => {
      const horizon = horizon_jours || "60";
      const scope = manager_id ? `\`perimeterManagers: [${manager_id}]\`` : "`perimeterDynamic: ['managers']`";
      return [
        `Liste les ressources dont la mission se termine dans les ${horizon} prochains jours.`,
        "",
        `Périmètre : ${scope}.`,
        "",
        "Étapes :",
        `1. Calculer la fenêtre : aujourd'hui (D) → D + ${horizon} jours (D+H). Conserver ces deux dates au format YYYY-MM-DD.`,
        "2. Appeler `boond_resources_search` avec :",
        '   - `period: "available"`, `startDate: D`, `endDate: D+H`',
        `   - ${scope}`,
        "   - `resourceStates` filtrés sur les états « actif » (consulter `setting.state.resource`)",
        '   - `pageSize: 100`, `sort: "availability"`, `order: "asc"`',
        "   → Cela retourne les ressources qui (re)deviennent disponibles dans la fenêtre — proxy direct pour « fin de mission ».",
        "3. Pour chaque ressource, en parallèle :",
        "   - `boond_resources_positionings` — récupérer le positionnement courant (projet + société + date de fin) et détecter d'éventuels positionnements de relais déjà actés",
        "   - `boond_resources_projects` — historique projet récent pour contexte",
        "4. Restituer un tableau trié par date de fin croissante : ressource | projet courant | société cliente | date de fin | jours restants | manager | relais déjà identifié (oui/non).",
        "5. Mettre en évidence en haut du tableau :",
        "   - **Urgent** : fin dans <= 15 jours sans relais identifié",
        "   - **À surveiller** : fin entre 15 et 30 jours sans relais",
        "6. Conclure par 3-5 actions concrètes : relances commerciales, repositionnements internes, etc.",
      ].join("\n");
    },
  },

  {
    name: "cartographie_competences",
    title: "Cartographie des compétences d'un périmètre",
    description:
      "Produit une cartographie des compétences techniques d'un périmètre (équipe, agence, …) : " +
      "top compétences, compétences rares (risque bus-factor) et compétences manquantes vs opportunités ouvertes.",
    argsSchema: {
      manager_id: z
        .string()
        .optional()
        .describe(
          "ID d'un manager pour cibler son équipe. Si absent, scope = mon équipe via `perimeterDynamic: ['managers']`."
        ),
      agency_id: z
        .string()
        .optional()
        .describe("ID d'agence pour cartographier toute une agence (alternatif à `manager_id`)."),
      top_n: z.string().optional().describe("Nombre de compétences à mettre en avant dans le top (défaut: 20)."),
    },
    build: ({ manager_id, agency_id, top_n }) => {
      const top = top_n || "20";
      const scope = agency_id
        ? `\`perimeterAgencies: [${agency_id}]\``
        : manager_id
          ? `\`perimeterManagers: [${manager_id}]\``
          : "`perimeterDynamic: ['managers']`";
      return [
        "Cartographie les compétences techniques du périmètre.",
        "",
        `Périmètre : ${scope}.`,
        "",
        "Étapes :",
        "1. Lister les ressources actives via `boond_resources_search` :",
        `   - ${scope}`,
        "   - `resourceStates` filtrés sur les états « actif » (consulter `setting.state.resource` via `boond_application_dictionary`)",
        "   - `pageSize: 100` (paginer si > 100)",
        "2. Récupérer le dictionnaire `setting.tool` (et `setting.expertiseArea`, `setting.languageSpoken`) via `boond_application_dictionary` pour traduire les IDs en libellés.",
        "3. Pour chaque ressource (par batchs parallèles), appeler `boond_resources_technical_data` et extraire `tools`, `expertiseAreas`, `languages`, `experiences`.",
        "4. Agréger côté agent :",
        `   - **Top ${top}** : compétences les plus représentées (nb de ressources)`,
        "   - **Rares** : compétences possédées par 1 ou 2 personnes (risque bus-factor)",
        "   - **Saturées** : compétences possédées par > 70% de l'équipe (potentielle banalisation)",
        "5. Croiser avec les opportunités ouvertes via `boond_opportunities_search` (`opportunityStates` actifs, `perimeterDynamic`/`perimeterAgencies` cohérents) et leurs `tools` :",
        "   - **Manquantes** : compétences demandées sur les opportunités mais absentes du périmètre — alerte recrutement / formation",
        "6. Restituer en 4 sections :",
        `   - Top ${top} compétences (tableau : compétence | nb ressources | exemples de noms)`,
        "   - Compétences rares (avec porteurs nominatifs et nombre d'opportunités demandant cette compétence)",
        "   - Compétences saturées",
        "   - Compétences manquantes vs opportunités (recommandations recrutement / formation)",
      ].join("\n");
    },
  },

  {
    name: "cvs_a_mettre_a_jour",
    title: "Audit fraîcheur des CV / dossiers techniques",
    description:
      "Identifie les ressources dont le CV ou le dossier technique est obsolète, incomplet, ou manquant. " +
      "Priorise celles bientôt sur le marché (en intercontrat ou disponibles à court terme).",
    argsSchema: {
      seuil_mois: z
        .string()
        .optional()
        .describe("Un dossier technique non touché depuis plus de N mois est considéré obsolète (défaut: 12)."),
      manager_id: z
        .string()
        .optional()
        .describe(
          "ID d'un manager pour cibler son équipe. Si absent, scope = mon équipe via `perimeterDynamic: ['managers']`."
        ),
    },
    build: ({ seuil_mois, manager_id }) => {
      const seuil = seuil_mois || "12";
      const scope = manager_id ? `\`perimeterManagers: [${manager_id}]\`` : "`perimeterDynamic: ['managers']`";
      return [
        `Identifie les CV / dossiers techniques à rafraîchir (seuil d'obsolescence : ${seuil} mois).`,
        "",
        `Périmètre : ${scope}.`,
        "",
        "Étapes :",
        "1. Lister les ressources actives via `boond_resources_search` :",
        `   - ${scope}`,
        "   - `resourceStates` filtrés sur les états « actif » (consulter `setting.state.resource`)",
        "   - `pageSize: 100` (paginer si nécessaire)",
        "2. Pour chaque ressource (par batchs parallèles), appeler `boond_resources_technical_data` et lire :",
        "   - `updateDate` du dossier technique",
        "   - présence et longueur du CV (`resume`)",
        "   - nombre de compétences déclarées (`tools`)",
        "   - nombre d'expériences renseignées",
        "3. Filtrer côté agent : ne conserver que les ressources dont au moins UN critère est défaillant —",
        `   - \`updateDate\` antérieure de plus de ${seuil} mois, OU`,
        "   - CV manquant / vide, OU",
        "   - moins de 3 compétences (`tools`) déclarées, OU",
        "   - aucune expérience renseignée.",
        '4. Croiser avec la disponibilité pour prioriser : `boond_resources_search` avec `period: "available"` + fenêtre des 3 prochains mois, et marquer les ressources concernées comme **prioritaires**.',
        "5. Restituer un tableau de relance trié par priorité décroissante : ressource | manager | dernière maj DT | jours d'ancienneté | trous (CV manquant / 0 compétences / 0 expérience) | bientôt dispo (oui/non).",
        "6. Conclure par les 5 ressources à relancer en premier (avec template de message court à envoyer au manager).",
      ].join("\n");
    },
  },

  {
    name: "recherche_profil_competences",
    title: "Recherche multi-source d'un profil par compétences",
    description:
      "Recherche un profil correspondant à un mix de compétences libres, en croisant ressources internes " +
      "et candidats. Sortie classée par adéquation. Utile en amont d'un staffing ou d'une opportunité non encore qualifiée.",
    argsSchema: {
      competences: z
        .string()
        .describe("Compétences recherchées en texte libre (ex: 'Java Spring AWS Kubernetes', '.NET Azure DevOps')."),
      experience_min: z
        .string()
        .optional()
        .describe(
          "Niveau d'expérience minimum en texte libre (ex: '5 ans', 'senior'). Le modèle le mappera vers `experiences` via le dictionnaire."
        ),
      dispo_avant: z
        .string()
        .optional()
        .describe(
          "Disponibilité requise au plus tard à cette date (YYYY-MM-DD). Si fourni, applique `period: 'available'` + `endDate`."
        ),
      inclure_candidats: z
        .string()
        .optional()
        .describe(
          "'oui' (défaut) pour inclure aussi les candidats actifs ; 'non' pour ne chercher que dans les ressources internes."
        ),
      manager_id: z
        .string()
        .optional()
        .describe(
          "ID d'un manager pour restreindre le scope ressources internes. Sinon scope ouvert (toute l'organisation accessible)."
        ),
    },
    build: ({ competences, experience_min, dispo_avant, inclure_candidats, manager_id }) => {
      const includeCandidates = (inclure_candidats || "oui").toLowerCase() !== "non";
      const scope = manager_id
        ? `\`perimeterManagers: [${manager_id}]\``
        : "(pas de filtre périmètre — recherche sur l'ensemble accessible à l'utilisateur)";
      const dispoLine = dispo_avant
        ? `   - \`period: "available"\`, \`endDate: "${dispo_avant}"\` (disponible au plus tard à cette date)`
        : "";
      const expStep = experience_min
        ? `2bis. Mapper l'expérience minimum « ${experience_min} » vers les IDs \`experiences\` via \`boond_application_dictionary\` avec \`setting.experience\`.`
        : "";
      return [
        `Recherche un profil correspondant aux compétences : « ${competences} ».`,
        "",
        `Scope ressources internes : ${scope}.`,
        `Inclure les candidats actifs : ${includeCandidates ? "oui" : "non"}.`,
        "",
        "Étapes :",
        "1. Mapper les compétences libres vers leurs IDs :",
        "   - `boond_application_dictionary` avec `setting.tool` pour les outils / technos",
        "   - `boond_application_dictionary` avec `setting.expertiseArea` pour les domaines d'expertise",
        "2. Identifier les compétences indispensables (toutes requises) vs souhaitables, à partir du libellé du besoin.",
        expStep,
        "3. Recherche dans les ressources internes via `boond_resources_search` :",
        '   - `tools: [...]` (si plusieurs compétences indispensables, préfixer par `"#AND#"` pour exiger toutes ; sinon laisser en OU)',
        "   - `expertiseAreas: [...]` éventuellement",
        experience_min ? "   - `experiences: [...]` issus de l'étape 2bis" : "",
        dispoLine,
        manager_id ? `   - ${scope}` : "",
        "   - `resourceStates` actifs uniquement (consulter `setting.state.resource`)",
        "   - `pageSize: 30`",
        includeCandidates
          ? "4. En parallèle, recherche dans les candidats via `boond_candidates_search` avec les mêmes filtres + `candidateStates` actifs (consulter `setting.state.candidate`)."
          : "4. (Skip — recherche limitée aux ressources internes.)",
        "5. Pour les top 10 résultats combinés, récupérer `technical_data` (`boond_resources_technical_data` ou `boond_candidates_technical_data`) pour vérifier l'adéquation fine.",
        "6. Restituer un classement unique : type (Ressource interne / Candidat) | nom | titre | compétences matchées | expérience | dispo | localisation/mobilité | note d'adéquation /10 (1 ligne de justification).",
        "7. Si moins de 5 résultats : suggérer un assouplissement (retirer une compétence secondaire, élargir le périmètre géographique, accepter un junior, sous-traitance).",
      ]
        .filter(Boolean)
        .join("\n");
    },
  },

  {
    name: "recap_hebdo",
    title: "Récap hebdomadaire (moi + mon équipe)",
    description:
      "Compile en une vue ce qui s'est passé / va se passer cette semaine pour moi et mon équipe : opportunités, projets, absences, CRA.",
    argsSchema: {
      semaine: z
        .string()
        .optional()
        .describe("Semaine ciblée (ex: 'cette semaine', 'la semaine prochaine'). Défaut: cette semaine."),
    },
    build: ({ semaine }) => {
      const semaineText = semaine || "cette semaine";
      return [
        `Produis mon récap pour ${semaineText}.`,
        "",
        "Étapes :",
        "1. `boond_application_current_user` pour récupérer mon ID.",
        "2. En parallèle :",
        "   a. `boond_opportunities_search` avec `perimeterDynamic: ['data']`, `period: 'updated'` + dates de la semaine — opportunités touchées cette semaine.",
        "   b. `boond_resources_search` avec `perimeterDynamic: ['managers']` — mon équipe (mes N-1).",
        "   c. Pour chaque membre d'équipe : `boond_resources_absences_reports` filtré sur la semaine.",
        "   d. `boond_projects_search` avec `perimeterDynamic: ['data']` et `period: 'running'` + dates de la semaine — mes projets actifs.",
        "3. Récupérer `setting.state.opportunity` et `setting.state.project` via `boond_application_dictionary` pour libeller les états.",
        "4. Restituer en 4 sections :",
        "   - **Pipeline** : opps qui ont bougé (nouvelles, état changé, closing imminent)",
        "   - **Équipe** : qui est absent cette semaine, qui termine sa mission",
        "   - **Projets** : projets actifs, dont ceux qui s'arrêtent ou démarrent dans la semaine",
        "   - **Actions à mener** : 3-5 puces concrètes (relances, validations, repositionnements)",
      ].join("\n");
    },
  },
];

export function registerAllPrompts(server: McpServer): void {
  for (const p of PROMPTS) {
    server.registerPrompt(
      p.name,
      {
        title: p.title,
        description: p.description,
        argsSchema: p.argsSchema,
      },
      async (args) => userMessage(p.build((args ?? {}) as Record<string, string | undefined>))
    );
  }
}

/** Exposed for tests so we can assert names/coverage without instantiating a server. */
export const REGISTERED_PROMPTS = PROMPTS.map((p) => ({
  name: p.name,
  title: p.title,
  description: p.description,
  argKeys: Object.keys(p.argsSchema),
}));
