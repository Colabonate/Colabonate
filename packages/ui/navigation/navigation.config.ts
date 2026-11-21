/**
 * Colabonate – Navigationshierarchie (Konfiguration)
 *
 * Single Source of Truth für alle Routen der App. (ADR-026)
 *
 * Hauptnavigation:
 *   [Home/Back]  [Kaufen]  [Verkaufen]  [Kooperieren]  [···Options]
 *
 * Ebenen:
 *   L1 = Haupt-Tabs (isTab: true)
 *   L2 = Unterseiten / Views
 *   L3 = Detail- / Formular-Seiten
 *
 * Scopes:
 *   v1 = Release v1 (default)
 *   v2 = Ausbaustufen (nur Stubs, gefiltert durch getV1Routes)
 *
 * @see docs/decisions/026-navigation-hierarchy-route-config.md
 * @see docs/decisions/029–040 für Scope-Details
 */

import type { NavConfig, NavRoute } from './navigation.types';

export const navigationConfig: NavConfig = {
  routes: [

    // =========================================================================
    // ONBOARDING  –  kein Tab, kein Auth
    // ADR-036
    // =========================================================================
    {
      path: '/onboarding',
      label: 'Introduction',
      description: 'Get started with Colabonate',
      figmaFrames: ['Intro_Guide_S1', 'Intro_Guide_2S1'],
      children: [
        {
          path: '/onboarding/welcome',
          label: 'Welcome',
          figmaFrames: [
            'Intro_Guide_S1', 'Intro_Guide_S2', 'Intro_Guide_S3',
            'Intro_Guide_S4', 'Intro_Guide_S5', 'Intro_Guide_S6',
            'Intro_Guide_S7', 'Intro_Guide_S8', 'Intro_Guide_S9',
            'Intro_Guide_S10', 'Intro_Guide_S11', 'Intro_Guide_S12', 'Intro_Guide_S13',
            'Intro_Guide_2S1', 'Intro_Guide_2S2', 'Intro_Guide_2S3',
            'Intro_Guide_2S4', 'Intro_Guide_2S5',
          ],
        },
        {
          path: '/onboarding/features',
          label: 'Feature Selection',
          figmaFrames: ['START_FeatureSel'],
        },
        {
          path: '/onboarding/creator',
          label: 'Welcome as Creator',
          figmaFrames: ['Creator_Willkommen_Empty', 'Creator_Willkommen_Compact_Empty'],
          children: [
            {
              path: '/onboarding/creator/company',
              label: 'Register Company',
              figmaFrames: [
                'Creator_Unternehmen_gründen_S0', 'Creator_Unternehmen_gründen_S00',
                'Creator_Unternehmen_gründen_S1', 'Creator_Unternehmen_gründen_S2',
                'Creator_Unternehmen_gründen_S3', 'Creator_Unternehmen_gründen_AGB',
                'Creator_Unternehmen_gründen_Done',
              ],
            },
          ],
        },
      ],
    },

    // =========================================================================
    // HOME  –  Tab L1
    // ADR-037
    // =========================================================================
    {
      path: '/',
      label: 'Home',
      isTab: true,
      hasOptions: true,
      figmaFrames: [
        'HomeScreen', 'START_E02', 'START_E03', 'START_E04',
        'START_E04_BuyOnly', 'START_E04_Startmenu', 'START_E05', 'START_E06',
        'START_Instanz',
      ],
      subItems: [
        // ── DAO Discovery (ADR-200) ─────────────────────────────────────────
        { label: 'DAO Discovery',     description: 'Find and join DAOs',                     path: '/dao',                       icon: 'dashboard' },
        // ── DAO Governance (ADR-128) ────────────────────────────────────────
        { label: 'DAO Governance',    description: 'Community proposals and voting',          path: '/dao/colabonate-foundation', icon: 'settings' },
        // ── Escrow Trade Desk (ADR-355) ─────────────────────────────────────
        { label: 'Escrow Trade Desk', description: 'Your non-custodial Bitcoin escrow trades', path: '/trade',                    icon: 'wallet' },
      ],
      children: [
        {
          path: '/search',
          label: 'Search',
          figmaFrames: ['Search_overlay'],
        },
        {
          path: '/account',
          label: 'Account',
          requiresAuth: true,
          figmaFrames: ['User_Details', 'Account_Details_Personal'],
          hasOptions: true,
        },
        {
          path: '/settings',
          label: 'Settings',
          requiresAuth: true,
          figmaFrames: ['Start Einstellungen'],
        },
        {
          path: '/wallet',
          label: 'Wallet',
          requiresAuth: true,
          hasOptions: true,
          figmaFrames: ['Wallet_START', 'SI_Start', 'SI_Status', 'SI_Wallet_Creation_Start'],
          children: [
            {
              path: '/wallet/send',
              label: 'Send',
              figmaFrames: ['Wallet_Senden'],
            },
          ],
        },
      ],
    },

    // =========================================================================
    // KOOPERIEREN  –  Tab L1
    // ADR-033, ADR-034, ADR-035
    // =========================================================================
    {
      path: '/coop',
      label: 'Cooperate',
      isTab: true,
      hasOptions: true,
      requiresAuth: true,
      figmaFrames: [
        'KOOPERIEREN_START_Empty', 'KOOPERIEREN_START_activesTicket',
        'KOOPERIEREN_START_BereitschaftActiv_activesTicket', 'KOOPERIEREN_START_COMPACT',
        'KOOPERIEREN_Übersciht', 'KOOPERIEREN_Übersciht+Collabs',
      ],
      subItems: [
        // ADR-110: Vendors, Partners, Networks, Projects, Tenders, Availability removed from nav
        // → accessible via CoopExplore's filter tabs/sidebar or /sell/company/availability
        // ADR-218: 'Dashboard' renamed to 'Explore' in place (same /coop path, now ListBrowser-based);
        // 'Overview' promoted from a CoopDashboard subtab into its own route. Order preserved for muscle memory.
        // ADR-368: 'Manage' is now the /coop/manage hub and Services / Agent
        // Stack / My Bounties are its deep-linked tabs (everything service-,
        // agent- and bounty-shaped lives under Cooperate).
        { label: 'Explore',     description: 'Discover cooperations, tenders, bounties and networks', path: '/coop',        icon: 'search'    },
        { label: 'Overview',    description: 'KPIs, tools and quick actions',                      path: '/coop/overview',  icon: 'dashboard' },
        { label: 'Coop Guide',  description: 'Start a new cooperation – Creator or Private',       path: '/coop/guide',     icon: 'guide',    badge: 'START' },
        { label: 'Manage',      description: 'Manage cooperations, status and requests',          path: '/coop/manage?tab=cooperations', icon: 'settings'  },
        { label: 'Services',    description: 'Manage your service offers',                        path: '/coop/manage?tab=services',     icon: 'services' },
        { label: 'Agent Stack', description: 'All your agents — owned and booked — in one place', path: '/coop/manage?tab=stack',        icon: 'roster'   },
        { label: 'My Bounties', description: 'Post a bounty, review applications, pick a winner', path: '/coop/manage?tab=bounties',     icon: 'bounties' },
        { label: 'Templates',   description: 'Setup templates and contract templates',             path: '/coop/templates', icon: 'templates' },
      ],
      children: [

        // --- Koop-Guide (ADR-033)
        {
          path: '/coop/guide',
          label: 'Cooperation Guide',
          description: 'Start cooperation: Role × Type × Action → Protocol Form',
          hasOptions: true,
          figmaFrames: [
            'KOOPERIEREN_Create_Help_Private',
            'KOOPERIEREN_Create_Process_PartnerSel_S01',
            'KOOPERIEREN_Create_Process_partnerSelected_S000',
            'KOOPERIEREN_Create_Process_partner_details',
            'KOOPERIEREN_Create_Process_partner_templateSelection',
            'KOOPERIEREN_Create_Process_done_S03',
            'KOOPERIEREN_Create_TemplateContract',
            'KoOp_CreateProjectPrivate', 'KoOp_CreateProjectFounder',
            'KoOp_CreateTenderFounder', 'KoOp_CreateTenderPrivate',
            'KoOp_CreatePartnerPrivate', 'KoOp_CrreatePartnerFounder',
            'KoOp_Create_Offer_Private_Gesuch',
          ],
        },

        // --- Anbieter im Umfeld (ADR-034)
        {
          path: '/coop/vendors',
          label: 'Vendors',
          description: 'Discover vendors in your area',
          hasOptions: true,
          isFavoritable: true,
          figmaFrames: ['KOOPERIEREN_Übersciht', 'KOOPERIEREN_Anbieter_Details'],
          children: [
            {
              path: '/coop/vendors/:vendorId',
              label: 'Vendor Detail',
              hasOptions: true,
              figmaFrames: ['KOOPERIEREN_Anbieter_Details'],
            },
          ],
        },

        // --- Partner (ADR-034)
        {
          path: '/coop/partners',
          label: 'Partners',
          description: 'Cooperation partners near you',
          hasOptions: true,
          isFavoritable: true,
          figmaFrames: [
            'KOOPERIEREN_Partner_Übersicht', 'KOOPERIEREN_Partner_Overwview',
            'KOOPERIEREN_Suche_S01', 'KOOPERIEREN_Suche_S01_List',
            'KOOPERIEREN_Suche_S02', 'KOOPERIEREN_Suche_Unternehmen',
          ],
          children: [
            {
              path: '/coop/partners/:partnerId',
              label: 'Partner Detail',
              hasOptions: true,
              figmaFrames: [
                'KOOPERIEREN_Partner_Details_KollaboOpen',
                'KOOPERIEREN_Partner_Details_Prozess',
              ],
            },
          ],
        },

        // --- Netzwerke (ADR-034)
        {
          path: '/coop/networks',
          label: 'Networks',
          requiresAuth: true,
          hasOptions: true,
          isFavoritable: true,
          children: [
            {
              path: '/coop/networks/new',
              label: 'Create Network',
            },
            {
              path: '/coop/networks/:networkId',
              label: 'Manage Network',
              hasOptions: true,
            },
          ],
        },

        // --- Projekte (ADR-034)
        {
          path: '/coop/projects',
          label: 'Projects',
          hasOptions: true,
          isFavoritable: true,
          figmaFrames: [
            'KoOp_FindProjectPrivate', 'KoOp_FindProjectFounder',
            'KoOp_PlanProjectPrivate', 'KoOp_PlanProjectFounder',
          ],
          children: [
            {
              path: '/coop/projects/new',
              label: 'Create Project',
              figmaFrames: ['KoOp_CreateProjectPrivate', 'KoOp_CreateProjectFounder'],
            },
            {
              path: '/coop/projects/:projectId',
              label: 'Project Detail',
              hasOptions: true,
              figmaFrames: ['KoOp_Organize_Project_Founder'],
              redirectTo: '/coop/:projectId',
            },
          ],
        },

        // --- Ausschreibungen (ADR-034)
        {
          path: '/coop/tenders',
          label: 'Tenders',
          hasOptions: true,
          isFavoritable: true,
          figmaFrames: [
            'KOOPERIEREN_Tender_Details_create',
            'KoOp_FindTenderPrivate', 'KoOp_FindTenderFounder',
          ],
          children: [
            {
              path: '/coop/tenders/new',
              label: 'Create Tender',
              figmaFrames: ['KoOp_CreateTenderFounder', 'KoOp_CreateTenderPrivate'],
            },
            {
              path: '/coop/tenders/:tenderId',
              label: 'Tender Detail',
              hasOptions: true,
              redirectTo: '/coop/:tenderId',
            },
          ],
        },

        // --- Koop-Angebote (ADR-034)
        {
          path: '/coop/offers',
          label: 'Coop Offers',
          hasOptions: true,
          isFavoritable: true,
          figmaFrames: [
            'KOOPERIEREN_Angebot_erstellen_aktiv',
            'KoOp_Find_Offer_Private', 'KoOp_Organize_Offer_Private',
          ],
          children: [
            {
              path: '/coop/offers/new',
              label: 'Create Offer',
              figmaFrames: ['KoOp_Create_Offer_Private_Gesuch', 'Form_Koop_Anbieten'],
            },
            {
              path: '/coop/offers/:offerId',
              label: 'Offer Detail',
              hasOptions: true,
              redirectTo: '/coop/:offerId',
            },
          ],
        },

        // --- Lieferbereitschaft (ADR-035)
        {
          path: '/coop/delivery',
          label: 'Availability',
          requiresAuth: true,
          hasOptions: true,
          figmaFrames: [
            'KOOPERIEREN_Lieferung_START_inactiv', 'KOOPERIEREN_Lieferung_START_pause',
            'KOOPERIEREN_Lieferung_Bereitschaft_Übersicht_activ',
            'KOOPERIEREN_Lieferung_Bereitschaft_Übersicht_inactiv',
            'KOOPERIEREN_Lieferung_Bereitschaft_Übersicht_inactiv_PartnerGewählt',
            'KOOPERIEREN_Lieferung_Bereitschaft_Übersicht_inactiv_ohneVertretung',
            'KOOPERIEREN_Lieferung_Bereitschaft_Übersicht_PARTERWAHL',
            'KOOPERIEREN_Lieferung_Bereitschaft_Übersicht_Stellvertretung',
            'KOOPERIEREN_Lieferung_Bereitschaft_Übersicht_pause',
          ],
        },

        // --- Vorlagen (ADR-035)
        {
          path: '/coop/templates',
          label: 'Templates',
          description: 'Setup templates and contract templates for cooperations',
          requiresAuth: true,
          hasOptions: true,
          isFavoritable: true,
          figmaFrames: ['Vorlagen_T1', 'Templates_Option_Menu', 'KOOPERIEREN_Create_TemplateContract'],
          children: [
            {
              path: '/coop/templates/new',
              label: 'Create Template',
            },
            {
              path: '/coop/templates/:templateId',
              label: 'Edit Template',
              hasOptions: true,
            },
          ],
        },

        // --- Koop-Tickets (ADR-035)
        {
          path: '/coop/tickets',
          label: 'Coop Tickets',
          requiresAuth: true,
          hasOptions: true,
          figmaFrames: [
            'KOOPERIEREN_Tickets_Start', 'KOOPERIEREN_Tickets_Übersicht',
            'TIKETS_KoOp_Verträge_List',
          ],
        },

        // --- KI-Assistent (vorbereitet)
        {
          path: '/coop/ai-assistant',
          label: 'AI Assistant',
          figmaFrames: ['KoOp_AI_Assistent_Overlay'],
          phase: 'v2',
        },
      ],
    },

    // =========================================================================
    // KAUFEN  –  Tab L1
    // ADR-029, ADR-030
    // =========================================================================
    {
      path: '/buy',
      label: 'Buy',
      isTab: true,
      hasOptions: true,
      figmaFrames: [
        'BUY_START', 'BUY_START_Compact', 'BUY_OverviewCompact_01',
        'BUY_START_Anbieter', 'BUY_START_BestellungOffen',
      ],
      subItems: [
        { label: 'Marketplace', description: 'Browse and discover all offers',         path: '/buy',            icon: 'marketplace' },
        // Categories & Vendors obsolete – now integrated in BuyDashboard sidebar/KPIs
        // { label: 'Categories',  description: 'Browse products by category',            path: '/buy/categories', icon: 'categories' },
        // { label: 'Vendors',     description: 'Local vendors in your area',             path: '/buy/vendors',    icon: 'vendors'    },
        // { label: 'Search',      description: 'Find products, services & vendors',      path: '/buy/search',     icon: 'search'     },
        // ADR-337: the Bounty Board nav entry was removed from both Buy and
        // Sell (see the Sell subItems below for the matching removal note) —
        // it's discoverable via the "Bounties" KPI chip in Search's Cooperate
        // context instead (/search?context=coop), alongside Tenders/Projects/
        // Network, which is where its agent-native-open-call sibling concept
        // actually lives conceptually (ADR-328).
        { label: 'Map',         description: 'Find offers on the map',                 path: '/buy/map',        icon: 'map'        },
        { label: 'Cart',        description: 'Your shopping cart',                    path: '/buy/cart',       icon: 'cart',      badge: '' },
        { label: 'Orders',      description: 'Your active and past orders',            path: '/buy/orders',     icon: 'orders'     },
      ],
      children: [

        // --- Kategorien & Produkte (ADR-029)
        {
          path: '/buy/categories',
          label: 'Categories',
          description: 'Browse products by category',
          hasOptions: true,
          isFavoritable: true,
          figmaFrames: ['BUY_Übersicht_Kategorien'],
          children: [
            {
              path: '/buy/categories/:categoryId/products',
              label: 'Category Products',
              hasOptions: true,
              isFavoritable: true,
              figmaFrames: [
                'BUY_Kategorie_Produkte_Übersicht',
                'BUY_Kategorie_Produkte_Übersicht_Kategorien',
                'BUY_Kategorie_Produkte_Übersicht_kompakt',
                'BUY_Kategorie_Produkte_Listen',
              ],
              children: [
                {
                  path: '/buy/categories/:categoryId/products/filter',
                  label: 'Filter',
                  figmaFrames: [
                    'BUY_Kategorie_Produkte_FilterOption',
                    'BUY_Kategorie_Produkte_addOption',
                    'Kriterien_Liste', 'Kriterien_Liste_KriterienFilter',
                    'Kriterien_Liste_S02', 'Kriterien_hinzufügen_04',
                    'Kategorien Übersicht S03_KriterienFilter',
                  ],
                },
              ],
            },
          ],
        },

        // --- Produkt-Detail (flat route – ADR-029)
        {
          path: '/buy/product/:productId',
          label: 'Product Detail',
          hasOptions: true,
          figmaFrames: ['Image_Slider_Produkt_Detail'],
        },

        // --- Anbieter (ADR-029, ADR-223)
        // Vendor discovery is now a tab inside /buy; only the detail route remains.
        {
          path: '/buy/vendors/:id',
          label: 'Vendor Detail',
          hasOptions: true,
          figmaFrames: ['KOOPERIEREN_Anbieter_Details'],
        },

        // --- Suche & Karte (ADR-029)
        {
          path: '/buy/search',
          label: 'Search',
          description: 'Find products, services & vendors',
          hasOptions: true,
          figmaFrames: ['BUY_START_ErwSuche_FilterOption', 'BUY_START_ErwSuche_VoiceInput'],
        },
        {
          path: '/buy/map',
          label: 'Map',
          description: 'Find offers on the map',
          hasOptions: true,
          figmaFrames: ['BUY_Map_Übersicht'],
        },

        // --- Warenkorb & Checkout (ADR-030)
        {
          path: '/buy/cart',
          label: 'Cart',
          requiresAuth: true,
          hasOptions: true,
          figmaFrames: [
            'BUY_Kategorie_Produkte_Übersicht_Warenkorb',
            'BUY_Kategorie_Produkte_Übersicht_Warenkorb_1xp',
            'BUY_Kategorie_Produkte_Übersicht_Warenkorb_Leer',
          ],
          children: [
            {
              path: '/buy/cart/delivery',
              label: 'Delivery Address',
              figmaFrames: ['BUY_Kategorie_Produkte_Übersicht_Warenkorb_Lieferung_Adresse'],
            },
            {
              path: '/buy/cart/checkout',
              label: 'Checkout',
              figmaFrames: ['BUY_Kategorie_Produkte_Übersicht_Warenkorb_Abschluss'],
            },
            {
              path: '/buy/cart/confirmation',
              label: 'Order Confirmation',
              figmaFrames: ['BUY_Warenkorb_Bestellbestätigung'],
            },
          ],
        },

        // --- Bestellungen (ADR-030)
        {
          path: '/buy/orders',
          label: 'Orders',
          requiresAuth: true,
          hasOptions: true,
          isFavoritable: true,
          figmaFrames: ['BUY_START_BestellungOffen'],
        },
      ],
    },

    // =========================================================================
    // VERKAUFEN  –  Tab L1
    // ADR-031, ADR-032
    // =========================================================================
    {
      path: '/sell',
      label: 'Sell',
      isTab: true,
      hasOptions: true,
      requiresAuth: true,
       figmaFrames: ['SELL_OverviewCompact_01', 'Anzeige_Übersicht'],
       subItems: [
          { label: 'Dashboard',      description: 'Overview and quick actions',               path: '/sell',           icon: 'dashboard' },
          { label: 'Company',        description: 'Profile, fields and terms of service',     path: '/sell/company',   icon: 'company'  },
          { label: 'Listings',       description: 'Listings, catalogs and products',          path: '/sell/listings',  icon: 'listings' },
          // ADR-366: the 'Services' nav item that opened the Coop Guide's
          // "Service Bundle" flow (`/coop/guide?...&model=SERVICE`) was
          // removed — misleading now that Service is its own real Offer type
          // (creatable at /offers/new?type=service, reachable via the FAB and
          // Listings' own "Services" filter chip). The Coop Guide flow it
          // used to open is a different entity (Cooperation), not a listing.
          // ADR-336: the standalone 'Agents' entry (→ Listings pre-filtered
          // to AGENT_SETUP offers) was removed — Listings' own "AI Agents"
          // KPI chip already reaches the identical view, and having both
          // meant two nav items landing on what looked like the same page
          // (compounded by a real bug, also fixed in ADR-336, where the tab/
          // filter state never re-synced from the URL on repeat navigation).
          // ADR-368 D1/D2: the Sell 'Agent Stack' entry is removed too — the
          // agent roster (owned + booked) lives under Cooperate → Manage
          // (tab=stack), matching the umbrella decision that everything
          // service/agent-shaped is a cooperation surface. Sell = goods.
          // ADR-337: removed the Sell-side Bounty Board entry too — every
          // other Sell nav item is "your own inventory" (Company/Listings),
          // while Bounty Board is a shared marketplace/discovery surface,
          // structurally a Buy-shaped concept.
       ],
      children: [

        // --- Unternehmensprofil (ADR-031)
        {
          path: '/sell/company',
          label: 'Company Profile',
          requiresAuth: true,
          hasOptions: true,
          figmaFrames: ['Creator_Willkommen_Company_InUse', 'Creator_Willkommen_Company_Compact_InUse'],
          children: [
            {
              path: '/sell/company/setup',
              label: 'Company Info',
              description: 'Name, address and opening hours',
              figmaFrames: [
                'Creator_Unternehmen_gründen_S0', 'Creator_Unternehmen_gründen_S1',
                'Creator_Unternehmen_gründen_S2', 'Creator_Unternehmen_gründen_S3',
              ],
            },
            {
              path: '/sell/company/fields',
              label: 'Business Fields',
              description: 'Define business fields and cooperation radius',
              figmaFrames: ['Creator_Unternehmen_gründen_AGB'],
            },
            {
              path: '/sell/company/terms',
              label: 'Terms & Conditions',
              description: 'Terms of service and legal basis',
              figmaFrames: ['Creator_Unternehmen_gründen_AGB', 'Creator_Unternehmen_gründen_Done'],
            },
          ],
        },

        // --- Katalog-Management (ADR-031)
        {
          path: '/sell/catalog',
          label: 'Catalogs',
          requiresAuth: true,
          hasOptions: true,
          isFavoritable: true,
          figmaFrames: [
            'Creator_Kataloge_Liste_S0', 'Creator_Kataloge_Liste_S1',
            'Creator_Kataloge_Liste_S2', 'Creator_Kataloge_Liste_S3',
            'Creator_Kataloge_Liste_Kataloge', 'Katalog_Übersicht_leer',
          ],
          subItems: [
            { label: 'Products',     description: 'Manage products in catalog',  path: '/sell/catalog/:catalogId/products',  icon: 'products' },
          ],
          children: [
            {
              path: '/sell/catalog/new',
              label: 'Create Catalog',
              figmaFrames: ['Creator_Katalog_erstellen_S00', 'Creator_Katalog_erstellen_S02'],
            },
            {
              path: '/sell/catalog/:catalogId',
              label: 'Catalog Overview',
              hasOptions: true,
              figmaFrames: ['Kataloge_ElementSubmenue', 'Produkte_Übersicht'],
              children: [
                {
                  path: '/sell/catalog/:catalogId/categories',
                  label: 'Categories',
                  hasOptions: true,
                  figmaFrames: ['Produkte_Übersicht_Kategorien'],
                  children: [
                    {
                      path: '/sell/catalog/:catalogId/categories/new',
                      label: 'Add Category',
                      figmaFrames: ['kategorie_1_erstellen_leer', 'kategorie_1_erstellen_vegetarisch'],
                    },
                    {
                      path: '/sell/catalog/:catalogId/categories/:categoryId',
                      label: 'Edit Category',
                      hasOptions: true,
                    },
                  ],
                },
                {
                  path: '/sell/catalog/:catalogId/products',
                  label: 'Products',
                  hasOptions: true,
                  isFavoritable: true,
                  figmaFrames: [
                    'Produkte_Übersicht_S02', 'Produkte_Übersicht_S02_Filter',
                    'Produkte_Übersicht_S02_sel', 'Produkte_Übersicht_S03',
                    'Produkte_Übersicht_S03_sel',
                  ],
                  children: [
                    {
                      path: '/sell/catalog/:catalogId/products/new',
                      label: 'Add Product',
                      figmaFrames: [
                        'Produkt_hinzufügen_E02_S01', 'Produkt_hinzufügen_E02_S05',
                        'Produkt_hinzufügen_E02_S06', 'Produkt_hinzufügen_E02_S07',
                        'Produkt_hinzufügen_Kategorien_hinzu_E02_S05',
                        'Produkt_hinzufügen_OhneUnternehmen',
                      ],
                    },
                    {
                      path: '/sell/catalog/:catalogId/products/:productId',
                      label: 'Edit Product',
                      hasOptions: true,
                      figmaFrames: ['Produkt_Settings'],
                    },
                  ],
                },
              ],
            },
          ],
        },

        // --- Anzeigen (ADR-032)
        {
          path: '/sell/listings',
          label: 'Listings',
          requiresAuth: true,
          hasOptions: true,
          isFavoritable: true,
          figmaFrames: ['Anzeige_Übersicht', 'Anzeige_Übersicht_S02'],
          children: [
            {
              path: '/sell/listings/new',
              label: 'Create Listing',
              figmaFrames: [
                'Anzeige_hinzufügen', 'Anzeige_hinzufügen_S01',
                'Produkte_ArtikelVerkaufen', 'Produkte_ArtikelVerkaufen_S1',
              ],
            },
            {
              path: '/sell/listings/:listingId',
              label: 'Listing Detail',
              hasOptions: true,
              figmaFrames: ['Verkauf_Details_Verkaufsort'],
            },
          ],
        },

      ],
    },

    // =========================================================================
    // AUSBAUSTUFEN v2  –  kein Tab, nur Stubs
    // ADR-038
    // =========================================================================
    {
      path: '/statistics',
      label: 'Statistics',
      description: 'Blockchain data and analytics',
      phase: 'v2',
      figmaFrames: ['Statistiken'],
    },
    {
      path: '/feedback',
      label: 'Feedback',
      description: 'User feedback and improvement suggestions',
      phase: 'v2',
      figmaFrames: ['Feedback'],
    },
    {
      path: '/dao',
      label: 'DAO',
      description: 'Decentralized governance per Colabonate Protocol',
      // ADR-128: promoted from v2 — governance layer implemented
    },
    {
      path: '/media',
      label: 'Media',
      description: 'Images, videos and media management',
      phase: 'v2',
      figmaFrames: ['Media_Übersicht_S0', 'Media_Übersicht_S01', 'Media_Übersicht_S02'],
      children: [
        {
          path: '/media/:mediaId',
          label: 'Media Detail',
          phase: 'v2',
          figmaFrames: ['Media_DetailAnsicht', 'Media_Detail_Option'],
        },
      ],
    },
    {
      path: '/tickets',
      label: 'Tickets',
      description: 'Ticket management across all areas',
      phase: 'v2',
      figmaFrames: ['Tickets_Dashbaord', 'Tickets_List', 'Tickets_Übersicht_01'],
      children: [
        {
          path: '/tickets/:ticketId',
          label: 'Ticket Detail',
          phase: 'v2',
          figmaFrames: ['Tickets_Detail', 'Tickets_Detail_Collaboration'],
          children: [
            { path: '/tickets/:ticketId/workflow', label: 'Workflow Editor',      phase: 'v2', figmaFrames: ['Tickets Workflows Editor'] },
            { path: '/tickets/:ticketId/contract', label: 'Smart Contract Editor',phase: 'v2', figmaFrames: ['Tickets Smart Contract Editor'] },
            { path: '/tickets/:ticketId/chat',     label: 'Chat',                 phase: 'v2', figmaFrames: ['Tickets Chat'] },
          ],
        },
      ],
    },
  ],
};

// =============================================================================
// Hilfs-Funktionen
// =============================================================================

/** Alle Routen flach als Array (für React Router) */
export function flattenRoutes(
  routes: NavRoute[],
  acc: NavRoute[] = [],
): NavRoute[] {
  for (const route of routes) {
    acc.push(route);
    if (route.children) flattenRoutes(route.children, acc);
  }
  return acc;
}

/** Nur Routen der Phase v1 (filtert v2-Stubs heraus) */
export function getV1Routes(config: NavConfig): NavRoute[] {
  function filterV1(routes: NavRoute[]): NavRoute[] {
    return routes
      .filter((r) => r.phase !== 'v2')
      .map((r) => ({
        ...r,
        children: r.children ? filterV1(r.children) : undefined,
      }));
  }
  return filterV1(config.routes);
}

/** Alle Tabs (isTab === true) der Hauptnavigation */
export function getTabRoutes(config: NavConfig): NavRoute[] {
  return config.routes.filter((r) => r.isTab);
}

/** subItems einer Route (für Options-Button und Dashboard-Karten) */
export function getSubItems(config: NavConfig, path: string): NavRoute['subItems'] {
  const all = flattenRoutes(config.routes);
  return all.find((r) => r.path === path)?.subItems;
}

/** Vollständiges NavRoute-Objekt für einen Pfad */
export function getRouteMeta(config: NavConfig, path: string): NavRoute | undefined {
  return flattenRoutes(config.routes).find((r) => r.path === path);
}
