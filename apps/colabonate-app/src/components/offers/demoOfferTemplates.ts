// Demo offer templates for testing and development
// Used by: Protocol Simulator (Playground), CreateOfferModal, CreateOfferPage

export interface DemoOfferTemplate {
  title: string
  description: string
  type: 'SMART_ORDER' | 'MILESTONE'
  offerType: 'SERVICE' | 'PRODUCT'
  sats: number
  imageUrl: string
  category: string
  milestones?: { title: string; description: string; pct: number }[]
}

// ─── Service Templates ────────────────────────────────────────────────────────

export const SERVICE_TEMPLATES: DemoOfferTemplate[] = [
  {
    title: 'Professionelle Webentwicklung',
    description: 'Moderne, responsive Websites mit React, Next.js oder Vue. Inklusive SEO-Optimierung und mobiler Ansicht.',
    type: 'MILESTONE',
    offerType: 'SERVICE',
    sats: 120_000,
    imageUrl: 'https://picsum.photos/seed/webdev/600/400',
    category: 'Services',
    milestones: [
      { title: 'Konzept & Wireframe', description: 'Analyse Ihrer Anforderungen und Erstellung eines Wireframes', pct: 25 },
      { title: 'Design & Prototyp', description: 'Visuelles Design und interaktiver Prototyp', pct: 35 },
      { title: 'Entwicklung', description: 'Implementierung aller Funktionen', pct: 25 },
      { title: 'Launch & Support', description: 'Deployment und 2 Wochen Wartung', pct: 15 },
    ],
  },
  {
    title: 'Grafik-Design & Branding',
    description: 'Logo-Entwicklung, Farbkonzept, Typografie und komplettes Brand-Book für Ihren Auftritt.',
    type: 'MILESTONE',
    offerType: 'SERVICE',
    sats: 85_000,
    imageUrl: 'https://picsum.photos/seed/logo/600/400',
    category: 'Services',
    milestones: [
      { title: 'Discovery & Research', description: 'Marktanalyse, Wettbewerber-Recherche', pct: 20 },
      { title: 'Konzept-Entwicklung', description: '3 Logo-Varianten zur Auswahl', pct: 30 },
      { title: 'Finalisierung', description: 'Feinschliff und Brand-Book-Erstellung', pct: 30 },
      { title: 'Übergabe', description: 'Alle Dateien in allen Formaten', pct: 20 },
    ],
  },
  {
    title: 'API Integration entwickeln',
    description: 'RESTful API-Integration zwischen Plattform A und B inkl. Auth, Fehlerbehandlung und Dokumentation.',
    type: 'MILESTONE',
    offerType: 'SERVICE',
    sats: 320_000,
    imageUrl: 'https://picsum.photos/seed/api/600/400',
    category: 'Services',
    milestones: [
      { title: 'Anforderungsanalyse', description: 'Spezifikation, Schnittstellendefinition, Q&A', pct: 20 },
      { title: 'Schnittstellendesign', description: 'OpenAPI-Spezifikation, Authentifizierungskonzept', pct: 30 },
      { title: 'Implementierung', description: 'Coding, Unit-Tests, Review', pct: 30 },
      { title: 'Tests & Abnahme', description: 'Integrationstests, Dokumentation, Lieferung', pct: 20 },
    ],
  },
  {
    title: 'Landing Page erstellen',
    description: 'Responsive Landing Page nach Figma-Vorlage, mobile-first, inkl. Formular und Analytics-Einbindung.',
    type: 'SMART_ORDER',
    offerType: 'SERVICE',
    sats: 150_000,
    imageUrl: 'https://picsum.photos/seed/landing/600/400',
    category: 'Services',
  },
  {
    title: 'Mobile App Prototyp',
    description: 'Klickbarer Prototyp einer iOS/Android-App mit 5 Screens, UX-Flow und Übergabe als Figma-Datei.',
    type: 'MILESTONE',
    offerType: 'SERVICE',
    sats: 500_000,
    imageUrl: 'https://picsum.photos/seed/mobile/600/400',
    category: 'Services',
    milestones: [
      { title: 'Wireframes & Konzept', description: 'User Flow, grobe Screens, Abstimmung', pct: 15 },
      { title: 'UI Design', description: 'Figma-Screens, Design System, Farben', pct: 25 },
      { title: 'Frontend Implementierung', description: 'React Native Screens, Navigation', pct: 30 },
      { title: 'Backend & API', description: 'REST-Endpunkte, Datenbankmodell', pct: 20 },
      { title: 'QA & Release', description: 'Bugfixes, Store-Submission, Übergabe', pct: 10 },
    ],
  },
  {
    title: 'SEO-Optimierung Webseite',
    description: 'Technisches SEO-Audit, On-Page-Optimierung, Ladezeit-Analyse und strukturiertes Reporting.',
    type: 'SMART_ORDER',
    offerType: 'SERVICE',
    sats: 60_000,
    imageUrl: 'https://picsum.photos/seed/seo/600/400',
    category: 'Services',
  },
  {
    title: 'Datenbank-Migration',
    description: 'Migration von PostgreSQL 13 auf 15 inkl. Schema-Anpassungen, Datenmigration und Rollback-Plan.',
    type: 'MILESTONE',
    offerType: 'SERVICE',
    sats: 280_000,
    imageUrl: 'https://picsum.photos/seed/database/600/400',
    category: 'Services',
    milestones: [
      { title: 'Audit & Planung', description: 'Schema-Analyse, Migrationsplan, Risiken', pct: 25 },
      { title: 'Schema-Migration', description: 'DDL-Skripte, Testmigration auf Staging', pct: 25 },
      { title: 'Datenmigration', description: 'ETL-Prozess, Validierung, Performance-Tests', pct: 35 },
      { title: 'Validierung', description: 'Abnahme, Rollback-Test, Produktiv-Go-live', pct: 15 },
    ],
  },
  {
    title: 'Video-Produktion & Editing',
    description: 'Professionelles Erklärvideo oder Produktvorstellung mit Sprecher, Animationen und Untertitel.',
    type: 'MILESTONE',
    offerType: 'SERVICE',
    sats: 180_000,
    imageUrl: 'https://picsum.photos/seed/video/600/400',
    category: 'Services',
    milestones: [
      { title: 'Konzept & Storyboard', description: ' Drehbuch, visueller Ablauf', pct: 20 },
      { title: 'Produktion', description: 'Aufnahme, Animationen, Schnitt', pct: 40 },
      { title: 'Feinschliff', description: 'Farbkorrektur, Sound-Design, Untertitel', pct: 25 },
      { title: 'Lieferung', description: 'Export in allen Formaten (MP4, WebM)', pct: 15 },
    ],
  },
  {
    title: 'Übersetzung & Lokalisierung',
    description: 'Fachübersetzung Deutsch ↔ Englisch von Webseiten, Dokumenten oder Apps mit kultureller Anpassung.',
    type: 'SMART_ORDER',
    offerType: 'SERVICE',
    sats: 25_000,
    imageUrl: 'https://picsum.photos/seed/translation/600/400',
    category: 'Services',
  },
  {
    title: 'Fotografie & Bildbearbeitung',
    description: 'Produktfotografie mit Retusche, oder Event-Dokumentation mit professioneller Nachbearbeitung.',
    type: 'SMART_ORDER',
    offerType: 'SERVICE',
    sats: 45_000,
    imageUrl: 'https://picsum.photos/seed/photo/600/400',
    category: 'Services',
  },
]

// ─── Product Templates ─────────────────────────────────────────────────────────

export const PRODUCT_TEMPLATES: DemoOfferTemplate[] = [
  {
    title: 'Handgemachte Kerzen Set',
    description: 'Wunderschönes Set aus 6 handgemachten Soja-Kerzen in verschiedenen Düften. Perfekt als Geschenk.',
    type: 'SMART_ORDER',
    offerType: 'PRODUCT',
    sats: 20_000,
    imageUrl: 'https://picsum.photos/seed/candles/600/400',
    category: 'Goods',
  },
  {
    title: 'E-Book: TypeScript Best Practices',
    description: 'Umfassendes E-Book über TypeScript Best Practices – sofortiger Download nach Kauf.',
    type: 'SMART_ORDER',
    offerType: 'PRODUCT',
    sats: 25_000,
    imageUrl: 'https://picsum.photos/seed/ebook/600/400',
    category: 'Digital',
  },
  {
    title: 'UI Template Pack – React Components',
    description: 'Sammlung von 50+ vorgefertigten React-Komponenten mit Tailwind CSS – unbegrenzte Lizenzen.',
    type: 'SMART_ORDER',
    offerType: 'PRODUCT',
    sats: 45_000,
    imageUrl: 'https://picsum.photos/seed/uipack/600/400',
    category: 'Digital',
  },
  {
    title: 'Online-Kurs: Bitcoin & Lightning',
    description: 'Selbstlernkurs in 3 Modulen: Bitcoin Basics, Lightning Network, Praktisches Wallet-Setup.',
    type: 'MILESTONE',
    offerType: 'PRODUCT',
    sats: 120_000,
    imageUrl: 'https://picsum.photos/seed/bitcoin/600/400',
    category: 'Digital',
    milestones: [
      { title: 'Modul 1: Bitcoin Basics', description: 'Freischaltung Modul 1 nach Zahlung', pct: 30 },
      { title: 'Modul 2: Lightning Network', description: 'Freischaltung Modul 2 nach Abschluss M1', pct: 40 },
      { title: 'Modul 3: Wallet & Praxis', description: 'Zertifikat + Abschlusslieferung', pct: 30 },
    ],
  },
  {
    title: 'Software-Lizenz: Pro-Plan 3 Stufen',
    description: 'Gestaffelte Lizenzfreischaltung: Starter → Standard → Enterprise mit Upgrade-Pfad.',
    type: 'MILESTONE',
    offerType: 'PRODUCT',
    sats: 250_000,
    imageUrl: 'https://picsum.photos/seed/license/600/400',
    category: 'Digital',
    milestones: [
      { title: 'Starter-Lizenz', description: 'Sofortige Aktivierung nach Zahlung', pct: 25 },
      { title: 'Standard-Upgrade', description: 'Zusatzmodule + API-Zugang freigeschaltet', pct: 35 },
      { title: 'Enterprise-Lizenz', description: 'White-Label + Priority-Support + Quellcode', pct: 40 },
    ],
  },
  {
    title: 'Vintage Möbel – restauriert',
    description: 'Antiker Schreibtisch aus den 1950ern, professionell restauriert, originale Beschläge erhalten.',
    type: 'SMART_ORDER',
    offerType: 'PRODUCT',
    sats: 85_000,
    imageUrl: 'https://picsum.photos/seed/furniture/600/400',
    category: 'Goods',
  },
  {
    title: 'Handgemachte Schmuck-Kollektion',
    description: 'Exklusive Kollektion aus 12 handgefertigten Silberohrringen mit Edelstein-Applikationen.',
    type: 'SMART_ORDER',
    offerType: 'PRODUCT',
    sats: 55_000,
    imageUrl: 'https://picsum.photos/seed/jewelry/600/400',
    category: 'Goods',
  },
  {
    title: 'Bio-Honig aus regionaler Imkerei',
    description: 'Rohhonig von Stadtbienen aus dem Münchner Umland – 500g Glas, cremig gerührt.',
    type: 'SMART_ORDER',
    offerType: 'PRODUCT',
    sats: 8_500,
    imageUrl: 'https://picsum.photos/seed/honey/600/400',
    category: 'Goods',
  },
  {
    title: 'Digital Art Print – Abstract Series',
    description: 'Hochwertiger Fine-Art-Druck auf 300g mattem Papier, signiert, Format A3.',
    type: 'SMART_ORDER',
    offerType: 'PRODUCT',
    sats: 35_000,
    imageUrl: 'https://picsum.photos/seed/artprint/600/400',
    category: 'Goods',
  },
  {
    title: 'Freelance Portfolio Template',
    description: 'Modernes HTML/CSS Portfolio-Template für Freelancer – responsive, SEO-optimiert.',
    type: 'SMART_ORDER',
    offerType: 'PRODUCT',
    sats: 15_000,
    imageUrl: 'https://picsum.photos/seed/portfolio/600/400',
    category: 'Digital',
  },
]

// ─── All Templates ─────────────────────────────────────────────────────────────

export const ALL_DEMO_TEMPLATES: DemoOfferTemplate[] = [
  ...SERVICE_TEMPLATES,
  ...PRODUCT_TEMPLATES,
]

// ─── Helper Functions ───────────────────────────────────────────────────────────

export function getRandomTemplate(offerType?: 'SERVICE' | 'PRODUCT'): DemoOfferTemplate {
  const pool = offerType === 'SERVICE' ? SERVICE_TEMPLATES : offerType === 'PRODUCT' ? PRODUCT_TEMPLATES : ALL_DEMO_TEMPLATES
  return pool[Math.floor(Math.random() * pool.length)]
}

export function getTemplateByCategory(category: string): DemoOfferTemplate[] {
  return ALL_DEMO_TEMPLATES.filter(t => t.category === category)
}
