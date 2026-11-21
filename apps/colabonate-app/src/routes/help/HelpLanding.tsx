import { useState, useMemo, useCallback } from 'react'
import { HelpCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Typography,
  Tooltip,
} from '@mui/material'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import ShoppingCart from '@mui/icons-material/ShoppingCart'
import Store from '@mui/icons-material/Store'
import Handshake from '@mui/icons-material/Handshake'
import SearchIcon from '@mui/icons-material/Search'
import Star from '@mui/icons-material/Star'
import Business from '@mui/icons-material/Business'
import GridView from '@mui/icons-material/GridView'
import Fingerprint from '@mui/icons-material/Fingerprint'
import FactCheck from '@mui/icons-material/FactCheck'
import AccountTree from '@mui/icons-material/AccountTree'
import AccountBalance from '@mui/icons-material/AccountBalance'
import ConfirmationNumber from '@mui/icons-material/ConfirmationNumber'
import CurrencyBitcoin from '@mui/icons-material/CurrencyBitcoin'
import Check from '@mui/icons-material/Check'
import RocketLaunch from '@mui/icons-material/RocketLaunch'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { Seo } from '../../components/Seo'
import { cn } from '@ds/utils'
import { SearchInput } from '../../components/ui/SearchInput'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { HELP_SECTIONS, HELP_FAQ, getAllArticles } from './helpData'
import { HelpCategoryCard } from './HelpCategoryCard'

interface QuickStep {
  label: string
  tooltip: string
}

const FAQ_FLOW_STEPS: Record<string, QuickStep[]> = {
  'faq-1': [
    { label: 'Sell', tooltip: 'Go to the Sell section' },
    { label: 'New Listing', tooltip: 'Click "New Listing" button' },
    { label: 'Fill Details', tooltip: 'Add title, price, images' },
    { label: 'Publish', tooltip: 'Review and publish your offer' },
  ],
  'faq-2': [
    { label: 'L0', tooltip: 'Anonymous — basic access' },
    { label: 'L1', tooltip: 'Nostr key confirmed — takes 10 seconds' },
    { label: 'L2', tooltip: 'Peer verified — get vouched by 3 users' },
    { label: 'L3', tooltip: 'Biometric HID — highest trust tier' },
  ],
  'faq-3': [
    { label: 'Pay', tooltip: 'Buyer sends payment to hold invoice' },
    { label: 'Hold', tooltip: 'Funds locked in escrow' },
    { label: 'Work', tooltip: 'Provider delivers the work' },
    { label: 'Release', tooltip: 'Buyer confirms, funds released' },
  ],
  'faq-4': [
    { label: 'Role', tooltip: 'Corporate or Private' },
    { label: 'Type', tooltip: 'Project, Tender, or Offer' },
    { label: 'Model', tooltip: 'WHOLE or PER_MILESTONE' },
    { label: 'Publish', tooltip: 'Publish to the network' },
  ],
  'faq-5': [
    { label: 'Tickets', tooltip: 'Open the Tickets section' },
    { label: 'Find Order', tooltip: 'Locate your active order' },
    { label: 'Check Status', tooltip: 'Monitor milestone progress' },
    { label: 'Approve', tooltip: 'Confirm completion to release escrow' },
  ],
  'faq-6': [
    { label: 'Private Key', tooltip: 'Secret — signs every action, keep it safe' },
    { label: 'Public Key', tooltip: 'Your visible identity, like a username' },
    { label: 'Signing', tooltip: 'Private key authorizes logins and events' },
    { label: 'No Server', tooltip: 'Colabonate never sees or stores your private key' },
  ],
  'faq-7': [
    { label: 'Custodial', tooltip: 'A third party holds the wallet key for you' },
    { label: 'Non-custodial', tooltip: 'Your own wallet — you hold the keys' },
    { label: 'Direct-Pay', tooltip: 'Buyers pay your own Lightning rail directly' },
    { label: 'Settings', tooltip: 'Connect your receiving rail under Settings → Wallet' },
  ],
  'faq-8': [
    { label: 'Install', tooltip: 'Add a NIP-07 extension like Alby' },
    { label: 'Login', tooltip: 'Approve the signing prompt' },
    { label: 'Sign', tooltip: 'Extension signs a challenge — key never leaves' },
    { label: 'Verify', tooltip: 'Colabonate checks the signature' },
  ],
}

type FeatureCategory = 'buy' | 'sell' | 'coop'

interface MainCardDef {
  id: FeatureCategory
  icon: React.ReactNode
  title: string
  subtitle: string
  description: string
  color: string
  bg: string
  iconBg: string
  iconColor: string
}

interface FeatureDef {
  id: string
  icon: React.ReactNode
  title: string
  description: string
  tags: FeatureCategory[]
  flow?: string[]
}

const WHY_MAIN_CARDS: MainCardDef[] = [
  {
    id: 'buy',
    icon: <ShoppingCart sx={{ fontSize: 26 }} />,
    title: 'Buy',
    subtitle: 'Discover & shop',
    description: 'Find products and services nearby and pay directly — no intermediaries.',
    color: 'var(--color-accent-1)',
    bg: 'color-mix(in srgb, var(--color-accent-1) 8%, transparent)',
    iconBg: 'color-mix(in srgb, var(--color-accent-1) 12%, transparent)',
    iconColor: 'color-mix(in srgb, var(--color-accent-1) 85%, transparent)',
  },
  {
    id: 'sell',
    icon: <Store sx={{ fontSize: 26 }} />,
    title: 'Sell',
    subtitle: 'Offer & grow',
    description: 'Showcase your offers, manage catalogs and build a verifiable reputation.',
    color: 'var(--color-primary-50)',
    bg: 'color-mix(in srgb, var(--color-primary-50) 8%, transparent)',
    iconBg: 'color-mix(in srgb, var(--color-primary-50) 12%, transparent)',
    iconColor: 'color-mix(in srgb, var(--color-primary-50) 85%, transparent)',
  },
  {
    id: 'coop',
    icon: <Handshake sx={{ fontSize: 26 }} />,
    title: 'Cooperate',
    subtitle: 'Collaborate & scale',
    description: 'Find partners, close fair contracts and realize joint projects — open source and decentralized.',
    color: 'var(--color-accent-3)',
    bg: 'color-mix(in srgb, var(--color-accent-3) 8%, transparent)',
    iconBg: 'color-mix(in srgb, var(--color-accent-3) 12%, transparent)',
    iconColor: 'color-mix(in srgb, var(--color-accent-3) 85%, transparent)',
  },
]

const WHY_FEATURES: FeatureDef[] = [
  {
    id: 'local-providers',
    icon: <SearchIcon sx={{ fontSize: 18 }} />,
    title: 'Local Providers',
    description: 'Browse categories and discover providers and offers in your area.',
    tags: ['buy'],
    flow: ['Browse', 'Filter', 'Connect', 'Pay'],
  },
  {
    id: 'reviews',
    icon: <Star sx={{ fontSize: 18 }} />,
    title: 'Reviews & Trust',
    description: 'Real reviews from verified buyers help you make informed decisions.',
    tags: ['buy'],
    flow: ['Find', 'Read', 'Verify', 'Trust'],
  },
  {
    id: 'business-profile',
    icon: <Business sx={{ fontSize: 18 }} />,
    title: 'Business Profile',
    description: 'Create your creator profile with opening hours, contact info and branding.',
    tags: ['sell'],
    flow: ['Create', 'Add Info', 'Brand', 'Publish'],
  },
  {
    id: 'catalogs',
    icon: <GridView sx={{ fontSize: 18 }} />,
    title: 'Catalogs & Categories',
    description: 'Organize your products and services into searchable, structured catalogs.',
    tags: ['sell'],
    flow: ['Organize', 'Categorize', 'List', 'Update'],
  },
  {
    id: 'find-partners',
    icon: <Handshake sx={{ fontSize: 18 }} />,
    title: 'Find Partners',
    description: 'Discover providers with complementary skills for joint ventures.',
    tags: ['coop'],
    flow: ['Search', 'Match', 'Contact', 'Team Up'],
  },
  {
    id: 'hid',
    icon: <Fingerprint sx={{ fontSize: 18 }} />,
    title: 'Human Identity (HID)',
    description: 'Your unique, decentralized identity — no fake profiles, only real people. Verified through biometric proof and peer validation.',
    tags: ['buy', 'sell', 'coop'],
    flow: ['L0: Anonymous', 'L1: Nostr Key', 'L2: Peer Vouch', 'L3: Biometric'],
  },
  {
    id: 'wallet',
    icon: <CurrencyBitcoin sx={{ fontSize: 18 }} />,
    title: 'BTC / Lightning Wallet',
    description: 'Send and receive payments instantly via Bitcoin Lightning — user to user, no bank required. Built on a secure Bitcoin L2 infrastructure.',
    tags: ['buy', 'sell', 'coop'],
    flow: ['Open', 'Fund', 'Send', 'Receive'],
  },
  {
    id: 'smart-contracts',
    icon: <FactCheck sx={{ fontSize: 18 }} />,
    title: 'Smart Contracts',
    description: 'Trustless agreements with automated payments and conditional releases — enforced on-chain, no middleman.',
    tags: ['coop'],
    flow: ['Define', 'Sign', 'Execute', 'Release'],
  },
  {
    id: 'tickets',
    icon: <ConfirmationNumber sx={{ fontSize: 18 }} />,
    title: 'Tickets & Milestones',
    description: 'Structure projects into transparent phases with AI-assisted monitoring and automated payouts per milestone.',
    tags: ['coop'],
    flow: ['Create', 'Fund Escrow', 'Work', 'Approve'],
  },
  {
    id: 'workflows',
    icon: <AccountTree sx={{ fontSize: 18 }} />,
    title: 'Workflows & Protocols',
    description: 'Use standardized processes from the community or create your own — all open source and community-governed.',
    tags: ['coop'],
    flow: ['Choose', 'Customize', 'Run', 'Improve'],
  },
  {
    id: 'dao',
    icon: <AccountBalance sx={{ fontSize: 18 }} />,
    title: 'DAO Governance',
    description: 'Communities can form their own DAOs — one person, one vote. Governed by the Colabonate Codex, fully open source.',
    tags: ['coop'],
    flow: ['Propose', 'Vote', 'Implement', 'Audit'],
  },
]

function WhyColabonateSection() {
  const [expandedFeature, setExpandedFeature] = useState<string | null>(null)
  const [showFeatureGrid, setShowFeatureGrid] = useState(false)

  const getFeatureStyles = useCallback((tags: FeatureCategory[]) => {
    if (tags.includes('buy')) {
      return WHY_MAIN_CARDS.find(m => m.id === 'buy')!
    } else if (tags.includes('sell')) {
      return WHY_MAIN_CARDS.find(m => m.id === 'sell')!
    } else if (tags.includes('coop')) {
      return WHY_MAIN_CARDS.find(m => m.id === 'coop')!
    }
    return WHY_MAIN_CARDS[0]!
  }, [])

  return (
    <section aria-label="Why Colabonate" className="relative mt-10">
      <div className="flex items-center gap-3 mb-8">
        <div
          className="flex items-center justify-center w-10 h-10 shrink-0 rounded-xl"
          style={{ background: 'color-mix(in srgb, var(--color-primary-50) 10%, transparent)', color: 'var(--color-primary-50)' }}
        >
          <CurrencyBitcoin sx={{ fontSize: 24 }} />
        </div>
        <div>
          <h3 className="!my-0">
            Why Colabonate?
          </h3>
          <p className="text-[length:var(--typography-paragraph-small-regular-fontSize)] mt-1" style={{ color: 'var(--theme-text-muted)' }}>
            Decentral commerce powered by Bitcoin
          </p>
        </div>
      </div>

      <div className="grid w-full grid-cols-1 gap-4 mb-8 md:grid-cols-3">
        {WHY_MAIN_CARDS.map((card) => {
          return (
            <div
              key={card.id}
              className={cn(
                'relative flex flex-col items-center p-6 pt-9 pb-6 rounded-xl border text-center min-h-50',
                'shadow-lg',
              )}
              style={{
                border: `2px solid ${card.color}`,
                background: card.bg,
              }}
            >
              <div
                className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: card.color, color: 'var(--color-neutral-white)' }}
              >
                <Check sx={{ fontSize: 12 }} />
              </div>
              <div
                className="flex items-center justify-center mb-4 w-14 h-14 rounded-2xl"
                style={{ background: card.iconBg, color: card.iconColor }}
              >
                {card.icon}
              </div>
              <div className="flex flex-col items-center min-w-0">
                <h4 className="!my-0">
                  {card.title}
                </h4>
                <p className="text-[length:var(--typography-paragraph-small-regular-fontSize)] mb-1" style={{ color: 'var(--theme-text-muted)' }}>
                  {card.subtitle}
                </p>
                <p className="text-[length:var(--typography-paragraph-small-regular-fontSize)] mt-1.5 mb-0" style={{ color: 'var(--theme-text-muted)' }}>
                  {card.description}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h4 className="!my-0">
              All Features
            </h4>
            <p className="text-[length:var(--typography-paragraph-small-regular-fontSize)] mt-0.5" style={{ color: 'var(--theme-text-muted)' }}>
              A quick overview of everything Colabonate offers
            </p>
          </div>
          <button
            onClick={() => setShowFeatureGrid(prev => !prev)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[length:var(--typography-paragraph-xsmall-heavy-fontSize)] cursor-pointer transition-all duration-150 shrink-0"
            style={{
              background: 'var(--theme-surface)',
              color: 'var(--theme-text-muted)',
              border: '1px solid var(--theme-border)',
            }}
          >
            {showFeatureGrid ? 'Hide' : 'Show'}
            <svg 
              width="12" 
              height="12" 
              viewBox="0 0 24 24" 
              fill="none" 
              style={{ 
                color: 'var(--theme-text-muted)',
                transform: showFeatureGrid ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
              }}
            >
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {!showFeatureGrid && (
          <div className="flex flex-wrap gap-2 mt-4 mb-4">
            {WHY_FEATURES.map((fc) => {
              const mainCard = getFeatureStyles(fc.tags)
              return (
                <button
                  key={fc.id}
                  type="button"
                  onClick={() => {
                    setShowFeatureGrid(true)
                    setExpandedFeature(fc.id)
                  }}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[length:var(--typography-paragraph-xsmall-heavy-fontSize)] cursor-pointer transition-all duration-150 hover:opacity-80"
                  style={{
                    background: mainCard.bg,
                    color: mainCard.color,
                    border: `1px solid ${mainCard.color}40`,
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: mainCard.color }}
                  />
                  {fc.title}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {showFeatureGrid && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {WHY_FEATURES.map((fc) => {
          const mainCard = getFeatureStyles(fc.tags)
          const isExpanded = expandedFeature === fc.id

          return (
            <button
              key={fc.id}
              onClick={() => { setExpandedFeature(prev => prev === fc.id ? null : fc.id) }}
              className={cn(
                'flex flex-col p-5 rounded-xl border cursor-pointer transition-all duration-200 text-left',
                'hover:-translate-y-0.5 active:scale-[0.98]',
              )}
              style={{
                border: isExpanded ? `2px solid ${mainCard.color}` : `1px solid color-mix(in srgb, ${mainCard.color} 31%, transparent)`,
                background: mainCard.bg,
                boxShadow: isExpanded ? `0 4px 12px color-mix(in srgb, ${mainCard.color} 15%, transparent)` : 'none',
              }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="flex items-center justify-center w-10 h-10 transition-colors duration-200 rounded-xl shrink-0"
                  style={{
                    background: `color-mix(in srgb, ${mainCard.color} 13%, transparent)`,
                    color: mainCard.iconColor,
                  }}
                >
                  {fc.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="!my-0" style={{ color: 'var(--theme-text)' }}>
                    {fc.title}
                  </h4>
                  <p className="text-[length:var(--typography-paragraph-xsmall-regular-fontSize)] mt-1 mb-0" style={{ color: 'var(--theme-text-muted)' }}>
                    {fc.description}
                  </p>
                </div>
              </div>
              
              {fc.flow && (
                <div className="flex items-center gap-1.5 flex-wrap mt-3 pt-3 border-t" style={{ borderColor: `color-mix(in srgb, ${mainCard.color} 19%, transparent)` }}>
                  <span className="text-[length:var(--typography-paragraph-xsmall-regular-fontSize)] uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                    Flow:
                  </span>
                  {fc.flow.slice(0, 4).map((step, index) => (
                    <div key={index} className="flex items-center gap-1">
                      <div
                        className="px-2 py-0.5 rounded-md text-[length:var(--typography-paragraph-xsmall-regular-fontSize)]"
                        style={{
                          background: `color-mix(in srgb, ${mainCard.color} 8%, transparent)`,
                          color: mainCard.color,
                        }}
                      >
                        {step}
                      </div>
                      {index < fc.flow!.length - 1 && (
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--theme-text-muted)', opacity: 0.5 }}>
                          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </button>
          )
        })}
        </div>
      )}

      {expandedFeature && (() => {
        const activeFc = WHY_FEATURES.find(f => f.id === expandedFeature)
        if (!activeFc) return null
        const mainCard = getFeatureStyles(activeFc.tags)
        return (
          <div
            className="p-6 transition-all duration-300 border rounded-xl"
            style={{
              border: `2px solid ${mainCard.color}`,
              background: mainCard.bg,
              boxShadow: `0 4px 20px color-mix(in srgb, ${mainCard.color} 13%, transparent)`,
            }}
          >
            <div className="flex items-start gap-4 mb-5">
              <div
                className="flex items-center justify-center rounded-xl shrink-0 w-12 h-12"
                style={{
                  background: `color-mix(in srgb, ${mainCard.color} 13%, transparent)`,
                  color: mainCard.iconColor,
                }}
              >
                {activeFc.icon}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="!my-0 mb-1.5" style={{ color: 'var(--theme-text)' }}>
                  {activeFc.title}
                </h4>
                <p className="text-[length:var(--typography-paragraph-small-regular-fontSize)] mb-0" style={{ color: 'var(--theme-text-muted)' }}>
                  {activeFc.description}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 mb-5">
              <span className="text-[length:var(--typography-paragraph-xsmall-regular-fontSize)] uppercase tracking-wider px-2 py-1 rounded-md" style={{ color: 'var(--theme-text-muted)', background: 'var(--theme-bg-subtle)' }}>
                Process Flow:
              </span>
              {activeFc.flow?.map((step, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div
                    className="px-3 py-1.5 rounded-full text-[length:var(--typography-paragraph-xsmall-heavy-fontSize)]"
                    style={{
                      background: `color-mix(in srgb, ${mainCard.color} 8%, transparent)`,
                      color: mainCard.color,
                    border: `1px solid color-mix(in srgb, ${mainCard.color} 25%, transparent)`,
                    }}
                  >
                    {step}
                  </div>
                  {index < activeFc.flow!.length - 1 && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--theme-text-muted)' }}>
                      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
              ))}
            </div>

            <div className="mb-5 p-4 rounded-lg" style={{ background: 'var(--theme-bg-subtle)' }}>
              <p className="text-[length:var(--typography-paragraph-xsmall-heavy-fontSize)] uppercase tracking-wider mb-2.5" style={{ color: 'var(--theme-text-muted)' }}>
                How it works
              </p>
              <p className="text-[length:var(--typography-paragraph-small-regular-fontSize)] mb-0" style={{ color: 'var(--theme-text)' }}>
                {activeFc.description} This feature is part of the Colabonate ecosystem and helps you accomplish your goals more efficiently. Each step is designed to be simple yet powerful.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 flex-wrap flex-1">
                <span 
                  className="text-[length:var(--typography-paragraph-xsmall-heavy-fontSize)] px-2 py-1 rounded-full uppercase tracking-wider"
                  style={{ 
                    background: `color-mix(in srgb, ${mainCard.color} 8%, transparent)`,
                    color: mainCard.color,
                  }}
                >
                  {activeFc.tags.join(' · ')}
                </span>
              </div>
              <button
                onClick={() => setExpandedFeature(null)}
                className="text-[length:var(--typography-paragraph-xsmall-regular-fontSize)] px-3 py-1.5 rounded-full cursor-pointer transition-colors duration-150"
                style={{
                  background: 'var(--theme-surface)',
                  color: 'var(--theme-text-muted)',
                  border: '1px solid var(--theme-border)',
                }}
              >
                Close
              </button>
            </div>
          </div>
        )
      })()}
    </section>
  )
}

export function HelpLanding() {
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  const containerRef = usePageAnimation([
    { selector: '.help-landing-animate', from: { duration: 0.4, stagger: 0.06, y: 16 } },
  ])

  const filteredArticles = useMemo(() => {
    if (!search.trim()) return []
    const q = search.toLowerCase()
    return getAllArticles()
      .filter(
        a =>
          a.title.toLowerCase().includes(q) ||
          a.summary.toLowerCase().includes(q) ||
          a.content.toLowerCase().includes(q) ||
          a.tags.some(t => t.toLowerCase().includes(q)),
      )
      .slice(0, 5)
  }, [search])

  return (
    <>
      <Seo
        title="Help Center"
        description="Colabonate Help Center: guides and FAQs for buying, selling and cooperating — Lightning payments, wallets, escrow, identity levels and DAO governance explained."
        path="/help"
      />
    <PageContainer size="standard" spacing="lg">
      <Box ref={containerRef}>
        <Box className="help-landing-animate">
          <PageHeader
            icon={<HelpCircle size={20} />}
            title="Help Center"
            subtitle="Learn how to buy, sell, and cooperate on Colabonate"
          />
        </Box>

        <Box className="help-landing-animate mt-7">
          <div className="flex items-center gap-3 w-full max-w-2xl mx-auto">
            <div className="flex-1 relative">
              <div
                className="absolute inset-0 rounded-xl pointer-events-none"
                style={{
                  boxShadow: '0 0 0 2px var(--color-primary-50), 0 0 20px color-mix(in srgb, var(--color-primary-50) 15%, transparent)',
                }}
              />
              <SearchInput
                variant="expanded"
                size="md"
                value={search}
                onChange={setSearch}
                onSearch={() => {}}
                onClear={() => setSearch('')}
                placeholder="Search help articles..."
                autoFocus
                ariaLabel="Search help articles"
                className="w-full"
              />
            </div>
          </div>
        </Box>

        <Box className="help-landing-animate mt-6">
          <Box
            onClick={() => navigate('/help/getting-started#gs-6')}
            role="link"
            className={cn(
              'flex items-center gap-4 p-4 rounded-xl cursor-pointer',
              'transition-all duration-200 hover:shadow-lg active:scale-[0.99]',
            )}
            sx={{
              background: 'color-mix(in srgb, var(--color-accent-1) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-accent-1) 35%, transparent)',
            }}
          >
            <Box
              className="flex items-center justify-center w-11 h-11 rounded-xl shrink-0"
              sx={{ background: 'color-mix(in srgb, var(--color-accent-1) 15%, transparent)', color: 'var(--color-accent-1)' }}
            >
              <RocketLaunch sx={{ fontSize: 22 }} />
            </Box>
            <Box className="flex-1 min-w-0">
              <Typography className="!text-[length:var(--typography-paragraph-small-heavy-fontsize)] !font-semibold text-[var(--theme-text)]">
                Get started with Nostr
              </Typography>
              <Typography className="!text-[length:var(--typography-paragraph-xsmall-regular-fontsize)] text-[var(--theme-text-muted)] mt-0.5">
                New here? Create your keys, install a signer, and connect to Colabonate in a few steps.
              </Typography>
            </Box>
            <Box
              className="flex items-center gap-1 text-[length:var(--typography-paragraph-small-heavy-fontSize)] shrink-0"
              sx={{ color: 'var(--color-accent-1)' }}
            >
              Start
              <Box component="svg" viewBox="0 0 24 24" className="w-3.5 h-3.5" sx={{ fill: 'currentColor' }}>
                <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8z" />
              </Box>
            </Box>
          </Box>
        </Box>

        {search.trim() && filteredArticles.length > 0 ? (
          <Box className="mt-7 flex flex-col gap-4">
            <Typography className="!text-[length:var(--typography-paragraph-small-heavy-fontsize)] !font-medium text-[var(--theme-text-muted)]">
              Search Results
            </Typography>
            {filteredArticles.map(article => {
              const section = HELP_SECTIONS.find(s => s.articles.some(a => a.id === article.id))
              return (
                <Box
                  key={article.id}
                  onClick={() => navigate(`/help/${section?.id}`)}
                  className={cn(
                    'p-5 rounded-lg',
                    'bg-[var(--theme-surface)]',
                    'border border-[var(--theme-border)]',
                    'cursor-pointer',
                    'hover:border-[var(--color-accent-1)]',
                    'transition-colors duration-150',
                  )}
                >
                  <Typography className="!text-[length:var(--typography-paragraph-small-heavy-fontsize)] !font-medium text-[var(--theme-text)]">
                    {article.title}
                  </Typography>
                  <Typography className="!text-[length:var(--typography-paragraph-xsmall-regular-fontsize)] text-[var(--theme-text-muted)] mt-1">
                    {section?.title} — {article.summary}
                  </Typography>
                </Box>
              )
            })}
          </Box>
        ) : search.trim() ? (
          <Box className="mt-8 text-center">
            <HelpOutlineIcon sx={{ fontSize: 40, color: 'var(--theme-text-muted)', mb: 1 }} />
            <Typography className="!text-[length:var(--typography-paragraph-small-regular-fontsize)] text-[var(--theme-text-muted)]">
              No articles found for "{search}"
            </Typography>
          </Box>
        ) : (
          <>
            <WhyColabonateSection />

            <Box
              className={cn(
                'mt-10',
                'help-landing-animate',
              )}
            >
              <div className="flex items-center gap-3 mb-5">
                <div
                  className="flex items-center justify-center w-10 h-10 shrink-0 rounded-xl"
                  style={{ background: 'color-mix(in srgb, var(--color-accent-1) 10%, transparent)', color: 'var(--color-accent-1)' }}
                >
                  <HelpOutlineIcon sx={{ fontSize: 20 }} />
                </div>
                <div>
                  <h3 className="!my-0">
                    Help Categories
                  </h3>
                  <p className="text-[length:var(--typography-paragraph-small-regular-fontSize)] mt-1" style={{ color: 'var(--theme-text-muted)' }}>
                    Browse topics to find answers
                  </p>
                </div>
              </div>

              <div
                className={cn(
                  'grid',
                  'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
                  'gap-4',
                )}
              >
                {HELP_SECTIONS.map(section => (
                  <HelpCategoryCard key={section.id} section={section} />
                ))}
              </div>
            </Box>

            <Box className="mt-10 help-landing-animate">
              <div className="flex items-center gap-3 mb-5">
                <div
                  className="flex items-center justify-center w-10 h-10 shrink-0 rounded-xl"
                  style={{ background: 'color-mix(in srgb, var(--color-accent-3) 10%, transparent)', color: 'var(--color-accent-3)' }}
                >
                  <HelpOutlineIcon sx={{ fontSize: 20 }} />
                </div>
                <div>
                  <h3 className="!my-0">
                    Popular Questions
                  </h3>
                  <p className="text-[length:var(--typography-paragraph-small-regular-fontSize)] mt-1" style={{ color: 'var(--theme-text-muted)' }}>
                    Quick answers to common questions
                  </p>
                </div>
              </div>

              <Box
                className={cn(
                  'grid gap-4',
                  'grid-cols-1 md:grid-cols-2',
                )}
              >
                {HELP_FAQ.map((faq, index) => {
                  const section = HELP_SECTIONS.find(s => s.id === faq.sectionId)
                  const flowSteps = FAQ_FLOW_STEPS[faq.id] || []
                  return (
                    <Box
                      key={faq.id}
                      onClick={() => navigate(`/help/${faq.sectionId}`)}
                      className={cn(
                        'flex items-start gap-3.5',
                        'p-5',
                        'rounded-xl',
                        'bg-[var(--theme-surface)]',
                        'border border-[var(--theme-border)]',
                        'cursor-pointer',
                        'help-faq-card',
                        'transition-all duration-200',
                        'hover:border-[var(--color-accent-1)]',
                        'hover:shadow-[0_2px_12px_color-mix(in_srgb,var(--color-accent-1)_12%,transparent)]',
                        'active:scale-[0.98]',
                      )}
                    >
                      <Box
                        className={cn(
                          'w-8 h-8 rounded-lg',
                          'flex items-center justify-center',
                          'flex-shrink-0',
                        )}
                        sx={{
                          backgroundColor: section?.iconBg || 'color-mix(in srgb, var(--color-accent-1) 15%, transparent)',
                        }}
                      >
                        <Box
                          className="text-[length:var(--typography-paragraph-xsmall-heavy-fontSize)]"
                          sx={{
                            color: section?.iconColor || 'var(--color-accent-1)',
                          }}
                        >
                          {String(index + 1).padStart(2, '0')}
                        </Box>
                      </Box>
                      <Box className="flex flex-col gap-2.5 flex-1 min-w-0">
                        <Typography
                          className={cn(
                             '!text-[length:var(--typography-paragraph-small-heavy-fontsize)] !font-medium',
                            'text-[var(--theme-text)]',
                            'leading-snug',
                          )}
                        >
                          {faq.title}
                        </Typography>

                        {flowSteps.length > 0 && (
                          <Box className="flex items-center gap-1.5 flex-wrap">
                            {flowSteps.map((step, stepIndex) => (
                              <Box key={stepIndex} className="flex items-center gap-1.5">
                                <Tooltip
                                  title={step.tooltip}
                                  placement="top"
                                  arrow
                                  className="help-flow-tooltip"
                                >
                                  <Box
                                    className={cn(
                                      'px-2 py-0.5',
                                      'rounded-md',
                                      'text-[length:var(--typography-paragraph-xsmall-regular-fontSize)]',
                                      'cursor-help',
                                      'transition-colors duration-150',
                                    )}
                                    sx={{
                                      backgroundColor: 'color-mix(in srgb, var(--color-accent-1) 10%, transparent)',
                                      color: section?.color || 'var(--color-accent-1)',
                                      border: `1px solid color-mix(in srgb, ${section?.color || 'var(--color-accent-1)'} 25%, transparent)`,
                                      '&:hover': {
                                        backgroundColor: 'color-mix(in srgb, var(--color-accent-1) 20%, transparent)',
                                      },
                                    }}
                                  >
                                    {step.label}
                                  </Box>
                                </Tooltip>
                                {stepIndex < flowSteps.length - 1 && (
                                  <Box
                                    className="w-3 h-px opacity-40"
                                    sx={{ backgroundColor: 'var(--theme-text-muted)' }}
                                  />
                                )}
                              </Box>
                            ))}
                          </Box>
                        )}

                        <Box className="flex items-center justify-between gap-2">
                          <Box
                            className={cn(
                              'inline-flex items-center gap-1',
                              'px-2 py-0.5',
                              'rounded-full',
                              'w-fit',
                            )}
                            sx={{
                              backgroundColor: section?.bgColor || 'color-mix(in srgb, var(--color-accent-1) 8%, transparent)',
                              border: `1px solid color-mix(in srgb, ${section?.color || 'var(--color-accent-1)'} 19%, transparent)`,
                            }}
                          >
                            <Typography
                              className="!text-[length:var(--typography-paragraph-xsmall-regular-fontSize)] !font-medium"
                              sx={{ color: section?.color || 'var(--color-accent-1)' }}
                            >
                              {section?.title}
                            </Typography>
                          </Box>
                          <Box
                            className={cn(
                              'flex items-center gap-1',
                              'text-[length:var(--typography-paragraph-small-heavy-fontSize)]',
                            )}
                            sx={{ color: 'var(--color-accent-1)' }}
                          >
                            Read
                            <Box
                              component="svg"
                              viewBox="0 0 24 24"
                              className="w-3.5 h-3.5"
                              sx={{ fill: 'currentColor' }}
                            >
                              <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8z" />
                            </Box>
                          </Box>
                        </Box>
                      </Box>
                    </Box>
                  )
                })}
              </Box>
            </Box>
          </>
        )}
      </Box>
    </PageContainer>
    </>
  )
}
