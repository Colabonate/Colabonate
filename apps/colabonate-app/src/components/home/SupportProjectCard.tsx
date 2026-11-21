import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { gsap } from 'gsap'
import { Zap, Heart, User } from 'lucide-react'
import { Button, CircularProgress, Tooltip } from '@mui/material'

import { CARD_THEME } from '@ds/ui'
import { useTheme, cn } from '@ds/utils'

import { useTranslation } from '../../contexts/LocaleContext'
import { useSupportTip } from '../../hooks/useSupportTip'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { apiCall } from '../../lib/api'
import { toNpub } from '../../lib/nostr-identity'

import { CustomTipModal } from './CustomTipModal'

type TierId = 'rare' | 'epic' | 'legendary'

interface TierDef {
  id: TierId
  amount: number
  label: string
  chipColor: string
  chipBg: string
  chipBorder: string
  buttonColor: string
  buttonBorder: string
  buttonBg: string
  buttonHoverBg: string
  placeholder: string
  glowClass: string
}

const TIERS: TierDef[] = [
  {
    id: 'rare',
    amount: 2100,
    label: 'RARE',
    chipColor: '#3b82f6',
    chipBg: 'rgba(59,130,246,0.10)',
    chipBorder: 'rgba(59,130,246,0.30)',
    buttonColor: '#3b82f6',
    buttonBorder: 'rgba(59,130,246,0.40)',
    buttonBg: 'rgba(59,130,246,0.10)',
    buttonHoverBg: 'rgba(59,130,246,0.18)',
    placeholder: 'Be the first',
    glowClass: '',
  },
  {
    id: 'epic',
    amount: 21000,
    label: 'EPIC',
    chipColor: '#a855f7',
    chipBg: 'rgba(168,85,247,0.10)',
    chipBorder: 'rgba(168,85,247,0.30)',
    buttonColor: '#a855f7',
    buttonBorder: 'rgba(168,85,247,0.40)',
    buttonBg: 'rgba(168,85,247,0.10)',
    buttonHoverBg: 'rgba(168,85,247,0.18)',
    placeholder: 'Join the elite',
    glowClass: 'support-tier-epic',
  },
  {
    id: 'legendary',
    amount: 210000,
    label: 'LEGEND',
    chipColor: '#f59e0b',
    chipBg: 'rgba(245,158,11,0.10)',
    chipBorder: 'rgba(245,158,11,0.30)',
    buttonColor: '#f59e0b',
    buttonBorder: 'rgba(245,158,11,0.40)',
    buttonBg: 'rgba(245,158,11,0.10)',
    buttonHoverBg: 'rgba(245,158,11,0.18)',
    placeholder: 'Claim the throne',
    glowClass: 'support-tier-legend',
  },
]

interface RecentTip {
  id: string
  pubkey: string
  amountSats: number
  createdAt: string
}

function truncateNpub(npub: string): string {
  if (npub.length <= 16) return npub
  return `${npub.slice(0, 8)}…${npub.slice(-4)}`
}

function useBorderFlash(containerRef: React.RefObject<HTMLDivElement | null>) {
  const prefersReduced = useReducedMotion()
  const glowRef = useRef<HTMLDivElement>(null)
  const bgRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (prefersReduced) return

    const el = containerRef.current
    if (!el) return

    const glow = glowRef.current
    const bg = bgRef.current
    if (!glow || !bg) return

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ repeat: -1, repeatDelay: 2.5, delay: 1 })

      tl.fromTo(glow, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'power2.out' })
        .to(glow, { opacity: 0, duration: 1, ease: 'power2.in' }, '+=0.4')
        .fromTo(bg, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out' }, '-=1.2')
        .to(bg, { opacity: 0, duration: 1.2, ease: 'power2.in' })
    }, el)

    return () => ctx.revert()
  }, [containerRef, prefersReduced])

  return { glowRef, bgRef }
}

function useRecentTips() {
  return useQuery({
    queryKey: ['support-tips-recent'],
    queryFn: async (): Promise<RecentTip[]> => {
      const res = await apiCall('/api/support-tips/recent')
      return res.json()
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
}

interface ChipData {
  id: string
  label: string
  pubkey: string
}

function useTierChips(tips: RecentTip[], tier: TierDef) {
  const prefersReduced = useReducedMotion()
  const CHIP_COUNT = 4

  const uniqueTips = useMemo(() => {
    const seen = new Set<string>()
    return tips
      .filter(t => t.amountSats === tier.amount)
      .filter(t => {
        if (seen.has(t.pubkey)) return false
        seen.add(t.pubkey)
        return true
      })
  }, [tips, tier.amount])

  const chips: ChipData[] = useMemo(() => {
    if (uniqueTips.length === 0) return [{ id: `${tier.id}-ph`, label: tier.placeholder, pubkey: '' }]
    return uniqueTips.map(t => ({
      id: t.id,
      label: truncateNpub(toNpub(t.pubkey) ?? t.pubkey),
      pubkey: t.pubkey,
    }))
  }, [uniqueTips, tier.placeholder])

  const [page, setPage] = useState(0)

  const pages = useMemo(() => {
    if (chips.length <= CHIP_COUNT) return [chips]
    const result: ChipData[][] = []
    for (let i = 0; i < chips.length; i += CHIP_COUNT) {
      result.push(chips.slice(i, i + CHIP_COUNT))
    }
    return result
  }, [chips])

  const visibleChips = pages[page] ?? pages[0] ?? []

  const advance = useCallback(() => {
    setPage(p => (p + 1) % pages.length)
  }, [pages.length])

  useEffect(() => {
    if (prefersReduced || pages.length <= 1) return
    const id = setInterval(advance, 4000)
    return () => clearInterval(id)
  }, [prefersReduced, pages.length, advance])

  useEffect(() => {
    setPage(0)
  }, [chips.length])

  return { visibleChips, isEmpty: uniqueTips.length === 0 }
}

function TierChipRow({ tier, tips }: { tier: TierDef; tips: RecentTip[] }) {
  const navigate = useNavigate()
  const { visibleChips, isEmpty } = useTierChips(tips, tier)
  const hasGlow = !!tier.glowClass

  return (
    <div className={cn('flex items-center gap-1 shrink-0', hasGlow && tier.glowClass)}>
      <span
        className="inline-flex items-center px-1 py-0.5 rounded text-[7px] font-bold uppercase tracking-widest leading-none shrink-0"
        style={{ color: tier.chipColor, background: tier.chipBg, border: `1px solid ${tier.chipBorder}` }}
      >
        {tier.label}
      </span>
      {visibleChips.slice(0, 2).map(chip => (
        <Tooltip key={chip.id} title={chip.pubkey ? toNpub(chip.pubkey) ?? chip.pubkey : chip.label} placement="top">
          <button
            onClick={chip.pubkey ? (e) => { e.stopPropagation(); navigate(`/u/${chip.pubkey}`) } : undefined}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold leading-tight shrink-0 transition-colors duration-200',
              chip.pubkey ? 'cursor-pointer' : 'cursor-default',
            )}
            style={{
              background: isEmpty ? tier.chipBg : 'var(--theme-bg-subtle)',
              color: isEmpty ? tier.chipColor : 'var(--theme-text-muted)',
              border: isEmpty
                ? `1px dashed ${tier.chipBorder}`
                : '1px solid var(--theme-border, rgba(0,0,0,0.08))',
              opacity: isEmpty ? 0.6 : 1,
            }}
          >
            <User size={9} className="shrink-0" />
            {chip.label}
          </button>
        </Tooltip>
      ))}
    </div>
  )
}

/**
 * Support-the-project tip card — rendered next to SearchHeroSection on Home
 * from tablet (md) upward. On mobile the Support action lives inline in
 * SearchHeroSection's action row (next to Explore) instead of as its own card.
 * Pays a Lightning Address (LUD-16) via whichever wallet the user already has
 * configured (see useSupportTip), so no extra opt-in/setup step is required
 * beyond being logged in. Renders a disabled action without a connected wallet.
 */
export const SupportProjectCard = memo(function SupportProjectCard() {
  const { theme } = useTheme()
  const { formatNumber } = useTranslation()
  const { available, state, pendingAmount, error, sendTip } = useSupportTip()
  const { data: recentTips = [] } = useRecentTips()
  const [customTipOpen, setCustomTipOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const { glowRef, bgRef } = useBorderFlash(cardRef)

  // Card always renders so the entry point is visible to every viewer (logged
  // in, no wallet, or no donation address configured). The buttons are
  // disabled when no wallet is connected — `sendTip` itself returns early in
  // that case, so this is belt-and-braces visibility. `available` is still
  // exposed by the hook for callers that want to hide the action entirely.
  void available

  return (
    <>
    <div
      ref={cardRef}
      className="support-project-card relative rounded-2xl p-3 md:p-4 hidden md:flex flex-col justify-center gap-2.5 w-full h-full overflow-hidden"
      style={{ boxShadow: CARD_THEME.shadow }}
    >
      <div
        ref={glowRef}
        className="pointer-events-none"
        style={{
          position: 'absolute',
          inset: -1,
          borderRadius: 17,
          background: 'radial-gradient(ellipse at 30% 20%, rgba(35,202,97,0.6) 0%, rgba(35,202,97,0.15) 40%, transparent 70%)',
          opacity: 0,
          willChange: 'opacity',
        }}
      />
      <div
        ref={bgRef}
        className="pointer-events-none"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 16,
          background: 'linear-gradient(135deg, rgba(35,202,97,0.12) 0%, transparent 60%)',
          opacity: 0,
          willChange: 'opacity',
        }}
      />

      <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
        <div
          className="absolute inset-0"
          style={{ background: 'color-mix(in srgb, var(--theme-bg) 18%, transparent)' }}
        />
        <div className="absolute inset-0" style={{ background: CARD_THEME.overlay(theme), opacity: 0.2 }} />
      </div>

      <div className="relative z-10 flex items-center gap-2">
        <div
          className="flex items-center justify-center rounded-xl shrink-0"
          style={{ width: 32, height: 32, background: 'rgba(250,204,21,0.14)', color: '#eab308' }}
        >
          <Zap size={16} className="fill-current" />
        </div>
        <div className="min-w-0">
          <span className="block text-[13px] font-semibold leading-tight" style={{ color: 'var(--theme-text)' }}>
            Support Colabonate
          </span>
          <p className="text-[11px] leading-snug m-0" style={{ color: 'var(--theme-text-muted)' }}>
            Zap the project a few sats
          </p>
        </div>

        <div className="flex items-center gap-1 ml-auto shrink-0">
          {TIERS.map(tier => (
            <Tooltip key={tier.id} title={available ? `${tier.label} — ${formatNumber(tier.amount)} sats` : 'Connect a wallet to tip'}>
              <Button
                size="small"
                variant="outlined"
                disabled={!available || state === 'sending'}
                onClick={() => sendTip(tier.amount)}
                sx={{
                  minWidth: 36,
                  height: 26,
                  fontSize: 10,
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRadius: '8px',
                  px: 1,
                  color: tier.buttonColor,
                  borderColor: tier.buttonBorder,
                  backgroundColor: tier.buttonBg,
                  '&:hover': {
                    backgroundColor: tier.buttonHoverBg,
                    borderColor: tier.buttonColor,
                  },
                }}
              >
                {pendingAmount === tier.amount ? <CircularProgress size={10} color="inherit" /> : formatNumber(tier.amount)}
              </Button>
            </Tooltip>
          ))}
          <Tooltip title={available ? 'Custom amount' : 'Connect a wallet to tip'}>
            <Button
              size="small"
              variant="outlined"
              disabled={!available || state === 'sending'}
              onClick={() => setCustomTipOpen(true)}
              sx={{
                minWidth: 26,
                height: 26,
                fontSize: 12,
                fontWeight: 700,
                borderRadius: '8px',
                px: 0.5,
                color: 'var(--theme-text-muted)',
                borderColor: 'var(--theme-border)',
                backgroundColor: 'var(--theme-bg-subtle)',
                '&:hover': {
                  backgroundColor: 'var(--theme-bg-elevated)',
                  borderColor: 'var(--theme-text-muted)',
                },
              }}
            >
              ?
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="relative z-10 flex flex-col gap-1">
        <span
          className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider m-0"
          style={{ color: 'var(--color-primary-50)' }}
        >
          <Heart size={10} className="fill-current" />
          Recent Supporters
        </span>
        <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {TIERS.map((tier, i) => (
            <div key={tier.id} className="flex items-center gap-1 shrink-0">
              {i > 0 && (
                <div
                  className="w-px h-3 shrink-0"
                  style={{ background: 'var(--theme-border, rgba(0,0,0,0.10))' }}
                />
              )}
              <TierChipRow tier={tier} tips={recentTips} />
            </div>
          ))}
        </div>
      </div>

      <p
        className="relative z-10 text-[11px] font-semibold m-0 text-center transition-opacity duration-200"
        style={{
          color: state === 'error' ? 'var(--color-primary-50)' : 'var(--color-status-success, #22c55e)',
          opacity: state === 'sent' || state === 'error' ? 1 : 0,
          height: state === 'sent' || state === 'error' ? 'auto' : 0,
          overflow: 'hidden',
        }}
      >
        {state === 'sent' ? 'Thank you! ⚡' : error}
      </p>

      <style>{`
        @keyframes supportTierEpicGlow {
          0%, 100% { filter: drop-shadow(0 0 2px rgba(168,85,247,0.3)); }
          50%      { filter: drop-shadow(0 0 6px rgba(168,85,247,0.5)); }
        }
        @keyframes supportTierEpicBorder {
          0%, 100% { border-color: rgba(168,85,247,0.30); }
          50%      { border-color: rgba(168,85,247,0.55); }
        }
        .support-tier-epic {
          animation: supportTierEpicGlow 2.4s ease-in-out infinite;
        }
        .support-tier-epic span,
        .support-tier-epic button {
          animation: supportTierEpicBorder 2.4s ease-in-out infinite;
        }

        @keyframes supportTierLegendGlow {
          0%, 100% { filter: drop-shadow(0 0 3px rgba(245,158,11,0.35)); }
          50%      { filter: drop-shadow(0 0 8px rgba(245,158,11,0.6)); }
        }
        @keyframes supportTierLegendBorder {
          0%, 100% { border-color: rgba(245,158,11,0.30); }
          50%      { border-color: rgba(245,158,11,0.65); }
        }
        .support-tier-legend {
          animation: supportTierLegendGlow 2s ease-in-out infinite;
        }
        .support-tier-legend span,
        .support-tier-legend button {
          animation: supportTierLegendBorder 2s ease-in-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .support-tier-epic,
          .support-tier-epic span,
          .support-tier-epic button,
          .support-tier-legend,
          .support-tier-legend span,
          .support-tier-legend button {
            animation: none;
          }
        }
      `}</style>
    </div>

    <CustomTipModal
      open={customTipOpen}
      onClose={() => setCustomTipOpen(false)}
      sendTip={sendTip}
      sending={state === 'sending'}
      pendingAmount={pendingAmount}
      available={available}
    />
    </>
  )
})
