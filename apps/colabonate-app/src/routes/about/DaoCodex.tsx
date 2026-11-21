import { Link } from 'react-router-dom'
import { Box, Chip } from '@mui/material'
import { PageContainer, PageHeader } from '@ds/ui'
import { Seo } from '../../components/Seo'
import { LegalSectionAccordion } from '../../components/ui/LegalSectionAccordion'
import type { LegalSection } from '../../components/ui/LegalSectionAccordion'

const CODEX_SECTIONS: LegalSection[] = [
  {
    title: 'Preamble',
    content: (
      <>
        <p>
          The DAO Codex defines the constitutional rules of the Colabonate community governance system.
          It is <strong>not a legal document</strong> and is not directly enforceable in state courts.
          It applies within the technical system and is enforced through Nostr Events and Lightning Escrow.
        </p>
        <p>
          Tickets with an optional DAO binding (<code>daoId</code> + <code>codexHash</code> fields)
          are subject to this Codex&apos;s dispute resolution and sanction procedures.
        </p>
        <div className="space-y-2 mt-3">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-sm">Colabonate Foundation (Stiftung)</span>
            <span className="text-[var(--theme-text-muted)] text-xs">Protocol development, IP/trademark holder, protocol spec steward</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-sm">Colabonate DAO</span>
            <span className="text-[var(--theme-text-muted)] text-xs">Community governance via this Codex, token-weighted and reputation-weighted voting</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-sm">Colabonate GmbH</span>
            <span className="text-[var(--theme-text-muted)] text-xs">Commercial services entity, premium features, governed by separate terms</span>
          </div>
        </div>
      </>
    ),
  },
  {
    title: 'I.1 — Voting Rights',
    badge: '3 Models',
    content: (
      <>
        <p>Three voting models are available. The DAO selects the applicable model per proposal type.</p>
        <div className="space-y-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-sm">1P1V (One Person One Vote) — Phase 4+</span>
            <span className="text-[var(--theme-text-muted)] text-xs">Humanode Biomapper verification — Identity Level 3. 1 vote per verified human. Prevents multiple accounts, bot networks, sock puppets.</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-sm">Token-Weighted — Phase 4+</span>
            <span className="text-[var(--theme-text-muted)] text-xs">COLA Token staked via Kind 30025 event. 1 governance unit per 1 staked COLA. RRC-20 governance token on RSK (Bitcoin sidechain). Staking enables 5% APY yield.</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-sm">Reputation-Weighted — Phase 5+</span>
            <span className="text-[var(--theme-text-muted)] text-xs">COL-Points (off-chain). Score-based multiplier (DAO sets formula).</span>
          </div>
        </div>
      </>
    ),
  },
  {
    title: 'I.2 — Proposal Types & Voting Model Selection',
    content: (
      <div className="space-y-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">Normal Decision</span>
          <span className="text-[var(--theme-text-muted)] text-xs">Token-weighted or Reputation · Quorum 10% · Majority &gt;50% · 7 days</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">Codex Amendment</span>
          <span className="text-[var(--theme-text-muted)] text-xs">1P1V (if available) or Token-weighted · Quorum 20% · 2/3 majority · 21 days</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">Treasury Spending</span>
          <span className="text-[var(--theme-text-muted)] text-xs">Token-weighted · Quorum 15% · Majority &gt;50% · 14 days</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">Sanction / Ban</span>
          <span className="text-[var(--theme-text-muted)] text-xs">1P1V required · Quorum 10% · 2/3 majority · 7 days</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">Protocol Upgrade</span>
          <span className="text-[var(--theme-text-muted)] text-xs">Token-weighted + 1P1V confirmation · Quorum 25% · 2/3 majority · 21 days</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">New DAO Creation (Foundation Recognition)</span>
          <span className="text-[var(--theme-text-muted)] text-xs">Token-weighted · Quorum 10% · Majority &gt;50% · 7 days</span>
        </div>
        <p className="text-[var(--theme-text-muted)] text-xs mt-2">Quorum is measured as a percentage of active pubkeys (at least 1 COMPLETED ticket in the last 90 days).</p>
      </div>
    ),
  },
  {
    title: 'I.3 — Voting Procedure',
    content: (
      <ol className="list-decimal list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2">
        <li>Proposer publishes a Governance Proposal (Nostr Kind 30022, sub_type: proposal) — Title, description, options, deadline, voting model</li>
        <li>14-day public comment period before voting opens (Codex amendments only)</li>
        <li>Voting period opens — participants publish Kind 30022 vote events</li>
        <li>Quorum and majority checked at deadline by protocol tallying logic</li>
        <li>Result published as a final Kind 30022 event (immutable, signed by DAO operator pubkey)</li>
      </ol>
    ),
  },
  {
    title: 'I.4 — Delegation (Liquid Democracy)',
    badge: 'Phase 4+',
    content: (
      <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2">
        <li>Voting rights can be delegated to another pubkey</li>
        <li>Delegation is revocable at any time</li>
        <li>Valid for 90 days, then automatically expired</li>
        <li>Delegation is published as a public Nostr Event (auditable)</li>
        <li>COLA delegation: delegatee casts vote with combined stake weight</li>
        <li>1P1V delegation: not permitted — each HID-verified human must vote directly</li>
      </ul>
    ),
  },
  {
    title: 'I.5 — Amendment Procedure (Codex Changes)',
    content: (
      <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2">
        <li>Requirement: 2/3 majority + 21-day voting period (Codex amendment type)</li>
        <li>Proposal must be published 14 days before voting opens</li>
        <li>Change history is traceable through immutable Nostr events</li>
        <li>The <code>codexHash</code> field in all active tickets references the Codex version at ticket creation — amendments do not retroactively affect in-flight tickets</li>
      </ul>
    ),
  },
  {
    title: 'II.1 — Dispute Resolution',
    badge: '3 Levels',
    content: (
      <div className="space-y-2.5">
        <div className="flex gap-3">
          <div className="w-6 h-6 rounded-full text-white text-xs flex items-center justify-center font-bold shrink-0" style={{ background: 'var(--color-accent-1)' }}>1</div>
          <div>
            <span className="font-medium text-sm">Level 1 — Self-Resolution (7 days) · Phase 1+</span>
            <p className="text-[var(--theme-text-muted)] text-xs">Cooling-off, direct negotiation between parties.</p>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="w-6 h-6 rounded-full text-white text-xs flex items-center justify-center font-bold shrink-0" style={{ background: 'var(--color-accent-1)', opacity: 0.4 }}>2</div>
          <div>
            <span className="font-medium text-sm">Level 2 — Community Mediator (14 days) · Phase 3+</span>
            <p className="text-[var(--theme-text-muted)] text-xs">Reputation-selected neutral mediator assists agreement.</p>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="w-6 h-6 rounded-full text-white text-xs flex items-center justify-center font-bold shrink-0" style={{ background: 'var(--color-accent-1)' }}>3</div>
          <div>
            <span className="font-medium text-sm">Level 3 — DAO Court (24–48h) · Phase 4+</span>
            <p className="text-[var(--theme-text-muted)] text-xs">Arbitrator panel, binding verdict. DAO Court verdicts are published as Kind 30019 events with <code>escrow_action</code> tag, triggering Lightning escrow settlement.</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    title: 'II.2 — Sanctions',
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
        <p className="text-[var(--theme-text-muted)] text-xs mt-2">
          Since identity = Lightning wallet pubkey, a banned user could create a new wallet. Sanctions are therefore effective primarily through reputation loss (COL-Points forfeiture, public Nostr sanction event visible to all counterparties).
        </p>
      </div>
    ),
  },
  {
    title: 'II.3 — Security Principles',
    content: (
      <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2">
        <li>Private keys never leave the client device</li>
        <li>No custody — Colabonate holds no Bitcoin at any layer</li>
        <li>All governance decisions are Nostr-signed and immutable on relay</li>
        <li>Open source — protocol spec is MIT licensed; reference implementation is open source</li>
      </ul>
    ),
  },
  {
    title: 'III.1 — Currency and Payment',
    content: (
      <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2">
        <li><strong>Primary currency:</strong> Bitcoin, denominated in satoshis (sats)</li>
        <li>All marketplace payments, escrow, mediator fees, and arbitrator fees are in sats via Lightning Network</li>
        <li>The COLA Token is a <strong>governance and utility token</strong> — it is not a payment currency</li>
        <li>No altcoin integration; RSK (for COLA) is a Bitcoin sidechain with 1:1 BTC peg (RBTC)</li>
      </ul>
    ),
  },
  {
    title: 'III.2 — COLA Token',
    content: (
      <div className="space-y-2.5">
        <div className="flex justify-between">
          <span className="text-[var(--theme-text-muted)]">Symbol</span>
          <span className="font-medium text-sm">COLA</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--theme-text-muted)]">Network</span>
          <span className="font-medium text-sm">RSK (Bitcoin sidechain)</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--theme-text-muted)]">Max Supply</span>
          <span className="font-medium text-sm">100,000,000 COLA</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--theme-text-muted)]">Use</span>
          <span className="font-medium text-sm">Governance voting weight, staking yield</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--theme-text-muted)]">Payment Use</span>
          <span className="font-medium text-sm">Not permitted — all payments in sats</span>
        </div>
      </div>
    ),
  },
  {
    title: 'III.3 — Fees',
    content: (
      <div className="space-y-2.5">
        <div className="flex justify-between">
          <span className="text-[var(--theme-text-muted)]">Platform Fee</span>
          <span className="font-medium text-sm">0% — Phase 1–3</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--theme-text-muted)]">Mediator Fee</span>
          <span className="font-medium text-sm">1% of escrow (in sats) — Phase 4+</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--theme-text-muted)]">Arbitrator Fee</span>
          <span className="font-medium text-sm">2% of escrow (split) — Phase 4+</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--theme-text-muted)]">Protocol Royalty</span>
          <span className="font-medium text-sm">Variable (sat-denominated) — Phase 5+</span>
        </div>
      </div>
    ),
  },
  {
    title: 'III.4 — Community Treasury',
    content: (
      <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2">
        <li>Optional multi-sig Lightning treasury for each Community DAO</li>
        <li>Funding: voluntary contributions, protocol royalties (Phase 5), DAO grants</li>
        <li>Spending: requires Governance Vote (Treasury type)</li>
        <li>Foundation DAO Treasury: 25M COLA allocation (vested)</li>
      </ul>
    ),
  },
  {
    title: 'IV.1 — Identity',
    content: (
      <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2">
        <li>Pseudonymous identity allowed (pubkey = identity, no real name required at Level 0–1)</li>
        <li>Identity levels 0–3 unlock progressive features — no KYC required at any level</li>
        <li>Level 3 (Humanode) is required for 1P1V voting and high-value DAO interactions</li>
      </ul>
    ),
  },
  {
    title: 'IV.2 — Reputation',
    content: (
      <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2">
        <li>Built through: completed tickets (COMPLETED status), mutual reviews (Kind 30024)</li>
        <li>Non-transferable: Soulbound via signed Nostr Events bound to pubkey</li>
        <li>Publicly visible: reputation score is computable from public Nostr events</li>
        <li>Can be lost: losing a dispute, sanctions, abandoning tickets</li>
      </ul>
    ),
  },
  {
    title: 'IV.3 — Inclusion',
    content: (
      <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2">
        <li>No geographic restriction</li>
        <li>A Lightning-compatible wallet is the only technical prerequisite</li>
        <li>No KYC at base level (Level 0 = LNURL-Auth pubkey only)</li>
        <li>Platform UI will be multilingual — Phase 3+</li>
      </ul>
    ),
  },
  {
    title: 'IV.4 — User DAOs (Community DAOs)',
    content: (
      <ul className="list-disc list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2">
        <li>Community members can create their own DAOs governed by a custom Codex</li>
        <li>Based on the Foundation Codex as a template</li>
        <li>Independent governance from the Foundation DAO</li>
        <li>Minimum requirements: 5 founding members, HID Level 2, COLA stake</li>
      </ul>
    ),
  },
  {
    title: 'Appendix A — Foundation DAO Operation',
    badge: 'ADR-125/126',
    content: (
      <>
        <p>
          This appendix documents the operational state of the Foundation DAO. The M2 upgrade (ADR-126)
          lifted the Council from single-admin bootstrap to a multi-member quorum body.
        </p>
        <p className="text-sm font-medium">M2 Quorum Types:</p>
        <div className="space-y-2 mb-3">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-sm">SINGLE</span>
            <span className="text-[var(--theme-text-muted)] text-xs">Any single verdict resolves (backward-compatible with M0)</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-sm">MAJORITY</span>
            <span className="text-[var(--theme-text-muted)] text-xs">&gt;50% of active arbitrators required</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-sm">THRESHOLD</span>
            <span className="text-[var(--theme-text-muted)] text-xs">Exactly N verdicts required</span>
          </div>
        </div>
        <p className="text-sm font-medium">Upgrade Path:</p>
        <ol className="list-decimal list-inside text-[var(--theme-text-muted)] text-xs space-y-1.5 ml-2">
          <li><strong>M2 (implemented):</strong> Admin invites arbitrators → quorum activates → audit trail public</li>
          <li><strong>Phase 3:</strong> Humanode HID integration → 1P1V enforcement → Level 2 mediator pool starts</li>
          <li><strong>Phase 4:</strong> COLA token staking → token-weighted votes → arbitrator compensation → SPLIT outcome</li>
        </ol>
      </>
    ),
  },
]

export function DaoCodex() {
  return (
    <>
      <Seo
        title="DAO Codex"
        description="The DAO Codex: constitutional rules of Colabonate community governance — voting models, proposal types, dispute resolution and sanctions enforced via Nostr."
        path="/about/codex"
      />
    <PageContainer size="standard" spacing="lg">
      <PageHeader
        title="DAO Codex"
        subtitle="Constitutional rules of the Colabonate community governance system"
      />

      <Box className="flex items-center gap-2 mb-6">
        <Chip
          label="Version 1.0.0-draft"
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
          label="Phase 4"
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
        {CODEX_SECTIONS.map((section) => (
          <LegalSectionAccordion key={section.title} section={section} />
        ))}
      </Box>

      <Box className="flex items-center gap-4">
        <Link
          to="/about/foundation"
          className="text-sm font-medium"
          style={{ color: 'var(--color-accent-1)' }}
        >
          ← Foundation DAO
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
