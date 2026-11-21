/**
 * DmMessageCard — A single inbox row for the DmMessage inbox view.
 *
 * ADR-152: Phase 2.5 — Inbox-Filter UI (All / Offers / Coops / Chat).
 * Renders a clickable card summarizing a DmMessage. The card visual
 * differs by inferred category:
 *   - offer  → envelope icon (lila), title + price preview
 *   - cooperation → handshake icon (blau), title preview
 *   - chat   → message icon (grau), first line preview
 *   - other  → generic icon, raw payload preview
 *
 * Props:
 * - message: DmMessage row
 * - onClick: navigation handler (parent decides where to go)
 * - selected: highlight if currently active
 */
import { useMemo } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import HandshakeOutlinedIcon from '@mui/icons-material/HandshakeOutlined'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import BoltIcon from '@mui/icons-material/Bolt'
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined'
import { cn } from '@ds/utils'
import type { DmMessage, PrivateOfferPayload } from '../../hooks/useDmMessage'

export type DmCategory = 'offer' | 'cooperation' | 'chat' | 'other'

export interface DmMessageCardProps {
  message: DmMessage
  onClick: () => void
  selected?: boolean
}

/** Infer the category of a DmMessage from its kind + payload.type. */
export function inferDmCategory(message: DmMessage): DmCategory {
  if (message.kind === 1059) return 'offer' // gift-wrapped private offer
  if (message.kind !== 14) return 'other'
  // kind=14 (legacy plaintext): inspect payload.type
  let parsed: PrivateOfferPayload | null = null
  try {
    parsed = message.payload ? JSON.parse(message.payload) : null
  } catch {
    return 'chat'
  }
  if (!parsed) return 'chat'
  if (parsed.type === 'offer' || parsed.type === 'counter') return 'offer'
  if (parsed.type === 'cooperation') return 'cooperation'
  if (parsed.type === 'message') return 'chat'
  return 'other'
}

function shortPubkey(pk: string): string {
  if (pk.length <= 14) return pk
  return `${pk.slice(0, 6)}…${pk.slice(-6)}`
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

function previewFor(message: DmMessage, category: DmCategory): { primary: string; secondary?: string } {
  if (category === 'offer') {
    try {
      const p = JSON.parse(message.payload) as PrivateOfferPayload
      return {
        primary: p.title ?? '(no title)',
        secondary: p.priceSats != null ? `${p.priceSats.toLocaleString()} sats` : undefined,
      }
    } catch { /* fallthrough */ }
  }
  if (category === 'cooperation') {
    try {
      const p = JSON.parse(message.payload) as PrivateOfferPayload
      return { primary: p.title ?? '(no title)', secondary: 'Cooperation proposal' }
    } catch { /* fallthrough */ }
  }
  // chat / other: first line of the payload
  const firstLine = (message.payload ?? '').split('\n')[0]?.trim() ?? ''
  return {
    primary: firstLine || (category === 'chat' ? 'New message' : '(empty)'),
    secondary: undefined,
  }
}

const CATEGORY_STYLES: Record<DmCategory, {
  Icon: typeof LockOutlinedIcon
  iconColor: string
  badgeBg: string
  badgeBorder: string
  label: string
}> = {
  offer: {
    Icon: LockOutlinedIcon,
    iconColor: '#B794F4',
    badgeBg: 'rgba(159,122,234,0.10)',
    badgeBorder: 'rgba(159,122,234,0.30)',
    label: 'Offer',
  },
  cooperation: {
    Icon: HandshakeOutlinedIcon,
    iconColor: '#63B3ED',
    badgeBg: 'rgba(99,179,237,0.10)',
    badgeBorder: 'rgba(99,179,237,0.30)',
    label: 'Cooperation',
  },
  chat: {
    Icon: ChatBubbleOutlineIcon,
    iconColor: 'var(--color-neutral-5)',
    badgeBg: 'rgba(113,128,150,0.10)',
    badgeBorder: 'rgba(113,128,150,0.30)',
    label: 'Chat',
  },
  other: {
    Icon: ChatBubbleOutlineIcon,
    iconColor: 'var(--color-neutral-5)',
    badgeBg: 'rgba(113,128,150,0.10)',
    badgeBorder: 'rgba(113,128,150,0.30)',
    label: 'Message',
  },
}

export function DmMessageCard({ message, onClick, selected }: DmMessageCardProps) {
  const category = useMemo(() => inferDmCategory(message), [message])
  const style = CATEGORY_STYLES[category]
  const { Icon } = style
  const preview = useMemo(() => previewFor(message, category), [message, category])
  const isEncrypted = message.kind === 1059

  return (
    <Box
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick() }}
      className={cn(
        'group flex items-start gap-3 p-3 rounded-xl cursor-pointer',
        'transition-all duration-200 ease-out',
        'hover:-translate-y-px',
      )}
      style={{
        background: selected ? 'var(--theme-item-active)' : 'var(--theme-surface)',
        border: `1px solid ${selected ? 'var(--color-primary-50)' : 'var(--theme-border)'}`,
        boxShadow: selected ? '0 2px 8px rgba(99,179,237,0.15)' : 'none',
      }}
    >
      {/* ── Icon Badge ── */}
      <Box
        className="flex items-center justify-center shrink-0"
        sx={{
          width: 44,
          height: 44,
          borderRadius: '12px',
          bgcolor: style.badgeBg,
          border: `1px solid ${style.badgeBorder}`,
        }}
      >
        <Icon sx={{ fontSize: 22, color: style.iconColor }} />
      </Box>

      {/* ── Content ── */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.25 }}>
          <span
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm uppercase"
            style={{
              fontSize: '9px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              background: style.badgeBg,
              color: style.iconColor,
              border: `1px solid ${style.badgeBorder}`,
              lineHeight: 1.2,
            }}
          >
            {style.label}
          </span>
          {isEncrypted && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm uppercase"
              style={{
                fontSize: '9px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                background: 'rgba(159,122,234,0.20)',
                color: '#B794F4',
                border: '1px solid rgba(159,122,234,0.30)',
                lineHeight: 1.2,
              }}
              title="Decrypted from NIP-17 gift wrap"
            >
              Encrypted
            </span>
          )}
          <Typography
            variant="caption"
            sx={{ ml: 'auto', color: 'var(--theme-text-muted)', fontSize: '0.7rem' }}
          >
            {formatRelative(message.createdAt)}
          </Typography>
        </Stack>

        <Typography
          variant="body2"
          fontWeight={600}
          sx={{
            color: 'var(--theme-text)',
            fontSize: '0.875rem',
            lineHeight: 1.4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            mb: preview.secondary ? 0.25 : 0,
          }}
        >
          {preview.primary}
        </Typography>

        <Stack direction="row" alignItems="center" spacing={1} sx={{ color: 'var(--theme-text-muted)' }}>
          <Typography
            variant="caption"
            sx={{
              fontFamily: 'monospace',
              fontSize: '0.7rem',
            }}
          >
            {shortPubkey(message.peerPubkey)}
          </Typography>
          {preview.secondary && category === 'offer' && (
            <>
              <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: 'var(--theme-text-muted)', opacity: 0.5 }} />
              <Stack direction="row" alignItems="center" spacing={0.25}>
                <BoltIcon sx={{ fontSize: 11, color: 'primary.main' }} />
                <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>
                  {preview.secondary}
                </Typography>
              </Stack>
            </>
          )}
          {preview.secondary && category !== 'offer' && (
            <>
              <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: 'var(--theme-text-muted)', opacity: 0.5 }} />
              <Stack direction="row" alignItems="center" spacing={0.25}>
                <ScheduleOutlinedIcon sx={{ fontSize: 11 }} />
                <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>
                  {preview.secondary}
                </Typography>
              </Stack>
            </>
          )}
        </Stack>
      </Box>
    </Box>
  )
}
