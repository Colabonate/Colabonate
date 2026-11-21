// ESCROW-COPY (ADR-397): payment wording here assumes Direct-Pay. On escrow activation follow docs/plans/ESCROW-COPY-REACTIVATION.md.
import { Link } from 'react-router-dom'
import { Info } from 'lucide-react'
import { PageContainer, PageCard } from '@ds/ui'
import { cn } from '@ds/utils'
import { PageHeader } from '../../components/PageHeader'
import { Seo } from '../../components/Seo'
import LightbulbIcon from '@mui/icons-material/Lightbulb'
import CodeIcon from '@mui/icons-material/Code'
import HubIcon from '@mui/icons-material/Hub'
import CurrencyBitcoinIcon from '@mui/icons-material/CurrencyBitcoin'
import GroupsIcon from '@mui/icons-material/Groups'
import VisibilityIcon from '@mui/icons-material/Visibility'
import AccountBalanceIcon from '@mui/icons-material/AccountBalance'
import SecurityIcon from '@mui/icons-material/Security'
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber'
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet'
import GavelIcon from '@mui/icons-material/Gavel'
import StarIcon from '@mui/icons-material/Star'
import FingerprintIcon from '@mui/icons-material/Fingerprint'
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart'
import StoreIcon from '@mui/icons-material/Store'
import HandshakeIcon from '@mui/icons-material/Handshake'
import ChatBubbleIcon from '@mui/icons-material/ChatBubble'
import CloudIcon from '@mui/icons-material/Cloud'
import LinkIcon from '@mui/icons-material/Link'

const PILLARS = [
  {
    title: 'Open Source',
    description:
      'The protocol spec is MIT licensed. The reference implementation is open source. No black boxes.',
    icon: <CodeIcon sx={{ fontSize: 20 }} />,
    color: 'var(--color-accent-1)',
  },
  {
    title: 'Decentralized',
    description:
      'Built on Nostr — identities and data live on open relays, not on Colabonate servers.',
    icon: <HubIcon sx={{ fontSize: 20 }} />,
    color: 'var(--color-accent-3)',
  },
  {
    title: 'Bitcoin-Native',
    description:
      'Payments via Bitcoin Lightning. No banks, no custodians — peer-to-peer by default.',
    icon: <CurrencyBitcoinIcon sx={{ fontSize: 20 }} />,
    color: 'var(--color-primary-50)',
  },
]

const PRINCIPLES = [
  {
    title: 'Collaboration First',
    description:
      'Transactions are viewed as collaborations, not just sales. All parties work toward mutual success with shared value creation over zero-sum thinking.',
    icon: <GroupsIcon sx={{ fontSize: 20, color: 'var(--color-accent-1)' }} />,
  },
  {
    title: 'Trust Through Transparency',
    description:
      'Escrow mechanisms build interim trust, reputation follows participants across relationships, and all significant actions are recorded immutably.',
    icon: <VisibilityIcon sx={{ fontSize: 20, color: 'var(--color-accent-1)' }} />,
  },
  {
    title: 'Community Governance',
    description:
      'No centralized authority controls the platform. Rules are created and modified by token holders, and disputes are resolved by community juries.',
    icon: <AccountBalanceIcon sx={{ fontSize: 20, color: 'var(--color-accent-1)' }} />,
  },
  {
    title: 'User Sovereignty',
    description:
      'Users own their identity and reputation. Data is minimized, privacy is protected, and everyone is free to transact without surveillance.',
    icon: <SecurityIcon sx={{ fontSize: 20, color: 'var(--color-accent-1)' }} />,
  },
]

const COMPONENTS = [
  {
    title: 'Ticket System',
    description:
      'The central transaction unit. Every interaction is a ticket that flows through defined states, from order to confirmed delivery.',
    icon: <ConfirmationNumberIcon sx={{ fontSize: 20, color: 'var(--color-accent-3)' }} />,
  },
  {
    title: 'Escrow',
    description:
      'Planned: funds held by a verifiable, open-source canister until predefined conditions are met. Today every trade is Direct-Pay — buyers pay sellers directly and Colabonate never holds funds.',
    icon: <AccountBalanceWalletIcon sx={{ fontSize: 20, color: 'var(--color-accent-3)' }} />,
  },
  {
    title: 'Dispute Management',
    description:
      'Multi-stage conflict resolution: direct negotiation, community mediation, and finally DAO juries for binding decisions.',
    icon: <GavelIcon sx={{ fontSize: 20, color: 'var(--color-accent-3)' }} />,
  },
  {
    title: 'DAO Governance',
    description:
      'Community-driven platform governance. Token holders propose and vote on changes and serve as dispute jurors.',
    icon: <AccountBalanceIcon sx={{ fontSize: 20, color: 'var(--color-accent-3)' }} />,
  },
  {
    title: 'Reputation System',
    description:
      'Holistic trust tracking across transactions, dispute outcomes, and governance participation creates a reliable reputation profile.',
    icon: <StarIcon sx={{ fontSize: 20, color: 'var(--color-accent-3)' }} />,
  },
  {
    title: 'Human Sovereign Identity',
    description:
      'Self-sovereign identity management gives users control over personal data while enabling selective disclosure and verification.',
    icon: <FingerprintIcon sx={{ fontSize: 20, color: 'var(--color-accent-3)' }} />,
  },
]

const ROLES = [
  {
    title: 'Buyers',
    description:
      'Pay sellers directly, review detailed seller profiles and reputation, dispute if not satisfied, and access a global marketplace.',
    icon: <ShoppingCartIcon sx={{ fontSize: 20, color: 'var(--color-primary-50)' }} />,
  },
  {
    title: 'Sellers',
    description:
      'Create listings and service offerings, receive payment guaranteed by escrow, build reputation, and customize workflows.',
    icon: <StoreIcon sx={{ fontSize: 20, color: 'var(--color-primary-50)' }} />,
  },
  {
    title: 'Service Providers',
    description:
      'Offer complex, ongoing services with milestone-based payments, collaborate with subcontractors, and grow professional reputation.',
    icon: <HandshakeIcon sx={{ fontSize: 20, color: 'var(--color-primary-50)' }} />,
  },
]

const TECH_STACK = [
  { layer: 'Blockchain', value: 'Bitcoin / Lightning Network', icon: <LinkIcon sx={{ fontSize: 18 }} /> },
  { layer: 'Identity', value: 'Nostr, NIP-07, Humanode Biomapper', icon: <FingerprintIcon sx={{ fontSize: 18 }} /> },
  { layer: 'Communication', value: 'Nostr relays, WebRTC', icon: <ChatBubbleIcon sx={{ fontSize: 18 }} /> },
  { layer: 'Storage', value: 'IPFS for off-chain data', icon: <CloudIcon sx={{ fontSize: 18 }} /> },
]

function SectionTitle({ icon, children }: { icon?: React.ReactNode; children: string }) {
  return (
    <div className="flex items-center gap-2">
      {icon && (
        <span className="text-[var(--theme-text-muted)]">
          {icon}
        </span>
      )}
      <h2
        className={cn(
          'text-[var(--theme-text)]',
          'font-semibold',
          'text-lg',
          'md:text-xl',
        )}
      >
        {children}
      </h2>
    </div>
  )
}

function CardTitle({ icon, children }: { icon?: React.ReactNode; children: string }) {
  return (
    <div className="flex items-center gap-2">
      {icon && <span>{icon}</span>}
      <div
        className={cn(
          'text-sm',
          'font-semibold',
          'text-[var(--theme-text)]',
        )}
      >
        {children}
      </div>
    </div>
  )
}

export function AboutPage() {
  return (
    <>
      <Seo
        title="About"
        description="Colabonate is an open, decentralized peer-to-peer commerce platform — escrow-protected transactions, Bitcoin Lightning payments and community governance."
        path="/about"
      />
    <PageContainer>
      <PageHeader
        icon={<Info size={20} />}
        title="About Colabonate"
        subtitle="Open, fair, community-governed local commerce."
      />

      {/* Vision */}
      <PageCard>
        <div className="prose max-w-3xl">
          <div className="flex items-center gap-2 mb-2">
            <LightbulbIcon sx={{ fontSize: 22, color: 'var(--color-accent-2)' }} />
            <span
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--color-accent-2)' }}
            >
              Our Vision
            </span>
          </div>
          <p className="text-[var(--theme-text)] text-lg md:text-xl leading-relaxed">
            &ldquo;To create a commerce platform where collaboration precedes transaction, where trust
            is earned through transparent mechanisms, and where community governance ensures the
            platform serves all participants fairly.&rdquo;
          </p>
          <p className="text-[var(--theme-text-muted)] text-base">
            Colabonate is a decentralized peer-to-peer commerce platform where buyers, sellers, and
            service providers collaborate on transactions with built-in trust mechanisms, transparent
            governance, and community-driven dispute resolution.
          </p>
        </div>
      </PageCard>

      {/* Mission */}
      <PageCard className="mt-6">
        <SectionTitle>What is Colabonate?</SectionTitle>
        <div className="prose max-w-3xl mt-4">
          <p className="text-[var(--theme-text-muted)] text-base">
            Colabonate is an open protocol and platform for local economic cooperation. We connect
            buyers, sellers and cooperators in a fair, decentralized network — governed by the
            community, not by a corporation.
          </p>
          <p className="text-[var(--theme-text-muted)] text-base">
            Instead of viewing commerce as a zero-sum game where one party wins at the other&apos;s
            expense, Colabonate structures transactions as collaborative efforts with shared success
            incentives. Built on blockchain technology, it eliminates the need for traditional
            intermediaries while providing equal or greater trust guarantees.
          </p>
        </div>
      </PageCard>

      {/* 3 Pillars */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
        {PILLARS.map((pillar) => (
          <PageCard key={pillar.title}>
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
              style={{ background: pillar.color, color: '#fff' }}
            >
              {pillar.icon}
            </div>
            <CardTitle>{pillar.title}</CardTitle>
            <p className="text-sm text-[var(--theme-text-muted)] leading-relaxed mt-1.5">
              {pillar.description}
            </p>
          </PageCard>
        ))}
      </div>

      {/* Core Principles */}
      <PageCard className="mt-6">
        <SectionTitle icon={<SecurityIcon sx={{ fontSize: 22 }} />}>Core Principles</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-5">
          {PRINCIPLES.map((principle) => (
            <div key={principle.title}>
              <CardTitle icon={principle.icon}>{principle.title}</CardTitle>
              <p className="text-sm text-[var(--theme-text-muted)] leading-relaxed mt-1.5">
                {principle.description}
              </p>
            </div>
          ))}
        </div>
      </PageCard>

      {/* Why it matters */}
      <PageCard className="mt-6">
        <SectionTitle icon={<LightbulbIcon sx={{ fontSize: 22 }} />}>Why Colabonate Matters</SectionTitle>
        <div className="prose max-w-3xl mt-4">
          <p className="text-[var(--theme-text-muted)] text-base">
            Traditional e-commerce platforms charge high fees, exercise centralized control, harvest
            user data, and resolve disputes behind closed doors. Colabonate replaces that model with
            open infrastructure and community accountability:
          </p>
          <ul>
            <li>Low platform fees via decentralized infrastructure</li>
            <li>Community governance instead of centralized control</li>
            <li>Transparent jury-based dispute resolution</li>
            <li>User-owned identity and data</li>
            <li>Smart-contract escrow that protects both buyers and sellers</li>
          </ul>
        </div>
      </PageCard>

      {/* Key Components */}
      <PageCard className="mt-6">
        <SectionTitle icon={<HubIcon sx={{ fontSize: 22 }} />}>Key Components</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-5">
          {COMPONENTS.map((component) => (
            <div key={component.title}>
              <CardTitle icon={component.icon}>{component.title}</CardTitle>
              <p className="text-sm text-[var(--theme-text-muted)] leading-relaxed mt-1.5">
                {component.description}
              </p>
            </div>
          ))}
        </div>
      </PageCard>

      {/* User Roles */}
      <PageCard className="mt-6">
        <SectionTitle icon={<GroupsIcon sx={{ fontSize: 22 }} />}>For Everyone in the Ecosystem</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-5">
          {ROLES.map((role) => (
            <div key={role.title}>
              <CardTitle icon={role.icon}>{role.title}</CardTitle>
              <p className="text-sm text-[var(--theme-text-muted)] leading-relaxed mt-1.5">
                {role.description}
              </p>
            </div>
          ))}
        </div>
      </PageCard>

      {/* Technology Stack */}
      <PageCard className="mt-6">
        <SectionTitle icon={<CodeIcon sx={{ fontSize: 22 }} />}>Technology Stack</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
          {TECH_STACK.map((item) => (
            <div
              key={item.layer}
              className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3"
            >
              <div className="flex items-center gap-2 sm:w-28 shrink-0">
                <span className="text-[var(--theme-text-muted)]">{item.icon}</span>
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
                  {item.layer}
                </span>
              </div>
              <span className="text-sm text-[var(--theme-text)]">{item.value}</span>
            </div>
          ))}
        </div>
      </PageCard>

      {/* Links */}
      <div className="flex flex-wrap items-center gap-4 mt-6">
        <Link
          to="/about/foundation"
          className="text-sm font-medium"
          style={{ color: 'var(--color-accent-1)' }}
        >
          Foundation DAO →
        </Link>
        <span style={{ color: 'var(--theme-border)' }}>·</span>
        <Link
          to="/about/codex"
          className="text-sm font-medium"
          style={{ color: 'var(--color-accent-1)' }}
        >
          Codex Constitution →
        </Link>
        <span style={{ color: 'var(--theme-border)' }}>·</span>
        <a
          href="https://github.com/Colabonate"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium"
          style={{ color: 'var(--color-accent-1)' }}
        >
          GitHub →
        </a>
      </div>
    </PageContainer>
    </>
  )
}
