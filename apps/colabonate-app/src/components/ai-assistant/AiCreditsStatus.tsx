// ADR-384 D5: how the hosted-AI credits show up inside the assistant surfaces.
//  - AiCreditsStarter: the fuller block in the intro splash (empty chat): current
//    usage, or the three packs to pick and start right away.
//  - AiCreditsBar: the slim one-line status strip that stays above the chat input
//    while the user is working (usage meter + "Buy" without leaving the chat).
import { useState } from 'react';
import Button from '@mui/material/Button';
import { Zap } from 'lucide-react';
import { SatsAmount } from '../currency/SatsAmount';
import { TIER_COLORS } from './PackCard';
import { BuyAiCreditsDialog } from './BuyAiCreditsDialog';
import { announceAiCredits, isAiGuest, isHostedModeActive, useAiCredits } from './useAiCredits';

// Same literal the Home AI section uses; no yellow token exists in this theme.
const YELLOW = '#eab308';

function meterColor(remaining: number, peak: number): string {
  if (remaining <= 0) return 'var(--color-status-error)';
  return remaining <= Math.max(1, Math.ceil(peak * 0.2)) ? YELLOW : 'var(--color-primary-50)';
}

function Meter({ remaining, peak, height = 4 }: { remaining: number; peak: number; height?: number }) {
  const pct = peak > 0 ? Math.min(100, Math.round((remaining / peak) * 100)) : 0;
  return (
    <div
      role="meter"
      aria-label="Requests left"
      aria-valuemin={0}
      aria-valuemax={peak}
      aria-valuenow={remaining}
      className="flex-1 min-w-[40px] overflow-hidden rounded-full"
      style={{ height, background: 'color-mix(in srgb, var(--theme-text-muted) 18%, transparent)' }}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${pct}%`,
          background: meterColor(remaining, peak),
          transition: 'width 0.45s ease, background 0.3s ease',
        }}
      />
    </div>
  );
}

const GHOST_SX = {
  flexShrink: 0,
  minWidth: 0,
  px: 1.25,
  py: 0.25,
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'none',
  borderRadius: '8px',
  color: 'var(--color-primary-50)',
  border: '1px solid color-mix(in srgb, var(--color-primary-50) 55%, transparent)',
  transition: 'box-shadow 0.2s ease, background 0.2s ease, transform 0.15s ease',
  '&:hover': {
    border: '1px solid var(--color-primary-50)',
    background: 'color-mix(in srgb, var(--color-primary-50) 8%, transparent)',
    boxShadow: '0 0 12px 2px color-mix(in srgb, var(--color-primary-50) 45%, transparent)',
  },
  '&:active': { transform: 'scale(0.96)' },
  '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:active': { transform: 'none' } },
} as const;

/** Slim status strip above the chat input, shown while a conversation is running. */
export function AiCreditsBar() {
  const { remaining, peak } = useAiCredits();
  const [buyOpen, setBuyOpen] = useState(false);

  if (remaining === null || !isHostedModeActive()) return null;

  const empty = remaining <= 0;
  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2.5 px-3 py-1.5 shrink-0 border-t"
        style={{
          borderColor: empty ? 'color-mix(in srgb, var(--color-status-error) 45%, var(--theme-border))' : 'var(--theme-border)',
          background: 'color-mix(in srgb, var(--theme-bg-subtle) 60%, transparent)',
        }}
      >
        <Zap size={13} style={{ color: meterColor(remaining, peak), flexShrink: 0 }} />
        <span className="hidden sm:inline text-[11px] font-semibold shrink-0" style={{ color: 'var(--theme-text-muted)' }}>
          Colabonate Hosted
        </span>
        <Meter remaining={remaining} peak={peak} />
        <span
          className="text-[12px] font-bold shrink-0 tabular-nums"
          style={{ color: empty ? 'var(--color-status-error)' : 'var(--theme-text)' }}
        >
          {empty ? 'Out of requests' : `${remaining} left`}
        </span>
        <Button variant="outlined" size="small" onClick={() => setBuyOpen(true)} sx={GHOST_SX}>
          {empty ? 'Buy credits' : 'Buy'}
        </Button>
      </div>
      <BuyAiCreditsDialog open={buyOpen} onClose={() => setBuyOpen(false)} />
    </>
  );
}

/** Intro-splash block: current usage, or the three packs to choose and start. */
export function AiCreditsStarter() {
  const { remaining, tiers, peak, hostedEnabled } = useAiCredits();
  const [dialog, setDialog] = useState<{ open: boolean; tier: string | null }>({ open: false, tier: null });

  // Someone who deliberately runs their own model does not need the hosted upsell.
  const stored = localStorage.getItem('aiProvider');
  if (stored === 'local' || stored === 'adapter') return null;
  if (remaining === null) return null;
  // Nothing to sell yet and nothing left to show: keep the splash free of the hosted upsell.
  if (!hostedEnabled && remaining <= 0) return null;

  const hostedActive = isHostedModeActive();
  const hasCredits = remaining > 0;
  const open = (tier: string | null) => setDialog({ open: true, tier });

  return (
    <div
      className="w-full rounded-xl p-3 text-left"
      style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-bg-subtle)' }}
    >
      {hasCredits ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)' }}>
              Your requests
            </span>
            <span className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--theme-text)' }}>
              {remaining} left
            </span>
          </div>
          <Meter remaining={remaining} peak={peak} height={6} />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }}>
              {hostedActive ? 'Type below to start.' : 'You have hosted credits ready.'}
            </span>
            <div className="flex items-center gap-1.5">
              {!hostedActive && !isAiGuest() && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => { localStorage.setItem('aiProvider', 'platform'); announceAiCredits(remaining); }}
                  sx={GHOST_SX}
                >
                  Use hosted
                </Button>
              )}
              <Button variant="outlined" size="small" onClick={() => open(null)} sx={GHOST_SX}>
                Buy more
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)' }}>
              Get started
            </span>
            <span className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }}>
              Hosted by Colabonate, no API key needed. Pick a pack and start chatting.
              {isAiGuest() && ' No account required.'}
            </span>
          </div>
          <div className="flex items-stretch gap-2">
            {tiers.map((tier, i) => {
              const c = TIER_COLORS[i % TIER_COLORS.length];
              return (
                <Button
                  key={tier.id}
                  variant="outlined"
                  onClick={() => open(tier.id)}
                  sx={{
                    flex: 1,
                    display: 'grid',
                    gap: 0.25,
                    py: 0.75,
                    px: 0.5,
                    borderRadius: '8px',
                    textTransform: 'none',
                    color: c.color,
                    borderColor: c.border,
                    backgroundColor: c.bg,
                    transition: 'transform 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease, border-color 0.18s ease',
                    '&:hover': { backgroundColor: c.hoverBg, borderColor: c.color, transform: 'translateY(-2px)', boxShadow: `0 0 12px 1px ${c.border}` },
                    '&:active': { transform: 'translateY(0) scale(0.96)', boxShadow: 'none' },
                    '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover, &:active': { transform: 'none' } },
                  }}
                >
                  <span className="text-[12px] font-extrabold">{tier.requests}</span>
                  <span className="text-[9px] uppercase tracking-wider opacity-80">requests</span>
                  <SatsAmount sats={tier.priceSats} size="sm" />
                </Button>
              );
            })}
          </div>
        </div>
      )}
      <BuyAiCreditsDialog
        open={dialog.open}
        autoBuyTierId={dialog.tier}
        onClose={() => setDialog({ open: false, tier: null })}
      />
    </div>
  );
}
