import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Chip } from '@mui/material'
import { PageContainer, PageHeader } from '@ds/ui'
import { Seo } from '../../components/Seo'
import { LegalSectionAccordion } from '../../components/ui/LegalSectionAccordion'
import type { LegalSection } from '../../components/ui/LegalSectionAccordion'
import { apiCall } from '../../lib/api'

interface FoundationDao {
  id: string
  name: string
  codexHash: string
  codexVersion: string
  status: string
  nostrEventId: string | null
}

export function AboutFoundation() {
  const [dao, setDao] = useState<FoundationDao | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiCall('/api/dao/foundation')
      .then(r => r.json())
      .then(data => setDao(data.dao))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const sections: LegalSection[] = [
    {
      title: 'Foundation DAO Status',
      badge: loading ? 'Loading…' : dao?.status?.toUpperCase(),
      content: (
        <div className="space-y-2.5">
          <div className="flex justify-between">
            <span className="text-[var(--theme-text-muted)]">Status</span>
            <span className="font-medium capitalize">{loading ? '…' : dao?.status?.toLowerCase() ?? 'unknown'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--theme-text-muted)]">Codex Version</span>
            <span className="font-medium">{loading ? '…' : dao?.codexVersion ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--theme-text-muted)]">Codex Hash</span>
            <span className="font-mono text-xs break-all">{loading ? '…' : dao?.codexHash ? `${dao.codexHash.slice(0, 16)}…` : '—'}</span>
          </div>
        </div>
      ),
    },
    {
      title: 'Organizational Context',
      content: (
        <div className="space-y-2.5">
          <div className="flex flex-col gap-1">
            <span className="text-[var(--theme-text-muted)] text-xs font-medium uppercase tracking-wider">Colabonate Foundation (Stiftung)</span>
            <span className="text-sm">Protocol development, IP/trademark holder, protocol spec steward</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[var(--theme-text-muted)] text-xs font-medium uppercase tracking-wider">Colabonate DAO</span>
            <span className="text-sm">Community governance via the Codex, token-weighted and reputation-weighted voting</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[var(--theme-text-muted)] text-xs font-medium uppercase tracking-wider">Colabonate GmbH</span>
            <span className="text-sm">Commercial services entity, premium features, governed by separate terms</span>
          </div>
        </div>
      ),
    },
    {
      title: 'Dispute Resolution Levels',
      badge: '3 Levels',
      content: (
        <div className="space-y-3">
          <div className="flex gap-3">
            <div
              className="w-6 h-6 rounded-full text-white text-xs flex items-center justify-center font-bold shrink-0"
              style={{ background: 'var(--color-accent-1)' }}
            >
              1
            </div>
            <div>
              <div className="font-medium mb-0.5">Level 1 — Cooling Off (7 days)</div>
              <div className="text-[var(--theme-text-muted)] text-xs">Parties communicate directly. No third-party involvement.</div>
            </div>
          </div>
          <div className="flex gap-3">
            <div
              className="w-6 h-6 rounded-full text-white text-xs flex items-center justify-center font-bold shrink-0"
              style={{ background: 'var(--color-accent-1)', opacity: 0.4 }}
            >
              2
            </div>
            <div>
              <div className="font-medium mb-0.5">Level 2 — Mediation (Deferred)</div>
              <div className="text-[var(--theme-text-muted)] text-xs">Neutral mediator assists agreement. Not yet implemented.</div>
            </div>
          </div>
          <div className="flex gap-3">
            <div
              className="w-6 h-6 rounded-full text-white text-xs flex items-center justify-center font-bold shrink-0"
              style={{ background: 'var(--color-accent-1)' }}
            >
              3
            </div>
            <div>
              <div className="font-medium mb-0.5">Level 3 — Arbitration Council</div>
              <div className="text-[var(--theme-text-muted)] text-xs">Binding verdict by elected arbitrators. Enforces escrow state transitions.</div>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: 'Voting Rights',
      content: (
        <>
          <p>Three voting models are available. The DAO selects the applicable model per proposal type.</p>
          <div className="space-y-2.5">
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-sm">1P1V (One Person One Vote)</span>
              <span className="text-[var(--theme-text-muted)] text-xs">Humanode Biomapper verification — Identity Level 3. 1 vote per verified human. Phase 4+.</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-sm">Token-Weighted</span>
              <span className="text-[var(--theme-text-muted)] text-xs">COLA Token staked via Kind 30025 event. 1 governance unit per 1 staked COLA. Phase 4+.</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-sm">Reputation-Weighted</span>
              <span className="text-[var(--theme-text-muted)] text-xs">COL-Points (off-chain). Score-based multiplier (DAO sets formula). Phase 5+.</span>
            </div>
          </div>
        </>
      ),
    },
    {
      title: 'Sanctions',
      content: (
        <div className="space-y-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-sm">Level 1 — Warning</span>
            <span className="text-[var(--theme-text-muted)] text-xs">Public Nostr Event. First violation, minor breach.</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-sm">Level 2 — Temporary Restriction (30 days)</span>
            <span className="text-[var(--theme-text-muted)] text-xs">No ticket creation. Repeat or serious violation.</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-sm">Level 3 — Permanent Ban</span>
            <span className="text-[var(--theme-text-muted)] text-xs">Requires DAO Governance Vote (Sanction type). Fraud, abuse, serious harm.</span>
          </div>
        </div>
      ),
    },
    {
      title: 'Security Principles',
      content: (
        <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2">
          <li>Private keys never leave the client device</li>
          <li>No custody — Colabonate holds no Bitcoin at any layer</li>
          <li>All governance decisions are Nostr-signed and immutable on relay</li>
          <li>Open source — protocol spec is MIT licensed; reference implementation is open source</li>
        </ul>
      ),
    },
  ]

  return (
    <>
      <Seo
        title="Foundation DAO"
        description="The Colabonate Foundation DAO: community governance, three-level dispute resolution, an Arbitration Council, voting models and transparent security principles."
        path="/about/foundation"
      />
    <PageContainer size="standard" spacing="lg">
      <PageHeader
        title="Colabonate Foundation DAO"
        subtitle="The Arbitration Council is the operative arm of the Foundation DAO, resolving disputes at Level 3 of the three-level dispute protocol."
      />

      <Box className="flex items-center gap-2 mb-6">
        <Chip
          label={loading ? 'Loading…' : dao?.status?.toUpperCase() ?? 'UNKNOWN'}
          size="small"
          className="!text-[11px] !h-[22px] !rounded-md"
          sx={{
            borderColor: 'var(--color-accent-1)',
            color: 'var(--color-accent-1)',
            backgroundColor: 'transparent',
            border: '1px solid',
          }}
        />
        <Chip
          label={`Codex v${loading ? '…' : dao?.codexVersion ?? '—'}`}
          size="small"
          className="!text-[11px] !h-[22px] !rounded-md"
          sx={{
            borderColor: 'var(--theme-border)',
            color: 'var(--theme-text-muted)',
            backgroundColor: 'transparent',
            border: '1px solid',
          }}
        />
      </Box>

      <Box className="flex flex-col gap-3 mb-6">
        {sections.map((section) => (
          <LegalSectionAccordion key={section.title} section={section} />
        ))}
      </Box>

      <Box className="flex items-center gap-4">
        <Link
          to="/about/codex"
          className="text-sm font-medium"
          style={{ color: 'var(--color-accent-1)' }}
        >
          View the Codex Constitution →
        </Link>
        <span style={{ color: 'var(--theme-border)' }}>·</span>
        <Link
          to="/about/role-onboarding"
          className="text-sm font-medium"
          style={{ color: 'var(--color-accent-1)' }}
        >
          Role Onboarding →
        </Link>
      </Box>
    </PageContainer>
    </>
  )
}
