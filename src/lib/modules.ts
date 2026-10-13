import type { LucideIcon } from 'lucide-react'
import { LayoutDashboard, UsersRound, BriefcaseBusiness, CalendarDays, FileText, FileCheck2, ShoppingBag, WalletCards, ReceiptText, BadgePercent, MonitorPlay, FileSpreadsheet, ChartNoAxesCombined, Settings2 } from 'lucide-react'

export type ModuleId = 'dashboard' | 'prospects' | 'sales' | 'activities' | 'offers' | 'proposals' | 'orders' | 'payments' | 'expenses' | 'commissions' | 'production' | 'imports' | 'reports' | 'settings'
export interface Module { id: ModuleId; label: string; path: string; icon: LucideIcon; description: string }
export const modules: Module[] = [
  { id: 'dashboard', label: 'Vue d’ensemble', path: '/', icon: LayoutDashboard, description: 'Le parcours commercial en un regard.' },
  { id: 'prospects', label: 'Prospects', path: '/prospects', icon: UsersRound, description: 'Suivi des entreprises et des opportunités.' },
  { id: 'sales', label: 'Commerciaux', path: '/commerciaux', icon: BriefcaseBusiness, description: 'Équipe commerciale et attributions.' },
  { id: 'activities', label: 'Activités et rendez-vous', path: '/activites', icon: CalendarDays, description: 'Historique des échanges et prochaines rencontres.' },
  { id: 'offers', label: 'Offres et propositions', path: '/offres', icon: FileText, description: 'Catalogue, versions et propositions commerciales.' },
  { id: 'proposals', label: 'Propositions', path: '/propositions', icon: FileCheck2, description: 'Validation et documents adressés aux prospects.' },
  { id: 'orders', label: 'Commandes', path: '/commandes', icon: ShoppingBag, description: 'Commandes acceptées et suivi contractuel.' },
  { id: 'payments', label: 'Paiements et reçus', path: '/paiements', icon: WalletCards, description: 'Encaissements confirmés et documents associés.' },
  { id: 'expenses', label: 'Dépenses', path: '/depenses', icon: ReceiptText, description: 'Frais commerciaux et justificatifs.' },
  { id: 'commissions', label: 'Commissions', path: '/commissions', icon: BadgePercent, description: 'Calculs, validations et versements.' },
  { id: 'production', label: 'Production et livraison', path: '/production', icon: MonitorPlay, description: 'Avancement des sites en création.' },
  { id: 'imports', label: 'Imports Excel', path: '/imports', icon: FileSpreadsheet, description: 'Préparation des imports et détection de conflits.' },
  { id: 'reports', label: 'Rapports', path: '/rapports', icon: ChartNoAxesCombined, description: 'Analyses commerciales.' },
  { id: 'settings', label: 'Paramètres', path: '/parametres', icon: Settings2, description: 'Configuration du système.' },
]

export type ZoneId = 'prospects' | 'activities' | 'offers' | 'payments' | 'production' | 'delivery'
export const zones: { id: ZoneId; label: string; number: string; moduleId: ModuleId; description: string }[] = [
  { id: 'prospects', label: 'Prospection', number: '01', moduleId: 'prospects', description: 'Entreprises et opportunités à développer' },
  { id: 'activities', label: 'Rendez-vous', number: '02', moduleId: 'activities', description: 'Échanges, visites et démonstrations' },
  { id: 'offers', label: 'Offres & commandes', number: '03', moduleId: 'offers', description: 'Propositions et engagements clients' },
  { id: 'payments', label: 'Paiements', number: '04', moduleId: 'payments', description: 'Acomptes et encaissements vérifiés' },
  { id: 'production', label: 'Production', number: '05', moduleId: 'production', description: 'Création des sites et étapes de travail' },
  { id: 'delivery', label: 'Livraison', number: '06', moduleId: 'production', description: 'Projets finalisés et remis aux clients' },
]
