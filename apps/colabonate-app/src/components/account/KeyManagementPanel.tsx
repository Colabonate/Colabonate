import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Typography, Button, IconButton, Alert, Divider } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank'
import KeyIcon from '@mui/icons-material/Key'
import VpnKeyOutlinedIcon from '@mui/icons-material/VpnKeyOutlined'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import PublicOutlinedIcon from '@mui/icons-material/PublicOutlined'
import VerifiedOutlinedIcon from '@mui/icons-material/VerifiedOutlined'
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined'
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined'
import { cn } from '@ds/utils'
import { IdentityStatusBadge } from '../identity/IdentityStatusBadge'
import {
  getIdentityKeyType,
  getIdentityPubkey,
  getMyIdentityStatus,
  getMyNsecBech32,
  toNpub,
  acknowledgeBackup,
  isBackupAcknowledged,
} from '../../lib/nostr-identity'
import { onNip46Change } from '../../lib/nostr-nip46'

/**
 * ADR-195 §3.2 — Tab 1 "Keys & Backup".
 *
 * Zone A: identity overview (npub, status badge, custody disclosure).
 * Zone B: one-time burner nsec export (two-step, masked, re-hide) + offline
 *         backup checklist (sets the local `backupAck` flag).
 *
 * SECURITY (ADR-195 §3.3 / ADR-141): every operation here is client-side. The
 * nsec is read from localStorage only on the burner path and never leaves the
 * browser except via the user's explicit copy. NIP-07/NIP-46 keys cannot be
 * exported in-app.
 */

type ExportStage = 'idle' | 'warn' | 'revealed'

const C = {
  surface: 'var(--theme-surface)',
  bgSubtle: 'var(--theme-bg-subtle)',
  text: 'var(--theme-text)',
  textMuted: 'var(--theme-text-muted)',
  border: 'var(--theme-border)',
  error: 'var(--color-status-error)',
  errorBg: 'var(--color-status-error-bg)',
} as const

function shortNpub(npub: string): string {
  return npub.length < 20 ? npub : `${npub.slice(0, 12)}…${npub.slice(-8)}`
}

function custodyLabel(keyType: ReturnType<typeof getIdentityKeyType>, evmAddress: string | null): string {
  if (evmAddress) return 'MetaMask. Your Nostr key is deterministically derived from your Ethereum address'
  switch (keyType) {
    case 'bunker': return 'a remote signer (NIP-46 bunker): Alby Hub, Amber, or nsecBunker'
    case 'extension': return 'a browser extension (NIP-07)'
    case 'burner': return 'this browser’s local storage (burner key)'
  }
}

/** What the npub is used for — shown as a responsive grid of mini-cards. */
const NPUB_USES: { label: string; text: string; Icon: typeof VerifiedOutlinedIcon }[] = [
  { label: 'Your identity', text: 'Anchors your profile, reputation, reviews, and COL-Points.', Icon: VerifiedOutlinedIcon },
  { label: 'Signs actions', text: 'Every offer, ticket, and identity event is verified against it.', Icon: KeyIcon },
  { label: 'Private messages', text: 'The address peers use to send you NIP-17 encrypted DMs.', Icon: ForumOutlinedIcon },
  { label: 'Receives payments', text: 'Lets others pay and zap you over Lightning and Nostr.', Icon: BoltOutlinedIcon },
]

export function KeyManagementPanel() {
  const [, force] = useState(0)
  // Re-render whenever the NIP-46 connection changes (e.g. connected from Tab 3).
  useEffect(() => onNip46Change(() => force(n => n + 1)), [])

  const keyType = getIdentityKeyType()
  const status = getMyIdentityStatus()
  const pubkeyHex = getIdentityPubkey()
  const npub = useMemo(() => toNpub(pubkeyHex), [pubkeyHex])
  const [evmAddress] = useState<string | null>(() => {
    try { return localStorage.getItem('evmAddress') } catch { return null }
  })

  const [exportStage, setExportStage] = useState<ExportStage>('idle')
  const [revealedNsec, setRevealedNsec] = useState(false)
  const [nsecValue, setNsecValue] = useState<string | null>(null)
  const [copiedNpub, setCopiedNpub] = useState(false)
  const [copiedNsec, setCopiedNsec] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [backupAcked, setBackupAcked] = useState<boolean>(() => isBackupAcknowledged())
  const [showNsecCopied, setShowNsecCopied] = useState(false)

  // MetaMask-derived identities are reproducible from the MetaMask seed, so the
  // regular burner-export flow does not apply (FU-196-C).
  const canExport = keyType === 'burner' && !evmAddress

  function copy(text: string, onDone: () => void) {
    navigator.clipboard?.writeText(text).then(onDone).catch(() => {})
  }

  function handleRevealNsec() {
    setExportError(null)
    try {
      const nsec = getMyNsecBech32()
      setNsecValue(nsec)
      setExportStage('revealed')
      setRevealedNsec(true)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Could not read the burner key')
    }
  }

  function handleCopyNsec() {
    if (!nsecValue) return
    copy(nsecValue, () => {
      setCopiedNsec(true)
      setShowNsecCopied(true)
      // SECURITY: re-hide immediately after copy (ADR-195 §3.3).
      setRevealedNsec(false)
      setTimeout(() => { setCopiedNsec(false); setShowNsecCopied(false) }, 2500)
    })
  }

  function handleAckBackup(value: boolean) {
    acknowledgeBackup(value)
    setBackupAcked(value)
  }

  return (
    <Box className="flex flex-col gap-6">
      {/* ── Zone A: Identity Overview ─────────────────────────────────────── */}
      <Box>
        <IdentityStatusBadge status={status} withExplanation size="medium" />

        {/* Key facts — responsive multi-column grid */}
        <Box className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* npub card */}
          {npub && (
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: C.bgSubtle, border: `1px solid ${C.border}` }}>
              <Box className="flex items-center gap-1.5 mb-1.5">
                <PublicOutlinedIcon sx={{ fontSize: 16, color: 'var(--color-primary-50)' }} />
                <Typography variant="caption" className="!font-semibold !uppercase !tracking-wider" sx={{ color: C.textMuted }}>
                  Nostr public key (npub)
                </Typography>
              </Box>
              <Box
                className={cn('flex', 'items-center', 'gap-1.5', 'p-1.5', 'rounded-lg', 'cursor-pointer')}
                sx={{ bgcolor: C.surface, border: `1px solid ${C.border}` }}
                onClick={() => copy(npub, () => { setCopiedNpub(true); setTimeout(() => setCopiedNpub(false), 2000) })}
              >
                <code className="text-[12px] font-mono text-(--theme-text) break-all">{shortNpub(npub)}</code>
                <IconButton size="small" aria-label="Copy npub" sx={{ ml: 'auto' }}>
                  <ContentCopyIcon sx={{ fontSize: 14, color: C.textMuted }} />
                </IconButton>
              </Box>
              {copiedNpub && (
                <Typography variant="caption" sx={{ color: 'var(--color-status-success)', display: 'block', mt: 0.5 }}>
                  npub copied
                </Typography>
              )}
            </Box>
          )}

          {/* Custody card */}
          <Box sx={{ p: 2, borderRadius: 2, bgcolor: C.bgSubtle, border: `1px solid ${C.border}` }}>
            <Box className="flex items-center gap-1.5 mb-1.5">
              <VpnKeyOutlinedIcon sx={{ fontSize: 16, color: 'var(--color-primary-50)' }} />
              <Typography variant="caption" className="!font-semibold !uppercase !tracking-wider" sx={{ color: C.textMuted }}>
                Key custody
              </Typography>
            </Box>
            <Typography variant="body2" sx={{ color: C.textMuted }}>
              Your identity key is held by{' '}
              <Box component="span" sx={{ color: C.text, fontWeight: 600 }}>
                {custodyLabel(keyType, evmAddress)}
              </Box>
              .
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* ── What is the npub? explainer ──────────────────────────────────── */}
      <Box sx={{ p: 2.5, borderRadius: 2, bgcolor: C.surface, border: `1px solid ${C.border}` }}>
        <Typography variant="subtitle2" className="!font-bold" sx={{ color: C.text, mb: 0.5 }}>
          What is your npub?
        </Typography>
        <Typography variant="body2" sx={{ color: C.textMuted, mb: 2 }}>
          Your <strong>npub</strong> (Nostr public key) is the human-readable form of your identity: a
          <code className="mx-1 px-1 py-0.5 rounded bg-[var(--theme-bg-subtle)] text-[12px]">npub1…</code>
          string. Think of it as your username and address on Colabonate and the wider Nostr network.
          It is derived from your <em>public</em> key, so sharing it is safe. It cannot let anyone
          impersonate you or move your funds. Only the matching <strong>nsec</strong> (private key) is
          secret.
        </Typography>

        {/* What it's used for — multi-column grid of uses */}
        <Box className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {NPUB_USES.map(u => (
            <Box
              key={u.label}
              className={cn('flex', 'flex-col', 'gap-1', 'p-2.5', 'rounded-xl')}
              sx={{ bgcolor: C.bgSubtle, border: `1px solid ${C.border}` }}
            >
              <u.Icon sx={{ fontSize: 20, color: 'var(--color-primary-50)' }} />
              <Typography variant="caption" className="!font-semibold" sx={{ color: C.text }}>
                {u.label}
              </Typography>
              <Typography variant="caption" sx={{ color: C.textMuted, lineHeight: 1.5 }}>
                {u.text}
              </Typography>
            </Box>
          ))}
        </Box>

        <Box className="mt-2.5">
          <Link
            to="/help/wallet#wallet-keys-4"
            className="inline-flex items-center gap-1 text-[13px] font-medium"
            style={{ color: 'var(--color-primary-50)' }}
          >
            <HelpOutlineIcon sx={{ fontSize: 15 }} />
            Learn more about your npub in the Help Center
          </Link>
        </Box>
      </Box>

      <Divider sx={{ borderColor: C.border }} />

      {/* ── Zone B: Backup & Export (burner / local key only) ─────────────── */}
      {evmAddress ? (
        <Box>
          <Typography variant="subtitle2" className="!font-bold" sx={{ color: C.text }}>
            MetaMask-derived identity
          </Typography>
          <Typography variant="caption" sx={{ color: C.textMuted, display: 'block', mb: 2 }}>
            Your Nostr identity is deterministically derived from a MetaMask signature. As long as
            you control the same MetaMask seed, you can reproduce this identity on any device.
            Clearing the browser cache does not lose your identity, but you will need to sign the
            derivation message again to restore it.
          </Typography>
          <Alert severity="info" sx={{ bgcolor: 'transparent' }}>
            <Typography variant="caption">
              For maximum sovereignty, consider connecting a NIP-46 bunker later. Reputation does
              not transfer automatically when you switch identity methods.
            </Typography>
          </Alert>
        </Box>
      ) : canExport ? (
        <Box>
          <Typography variant="subtitle2" className="!font-bold" sx={{ color: C.text }}>
            Back up your identity
          </Typography>
          <Typography variant="caption" sx={{ color: C.textMuted, display: 'block', mb: 2 }}>
            This burner identity lives only in this browser. Export your private key and store it
            offline. Clearing the browser otherwise loses your identity and reputation permanently.
          </Typography>

          {/* Export flow */}
          {exportStage === 'idle' && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<KeyIcon />}
              onClick={() => setExportStage('warn')}
              sx={{ textTransform: 'none', borderColor: C.error, color: C.error }}
            >
              Show my private key (nsec)
            </Button>
          )}

          {exportStage === 'warn' && (
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: C.errorBg, border: `1px solid ${C.error}55` }}>
              <Typography variant="body2" className="!font-semibold" sx={{ color: C.error, mb: 1 }}>
                Anyone with this key controls your identity.
              </Typography>
              <Typography variant="caption" sx={{ color: C.textMuted, display: 'block', mb: 2 }}>
                Never type it into a website, never send it to anyone, never store it online.
                Colabonate staff will never ask for it.
              </Typography>
              <Box className="flex gap-2">
                <Button variant="contained" size="small" color="error" onClick={handleRevealNsec} sx={{ textTransform: 'none' }}>
                  I understand, reveal
                </Button>
                <Button variant="text" size="small" onClick={() => setExportStage('idle')} sx={{ textTransform: 'none', color: C.textMuted }}>
                  Cancel
                </Button>
              </Box>
            </Box>
          )}

          {exportStage === 'revealed' && (
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: C.bgSubtle, border: `1px solid ${C.border}` }}>
              <Box className="flex items-center gap-1.5">
                <code className="text-[13px] font-mono text-(--theme-text) break-all flex-1">
                  {revealedNsec ? nsecValue : (nsecValue ? `${nsecValue.slice(0, 16)}${'•'.repeat(14)}` : '')}
                </code>
                <IconButton
                  size="small"
                  aria-label={revealedNsec ? 'Hide' : 'Show'}
                  onClick={() => setRevealedNsec(v => !v)}
                >
                  {revealedNsec ? <VisibilityOffIcon sx={{ fontSize: 18 }} /> : <VisibilityIcon sx={{ fontSize: 18 }} />}
                </IconButton>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<ContentCopyIcon />}
                  onClick={handleCopyNsec}
                  sx={{ textTransform: 'none' }}
                >
                  {copiedNsec ? 'Copied' : 'Copy'}
                </Button>
              </Box>
              <Typography variant="caption" sx={{ color: C.textMuted, display: 'block', mt: 1 }}>
                Paste it into a password manager or write it down offline, then close this panel.
              </Typography>
              <Button variant="text" size="small" onClick={() => { setExportStage('idle'); setNsecValue(null) }} sx={{ textTransform: 'none', color: C.textMuted, mt: 1 }}>
                Done, hide
              </Button>
            </Box>
          )}

          {exportError && (
            <Alert severity="error" sx={{ mt: 1.5, bgcolor: 'transparent' }}>
              {exportError}
            </Alert>
          )}

          {/* Backup checklist */}
          <Box className="mt-4">
            <Typography variant="caption" className="!font-semibold" sx={{ color: C.text, display: 'block', mb: 1 }}>
              Confirm offline storage
            </Typography>
            <BackupChecklist acked={backupAcked} onToggle={handleAckBackup} />
          </Box>
        </Box>
      ) : (
        <Alert severity="info" icon={<VpnKeyOutlinedIcon fontSize="inherit" />} sx={{ bgcolor: 'transparent' }}>
          <Typography variant="caption">
            Your key is held by {custodyLabel(keyType, evmAddress)}. Back it up using that signer’s own export
            flow. Colabonate never holds and cannot export it.
          </Typography>
        </Alert>
      )}

      {showNsecCopied && (
        <Alert severity="success" sx={{ bgcolor: 'transparent' }}>
          nsec copied. It has been hidden again. Store it offline now.
        </Alert>
      )}
    </Box>
  )
}

// ── Backup checklist (burner) ──────────────────────────────────────────────────
const CHECKLIST_ITEMS = [
  'I exported my private key (nsec).',
  'I stored it offline (password manager, paper, or hardware).',
  'I will never paste it into another website.',
]

function BackupChecklist({ acked, onToggle }: { acked: boolean; onToggle: (v: boolean) => void }) {
  const [checked, setChecked] = useState<boolean[]>(() => [false, false, false])

  const allChecked = checked.every(Boolean)

  function toggleItem(i: number) {
    const next = checked.map((v, idx) => (idx === i ? !v : v))
    setChecked(next)
    if (next.every(Boolean)) onToggle(true)
    else if (acked) onToggle(false)
  }

  return (
    <Box>
      <Box className="flex flex-col gap-1.5">
        {CHECKLIST_ITEMS.map((item, i) => (
          <Box
            key={i}
            component="button"
            onClick={() => toggleItem(i)}
            className={cn('flex', 'items-start', 'gap-2', 'text-left', 'p-1.5', 'rounded-md', 'cursor-pointer', 'transition-colors')}
            sx={{
              bgcolor: 'transparent',
              border: 'none',
              '&:hover': { bgcolor: C.bgSubtle },
            }}
          >
            {checked[i]
              ? <CheckCircleOutlineIcon sx={{ fontSize: 18, color: 'var(--color-status-success)', mt: '1px' }} />
              : <CheckBoxOutlineBlankIcon sx={{ fontSize: 18, color: C.textMuted, mt: '1px' }} />
            }
            <Typography variant="caption" sx={{ color: C.text }}>{item}</Typography>
          </Box>
        ))}
      </Box>
      {acked && allChecked && (
        <Typography variant="caption" sx={{ color: 'var(--color-status-success)', display: 'block', mt: 1 }}>
          ✓ Backup recorded (on this device only).
        </Typography>
      )}
    </Box>
  )
}
