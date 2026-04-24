import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants.js";

// Common search schema
export const SearchSchema = z.object({
  keywords: z.string().optional().describe("Mots-clés de recherche (nom, email, compétences...)"),
  page: z.number().int().min(1).default(1).describe("Numéro de page (défaut: 1)"),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE)
    .describe(`Nombre de résultats par page (max: ${MAX_PAGE_SIZE}, défaut: ${DEFAULT_PAGE_SIZE})`),
}).strict();

// ---- Reusable filter field helpers ----
// Keep descriptions short here; the tool description guides the LLM on usage.
const pageField = z.number().int().min(1).default(1).describe("Numéro de page (défaut: 1)");
const pageSizeField = z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE)
  .describe(`Nombre de résultats par page (max: ${MAX_PAGE_SIZE}, défaut: ${DEFAULT_PAGE_SIZE})`);
const sortField = z.string().optional().describe("Champ de tri (ex: lastName, createdAt)");
const orderField = z.enum(["asc", "desc"]).optional().describe("Ordre de tri : 'asc' ou 'desc'");
const idArray = (doc: string) => z.array(z.string()).optional().describe(doc);
const intArray = (doc: string) => z.array(z.number().int()).optional().describe(doc);
const strArray = (doc: string) => z.array(z.string()).optional().describe(doc);

// ---- Resource search schema ----
// Filtres les plus utiles de /resources. Inclut mainManagers (clé pour hiérarchie N-1/N-2).
export const ResourceSearchSchema = z.object({
  keywords: z.string().optional().describe("Mots-clés (nom, prénom, email, compétences libres)"),
  mainManagers: idArray("ID(s) du/des managers principaux. Les ressources retournées ont ce(s) manager(s) comme N+1. CLÉ pour les requêtes hiérarchiques (mes N-1, N-2...)."),
  states: intArray("États de ressource à inclure (voir dictionnaire 'states/resources')"),
  agencies: idArray("IDs d'agences"),
  poles: idArray("IDs de pôles"),
  businessUnits: idArray("IDs de business units"),
  skills: strArray("Compétences techniques (ex: ['Java', 'React'])"),
  tools: strArray("Outils / technologies"),
  activityAreas: strArray("Secteurs d'activité"),
  languages: strArray("Langues"),
  typeOf: strArray("Types de ressource (interne, sous-traitant...)"),
  saved: z.string().optional().describe("ID d'une recherche enregistrée (remplace les autres filtres)"),
  sort: sortField,
  order: orderField,
  page: pageField,
  pageSize: pageSizeField,
}).strict();

// ---- Candidate search schema ----
export const CandidateSearchSchema = z.object({
  keywords: z.string().optional().describe("Mots-clés (nom, prénom, email, compétences libres)"),
  mainManagers: idArray("ID(s) du/des managers principaux (responsables des candidats)"),
  states: intArray("États de candidat (voir dictionnaire 'states/candidates')"),
  agencies: idArray("IDs d'agences"),
  poles: idArray("IDs de pôles"),
  businessUnits: idArray("IDs de business units"),
  skills: strArray("Compétences techniques"),
  tools: strArray("Outils / technologies"),
  activityAreas: strArray("Secteurs d'activité"),
  languages: strArray("Langues"),
  qualifications: strArray("Qualifications / diplômes"),
  mobilityAreas: strArray("Zones de mobilité"),
  typeOf: strArray("Types de candidat"),
  origins: idArray("IDs d'origines (source de recrutement)"),
  saved: z.string().optional().describe("ID d'une recherche enregistrée"),
  sort: sortField,
  order: orderField,
  page: pageField,
  pageSize: pageSizeField,
}).strict();

// ---- Contact search schema ----
export const ContactSearchSchema = z.object({
  keywords: z.string().optional().describe("Mots-clés (nom, email, société...)"),
  mainManagers: idArray("ID(s) du/des managers principaux (responsables commerciaux des contacts)"),
  states: intArray("États de contact"),
  agencies: idArray("IDs d'agences"),
  poles: idArray("IDs de pôles"),
  businessUnits: idArray("IDs de business units"),
  company: z.string().optional().describe("ID d'une société : filtre les contacts rattachés à cette société"),
  typeOf: strArray("Types de contact"),
  origins: idArray("IDs d'origines"),
  activityAreas: strArray("Secteurs d'activité"),
  saved: z.string().optional().describe("ID d'une recherche enregistrée"),
  sort: sortField,
  order: orderField,
  page: pageField,
  pageSize: pageSizeField,
}).strict();

// ---- Company search schema ----
export const CompanySearchSchema = z.object({
  keywords: z.string().optional().describe("Mots-clés (nom, SIRET, email...)"),
  mainManagers: idArray("ID(s) du/des managers principaux (responsables commerciaux)"),
  states: intArray("États de société"),
  agencies: idArray("IDs d'agences"),
  poles: idArray("IDs de pôles"),
  businessUnits: idArray("IDs de business units"),
  typeOf: strArray("Types de société (client, prospect, fournisseur...)"),
  activityAreas: strArray("Secteurs d'activité"),
  origins: idArray("IDs d'origines"),
  saved: z.string().optional().describe("ID d'une recherche enregistrée"),
  sort: sortField,
  order: orderField,
  page: pageField,
  pageSize: pageSizeField,
}).strict();

// ---- Opportunity search schema ----
export const OpportunitySearchSchema = z.object({
  keywords: z.string().optional().describe("Mots-clés (titre, société, contact...)"),
  mainManagers: idArray("ID(s) du/des managers principaux (commerciaux en charge)"),
  states: intArray("États d'opportunité (voir dictionnaire 'states/opportunities')"),
  agencies: idArray("IDs d'agences"),
  poles: idArray("IDs de pôles"),
  businessUnits: idArray("IDs de business units"),
  company: z.string().optional().describe("ID d'une société cliente"),
  contact: z.string().optional().describe("ID d'un contact"),
  activityAreas: strArray("Secteurs d'activité"),
  origins: idArray("IDs d'origines"),
  period: z.enum(["creation", "update", "startDate", "endDate"]).optional()
    .describe("Champ date sur lequel appliquer startDate/endDate"),
  startDate: z.string().optional().describe("Début de période (YYYY-MM-DD), à utiliser avec `period`"),
  endDate: z.string().optional().describe("Fin de période (YYYY-MM-DD), à utiliser avec `period`"),
  saved: z.string().optional().describe("ID d'une recherche enregistrée"),
  sort: sortField,
  order: orderField,
  page: pageField,
  pageSize: pageSizeField,
}).strict();

// ---- Project search schema ----
export const ProjectSearchSchema = z.object({
  keywords: z.string().optional().describe("Mots-clés (nom du projet, société, contact...)"),
  mainManagers: idArray("ID(s) du/des managers principaux (responsables du projet)"),
  states: intArray("États de projet (voir dictionnaire 'states/projects')"),
  agencies: idArray("IDs d'agences"),
  poles: idArray("IDs de pôles"),
  businessUnits: idArray("IDs de business units"),
  company: z.string().optional().describe("ID d'une société cliente"),
  contact: z.string().optional().describe("ID d'un contact"),
  typeOf: strArray("Types de projet (régie, forfait, produit...)"),
  activityAreas: strArray("Secteurs d'activité"),
  period: z.enum(["creation", "update", "startDate", "endDate"]).optional()
    .describe("Champ date sur lequel appliquer startDate/endDate"),
  startDate: z.string().optional().describe("Début de période (YYYY-MM-DD)"),
  endDate: z.string().optional().describe("Fin de période (YYYY-MM-DD)"),
  saved: z.string().optional().describe("ID d'une recherche enregistrée"),
  sort: sortField,
  order: orderField,
  page: pageField,
  pageSize: pageSizeField,
}).strict();

// ID param schema
export const IdSchema = z.object({
  id: z.string().min(1).describe("Identifiant unique de l'entité BoondManager"),
}).strict();

// ID + tab param schema
export const IdTabSchema = z.object({
  id: z.string().min(1).describe("Identifiant unique de l'entité"),
  tab: z.string().optional().describe("Onglet spécifique à récupérer (information, technical, financial, actions, contracts, documents)"),
}).strict();

// ---- Candidate schemas ----

export const CandidateCreateSchema = z.object({
  firstName: z.string().min(1).describe("Prénom du candidat"),
  lastName: z.string().min(1).describe("Nom de famille du candidat"),
  email1: z.string().email().optional().describe("Email principal"),
  phone1: z.string().optional().describe("Téléphone principal"),
  city: z.string().optional().describe("Ville"),
  country: z.string().optional().describe("Pays"),
  title: z.string().optional().describe("Titre du poste / fonction"),
  state: z.number().int().optional().describe("État du candidat (0=en cours, 1=placé, 2=archivé...)"),
  mainSkills: z.string().optional().describe("Compétences principales (texte libre)"),
  note: z.string().optional().describe("Notes / commentaires"),
}).strict();

export const CandidateUpdateSchema = z.object({
  id: z.string().min(1).describe("ID du candidat à modifier"),
  firstName: z.string().optional().describe("Prénom"),
  lastName: z.string().optional().describe("Nom"),
  email1: z.string().email().optional().describe("Email principal"),
  phone1: z.string().optional().describe("Téléphone"),
  city: z.string().optional().describe("Ville"),
  country: z.string().optional().describe("Pays"),
  title: z.string().optional().describe("Titre / fonction"),
  state: z.number().int().optional().describe("État du candidat"),
  mainSkills: z.string().optional().describe("Compétences principales"),
  note: z.string().optional().describe("Notes"),
}).strict();

// ---- Resource schemas ----

export const ResourceCreateSchema = z.object({
  firstName: z.string().min(1).describe("Prénom de la ressource/collaborateur"),
  lastName: z.string().min(1).describe("Nom de famille"),
  email1: z.string().email().optional().describe("Email principal"),
  phone1: z.string().optional().describe("Téléphone"),
  city: z.string().optional().describe("Ville"),
  country: z.string().optional().describe("Pays"),
  title: z.string().optional().describe("Titre / poste"),
  state: z.number().int().optional().describe("État de la ressource"),
  note: z.string().optional().describe("Notes"),
}).strict();

export const ResourceUpdateSchema = z.object({
  id: z.string().min(1).describe("ID de la ressource à modifier"),
  firstName: z.string().optional().describe("Prénom"),
  lastName: z.string().optional().describe("Nom"),
  email1: z.string().email().optional().describe("Email principal"),
  phone1: z.string().optional().describe("Téléphone"),
  city: z.string().optional().describe("Ville"),
  country: z.string().optional().describe("Pays"),
  title: z.string().optional().describe("Titre / poste"),
  state: z.number().int().optional().describe("État"),
  note: z.string().optional().describe("Notes"),
}).strict();

// ---- Contact schemas ----

export const ContactCreateSchema = z.object({
  firstName: z.string().min(1).describe("Prénom du contact"),
  lastName: z.string().min(1).describe("Nom de famille"),
  email1: z.string().email().optional().describe("Email principal"),
  phone1: z.string().optional().describe("Téléphone"),
  city: z.string().optional().describe("Ville"),
  country: z.string().optional().describe("Pays"),
  title: z.string().optional().describe("Titre / fonction"),
  companyId: z.string().optional().describe("ID de la société associée"),
  note: z.string().optional().describe("Notes"),
}).strict();

export const ContactUpdateSchema = z.object({
  id: z.string().min(1).describe("ID du contact à modifier"),
  firstName: z.string().optional().describe("Prénom"),
  lastName: z.string().optional().describe("Nom"),
  email1: z.string().email().optional().describe("Email"),
  phone1: z.string().optional().describe("Téléphone"),
  city: z.string().optional().describe("Ville"),
  title: z.string().optional().describe("Titre / fonction"),
  note: z.string().optional().describe("Notes"),
}).strict();

// ---- Company schemas ----

export const CompanyCreateSchema = z.object({
  name: z.string().min(1).describe("Nom de la société"),
  email1: z.string().email().optional().describe("Email de la société"),
  phone1: z.string().optional().describe("Téléphone"),
  city: z.string().optional().describe("Ville"),
  country: z.string().optional().describe("Pays"),
  website: z.string().optional().describe("Site web"),
  siret: z.string().optional().describe("Numéro SIRET"),
  state: z.number().int().optional().describe("État de la société"),
  note: z.string().optional().describe("Notes"),
}).strict();

export const CompanyUpdateSchema = z.object({
  id: z.string().min(1).describe("ID de la société à modifier"),
  name: z.string().optional().describe("Nom"),
  email1: z.string().email().optional().describe("Email"),
  phone1: z.string().optional().describe("Téléphone"),
  city: z.string().optional().describe("Ville"),
  country: z.string().optional().describe("Pays"),
  website: z.string().optional().describe("Site web"),
  siret: z.string().optional().describe("Numéro SIRET"),
  state: z.number().int().optional().describe("État"),
  note: z.string().optional().describe("Notes"),
}).strict();

// ---- Opportunity schemas ----

export const OpportunityCreateSchema = z.object({
  name: z.string().min(1).describe("Nom / titre de l'opportunité"),
  companyId: z.string().optional().describe("ID de la société cliente"),
  contactId: z.string().optional().describe("ID du contact associé"),
  state: z.number().int().optional().describe("État de l'opportunité"),
  startDate: z.string().optional().describe("Date de début prévue (YYYY-MM-DD)"),
  endDate: z.string().optional().describe("Date de fin prévue (YYYY-MM-DD)"),
  note: z.string().optional().describe("Notes / description"),
}).strict();

export const OpportunityUpdateSchema = z.object({
  id: z.string().min(1).describe("ID de l'opportunité à modifier"),
  name: z.string().optional().describe("Nom / titre"),
  state: z.number().int().optional().describe("État"),
  startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
  endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
  note: z.string().optional().describe("Notes"),
}).strict();

// ---- Action schemas ----

export const ActionSearchSchema = z.object({
  keywords: z.string().optional().describe("Mots-clés de recherche"),
  candidateId: z.string().optional().describe("Filtrer par ID candidat"),
  resourceId: z.string().optional().describe("Filtrer par ID ressource"),
  contactId: z.string().optional().describe("Filtrer par ID contact"),
  companyId: z.string().optional().describe("Filtrer par ID société"),
  page: z.number().int().min(1).default(1).describe("Numéro de page"),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Résultats par page"),
}).strict();

export const ActionCreateSchema = z.object({
  typeOf: z.string().min(1).describe("Type d'action (ex: call, email, meeting, note)"),
  subject: z.string().optional().describe("Sujet de l'action"),
  content: z.string().optional().describe("Contenu / description"),
  startDate: z.string().optional().describe("Date de début (YYYY-MM-DD ou ISO)"),
  endDate: z.string().optional().describe("Date de fin"),
  candidateId: z.string().optional().describe("ID du candidat associé"),
  resourceId: z.string().optional().describe("ID de la ressource associée"),
  contactId: z.string().optional().describe("ID du contact associé"),
  companyId: z.string().optional().describe("ID de la société associée"),
}).strict();

// ---- Timesheet schemas ----

export const ResourceTimesheetSchema = z.object({
  resourceId: z.string().min(1).describe("ID de la ressource"),
  month: z.number().int().min(1).max(12).optional().describe("Mois (1-12). Si omis, mois courant."),
  year: z.number().int().min(2000).optional().describe("Année (ex: 2025). Si omis, année courante."),
}).strict();

export const TimesheetSearchSchema = z.object({
  startDate: z.string().optional().describe("Date de début de période (YYYY-MM-DD)"),
  endDate: z.string().optional().describe("Date de fin de période (YYYY-MM-DD)"),
  page: z.number().int().min(1).default(1).describe("Numéro de page (défaut: 1)"),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE)
    .describe(`Nombre de résultats par page (max: ${MAX_PAGE_SIZE}, défaut: ${DEFAULT_PAGE_SIZE})`),
}).strict();

export const TimesheetGetSchema = z.object({
  id: z.string().min(1).describe("Identifiant unique de la feuille de temps"),
}).strict();

// ---- Project schemas ----

export const ProjectCreateSchema = z.object({
  name: z.string().min(1).describe("Nom du projet / mission"),
  companyId: z.string().optional().describe("ID de la société cliente"),
  contactId: z.string().optional().describe("ID du contact associé"),
  opportunityId: z.string().optional().describe("ID de l'opportunité liée"),
  state: z.number().int().optional().describe("État du projet (0=en cours, 1=terminé, 2=archivé...)"),
  startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
  endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
  note: z.string().optional().describe("Notes / description du projet"),
}).strict();

export const ProjectUpdateSchema = z.object({
  id: z.string().min(1).describe("ID du projet à modifier"),
  name: z.string().optional().describe("Nom du projet"),
  state: z.number().int().optional().describe("État du projet"),
  startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
  endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
  note: z.string().optional().describe("Notes"),
}).strict();

// ---- Invoice schemas ----

export const InvoiceCreateSchema = z.object({
  reference: z.string().optional().describe("Référence de la facture"),
  companyId: z.string().optional().describe("ID de la société facturée"),
  projectId: z.string().optional().describe("ID du projet associé"),
  state: z.number().int().optional().describe("État de la facture"),
  invoiceDate: z.string().optional().describe("Date de facturation (YYYY-MM-DD)"),
  dueDate: z.string().optional().describe("Date d'échéance (YYYY-MM-DD)"),
  amountExcludingTax: z.number().optional().describe("Montant HT"),
  taxRate: z.number().optional().describe("Taux de TVA (%)"),
  note: z.string().optional().describe("Notes / commentaires"),
}).strict();

export const InvoiceUpdateSchema = z.object({
  id: z.string().min(1).describe("ID de la facture à modifier"),
  reference: z.string().optional().describe("Référence de la facture"),
  state: z.number().int().optional().describe("État de la facture"),
  invoiceDate: z.string().optional().describe("Date de facturation (YYYY-MM-DD)"),
  dueDate: z.string().optional().describe("Date d'échéance (YYYY-MM-DD)"),
  amountExcludingTax: z.number().optional().describe("Montant HT"),
  taxRate: z.number().optional().describe("Taux de TVA (%)"),
  note: z.string().optional().describe("Notes"),
}).strict();

export const InvoiceSearchSchema = z.object({
  keywords: z.string().optional().describe("Mots-clés de recherche (référence, société...)"),
  companyId: z.string().optional().describe("Filtrer par ID société"),
  projectId: z.string().optional().describe("Filtrer par ID projet"),
  startDate: z.string().optional().describe("Date de début de période (YYYY-MM-DD)"),
  endDate: z.string().optional().describe("Date de fin de période (YYYY-MM-DD)"),
  period: z.string().optional().describe("Type de période (created, updated, expectedPayment, performedPayment, period)"),
  page: z.number().int().min(1).default(1).describe("Numéro de page"),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Résultats par page"),
}).strict();

// ---- Order schemas (Bons de commande) ----

export const OrderCreateSchema = z.object({
  reference: z.string().optional().describe("Référence du bon de commande"),
  companyId: z.string().optional().describe("ID de la société"),
  projectId: z.string().optional().describe("ID du projet associé"),
  state: z.number().int().optional().describe("État du bon de commande"),
  orderDate: z.string().optional().describe("Date du bon de commande (YYYY-MM-DD)"),
  amountExcludingTax: z.number().optional().describe("Montant HT"),
  note: z.string().optional().describe("Notes / commentaires"),
}).strict();

export const OrderUpdateSchema = z.object({
  id: z.string().min(1).describe("ID du bon de commande à modifier"),
  reference: z.string().optional().describe("Référence"),
  state: z.number().int().optional().describe("État"),
  orderDate: z.string().optional().describe("Date (YYYY-MM-DD)"),
  amountExcludingTax: z.number().optional().describe("Montant HT"),
  note: z.string().optional().describe("Notes"),
}).strict();

export const OrderSearchSchema = z.object({
  keywords: z.string().optional().describe("Mots-clés de recherche"),
  companyId: z.string().optional().describe("Filtrer par ID société"),
  projectId: z.string().optional().describe("Filtrer par ID projet"),
  page: z.number().int().min(1).default(1).describe("Numéro de page"),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Résultats par page"),
}).strict();

// ---- Delivery schemas (Livraisons / CRA) ----

export const DeliverySearchSchema = z.object({
  keywords: z.string().optional().describe("Mots-clés de recherche"),
  projectId: z.string().optional().describe("Filtrer par ID projet"),
  companyId: z.string().optional().describe("Filtrer par ID société"),
  startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
  endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
  page: z.number().int().min(1).default(1).describe("Numéro de page"),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Résultats par page"),
}).strict();

// ---- Absence schemas ----

export const AbsenceCreateSchema = z.object({
  resourceId: z.string().min(1).describe("ID de la ressource en absence"),
  typeOf: z.string().min(1).describe("Type d'absence (congé payé, RTT, maladie, sans solde...)"),
  startDate: z.string().min(1).describe("Date de début (YYYY-MM-DD)"),
  endDate: z.string().min(1).describe("Date de fin (YYYY-MM-DD)"),
  state: z.number().int().optional().describe("État de la demande (0=en attente, 1=validé, 2=refusé...)"),
  note: z.string().optional().describe("Commentaire / motif"),
}).strict();

export const AbsenceUpdateSchema = z.object({
  id: z.string().min(1).describe("ID de l'absence à modifier"),
  startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
  endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
  state: z.number().int().optional().describe("État de la demande"),
  note: z.string().optional().describe("Commentaire / motif"),
}).strict();

export const AbsenceSearchSchema = z.object({
  keywords: z.string().optional().describe("Mots-clés de recherche"),
  resourceId: z.string().optional().describe("Filtrer par ID ressource"),
  startDate: z.string().optional().describe("Date de début de période (YYYY-MM-DD)"),
  endDate: z.string().optional().describe("Date de fin de période (YYYY-MM-DD)"),
  page: z.number().int().min(1).default(1).describe("Numéro de page"),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Résultats par page"),
}).strict();

// ---- Expense schemas (Notes de frais) ----

export const ExpenseCreateSchema = z.object({
  resourceId: z.string().min(1).describe("ID de la ressource"),
  projectId: z.string().optional().describe("ID du projet associé"),
  typeOf: z.string().optional().describe("Type de frais (transport, repas, hébergement...)"),
  expenseDate: z.string().min(1).describe("Date du frais (YYYY-MM-DD)"),
  amount: z.number().describe("Montant du frais"),
  currency: z.string().optional().describe("Devise (EUR, USD...)"),
  state: z.number().int().optional().describe("État de la note de frais"),
  note: z.string().optional().describe("Description / justification"),
}).strict();

export const ExpenseUpdateSchema = z.object({
  id: z.string().min(1).describe("ID de la note de frais à modifier"),
  amount: z.number().optional().describe("Montant"),
  state: z.number().int().optional().describe("État"),
  note: z.string().optional().describe("Description"),
}).strict();

export const ExpenseSearchSchema = z.object({
  keywords: z.string().optional().describe("Mots-clés de recherche"),
  resourceId: z.string().optional().describe("Filtrer par ID ressource"),
  projectId: z.string().optional().describe("Filtrer par ID projet"),
  startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
  endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
  page: z.number().int().min(1).default(1).describe("Numéro de page"),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Résultats par page"),
}).strict();

// ---- Product schemas ----

export const ProductCreateSchema = z.object({
  name: z.string().min(1).describe("Nom du produit"),
  reference: z.string().optional().describe("Référence du produit"),
  unitPrice: z.number().optional().describe("Prix unitaire HT"),
  taxRate: z.number().optional().describe("Taux de TVA (%)"),
  state: z.number().int().optional().describe("État du produit"),
  note: z.string().optional().describe("Description du produit"),
}).strict();

export const ProductUpdateSchema = z.object({
  id: z.string().min(1).describe("ID du produit à modifier"),
  name: z.string().optional().describe("Nom du produit"),
  reference: z.string().optional().describe("Référence"),
  unitPrice: z.number().optional().describe("Prix unitaire HT"),
  taxRate: z.number().optional().describe("Taux de TVA (%)"),
  state: z.number().int().optional().describe("État"),
  note: z.string().optional().describe("Description"),
}).strict();

// ---- Positioning schemas ----

export const PositioningCreateSchema = z.object({
  candidateId: z.string().optional().describe("ID du candidat positionné"),
  resourceId: z.string().optional().describe("ID de la ressource positionnée"),
  projectId: z.string().optional().describe("ID du projet"),
  opportunityId: z.string().optional().describe("ID de l'opportunité"),
  state: z.number().int().optional().describe("État du positionnement"),
  startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
  endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
  note: z.string().optional().describe("Notes / commentaires"),
}).strict();

export const PositioningSearchSchema = z.object({
  keywords: z.string().optional().describe("Mots-clés de recherche"),
  candidateId: z.string().optional().describe("Filtrer par ID candidat"),
  resourceId: z.string().optional().describe("Filtrer par ID ressource"),
  projectId: z.string().optional().describe("Filtrer par ID projet"),
  opportunityId: z.string().optional().describe("Filtrer par ID opportunité"),
  page: z.number().int().min(1).default(1).describe("Numéro de page"),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Résultats par page"),
}).strict();

// ---- Payment schemas ----

export const PaymentSearchSchema = z.object({
  keywords: z.string().optional().describe("Mots-clés de recherche"),
  invoiceId: z.string().optional().describe("Filtrer par ID facture"),
  companyId: z.string().optional().describe("Filtrer par ID société"),
  startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)"),
  endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)"),
  page: z.number().int().min(1).default(1).describe("Numéro de page"),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Résultats par page"),
}).strict();

// ---- Advantage schemas ----

export const AdvantageSearchSchema = z.object({
  keywords: z.string().optional().describe("Mots-clés de recherche"),
  resourceId: z.string().optional().describe("Filtrer par ID ressource"),
  page: z.number().int().min(1).default(1).describe("Numéro de page"),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Résultats par page"),
}).strict();

// ---- Application schemas ----

export const DictionaryGetSchema = z.object({
  dictionaryType: z.string().min(1).describe("Type de dictionnaire (ex: typeOf/actions, typeOf/absences, states/candidates, states/resources, states/opportunities, states/projects, states/invoices, countries, currencies, languages...)"),
}).strict();

export type SearchInput = z.infer<typeof SearchSchema>;
export type ResourceSearchInput = z.infer<typeof ResourceSearchSchema>;
export type CandidateSearchInput = z.infer<typeof CandidateSearchSchema>;
export type ContactSearchInput = z.infer<typeof ContactSearchSchema>;
export type CompanySearchInput = z.infer<typeof CompanySearchSchema>;
export type OpportunitySearchInput = z.infer<typeof OpportunitySearchSchema>;
export type ProjectSearchInput = z.infer<typeof ProjectSearchSchema>;
export type IdInput = z.infer<typeof IdSchema>;
export type IdTabInput = z.infer<typeof IdTabSchema>;
export type ResourceTimesheetInput = z.infer<typeof ResourceTimesheetSchema>;
export type TimesheetSearchInput = z.infer<typeof TimesheetSearchSchema>;
export type TimesheetGetInput = z.infer<typeof TimesheetGetSchema>;
export type DictionaryGetInput = z.infer<typeof DictionaryGetSchema>;
