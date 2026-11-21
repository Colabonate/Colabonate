import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@mui/material'
import { cn } from '@ds/utils'
import { apiCall } from '../../lib/api'
import { isNip07Available, toNpub } from '../../lib/nostr-identity'
import { isNip46Active } from '../../lib/nostr-nip46'
import { NostrProfileForm } from '../identity/NostrProfileForm'
import type { IdentityData } from '../../types/identity'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import LockIcon from '@mui/icons-material/Lock'
import PersonIcon from '@mui/icons-material/Person'
import ShieldIcon from '@mui/icons-material/Shield'
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward'
import DownloadIcon from '@mui/icons-material/Download'

/**
 * Identity Level tab (redesign):
 *  - No collapsibles — every level is a static UI card.
 *  - Big level number to the left of the icon.
 *  - The current level is a prominently highlighted card.
 *  - A "Next Step" hero card sits ABOVE the levels: it introduces and
 *    explains the single action that advances the user from their current
 *    level to the next (e.g. "Connect Nostr Profile → Level 1").
 */

// ─── Identity Level Config ─────────────────────────────────────────────────────
const IDENTITY_LEVELS = [
  {
    level: 0,
    label: 'Anonymous',
    icon: <PersonIcon />,
    color: 'var(--identity-anonymous-color)',
    bg: 'var(--identity-anonymous-bg)',
    borderColor: 'var(--identity-anonymous-border)',
    headline: 'No identity verified',
    headlinePending: 'No identity verified',
    description: 'Browse offers and create a profile, but no trades or trust-gated features.',
    unlocks: ['Browse marketplace', 'View offers & vendors'],
    locked: ['Create offers', 'Start tickets', 'DAO participation'],
  },
  {
    level: 1,
    label: 'Nostr Profile',
    icon: <AccountCircleIcon />,
    color: 'var(--identity-nostr-color)',
    bg: 'var(--identity-nostr-bg)',
    borderColor: 'var(--identity-nostr-border)',
    headline: 'Nostr identity linked',
    headlinePending: 'Link a Nostr identity',
    description: 'Your public key is bound to a Nostr profile. Create offers and open tickets.',
    unlocks: ['Create offers', 'Open & accept tickets', 'Basic reputation', 'Public profile page'],
    locked: ['DAO governance votes', 'High-value ticket limits', 'Arbitrator eligibility'],
  },
  {
    level: 2,
    label: 'Peer Verified',
    icon: <VerifiedUserIcon />,
    color: 'var(--identity-peer-color)',
    bg: 'var(--identity-peer-bg)',
    borderColor: 'var(--identity-peer-border)',
    headline: 'Verified by peers',
    headlinePending: 'Get verified by 2 peers',
    description: 'Two independent verifiers confirm your identity, unlocking governance and higher trust.',
    unlocks: ['DAO governance', 'Higher trade limits', 'Priority matching', 'Reduced dispute risk'],
    locked: ['1-person-1-vote weight', 'Arbitrator eligibility'],
  },
  {
    level: 3,
    label: 'HID Verified',
    icon: <ShieldIcon />,
    color: 'var(--identity-hid-color)',
    bg: 'var(--identity-hid-bg)',
    borderColor: 'var(--identity-hid-border)',
    headline: 'Biometric ZK-verified',
    headlinePending: 'Complete biometric ZK-verification',
    description: 'Zero-knowledge biometric proof via Humanode Biomapper, the highest trust level.',
    unlocks: ['1-person-1-vote governance', 'Arbitrator eligibility', 'Max ticket limits', 'Full trust multiplier'],
    locked: [],
  },
] as const

type LevelCfg = (typeof IDENTITY_LEVELS)[number]

// What the user must do to advance FROM a given level to the next.
const NEXT_STEPS: Record<number, { title: string; body: string; cta: string }> = {
  0: {
    title: 'Connect your Nostr Profile to reach Level 1',
    body: 'You are currently anonymous (Level 0). To create offers, open tickets and unlock the marketplace, bind your public key to a Nostr profile. Already have a Nostr profile? Import it and adopt it as-is, no re-publish needed. This is the first trust upgrade: it takes a minute and stays portable across devices.',
    cta: 'Connect Nostr Profile → Level 1',
  },
  1: {
    title: 'Get verified by two peers to reach Level 2',
    body: 'Level 1 lets you trade. Level 2 unlocks DAO governance and higher limits. It requires two independent community verifiers to confirm your identity via an in-person proximity proof.',
    cta: 'Start Peer Verification (Mock)',
  },
  2: {
    title: 'Complete biometric ZK-verification to reach Level 3',
    body: 'Level 3 is the highest trust tier: a zero-knowledge biometric proof via Humanode Biomapper guarantees 1-person-1-account and enables arbitrator roles.',
    cta: 'Humanode HID Verification',
  },
}

// ─── Level Card ────────────────────────────────────────────────────────────────
type CardState = 'current' | 'achieved' | 'next' | 'locked'

function stateFor(level: number, current: number): CardState {
  if (level === current) return 'current'
  if (level < current) return 'achieved'
  if (level === current + 1) return 'next'
  return 'locked'
}

function LevelCard({ cfg, current, npub }: { cfg: LevelCfg; current: number; npub?: string | null }) {
  const state = stateFor(cfg.level, current)
  const isCurrent = state === 'current'
  const isAchieved = state === 'achieved'
  const isNext = state === 'next'
  const isLocked = state === 'locked'
  const dimmed = isLocked

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-2xl p-5 transition-all duration-200',
        'border',
        isCurrent && 'border-2',
        dimmed && 'opacity-65',
      )}
      style={{
        borderColor: isCurrent || isAchieved || isNext ? cfg.borderColor : 'var(--theme-border)',
        backgroundColor: isCurrent ? cfg.bg : isAchieved || isNext ? 'var(--theme-surface)' : 'var(--theme-surface)',
        boxShadow: isCurrent
          ? `0 0 0 4px color-mix(in srgb, ${cfg.color} 16%, transparent)`
          : isNext
            ? `0 0 0 1px color-mix(in srgb, ${cfg.color} 24%, transparent)`
            : 'none',
      }}
    >
      {/* Header: big number + icon */}
      <div className="flex items-center gap-3">
        {/* Big number */}
        <span
          className="flex items-center justify-center font-extrabold leading-none select-none"
          style={{
            fontSize: '2rem',
            minWidth: '2.25rem',
            height: '2.25rem',
            color: isCurrent || isAchieved || isNext ? cfg.color : 'var(--theme-text-muted)',
            backgroundColor: isCurrent || isAchieved || isNext ? cfg.bg : 'var(--theme-bg-subtle)',
            border: `1px solid ${isCurrent || isAchieved || isNext ? cfg.borderColor : 'var(--theme-border)'}`,
            borderRadius: '0.75rem',
            padding: '0 0.4rem',
            fontFamily: 'var(--typography-fontfamily-sans)',
          }}
        >
          {cfg.level}
        </span>

        {/* Icon */}
        <span
          className="flex items-center justify-center rounded-xl"
          style={{
            width: '2.25rem',
            height: '2.25rem',
            color: isCurrent || isAchieved || isNext ? cfg.color : 'var(--theme-text-muted)',
            backgroundColor: isCurrent || isAchieved || isNext ? cfg.bg : 'var(--theme-bg-subtle)',
            border: `1px solid ${isCurrent || isAchieved || isNext ? cfg.borderColor : 'var(--theme-border)'}`,
          }}
        >
          {cfg.icon}
        </span>

        {/* Status badge */}
        <div className="ml-auto flex flex-col items-end gap-1">
          {isCurrent && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold"
              style={{ backgroundColor: cfg.color, color: '#fff', fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              <CheckCircleIcon sx={{ fontSize: 13 }} /> Current
            </span>
          )}
          {isAchieved && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{ color: cfg.color, border: `1px solid ${cfg.borderColor}`, fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              <CheckCircleIcon sx={{ fontSize: 13 }} /> Achieved
            </span>
          )}
          {isNext && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold"
              style={{ backgroundColor: cfg.bg, color: cfg.color, border: `1px solid ${cfg.borderColor}`, fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              <ArrowForwardIcon sx={{ fontSize: 13 }} /> Up next
            </span>
          )}
          {isLocked && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium"
              style={{ color: 'var(--theme-text-muted)', border: '1px solid var(--theme-border)', fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              <LockIcon sx={{ fontSize: 12 }} /> Locked
            </span>
          )}
        </div>
      </div>

      {/* Title + headline */}
      <div className="mt-4">
        <h3
          className="text-[15px] font-semibold"
          style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
        >
          {cfg.label}
        </h3>
        <p
          className="mt-0.5 text-[12px]"
          style={{ color: isAchieved || isCurrent ? cfg.color : 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
        >
          {isAchieved || isCurrent ? cfg.headline : cfg.headlinePending}
        </p>
        <p
          className="mt-2 text-[12px] leading-relaxed"
          style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
        >
          {cfg.description}
        </p>

        {/* L1 — surface the linked Nostr identity once the level is reached */}
        {cfg.level === 1 && (isCurrent || isAchieved) && npub && (
          <div className="mt-3">
            <span
              className="block text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              Your npub
            </span>
            <code
              className="mt-1 block break-all rounded-lg px-2.5 py-1.5 text-[11px] font-mono"
              style={{
                backgroundColor: 'var(--theme-bg-subtle)',
                border: '1px solid var(--theme-border)',
                color: 'var(--theme-text)',
              }}
            >
              {npub}
            </code>
          </div>
        )}
      </div>

      {/* Unlocks / locked lists */}
      <div className="mt-4 space-y-2">
        {cfg.unlocks.map(item => (
          <div key={item} className="flex items-start gap-2">
            <CheckCircleOutlineIcon sx={{ fontSize: 14, color: cfg.color, mt: '2px', flexShrink: 0 }} />
            <span className="text-[12px] leading-snug" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
              {item}
            </span>
          </div>
        ))}
        {cfg.locked.map(item => (
          <div key={item} className="flex items-start gap-2">
            <LockIcon sx={{ fontSize: 13, color: 'var(--theme-text-muted)', mt: '2px', flexShrink: 0 }} />
            <span className="text-[12px] leading-snug" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
              {item}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Next Step Hero Card ───────────────────────────────────────────────────────
function NextStepCard({
  currentLevel,
  pubkey,
  onIdentityChanged,
}: {
  currentLevel: number
  pubkey: string
  onIdentityChanged: (data: IdentityData) => void
}) {
  const step = NEXT_STEPS[currentLevel]
  const nextCfg = IDENTITY_LEVELS[currentLevel + 1]
  const [expanded, setExpanded] = useState(false)
  // Opens the inline NostrProfileForm with the relay import already running —
  // set by the "Import from Nostr" button below.
  const [autoImport, setAutoImport] = useState(false)
  const [busy, setBusy] = useState(false)
  // A connected signer (NIP-07 extension like Alby, or a NIP-46 bunker) makes
  // the direct connect path the shortest route to Level 1 — surface it as the
  // primary CTA instead of telling the user no extension is installed.
  const hasNip07 = isNip07Available()
  const hasSigner = hasNip07 || isNip46Active()

  if (!step || !nextCfg) return null

  async function handleMockL2Upgrade() {
    if (!pubkey) return
    setBusy(true)
    try {
      const res = await apiCall('/api/identity/upgrade-l2-mock', {
        method: 'POST',
        body: JSON.stringify({ pubkey }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data && !data.error) onIdentityChanged(data as IdentityData)
      }
    } catch (e) {
      console.error('L2 mock upgrade failed', e)
    } finally {
      setBusy(false)
    }
  }

  const isHid = currentLevel === 2

  // Shared L0 CTA styles — the same two buttons appear in both branches below
  // (signer detected vs. no signer), only their order/labels change.
  const primaryBtnSx = {
    textTransform: 'none',
    borderRadius: '12px',
    fontWeight: 600,
    fontSize: '13px',
    px: 2,
    py: 1,
    fontFamily: 'var(--typography-fontfamily-sans)',
    backgroundColor: nextCfg.color,
    boxShadow: 'none',
    '&:hover': { backgroundColor: nextCfg.color, opacity: 0.9, boxShadow: 'none' },
  }
  const secondaryBtnSx = {
    textTransform: 'none',
    borderRadius: '12px',
    fontWeight: 600,
    fontSize: '13px',
    px: 2,
    py: 1,
    fontFamily: 'var(--typography-fontfamily-sans)',
    color: nextCfg.color,
    borderColor: nextCfg.borderColor,
  }

  return (
    <div
      className="rounded-2xl border-2 p-5 sm:p-6"
      style={{
        borderColor: nextCfg.borderColor,
        backgroundColor: nextCfg.bg,
      }}
    >
      <div className="flex items-start gap-4">
        {/* Icon — styled like the Account avatar (primary tokens, rounded-2xl, border-2) */}
        <span
          className="flex items-center justify-center rounded-2xl shrink-0 border-2"
          style={{
            width: '3.5rem',
            height: '3.5rem',
            backgroundColor: 'var(--color-primary-10)',
            borderColor: 'var(--color-primary-30)',
            color: 'var(--color-primary-50)',
          }}
        >
          <span style={{ display: 'flex', transform: 'scale(1.4)' }}>{nextCfg.icon}</span>
        </span>

        <div className="min-w-0 flex-1">
          {/* Refined chip — tinted, outlined, with icon (not a solid pill) */}
          <span
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
            style={{
              backgroundColor: nextCfg.bg,
              color: nextCfg.color,
              border: `1px solid ${nextCfg.borderColor}`,
              fontFamily: 'var(--typography-fontfamily-sans)',
            }}
          >
            <ArrowForwardIcon sx={{ fontSize: 12 }} />
            Next Step · Level {currentLevel} → {currentLevel + 1}
          </span>
          <h3
            className="mt-2 text-[16px] font-bold leading-snug"
            style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            {step.title}
          </h3>
          <p
            className="mt-1.5 text-[13px] leading-relaxed"
            style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            {step.body}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {currentLevel === 0 && (
              <div className="flex flex-col gap-2 w-full">
                <div className="flex flex-wrap items-center gap-3">
                  {hasSigner ? (
                    <>
                      {/* Signer detected (NIP-07 extension like Alby, or a NIP-46 bunker):
                          connecting it directly is the shortest route to L1, so it is the
                          primary CTA here. ADR-225 D2's generate-key-first order applies
                          only when no signer is available. */}
                      <Button
                        variant="contained"
                        onClick={() => { setAutoImport(true); setExpanded(true) }}
                        startIcon={<DownloadIcon />}
                        sx={primaryBtnSx}
                      >
                        {step.cta} &amp; import my data
                      </Button>
                      <Button
                        variant="outlined"
                        onClick={() => { setAutoImport(false); setExpanded(v => !v) }}
                        startIcon={<AccountCircleIcon />}
                        sx={secondaryBtnSx}
                      >
                        {expanded && !autoImport ? 'Cancel' : 'Fill in manually'}
                      </Button>
                      <Button
                        component={Link}
                        to="/onboarding/generate-nostr-key"
                        variant="outlined"
                        startIcon={<ArrowForwardIcon />}
                        sx={secondaryBtnSx}
                      >
                        Generate a new key instead
                      </Button>
                    </>
                  ) : (
                    <>
                      {/* ADR-225 D2: primary path — most L0 users (email/lightning login)
                          have no NIP-07 extension, so the sovereign generate-key path
                          is the one most people actually need. */}
                      <Button
                        component={Link}
                        to="/onboarding/generate-nostr-key"
                        variant="contained"
                        startIcon={<AccountCircleIcon />}
                        sx={primaryBtnSx}
                      >
                        Generate a Nostr key for me
                      </Button>
                      <Button
                        variant="outlined"
                        onClick={() => { setAutoImport(true); setExpanded(true) }}
                        startIcon={<DownloadIcon />}
                        sx={secondaryBtnSx}
                      >
                        I have a Nostr profile, import it
                      </Button>
                      <Button
                        variant="outlined"
                        onClick={() => { setAutoImport(false); setExpanded(v => !v) }}
                        startIcon={<ArrowForwardIcon />}
                        sx={secondaryBtnSx}
                      >
                        {expanded && !autoImport ? 'Cancel' : 'I already have a Nostr extension'}
                      </Button>
                    </>
                  )}
                </div>
                <p
                  className="text-[12px] leading-relaxed"
                  style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                >
                  {hasSigner
                    ? `${hasNip07 ? 'Nostr extension detected' : 'Nostr signer connected'}. Connect it to bind your Nostr profile to this account and unlock Level 1. Prefer a separate key for Colabonate? Generate a new one. It takes under a minute and never leaves your browser.`
                    : 'No Nostr extension installed (e.g. Alby, nos2x)? Generate a key. It takes under a minute and never leaves your browser. Already have one? Connect it directly instead.'}
                </p>
              </div>
            )}

            {currentLevel === 1 && (
              <>
                <span
                  className="inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium"
                  style={{ backgroundColor: 'rgba(255,192,57,0.14)', color: 'var(--color-warning-primary)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                >
                  Phase 3: Mock
                </span>
                <Button
                  variant="contained"
                  onClick={handleMockL2Upgrade}
                  disabled={busy}
                  startIcon={<VerifiedUserIcon />}
                  sx={{
                    textTransform: 'none',
                    borderRadius: '12px',
                    fontWeight: 600,
                    fontSize: '13px',
                    px: 2,
                    py: 1,
                    fontFamily: 'var(--typography-fontfamily-sans)',
                    backgroundColor: nextCfg.color,
                    boxShadow: 'none',
                    '&:hover': { backgroundColor: nextCfg.color, opacity: 0.9, boxShadow: 'none' },
                  }}
                >
                  {busy ? 'Verifying…' : step.cta}
                </Button>
              </>
            )}

            {isHid && (
              <>
                <span
                  className="inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium"
                  style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                >
                  Phase 4: Coming soon
                </span>
                <Button
                  variant="outlined"
                  disabled
                  startIcon={<ShieldIcon />}
                  sx={{
                    textTransform: 'none',
                    borderRadius: '12px',
                    fontWeight: 600,
                    fontSize: '13px',
                    px: 2,
                    py: 1,
                    fontFamily: 'var(--typography-fontfamily-sans)',
                    color: 'var(--theme-text-muted)',
                    borderColor: 'var(--theme-border)',
                  }}
                >
                  {step.cta}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Inline Nostr connect form */}
      {currentLevel === 0 && expanded && (
        <div className="mt-5 rounded-xl p-4" style={{ backgroundColor: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
          <NostrProfileForm
            pubkey={pubkey}
            autoImport={autoImport}
            onSuccess={(data) => { onIdentityChanged(data); setExpanded(false) }}
            onCancel={() => setExpanded(false)}
          />
        </div>
      )}
    </div>
  )
}

// ─── Section ───────────────────────────────────────────────────────────────────
interface IdentityLevelSectionProps {
  identityData: IdentityData | null
  pubkey: string
  onIdentityChanged: (data: IdentityData) => void
}

export function IdentityLevelSection({ identityData, pubkey, onIdentityChanged }: IdentityLevelSectionProps) {
  const currentLevel = identityData?.identityLevel ?? 0
  const npub = toNpub(identityData?.nostrPubkey ?? pubkey ?? '')

  return (
    <div className="flex flex-col gap-6">
      {/* Intro — why levels exist + Web of Trust */}
      <div className={cn('grid grid-cols-1 lg:grid-cols-2 gap-6')}>
        {/* Trust-based marketplace */}
        <div>
          <h3>Trust-based marketplace</h3>
          <p
            className="mt-2 text-[13px] leading-relaxed"
            style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            Colabonate is a trust-based marketplace. Instead of one account type, it uses a four-step
            trust ladder (L0 to L3): each level adds independent verification, so others can rely on you
            more and you unlock more features, from browsing (L0), to trading (L1), DAO governance (L2),
            up to one-person-one-vote and arbitration (L3). Higher levels also resist bots and
            multi-accounting. Complete the highlighted next step to climb from your current level.
          </p>
          <Link
            to="/help/getting-started#gs-2"
            className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold"
            style={{ color: 'var(--color-primary-50)', fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            Learn how identity levels work
            <ArrowOutwardIcon sx={{ fontSize: 13 }} />
          </Link>
        </div>

        {/* Web of Trust */}
        <div>
          <h3>Web of Trust</h3>
          <p
            className="mt-2 text-[13px] leading-relaxed"
            style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            Identity levels are one half of Colabonate's trust model; the other half is the Web of Trust.
            In the Nostr Web of Trust, reputation flows through real social relationships: follows,
            recommendations, and verified interactions between people you already know. Colabonate uses
            identity levels as a structured, sybil-resistant complement to this social graph, so you can
            trust strangers for commerce even when you do not share a direct social circle.
          </p>
          <Link
            to="/help/identity-trust#id-7"
            className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold"
            style={{ color: 'var(--color-primary-50)', fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            Learn how Web of Trust works
            <ArrowOutwardIcon sx={{ fontSize: 13 }} />
          </Link>
        </div>
      </div>

      {/* Next Step — appears before the levels */}
      {identityData && (
        <NextStepCard currentLevel={currentLevel} pubkey={pubkey} onIdentityChanged={onIdentityChanged} />
      )}

      {/* Level cards — responsive grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {IDENTITY_LEVELS.map(cfg => (
          <LevelCard key={cfg.level} cfg={cfg} current={currentLevel} npub={npub} />
        ))}
      </div>
    </div>
  )
}
