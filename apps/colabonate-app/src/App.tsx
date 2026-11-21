import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
  Outlet,
  redirect,
  useParams,
  useLocation,
  useSearchParams,
} from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { Layout } from './components/Layout'
import { initSmoothScroll } from './lib/lenis-setup'
import { ModalProvider } from './components/ModalProvider'
import { NotificationProvider } from './context/NotificationContext'
import { MobileNavHeaderProvider } from './context/MobileNavHeaderContext'
import { FABProvider } from './context/FABContext'
import { CartProvider } from './context/CartContext'
import { LocaleProvider } from './contexts/LocaleContext'
import { CurrencyProvider } from './contexts/CurrencyContext'
import { WalletProvider } from './contexts/WalletContext'
import { CashuProvider } from './contexts/CashuContext'
import { PageLoader } from './components/PageLoader'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ScrollToTop } from './components/ScrollToTop'
import { useDefaultLocationPreference } from './utils/userPreferences'
import { useCompany } from './hooks/useEntityQueries'
import CircularProgress from '@mui/material/CircularProgress'

/** Converts a named-export module into the default-export shape for React.lazy() */
function named<M, K extends keyof M>(factory: () => Promise<M>, key: K) {
  return lazy(() => factory().then(m => ({ default: m[key] as React.ComponentType<any> })))
}

// Product-Launch-Masterplan FU-662: no IC-mainnet escrow canister exists yet
// (ADR-354/355), so the Trade Desk (ADR-355-362, /trade/*) is a build-flag
// opt-in — same off-by-default pattern as VITE_CASHU_ENABLED (ADR-187). Baked
// at build time; unset in an environment's compose = the routes below never
// register, so /trade/* falls through to the catch-all instead of showing a
// non-functional escrow surface.
const ESCROW_TRADE_DESK_ENABLED = import.meta.env.VITE_ESCROW_TRADE_DESK === 'true'

// ─── Lazy Route Components ────────────────────────────────────────────────────

const Home              = named(() => import('./routes/home/Home'),               'Home')
const Tickets           = named(() => import('./routes/tickets/Tickets'),          'Tickets')
const TicketDetail      = named(() => import('./routes/tickets/TicketDetail'),     'TicketDetail')
const WorkspaceDetail   = named(() => import('./routes/workspaces/WorkspaceDetail'), 'WorkspaceDetail')
const Account           = named(() => import('./routes/account/Account'),          'Account')
const Login             = named(() => import('./routes/auth/Login'),               'Login')
const DemoLogin         = named(() => import('./routes/auth/DemoLogin'),           'DemoLogin')
const LoginAlbyError    = named(() => import('./routes/auth/LoginAlbyError'),      'LoginAlbyError')
const GenerateNostrKey  = named(() => import('./routes/onboarding/GenerateNostrKey'), 'GenerateNostrKey')
const CreateOfferPage   = named(() => import('./routes/offers/CreateOfferPage'),   'CreateOfferPage')
const CreateAgentPage   = named(() => import('./routes/agents/CreateAgentPage'),   'CreateAgentPage')
// ADR-339 D4: the edit route mounts the same wizard (prefilled); the
// standalone EditAgentPage is deleted.
const EditAgentWizard   = named(() => import('./routes/agents/CreateAgentPage'),   'EditAgentWizard')
const CreateProductPage = named(() => import('./routes/sell/CreateProductPage'),   'CreateProductPage')
const CreateServicePage = named(() => import('./routes/sell/CreateServicePage'),   'CreateServicePage')
const Notifications     = named(() => import('./routes/notifications/Notifications'), 'Notifications')

// ADR-319 / FU-428: Bounty board. ADR-368 D1: the "My Bounties" board is a
// Cooperate Manage tab (`/coop/manage?tab=bounties`) — posting stays at
// /bounties/new (auth), detail stays public at /bounties/:id.
const CreateBountyPage = named(() => import('./routes/bounties/CreateBountyPage'), 'CreateBountyPage')
const BountyDetail     = named(() => import('./routes/bounties/BountyDetail'),     'BountyDetail')

const BuyDashboard        = named(() => import('./routes/buy/BuyDashboard'),       'BuyDashboard')
const BuyCategories       = named(() => import('./routes/buy/BuyCategories'),      'BuyCategories')
const BuyCategoryProducts = named(() => import('./routes/buy/BuyCategoryProducts'),'BuyCategoryProducts')
const BuyProductDetail    = named(() => import('./routes/buy/BuyProductDetail'),   'BuyProductDetail')
const BuyMap              = named(() => import('./routes/buy/BuyMap'),             'BuyMap')
const BuyCartFlow         = named(() => import('./routes/buy/BuyCartFlow'),        'BuyCartFlow')
const BuyOrders           = named(() => import('./routes/buy/BuyOrders'),          'BuyOrders')

const SellDashboard           = named(() => import('./routes/sell/SellDashboard'),          'SellDashboard')
const SellCompany             = named(() => import('./routes/sell/SellCompany'),            'SellCompany')
const SellCompanySetup        = named(() => import('./routes/sell/SellCompanySetup'),       'SellCompanySetup')
const SellCompanyFields       = named(() => import('./routes/sell/SellCompanyFields'),      'SellCompanyFields')
const SellCompanyTerms        = named(() => import('./routes/sell/SellCompanyTerms'),       'SellCompanyTerms')
const SellCompanyAvailability = named(() => import('./routes/sell/SellCompanyAvailability'),'SellCompanyAvailability')
const SellDeliveryTemplates   = named(() => import('./routes/sell/SellDeliveryTemplates'),  'SellDeliveryTemplates')
const SellCollections         = named(() => import('./routes/sell/SellCollections'),        'SellCollections')
const SellShippingOptions     = named(() => import('./routes/sell/SellShippingOptions'),    'SellShippingOptions')
const SellCategoryDetail      = named(() => import('./routes/sell/SellCategoryDetail'),     'SellCategoryDetail')
const SellProductDetail       = named(() => import('./routes/sell/SellProductDetail'),      'SellProductDetail')
const SellListings            = named(() => import('./routes/sell/SellListings'),           'SellListings')
const SellListingDetail       = named(() => import('./routes/sell/SellListingDetail'),      'SellListingDetail')
const SellBookings            = named(() => import('./routes/sell/SellBookings'),           'SellBookings')

const CoopExplore       = named(() => import('./routes/coop/CoopExplore'),       'CoopExplore')
const CoopOverview      = named(() => import('./routes/coop/CoopOverview'),      'CoopOverview')
const CoopGuide         = named(() => import('./routes/coop/CoopGuide'),         'CoopGuide')
const CoopDetail        = named(() => import('./routes/coop/CoopDetail'),        'CoopDetail')
const CoopVendorDetail  = named(() => import('./routes/coop/CoopVendorDetail'),  'CoopVendorDetail')
const CoopPartnerDetail = named(() => import('./routes/coop/CoopPartnerDetail'), 'CoopPartnerDetail')
const CoopNetworkDetail = named(() => import('./routes/coop/CoopNetworkDetail'), 'CoopNetworkDetail')
// ADR-368 D1: Cooperate Manage hub (/coop/manage) — cooperations, services,
// agent stack and bounties as `?tab=` sub-tabs.
const CoopManage        = named(() => import('./routes/coop/manage/CoopManage'),  'CoopManage')
const CoopDelivery      = named(() => import('./routes/coop/CoopDelivery'),      'CoopDelivery')
const CoopTemplates     = named(() => import('./routes/coop/CoopTemplates'),     'CoopTemplates')
const CoopTemplateDetail= named(() => import('./routes/coop/CoopTemplateDetail'),'CoopTemplateDetail')
const CoopTickets       = named(() => import('./routes/coop/CoopTickets'),       'CoopTickets')

const OnboardingWelcome  = named(() => import('./routes/onboarding/OnboardingWelcome'),  'OnboardingWelcome')
const OnboardingFeatures = named(() => import('./routes/onboarding/OnboardingFeatures'), 'OnboardingFeatures')
const OnboardingCreator  = named(() => import('./routes/onboarding/OnboardingCreator'),  'OnboardingCreator')

const WalletDashboard = named(() => import('./routes/home/WalletDashboard'), 'WalletDashboard')
const WalletSend      = named(() => import('./routes/home/WalletSend'),      'WalletSend')
const Settings        = named(() => import('./routes/home/Settings'),        'Settings')
const Search          = named(() => import('./routes/home/Search'),          'Search')
const UserProfile     = named(() => import('./routes/user/UserProfile'),     'UserProfile')
const CompanyProfile  = named(() => import('./routes/company/CompanyProfile'),'CompanyProfile')

// ADR-355 / ADR-356: Escrow Trade Desk — public trust-verification surface.
// Renders with no session (auditors/court experts verify without an account).
const TradeVerify = named(() => import('./routes/trade/Verify'), 'Verify')

// ADR-355 / ADR-362: Escrow Trade Desk — auth-gated list + read-only cockpit.
const TradeDesk = named(() => import('./routes/trade/TradeDesk'), 'TradeDesk')
const TradeCockpit = named(() => import('./routes/trade/TradeCockpit'), 'TradeCockpit')
// ADR-357: Escrow Trade Desk — start-a-trade wizard (P3 minimal slice).
const NewTrade = named(() => import('./routes/trade/NewTrade'), 'NewTrade')

// ADR-360: Escrow Trade Desk — ISO 20022 interoperability view.
const TradeInterop = named(() => import('./routes/trade/TradeInterop'), 'TradeInterop')

const Statistics  = named(() => import('./routes/v2/Statistics'),  'Statistics')
const Feedback    = named(() => import('./routes/v2/Feedback'),    'Feedback')
const Media       = named(() => import('./routes/v2/Media'),       'Media')
const MediaDetail = named(() => import('./routes/v2/MediaDetail'), 'MediaDetail')

const DaoDashboard     = named(() => import('./routes/dao/DaoDashboard'),    'DaoDashboard')
const DaoProposalDetail= named(() => import('./routes/dao/DaoProposalDetail'),'DaoProposalDetail')
const DaoCreate        = named(() => import('./routes/dao/DaoCreate'),       'DaoCreate')
const DaoCodexSettings = named(() => import('./routes/dao/DaoCodexSettings'),'DaoCodexSettings')
const DaoCreateWizard  = named(() => import('./routes/dao/DaoCreateWizard'), 'DaoCreateWizard')
const DaoDiscovery     = named(() => import('./routes/dao/DaoDiscovery'),    'DaoDiscovery')
const DaoLayout        = named(() => import('./routes/dao/DaoLayout'),       'DaoLayout')
const DaoCouncil       = named(() => import('./routes/dao/DaoCouncil'),      'DaoCouncil')
const DaoAdmin         = named(() => import('./routes/dao/DaoAdmin'),        'DaoAdmin')
const DaoProfile       = named(() => import('./routes/dao/DaoProfile'),      'DaoProfile')

const AIAssistantPage = named(() => import('./routes/ai/AIAssistantPage'), 'AIAssistantPage')
const AIConnectPage    = named(() => import('./routes/ai/AIConnectPage'),    'AIConnectPage')

// ─── Admin Backend (separate layout, no Navbar/Footer) ────────────────────────
const AdminLayout    = named(() => import('./routes/admin/AdminLayout'),              'AdminLayout')
const AdminOverview  = named(() => import('./routes/admin/AdminOverview'),            'AdminOverview')
const AdminAccounts  = named(() => import('./routes/admin/sections/AccountsSection'), 'AccountsSection')
const AdminFeedback  = named(() => import('./routes/admin/sections/FeedbackSection'), 'FeedbackSection')
const AdminBeta      = named(() => import('./routes/admin/sections/BetaSection'),     'BetaSection')
const AdminEntities  = named(() => import('./routes/admin/sections/EntitiesSection'), 'EntitiesSection')
const AdminRemoteCandidates = named(() => import('./routes/admin/sections/RemoteCandidatesSection'), 'RemoteCandidatesSection')
const AdminFoundationBootstrap = named(() => import('./routes/admin/FoundationBootstrap'), 'FoundationBootstrap')
const AdminSchema    = named(() => import('./routes/admin/AdminSchemaPage'),            'AdminSchemaPage')
const AdminAgents    = named(() => import('./routes/admin/AdminAgentsPage'),            'AdminAgentsPage')
const AdminLaunchReadiness = named(() => import('./routes/admin/AdminLaunchReadinessPage'), 'AdminLaunchReadinessPage')
const AdminMcpConnections = named(() => import('./routes/admin/AdminMcpConnectionsPage'), 'AdminMcpConnectionsPage')
const AdminCommerceSettings = named(() => import('./routes/admin/AdminCommerceSettingsPage'), 'AdminCommerceSettingsPage')
const AdminNewsletter = named(() => import('./routes/admin/AdminNewsletterPage'), 'AdminNewsletterPage')

const AboutFoundation     = named(() => import('./routes/about/AboutFoundation'),    'AboutFoundation')
const DaoCodex            = named(() => import('./routes/about/DaoCodex'),           'DaoCodex')
const RoleOnboarding      = named(() => import('./routes/about/RoleOnboarding'),     'RoleOnboarding')
const InviteAccept        = named(() => import('./routes/council/InviteAccept'),     'InviteAccept')
const CouncilDisputeDetail= named(() => import('./routes/council/CouncilDisputeDetail'),'CouncilDisputeDetail')

const Privacy = named(() => import('./routes/legal/Legal/Privacy'), 'Privacy')
const Terms   = named(() => import('./routes/legal/Legal/Terms'),   'Terms')
const Imprint = named(() => import('./routes/legal/Legal/Imprint'), 'Imprint')
const Contact = named(() => import('./routes/legal/Legal/Contact'), 'Contact')

const PrivateOfferDetailPage = named(() => import('./routes/messages/PrivateOfferDetailPage'), 'PrivateOfferDetailPage')
const Messages               = named(() => import('./routes/messages/Messages'),               'Messages')

const HelpLanding = named(() => import('./routes/help/HelpLanding'), 'HelpLanding')
const HelpSection = named(() => import('./routes/help/HelpSection'),  'HelpSection')

const AboutPage    = named(() => import('./routes/about/AboutPage'),       'AboutPage')
const FeaturesPage = named(() => import('./routes/features/FeaturesPage'), 'FeaturesPage')
const PricingPage  = named(() => import('./routes/pricing/PricingPage'),   'PricingPage')
const RoadmapPage  = named(() => import('./routes/roadmap/RoadmapPage'),   'RoadmapPage')

// ─── Route Loaders ────────────────────────────────────────────────────────────

function requireAuth() {
  if (!localStorage.getItem('pubkey')) {
    // ADR-303 D10: forward the requested URL as `returnTo` so the login flow
    // (TabNostr/TabLightning/TabNsec/TabEmail/TabNostrConnect/DemoLoginSection)
    // can send the user back to the action they were trying to take. Same-origin
    // guard: only forward the path + search, never the hash.
    const returnTo = window.location.pathname + window.location.search
    return redirect(`/login${returnTo && returnTo !== '/' ? `?next=${encodeURIComponent(returnTo)}` : ''}`)
  }
  return null
}

async function onboardingLoader() {
  const pubkey = localStorage.getItem('pubkey')
  if (!pubkey || pubkey === 'undefined' || pubkey === 'null') return null

  if (localStorage.getItem('hasCompletedOnboarding') === 'true') return null

  try {
    const r = await fetch(`/api/company/${pubkey}`)
    const data = await r.json()
    if (data.company) {
      localStorage.setItem('hasCompletedOnboarding', 'true')
      return null
    }
    return redirect('/onboarding/welcome')
  } catch {
    return redirect('/onboarding/welcome')
  }
}

// ─── Layout Route Elements ────────────────────────────────────────────────────

/** Root wrapper: Lenis replaces ScrollRestoration for smooth scroll */
function RootLayout() {
  // initSmoothScroll() is called once here so it runs on every route.
  // Safe to call multiple times — returns the existing instance.
  initSmoothScroll()
  useDefaultLocationPreference()
  return (
    <>
      <ScrollToTop />
      <Outlet />
    </>
  )
}

/** Auth-protected layout: loader guards, Layout wraps content */
function AuthLayout() {
  return <Layout><Outlet /></Layout>
}

/** Public layout: no auth check, Layout wraps content */
function PublicLayout() {
  return <Layout><Outlet /></Layout>
}

/** Redirect /offers/:offerId → /buy/product/:offerId */
function OfferDetailRedirect() {
  const { offerId } = useParams<{ offerId: string }>()
  return <Navigate to={`/buy/product/${offerId}`} replace />
}

/** ADR-336: legacy /tasks* → /bounties* redirects, preserving the query
 *  string (e.g. CoopGuide's `?agentSupervision=`, `?filter=mine`) so old
 *  links/bookmarks keep working exactly as before. */
function BountyLegacyRedirect({ suffix = '' }: { suffix?: string }) {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const path = suffix === ':id' ? `/bounties/${id}` : `/bounties${suffix}`
  return <Navigate to={`${path}${location.search}`} replace />
}

/** ADR-368 D1/D2: legacy /sell/listings deep links that pointed at the moved
 *  Cooperate surfaces (`?tab=stack`, `?filter=services|agents`) redirect to
 *  /coop/manage; every other listing state renders SellListings untouched. */
function SellListingsLegacyRedirect() {
  const [searchParams] = useSearchParams()
  const tab = searchParams.get('tab')
  const filter = searchParams.get('filter')
  const target = tab === 'stack'
    ? '/coop/manage?tab=stack'
    : filter === 'services'
      ? '/coop/manage?tab=services'
      : filter === 'agents'
        ? '/coop/manage?tab=stack'
        : null
  if (target) return <Navigate to={target} replace />
  return <S component={SellListings} />
}

/** ADR-368 D1: /sell/agents/:id/edit moved to /coop/agents/:id/edit. */
function AgentEditRedirect() {
  const { id } = useParams<{ id: string }>()
  return <Navigate to={`/coop/agents/${id}/edit`} replace />
}

/** ADR-367 D4: /buy/vendors/:pubkey (a third, accidental vendor-detail view) →
 *  the company's canonical /c/:companyId when a Company exists for the pubkey,
 *  else the user's /u/:pubkey. Resolves pubkey → companyId via useCompany. */
function VendorDetailRedirect() {
  const { id } = useParams<{ id: string }>()
  const { data: company, isLoading } = useCompany(id ?? '')
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <CircularProgress />
      </div>
    )
  }
  if (company?.id) return <Navigate to={`/c/${company.id}`} replace />
  return <Navigate to={`/u/${id}`} replace />
}

/** Lazy wrapper for routes that need Suspense (nested without Suspense boundary) */
function S({ component: C }: { component: React.ComponentType<any> }) {
  return <Suspense fallback={<PageLoader />}><C /></Suspense>
}

// ─── Router ───────────────────────────────────────────────────────────────────

const router = createBrowserRouter([
  {
    // Pathless root route: catches unmatched-URL 404s AND thrown loader/render
    // errors globally via errorElement (see ADR-185).
    element: <RootLayout />,
    errorElement: <ErrorBoundary />,
    children: [

  // ── Auth ──────────────────────────────────────────────────────────────────
  { path: '/login',            element: <Suspense fallback={null}><Login /></Suspense> },
  { path: '/login/demo',       element: <Suspense fallback={null}><DemoLogin /></Suspense> },
  { path: '/login/alby/error', element: <Suspense fallback={null}><LoginAlbyError /></Suspense> },

  // ── Onboarding (ADR-036) ──────────────────────────────────────────────────
  { path: '/onboarding',                    element: <Navigate to="/onboarding/welcome" replace /> },
  { path: '/onboarding/welcome',            element: <Suspense fallback={null}><OnboardingWelcome /></Suspense> },
  { path: '/onboarding/features',           element: <Suspense fallback={null}><OnboardingFeatures /></Suspense> },
  { path: '/onboarding/creator',            element: <Suspense fallback={null}><OnboardingCreator /></Suspense> },
  { path: '/onboarding/creator/company',    element: <Suspense fallback={null}><OnboardingCreator /></Suspense> },
  // ADR-225 D1: sovereign, browser-only Nostr keygen + L1-claim auto-continue.
  { path: '/onboarding/generate-nostr-key', element: <Suspense fallback={null}><GenerateNostrKey /></Suspense> },

  // ── Home (ADR-037) – public with onboarding check ─────────────────────────
  {
    element: <PublicLayout />,
    loader: onboardingLoader,
    children: [
      { path: '/', element: <S component={Home} /> },
    ],
  },

  // ── Auth-protected routes ─────────────────────────────────────────────────
  {
    element: <AuthLayout />,
    loader: requireAuth,
    children: [
      // Home extensions
      { path: '/account',      element: <S component={Account} /> },
      { path: '/settings',     element: <S component={Settings} /> },
      { path: '/wallet',       element: <S component={WalletDashboard} /> },
      { path: '/wallet/send',  element: <S component={WalletSend} /> },
      { path: '/notifications',element: <S component={Notifications} /> },
      { path: '/ai',           element: <S component={AIAssistantPage} /> },

      // ADR-319 / FU-428: Bounty Board — posting a bounty is an action route; browsing/detail live in the public branch (ADR-303 D9)
      { path: '/bounties/new', element: <S component={CreateBountyPage} /> },
      // ADR-336: legacy /tasks* redirects for anyone with an old link/bookmark
      { path: '/tasks/new',    element: <BountyLegacyRedirect suffix="/new" /> },

      // Buy — personal/action routes only; the read tier lives in the public branch (ADR-303 D9)
      { path: '/buy/cart',                                         element: <S component={BuyCartFlow} /> },
      { path: '/buy/orders',                                       element: <S component={BuyOrders} /> },

      // Sell (ADR-031, ADR-032)
      { path: '/sell',                                                    element: <S component={SellDashboard} /> },
      { path: '/sell/company',                                            element: <S component={SellCompany} /> },
      { path: '/sell/company/setup',                                      element: <S component={SellCompanySetup} /> },
      { path: '/sell/company/fields',                                     element: <S component={SellCompanyFields} /> },
      { path: '/sell/company/terms',                                      element: <S component={SellCompanyTerms} /> },
      { path: '/sell/company/availability',                               element: <S component={SellCompanyAvailability} /> },
      { path: '/sell/company/delivery-templates',                         element: <S component={SellDeliveryTemplates} /> },
      { path: '/sell/company/collections',                                element: <S component={SellCollections} /> },
      { path: '/sell/company/shipping-options',                           element: <S component={SellShippingOptions} /> },
      { path: '/sell/catalog',                                            element: <Navigate to="/sell/listings?tab=catalogs" replace /> },
      { path: '/sell/catalog/new',                                        element: <Navigate to="/sell/listings?tab=catalogs&create=catalog" replace /> },
      { path: '/sell/catalog/:catalogId/categories/new',                  element: <S component={SellCategoryDetail} /> },
      { path: '/sell/catalog/:catalogId/categories/:categoryId',          element: <S component={SellCategoryDetail} /> },
      { path: '/sell/catalog/:catalogId/products',                        element: <Navigate to="/sell/listings?tab=catalogs" replace /> },
      { path: '/sell/catalog/:catalogId/products/new',                    element: <S component={SellProductDetail} /> },
      { path: '/sell/catalog/:catalogId/products/:productId',             element: <S component={SellProductDetail} /> },
      { path: '/sell/products',                                           element: <Navigate to="/sell/listings?tab=products" replace /> },
      { path: '/sell/products/new',                                       element: <S component={CreateProductPage} /> },
      // ADR-395: edit a company product that has no catalog.
      { path: '/sell/products/:productId',                                element: <S component={SellProductDetail} /> },
      { path: '/sell/listings/new',                                       element: <S component={() => <CreateOfferPage mode="listings" />} /> },
      // ADR-368 D1: agent create/edit routes moved to /coop/agents* (the
      // Sell paths stay as legacy redirects). /sell/listings mounts through
      // the legacy guard so ?tab=stack / ?filter=services|agents deep links
      // redirect to Cooperate Manage instead of silently falling back.
      { path: '/coop/agents/new',                                         element: <S component={CreateAgentPage} /> },
      { path: '/coop/agents/:id/edit',                                    element: <S component={EditAgentWizard} /> },
      { path: '/sell/agents/new',                                         element: <Navigate to="/coop/agents/new" replace /> },
      { path: '/sell/agents/:id/edit',                                    element: <AgentEditRedirect /> },
      { path: '/sell/agents',                                             element: <Navigate to="/coop/manage?tab=stack" replace /> },
      { path: '/agents/roster',                                           element: <Navigate to="/coop/manage?tab=stack" replace /> },
      { path: '/sell/offers',                                             element: <Navigate to="/sell/listings" replace /> },
      { path: '/sell/listings',                                           element: <SellListingsLegacyRedirect /> },
      { path: '/sell/listings/:listingId',                                element: <S component={SellListingDetail} /> },
      { path: '/sell/bookings',                                           element: <S component={SellBookings} /> },
      { path: '/sell/services',                                           element: <Navigate to="/coop/manage?tab=services" replace /> },
      { path: '/sell/services/new',                                       element: <Navigate to="/offers/new?type=service" replace /> },
      { path: '/sell/services/:serviceId',                                element: <Navigate to="/coop/manage?tab=services" replace /> },

      // Coop — personal/action routes only; the read tier lives in the public branch (ADR-303 D9)
      { path: '/coop/overview',           element: <S component={CoopOverview} /> },
      { path: '/coop/guide',              element: <S component={CoopGuide} /> },
      { path: '/coop/networks/new',       element: <S component={CoopNetworkDetail} /> },
      { path: '/coop/projects/new',       element: <Navigate to="/coop/guide?role=corporate&type=projects&action=create" replace /> },
      { path: '/coop/tenders/new',        element: <Navigate to="/coop/guide?role=corporate&type=tenders&action=create" replace /> },
      // ADR-368 D1: /coop/manage replaces the standalone /coop/offers page.
      { path: '/coop/offers',             element: <Navigate to="/coop/manage?tab=cooperations" replace /> },
      { path: '/coop/manage',             element: <S component={CoopManage} /> },
      { path: '/coop/delivery',           element: <S component={CoopDelivery} /> },
      { path: '/coop/tickets',            element: <S component={CoopTickets} /> },

      // Legacy compat
      { path: '/offers/new',        element: <S component={CreateOfferPage} /> },
      { path: '/services/new',      element: <S component={CreateServicePage} /> },
      { path: '/tickets',           element: <S component={Tickets} /> },
      { path: '/tickets/:ticketId', element: <S component={TicketDetail} /> },

      // ADR-311/326: Agent Workspace minimal status bridge (FU-447)
      { path: '/workspaces/:workspaceId', element: <S component={WorkspaceDetail} /> },

      // ADR-355-362: Escrow Trade Desk — gated behind VITE_ESCROW_TRADE_DESK (FU-662).
      ...(ESCROW_TRADE_DESK_ENABLED ? [
        // ADR-355 / ADR-362: list + read-only cockpit (P2)
        { path: '/trade', element: <S component={TradeDesk} /> },
        // ADR-357: start-a-trade wizard (P3 minimal slice) — static, so it wins over :tradeId
        { path: '/trade/new', element: <S component={NewTrade} /> },
        { path: '/trade/:tradeId', element: <S component={TradeCockpit} /> },
        // ADR-360: ISO 20022 interop view (P6)
        { path: '/trade/:tradeId/interop', element: <S component={TradeInterop} /> },
      ] : []),

      // Messages (ADR-152: Phase 2.3)
      { path: '/messages/offers/:id', element: <S component={PrivateOfferDetailPage} /> },
      { path: '/messages',            element: <S component={Messages} /> },

      // Council
      { path: '/council/invite/accept', element: <S component={InviteAccept} /> },

      // v2-Stubs (ADR-038)
      { path: '/statistics',     element: <S component={Statistics} /> },
      { path: '/feedback',       element: <S component={Feedback} /> },
      { path: '/media',          element: <S component={Media} /> },
      { path: '/media/:mediaId', element: <S component={MediaDetail} /> },

      // DAO Governance (ADR-128 / ADR-149)
      { path: '/dao',        element: <S component={DaoDiscovery} /> },
      { path: '/dao/create', element: <S component={DaoCreateWizard} /> },
      {
        path: '/dao/:id',
        element: <Suspense fallback={<PageLoader />}><DaoLayout /></Suspense>,
        children: [
          { index: true,                      element: <S component={DaoDashboard} /> },
          { path: 'profile',                  element: <S component={DaoProfile} /> },
          { path: 'council',                  element: <S component={DaoCouncil} /> },
          { path: 'council/disputes/:did',    element: <S component={CouncilDisputeDetail} /> },
          { path: 'admin',                    element: <S component={DaoAdmin} /> },
          { path: 'admin/members',            element: <S component={DaoAdmin} /> },
          { path: 'admin/config',             element: <S component={DaoAdmin} /> },
          { path: 'admin/bootstrap',          element: <S component={DaoAdmin} /> },
          { path: 'admin/governance',         element: <S component={DaoAdmin} /> },
          { path: 'codex-settings',           element: <S component={DaoCodexSettings} /> },
          { path: 'proposals/new',            element: <S component={DaoCreate} /> },
          { path: 'proposals/:pid',           element: <S component={DaoProposalDetail} /> },
        ],
      },
    ],
  },

  // ── Admin Backend — own layout, no Navbar/Footer (ADR-198) ──────────────
  {
    path: '/admin',
    element: <Suspense fallback={<PageLoader />}><AdminLayout /></Suspense>,
    children: [
      { index: true,            element: <Navigate to="/admin/overview" replace /> },
      { path: 'overview',       element: <S component={AdminOverview} /> },
      { path: 'accounts',       element: <S component={AdminAccounts} /> },
      { path: 'newsletter',     element: <S component={AdminNewsletter} /> },
      { path: 'feedback',       element: <S component={AdminFeedback} /> },
      { path: 'beta',           element: <S component={AdminBeta} /> },
      { path: 'entities',       element: <S component={AdminEntities} /> },
      { path: 'remote-candidates', element: <S component={AdminRemoteCandidates} /> },
      { path: 'agents',          element: <S component={AdminAgents} /> },
      { path: 'launch-readiness', element: <S component={AdminLaunchReadiness} /> },
      { path: 'mcp-connections', element: <S component={AdminMcpConnections} /> },
      { path: 'settings',       element: <S component={AdminCommerceSettings} /> },
      { path: 'foundation-bootstrap', element: <S component={AdminFoundationBootstrap} /> },
      { path: 'schema',         element: <S component={AdminSchema} /> },
    ],
  },

  // ── Public routes with Layout (ADR-082, ADR-125) ──────────────────────────
  {
    element: <PublicLayout />,
    children: [
      // Public read tier (ADR-303 D9): read-only discovery, actions gated client-side via requireLogin (D10)
      { path: '/search',       element: <S component={Search} /> },
      { path: '/u/:pubkey',    element: <S component={UserProfile} /> },
      { path: '/c/:companyId', element: <S component={CompanyProfile} /> },

      // ADR-355 / ADR-356: Escrow Trade Desk — public, unauthenticated trust
      // surface. Gated with the rest of /trade/* (FU-662) — verification is
      // meaningless without a deployed canister to verify against.
      ...(ESCROW_TRADE_DESK_ENABLED ? [
        { path: '/trade/verify',           element: <S component={TradeVerify} /> },
        { path: '/trade/verify/:canisterId', element: <S component={TradeVerify} /> },
      ] : []),
      { path: '/partners',     element: <Navigate to="/coop?filter=partners" replace /> },

      // ADR-319 / FU-428: Bounty board. ADR-368 D1: the "My Bounties" board
      // is now the bounties tab of /coop/manage (auth-gated); /bounties
      // redirects there. Detail stays public; posting lives in the auth branch.
      { path: '/bounties',     element: <Navigate to="/coop/manage?tab=bounties" replace /> },
      { path: '/bounties/:id', element: <S component={BountyDetail} /> },
      // ADR-336: legacy /tasks* redirects for anyone with an old link/bookmark
      { path: '/tasks',        element: <BountyLegacyRedirect /> },
      { path: '/tasks/:id',    element: <BountyLegacyRedirect suffix=":id" /> },

      // Buy (ADR-029, ADR-030)
      { path: '/buy',                                              element: <S component={BuyDashboard} /> },
      { path: '/buy/categories',                                   element: <S component={BuyCategories} /> },
      { path: '/buy/categories/:categoryId/products',              element: <S component={BuyCategoryProducts} /> },
      { path: '/buy/categories/:categoryId/products/filter',       element: <S component={BuyCategoryProducts} /> },
      { path: '/buy/product/:productId',                           element: <S component={BuyProductDetail} /> },
      { path: '/buy/vendors',                                      element: <Navigate to="/buy?tab=vendors" replace /> },
      { path: '/buy/vendors/:id',                                  element: <VendorDetailRedirect /> },
      { path: '/buy/map',                                          element: <S component={BuyMap} /> },

      // Coop (ADR-033–035, ADR-110, ADR-218)
      { path: '/coop',                    element: <S component={CoopExplore} /> },
      { path: '/coop/vendors',            element: <Navigate to="/coop?filter=vendors" replace /> },
      { path: '/coop/vendors/:vendorId',  element: <S component={CoopVendorDetail} /> },
      { path: '/coop/partners',           element: <Navigate to="/coop?filter=partners" replace /> },
      { path: '/coop/partners/:partnerId',element: <S component={CoopPartnerDetail} /> },
      { path: '/coop/networks',           element: <Navigate to="/coop?filter=networks" replace /> },
      { path: '/coop/networks/:networkId',element: <S component={CoopNetworkDetail} /> },
      { path: '/coop/projects',           element: <Navigate to="/coop?filter=projects" replace /> },
      { path: '/coop/projects/:projectId',element: <Navigate to="/coop/:projectId" replace /> },
      { path: '/coop/tenders',            element: <Navigate to="/coop?filter=tenders" replace /> },
      { path: '/coop/tenders/:tenderId',  element: <Navigate to="/coop/:tenderId" replace /> },
      { path: '/coop/offers/:offerId',    element: <Navigate to="/coop/:offerId" replace /> },
      { path: '/coop/templates',          element: <S component={CoopTemplates} /> },
      { path: '/coop/templates/:templateId', element: <S component={CoopTemplateDetail} /> },
      { path: '/coop/:id',                element: <S component={CoopDetail} /> },

      // ADR-371 — /ai/connect is public (auth-aware): guests reach the read-only
      // MCP explainer + login CTA; logged-in users mint/manage connections.
      { path: '/ai/connect',      element: <S component={AIConnectPage} /> },

      // Legacy compat — redirects into the public tier
      { path: '/offers/:offerId',   element: <OfferDetailRedirect /> },

      { path: '/about',                  element: <S component={AboutPage} /> },
      { path: '/features',              element: <S component={FeaturesPage} /> },
      { path: '/pricing',               element: <S component={PricingPage} /> },
      { path: '/roadmap',               element: <S component={RoadmapPage} /> },
      { path: '/about/foundation',      element: <S component={AboutFoundation} /> },
      { path: '/about/codex',           element: <S component={DaoCodex} /> },
      { path: '/about/role-onboarding', element: <S component={RoleOnboarding} /> },
      { path: '/legal/help',            element: <Navigate to="/help" replace /> },
      { path: '/help',                  element: <S component={HelpLanding} /> },
      { path: '/help/:sectionId',       element: <S component={HelpSection} /> },
      { path: '/legal/privacy',         element: <S component={Privacy} /> },
      { path: '/legal/terms',           element: <S component={Terms} /> },
      { path: '/legal/imprint',         element: <S component={Imprint} /> },
      { path: '/legal/contact',         element: <Navigate to="/contact" replace /> },
      { path: '/contact',               element: <S component={Contact} /> },
    ],
  },
    ],
  },
])

// ─── App ──────────────────────────────────────────────────────────────────────

export function App() {
  return (
    <NotificationProvider>
    <MobileNavHeaderProvider>
    <LocaleProvider>
    <CurrencyProvider>
    <WalletProvider>
    <CashuProvider>
    <ModalProvider>
    <FABProvider>
    <CartProvider>
      <RouterProvider router={router} />
    </CartProvider>
    </FABProvider>
    </ModalProvider>
    </CashuProvider>
    </WalletProvider>
    </CurrencyProvider>
    </LocaleProvider>
    </MobileNavHeaderProvider>
    </NotificationProvider>
  )
}

export default App
