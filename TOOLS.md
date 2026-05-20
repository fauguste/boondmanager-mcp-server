# Tool Catalogue

> Auto-generated from the server registrations. Do not edit by hand.
> Regenerate with `npm run docs:tools` (CI fails if this file is stale).

**171 tools** across **37 domains** · **11 prompts** · **21 resources**.

Hint legend: `read` (readOnlyHint), `write` (creates/updates), `delete` (destructiveHint), `idempotent` (idempotentHint), `open-world` (openWorldHint, e.g. paginated keyword search).

## Tools

### absences (5)

| Tool | Title | Hints |
|---|---|---|
| `boond_absences_create` | Créer une absence | write |
| `boond_absences_delete` | Supprimer une absence | delete |
| `boond_absences_get` | Détails d'une absence | read · idempotent |
| `boond_absences_search` | Rechercher des absences | read · idempotent · open-world |
| `boond_absences_update` | Modifier une absence | write · idempotent |

### accounts (2)

| Tool | Title | Hints |
|---|---|---|
| `boond_accounts_get` | Détails d'un compte utilisateur | read · idempotent |
| `boond_accounts_search` | Rechercher des comptes utilisateurs | read · idempotent · open-world |

### actions (4)

| Tool | Title | Hints |
|---|---|---|
| `boond_actions_create` | Créer une action | write |
| `boond_actions_delete` | Supprimer une action | delete |
| `boond_actions_get` | Détails d'une action | read · idempotent |
| `boond_actions_search` | Rechercher des actions | read · idempotent · open-world |

### advantages (2)

| Tool | Title | Hints |
|---|---|---|
| `boond_advantages_get` | Détails d'un avantage | read · idempotent |
| `boond_advantages_search` | Rechercher des avantages | read · idempotent · open-world |

### agencies (2)

| Tool | Title | Hints |
|---|---|---|
| `boond_agencies_get` | Détails d'une agence | read · idempotent |
| `boond_agencies_search` | Rechercher des agences | read · idempotent · open-world |

### application (2)

| Tool | Title | Hints |
|---|---|---|
| `boond_application_current_user` | Utilisateur courant BoondManager | read · idempotent |
| `boond_application_dictionary` | Récupérer un dictionnaire BoondManager | read · idempotent |

### business_units (2)

| Tool | Title | Hints |
|---|---|---|
| `boond_business_units_get` | Détails d'une business unit | read · idempotent |
| `boond_business_units_search` | Rechercher des business units | read · idempotent · open-world |

### calendars (2)

| Tool | Title | Hints |
|---|---|---|
| `boond_calendars_get` | Détails d'un calendrier | read · idempotent |
| `boond_calendars_search` | Rechercher des calendriers | read · idempotent · open-world |

### candidates (10)

| Tool | Title | Hints |
|---|---|---|
| `boond_candidates_actions` | Actions liées à un candidat | read · idempotent |
| `boond_candidates_administrative` | Données administratives d'un candidat | read · idempotent |
| `boond_candidates_create` | Créer un(e) candidat | write |
| `boond_candidates_delete` | Supprimer un(e) candidat | delete |
| `boond_candidates_get` | Détails d'un(e) candidat | read · idempotent |
| `boond_candidates_information` | Informations générales d'un candidat | read · idempotent |
| `boond_candidates_positionings` | Positionnements d'un candidat | read · idempotent |
| `boond_candidates_search` | Rechercher des candidats | read · idempotent · open-world |
| `boond_candidates_technical_data` | Compétences techniques d'un candidat | read · idempotent |
| `boond_candidates_update` | Modifier un(e) candidat | write · idempotent |

### companies (14)

| Tool | Title | Hints |
|---|---|---|
| `boond_companies_actions` | Actions liées à une société | read · idempotent |
| `boond_companies_contacts` | Contacts d'une société | read · idempotent |
| `boond_companies_create` | Créer un(e) société | write |
| `boond_companies_delete` | Supprimer un(e) société | delete |
| `boond_companies_get` | Détails d'un(e) société | read · idempotent |
| `boond_companies_information` | Informations générales d'une société | read · idempotent |
| `boond_companies_invoices` | Factures d'une société | read · idempotent |
| `boond_companies_opportunities` | Opportunités d'une société | read · idempotent |
| `boond_companies_orders` | Bons de commande d'une société | read · idempotent |
| `boond_companies_projects` | Projets d'une société | read · idempotent |
| `boond_companies_provider_invoices` | Factures fournisseur d'une société | read · idempotent |
| `boond_companies_purchases` | Achats d'une société | read · idempotent |
| `boond_companies_search` | Rechercher des sociétés | read · idempotent · open-world |
| `boond_companies_update` | Modifier un(e) société | write · idempotent |

### contacts (11)

| Tool | Title | Hints |
|---|---|---|
| `boond_contacts_actions` | Actions liées à un contact | read · idempotent |
| `boond_contacts_create` | Créer un(e) contact | write |
| `boond_contacts_delete` | Supprimer un(e) contact | delete |
| `boond_contacts_get` | Détails d'un(e) contact | read · idempotent |
| `boond_contacts_information` | Informations générales d'un contact | read · idempotent |
| `boond_contacts_invoices` | Factures d'un contact | read · idempotent |
| `boond_contacts_opportunities` | Opportunités d'un contact | read · idempotent |
| `boond_contacts_orders` | Bons de commande d'un contact | read · idempotent |
| `boond_contacts_projects` | Projets d'un contact | read · idempotent |
| `boond_contacts_search` | Rechercher des contacts | read · idempotent · open-world |
| `boond_contacts_update` | Modifier un(e) contact | write · idempotent |

### contracts (2)

| Tool | Title | Hints |
|---|---|---|
| `boond_contracts_create` | Créer un contrat | write |
| `boond_contracts_get` | Détails d'un contrat | read · idempotent |

### deliveries (2)

| Tool | Title | Hints |
|---|---|---|
| `boond_deliveries_get` | Détails d'une livraison / CRA | read · idempotent |
| `boond_deliveries_search` | Rechercher des livraisons / CRA | read · idempotent · open-world |

### expenses (5)

| Tool | Title | Hints |
|---|---|---|
| `boond_expenses_create` | Créer une note de frais | write |
| `boond_expenses_delete` | Supprimer une note de frais | delete |
| `boond_expenses_get` | Détails d'une note de frais | read · idempotent |
| `boond_expenses_search` | Rechercher des notes de frais | read · idempotent · open-world |
| `boond_expenses_update` | Modifier une note de frais | write · idempotent |

### flags (2)

| Tool | Title | Hints |
|---|---|---|
| `boond_flags_get` | Détails d'un drapeau/étiquette | read · idempotent |
| `boond_flags_search` | Rechercher des drapeaux/étiquettes | read · idempotent · open-world |

### invoices (5)

| Tool | Title | Hints |
|---|---|---|
| `boond_invoices_create` | Créer une facture | write |
| `boond_invoices_delete` | Supprimer une facture | delete |
| `boond_invoices_get` | Détails d'une facture | read · idempotent |
| `boond_invoices_search` | Rechercher des factures | read · idempotent · open-world |
| `boond_invoices_update` | Modifier une facture | write · idempotent |

### logs (2)

| Tool | Title | Hints |
|---|---|---|
| `boond_logs_get` | Détails d'un log d'audit | read · idempotent |
| `boond_logs_search` | Rechercher des logs d'audit | read · idempotent · open-world |

### notifications (2)

| Tool | Title | Hints |
|---|---|---|
| `boond_notifications_get` | Détails d'une notification | read · idempotent |
| `boond_notifications_search` | Rechercher des notifications | read · idempotent · open-world |

### opportunities (10)

| Tool | Title | Hints |
|---|---|---|
| `boond_opportunities_actions` | Actions liées à une opportunité | read · idempotent |
| `boond_opportunities_create` | Créer un(e) opportunité | write |
| `boond_opportunities_delete` | Supprimer un(e) opportunité | delete |
| `boond_opportunities_get` | Détails d'un(e) opportunité | read · idempotent |
| `boond_opportunities_information` | Informations générales d'une opportunité | read · idempotent |
| `boond_opportunities_positionings` | Positionnements d'une opportunité | read · idempotent |
| `boond_opportunities_projects` | Projets liés à une opportunité | read · idempotent |
| `boond_opportunities_search` | Rechercher des opportunités | read · idempotent · open-world |
| `boond_opportunities_simulation` | Simulation financière d'une opportunité | read · idempotent |
| `boond_opportunities_update` | Modifier un(e) opportunité | write · idempotent |

### orders (5)

| Tool | Title | Hints |
|---|---|---|
| `boond_orders_create` | Créer un bon de commande | write |
| `boond_orders_delete` | Supprimer un bon de commande | delete |
| `boond_orders_get` | Détails d'un bon de commande | read · idempotent |
| `boond_orders_search` | Rechercher des bons de commande | read · idempotent · open-world |
| `boond_orders_update` | Modifier un bon de commande | write · idempotent |

### payments (2)

| Tool | Title | Hints |
|---|---|---|
| `boond_payments_get` | Détails d'un paiement | read · idempotent |
| `boond_payments_search` | Rechercher des paiements | read · idempotent · open-world |

### planning_absences (1)

| Tool | Title | Hints |
|---|---|---|
| `boond_planning_absences_search` | Rechercher le planning des absences | read · idempotent · open-world |

### poles (2)

| Tool | Title | Hints |
|---|---|---|
| `boond_poles_get` | Détails d'un pôle | read · idempotent |
| `boond_poles_search` | Rechercher des pôles | read · idempotent · open-world |

### positionings (4)

| Tool | Title | Hints |
|---|---|---|
| `boond_positionings_create` | Créer un positionnement | write |
| `boond_positionings_delete` | Supprimer un positionnement | delete |
| `boond_positionings_get` | Détails d'un positionnement | read · idempotent |
| `boond_positionings_search` | Rechercher des positionnements | read · idempotent · open-world |

### products (5)

| Tool | Title | Hints |
|---|---|---|
| `boond_products_create` | Créer un(e) produit | write |
| `boond_products_delete` | Supprimer un(e) produit | delete |
| `boond_products_get` | Détails d'un(e) produit | read · idempotent |
| `boond_products_search` | Rechercher des produits | read · idempotent · open-world |
| `boond_products_update` | Modifier un(e) produit | write · idempotent |

### projects (12)

| Tool | Title | Hints |
|---|---|---|
| `boond_projects_actions` | Actions liées à un projet | read · idempotent |
| `boond_projects_create` | Créer un(e) projet | write |
| `boond_projects_delete` | Supprimer un(e) projet | delete |
| `boond_projects_deliveries_groupments` | Livraisons d'un projet | read · idempotent |
| `boond_projects_get` | Détails d'un(e) projet | read · idempotent |
| `boond_projects_information` | Informations générales d'un projet | read · idempotent |
| `boond_projects_orders` | Bons de commande d'un projet | read · idempotent |
| `boond_projects_productivity` | Productivité d'un projet | read · idempotent |
| `boond_projects_purchases` | Achats/sous-traitance d'un projet | read · idempotent |
| `boond_projects_search` | Rechercher des projets | read · idempotent · open-world |
| `boond_projects_simulation` | Simulation financière d'un projet | read · idempotent |
| `boond_projects_update` | Modifier un(e) projet | write · idempotent |

### provider_invoices (2)

| Tool | Title | Hints |
|---|---|---|
| `boond_provider_invoices_get` | Détails d'une facture fournisseur | read · idempotent |
| `boond_provider_invoices_search` | Rechercher des factures fournisseur | read · idempotent · open-world |

### purchases (4)

| Tool | Title | Hints |
|---|---|---|
| `boond_purchases_create` | Créer un achat/sous-traitance | write |
| `boond_purchases_delete` | Supprimer un achat/sous-traitance | delete |
| `boond_purchases_get` | Détails d'un achat/sous-traitance | read · idempotent |
| `boond_purchases_search` | Rechercher des achats/sous-traitance | read · idempotent · open-world |

### reporting (5)

| Tool | Title | Hints |
|---|---|---|
| `boond_reporting_companies` | Reporting sociétés | read · idempotent · open-world |
| `boond_reporting_production_plans` | Reporting plans de production | read · idempotent · open-world |
| `boond_reporting_projects` | Reporting projets | read · idempotent · open-world |
| `boond_reporting_resources` | Reporting ressources | read · idempotent · open-world |
| `boond_reporting_synthesis` | Reporting synthèse | read · idempotent · open-world |

### resources (20)

| Tool | Title | Hints |
|---|---|---|
| `boond_resources_absences_reports` | Demandes d'absences d'une ressource | read · idempotent |
| `boond_resources_actions` | Actions liées à une ressource | read · idempotent |
| `boond_resources_administrative` | Données administratives d'une ressource | read · idempotent |
| `boond_resources_advantages` | Avantages d'une ressource | read · idempotent |
| `boond_resources_create` | Créer un(e) ressource | write |
| `boond_resources_delete` | Supprimer un(e) ressource | delete |
| `boond_resources_expenses_reports` | Notes de frais d'une ressource | read · idempotent |
| `boond_resources_get` | Détails d'un(e) ressource | read · idempotent |
| `boond_resources_information` | Informations générales d'une ressource | read · idempotent |
| `boond_resources_positionings` | Positionnements d'une ressource | read · idempotent |
| `boond_resources_projects` | Projets d'une ressource | read · idempotent |
| `boond_resources_reference_create` | Créer une référence (expérience pro) sur une ressource | write |
| `boond_resources_reference_delete` | Supprimer une référence (expérience pro) | delete |
| `boond_resources_reference_update` | Modifier une référence (expérience pro) | write · idempotent |
| `boond_resources_search` | Rechercher des ressources | read · idempotent · open-world |
| `boond_resources_technical_data` | Compétences techniques d'une ressource | read · idempotent |
| `boond_resources_technical_data_update` | Mettre à jour le dossier technique d'une ressource | write · idempotent |
| `boond_resources_times_reports` | Feuilles de temps d'une ressource | read · idempotent |
| `boond_resources_timesheets` | Feuilles de temps d'une ressource | read · idempotent |
| `boond_resources_update` | Modifier un(e) ressource | write · idempotent |

### roles (2)

| Tool | Title | Hints |
|---|---|---|
| `boond_roles_get` | Détails d'un rôle | read · idempotent |
| `boond_roles_search` | Rechercher des rôles | read · idempotent · open-world |

### threads (2)

| Tool | Title | Hints |
|---|---|---|
| `boond_threads_get` | Détails d'un fil de discussion | read · idempotent |
| `boond_threads_search` | Rechercher des fils de discussion | read · idempotent · open-world |

### timesheets (2)

| Tool | Title | Hints |
|---|---|---|
| `boond_timesheets_get` | Détails d'une feuille de temps | read · idempotent |
| `boond_timesheets_search` | Rechercher des feuilles de temps | read · idempotent · open-world |

### todolists (2)

| Tool | Title | Hints |
|---|---|---|
| `boond_todolists_get` | Détails d'une liste de tâches | read · idempotent |
| `boond_todolists_search` | Rechercher des listes de tâches | read · idempotent · open-world |

### validations (2)

| Tool | Title | Hints |
|---|---|---|
| `boond_validations_get` | Détails d'une validation | read · idempotent |
| `boond_validations_search` | Rechercher des validations | read · idempotent · open-world |

### webhooks (2)

| Tool | Title | Hints |
|---|---|---|
| `boond_webhooks_get` | Détails d'un webhook | read · idempotent |
| `boond_webhooks_search` | Rechercher des webhooks | read · idempotent · open-world |

### workflow (11)

| Tool | Title | Hints |
|---|---|---|
| `boond_workflow_candidats_pour_opportunite` | Candidats correspondant à une opportunité | read · idempotent |
| `boond_workflow_cartographie_competences` | Cartographie des compétences d'un périmètre | read · idempotent |
| `boond_workflow_cvs_a_mettre_a_jour` | Audit fraîcheur des CV / dossiers techniques | read · idempotent |
| `boond_workflow_factures_a_relancer` | Factures impayées à relancer | read · idempotent |
| `boond_workflow_fiche_consultant` | Fiche complète d'un collaborateur | read · idempotent |
| `boond_workflow_fin_de_mission` | Anticipation des fins de mission | read · idempotent |
| `boond_workflow_pipeline_commercial` | Pipeline commercial sur une période | read · idempotent |
| `boond_workflow_recap_hebdo` | Récap hebdomadaire (moi + mon équipe) | read · idempotent |
| `boond_workflow_recherche_profil_competences` | Recherche multi-source d'un profil par compétences | read · idempotent |
| `boond_workflow_staffing_disponible` | Consultants disponibles pour un staffing | read · idempotent |
| `boond_workflow_synthese_equipe` | Synthèse d'une équipe | read · idempotent |

## Prompts (11)

Pre-orchestrated workflows surfaced via the MCP prompts API.

| Prompt | Title | Args |
|---|---|---|
| `candidats_pour_opportunite` | Candidats correspondant à une opportunité | `opportunity_id` |
| `cartographie_competences` | Cartographie des compétences d'un périmètre | `manager_id?` `agency_id?` `top_n?` |
| `cvs_a_mettre_a_jour` | Audit fraîcheur des CV / dossiers techniques | `seuil_mois?` `manager_id?` |
| `factures_a_relancer` | Factures impayées à relancer | `society_id?` |
| `fiche_consultant` | Fiche complète d'un collaborateur | `resource_id` |
| `fin_de_mission` | Anticipation des fins de mission | `horizon_jours?` `manager_id?` |
| `pipeline_commercial` | Pipeline commercial sur une période | `date_debut` `date_fin` `manager_id?` |
| `recap_hebdo` | Récap hebdomadaire (moi + mon équipe) | `semaine?` |
| `recherche_profil_competences` | Recherche multi-source d'un profil par compétences | `competences` `experience_min?` `dispo_avant?` `inclure_candidats?` `manager_id?` |
| `staffing_disponible` | Consultants disponibles pour un staffing | `start_date` `end_date` `competences?` `manager_id?` |
| `synthese_equipe` | Synthèse d'une équipe | `manager_id?` `periode?` |

## Resources (21)

Reference data exposed as MCP resources.

| URI | Title |
|---|---|
| `boond://application/current-user` | Utilisateur courant |
| `boond://dictionary/activityAreas` | Secteurs d'activité |
| `boond://dictionary/countries` | Pays |
| `boond://dictionary/currencies` | Devises |
| `boond://dictionary/experiences` | Niveaux d'expérience |
| `boond://dictionary/expertiseAreas` | Domaines d'expertise |
| `boond://dictionary/languages` | Langues |
| `boond://dictionary/mobilityAreas` | Mobilités |
| `boond://dictionary/states/candidates` | États candidats |
| `boond://dictionary/states/companies` | États sociétés |
| `boond://dictionary/states/contacts` | États contacts |
| `boond://dictionary/states/invoices` | États factures |
| `boond://dictionary/states/opportunities` | États opportunités |
| `boond://dictionary/states/orders` | États bons de commande |
| `boond://dictionary/states/positionings` | États positionnements |
| `boond://dictionary/states/projects` | États projets |
| `boond://dictionary/states/resources` | États ressources |
| `boond://dictionary/tools` | Outils / Technos |
| `boond://dictionary/typeOf/contacts` | Types contacts |
| `boond://dictionary/typeOf/projects` | Types projets |
| `boond://dictionary/typeOf/resources` | Types ressources |
