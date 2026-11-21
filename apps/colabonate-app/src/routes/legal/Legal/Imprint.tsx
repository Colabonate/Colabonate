import { Box, Typography, Chip } from '@mui/material'
import Business from '@mui/icons-material/Business'
import Email from '@mui/icons-material/Email'
import Gavel from '@mui/icons-material/Gavel'
import Shield from '@mui/icons-material/Shield'
import AccountBalance from '@mui/icons-material/AccountBalance'
import CloudOff from '@mui/icons-material/CloudOff'
import { Building2 } from 'lucide-react'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../../components/PageHeader'
import { Seo } from '../../../components/Seo'
import { cn } from '@ds/utils'

interface ImprintCard {
  icon: React.ReactNode
  title: string
  items: { label: string; value: React.ReactNode }[]
}

const IMPRINT_CARDS: ImprintCard[] = [
  {
    icon: <Business sx={{ fontSize: 22 }} />,
    title: 'Organization',
    items: [
      { label: 'Entity', value: 'Colabonate Foundation' },
      { label: 'Type', value: 'DAO Legal Node (Decentralized Autonomous Organization)' },
      { label: 'Governance', value: 'Codex-based, Swiss jurisdiction' },
      { label: 'Tagline', value: 'collaborate. share. deliver.' },
    ],
  },
  {
    icon: <Email sx={{ fontSize: 22 }} />,
    title: 'Contact',
    items: [
      { label: 'Email', value: <a href="mailto:hello@colabonate.com" className="underline" style={{ color: 'var(--color-accent-1)' }}>hello@colabonate.com</a> },
      { label: 'Website', value: <a href="https://colabonate.com" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--color-accent-1)' }}>colabonate.com</a> },
      { label: 'GitHub', value: <a href="https://github.com/Colabonate" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--color-accent-1)' }}>github.com/Colabonate</a> },
      { label: 'Data Protection', value: 'Colabonate Ticket System (pseudonymous)' },
      { label: 'Legal Inquiries', value: 'DAO Legal Node' },
    ],
  },
  {
    icon: <Gavel sx={{ fontSize: 22 }} />,
    title: 'Governing Law',
    items: [
      { label: 'Jurisdiction', value: 'Switzerland' },
      { label: 'Courts', value: 'Zurich, Switzerland' },
      { label: 'Applicable Law', value: 'Swiss law (excluding conflict of laws rules)' },
      { label: 'Appeal', value: 'Swiss Federal Court' },
    ],
  },
  {
    icon: <Shield sx={{ fontSize: 22 }} />,
    title: 'Online Dispute Resolution',
    items: [
      {
        label: 'EU ODR',
        value: 'The European Commission provides an Online Dispute Resolution platform (ec.europa.eu/odr)',
      },
      {
        label: 'Note',
        value: 'As a DAO-governed platform, disputes are primarily resolved through the Codex arbitration framework',
      },
    ],
  },
  {
    icon: <AccountBalance sx={{ fontSize: 22 }} />,
    title: 'Responsible for Content',
    items: [
      { label: 'Governance', value: 'Content governed by Colabonate DAO via Codex' },
      { label: 'Changes', value: 'Policy changes require DAO consensus vote' },
      { label: 'Versioning', value: 'Versioned with cryptographic Hash Identifiers (CID)' },
    ],
  },
  {
    icon: <CloudOff sx={{ fontSize: 22 }} />,
    title: 'Technical Infrastructure',
    items: [
      { label: 'Communication', value: 'Nostr protocol (decentralized)' },
      { label: 'Payments', value: 'Bitcoin Lightning Network' },
      { label: 'Identity', value: 'Sovereign Identity (SI) framework' },
      { label: 'Storage', value: 'No central server — data stored on user devices and decentralized relays' },
    ],
  },
]

function ImprintCardComponent({ card }: { card: ImprintCard }) {
  return (
    <div
      className={cn(
        'flex flex-col p-5 rounded-xl border',
        'transition-all duration-200',
      )}
      style={{
        borderColor: 'var(--theme-border)',
        background: 'var(--theme-surface)',
      }}
    >
      <div className="flex items-center gap-3 mb-4">
        <div
          className="flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
          style={{
            background: 'rgba(107,177,255,0.10)',
            color: 'var(--color-accent-1)',
          }}
        >
          {card.icon}
        </div>
        <h3
          className="text-sm font-semibold"
          style={{ color: 'var(--theme-text)' }}
        >
          {card.title}
        </h3>
      </div>
      <div className="flex flex-col gap-2.5">
        {card.items.map((item) => (
          <div key={item.label} className="flex flex-col gap-0.5">
            <span
              className="text-[11px] font-medium uppercase tracking-wider"
              style={{ color: 'var(--theme-text-muted)' }}
            >
              {item.label}
            </span>
            <span
              className="text-sm leading-relaxed"
              style={{ color: 'var(--theme-text)' }}
            >
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Imprint() {
  return (
    <>
      <Seo
        title="Imprint"
        description="Imprint and legal entity information for Colabonate — the Foundation, DAO and GmbH behind the open peer-to-peer commerce protocol, per § 5 TMG."
        path="/legal/imprint"
      />
    <PageContainer size="standard" spacing="lg">
      <PageHeader
        icon={<Building2 size={20} />}
        title="Imprint"
        subtitle="Legal entity information — Angaben gemäß § 5 TMG"
      />

      <Box className="flex items-center gap-2 mb-6">
        <Chip
          label="Colabonate Foundation"
          size="small"
          className="!text-[11px] !h-[22px] !rounded-md"
          sx={{
            borderColor: 'var(--color-accent-1)',
            color: 'var(--color-accent-1)',
            backgroundColor: 'transparent',
            border: '1px solid',
          }}
        />
      </Box>

      <div
        className={cn(
          'grid',
          'grid-cols-1 md:grid-cols-2',
          'gap-4',
        )}
      >
        {IMPRINT_CARDS.map((card) => (
          <ImprintCardComponent key={card.title} card={card} />
        ))}
      </div>

      <Box className="mt-6">
        <Typography
          className={cn(
            '!text-xs',
            'text-[var(--theme-text-muted)]',
            'leading-relaxed',
          )}
        >
          © 2026 colabonate.com — Colabonate Foundation. All rights reserved.
        </Typography>
      </Box>
    </PageContainer>
    </>
  )
}
