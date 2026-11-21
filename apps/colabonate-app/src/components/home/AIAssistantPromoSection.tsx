import { useState } from 'react';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Sparkles } from 'lucide-react';
import { BuyAiCreditsDialog } from '../ai-assistant/BuyAiCreditsDialog';
import { useAiCredits, isAiGuest } from '../ai-assistant/useAiCredits';
import { AiAccentDivider, AI_ACCENT_YELLOW } from './AiAccentDivider';
import { SatsAmount } from '../currency/SatsAmount';
import { QuickActionCategoryChips } from '../ai-assistant/QuickActions';

// ADR-384 D9: full-width Home section marketing the Colabonate-hosted AI
// Assistant. Rendered for EVERYONE: a visitor without an account can buy
// session credits right here (D10). Deliberately flat: no card background and
// no icon tile, so it costs as little height as possible. The divider mirrors
// the login divider (LoginTabs.tsx) in yellow. MCP passes (D11) are not part of
// this section yet.

const YELLOW = AI_ACCENT_YELLOW;

export function AIAssistantPromoSection() {
  const { remaining, tiers, hostedEnabled, salesPaused, sectionHidden } = useAiCredits();
  const [buyOpen, setBuyOpen] = useState(false);

  const openAssistant = () => window.dispatchEvent(new Event('colabonate:open-ai-assistant'));

  // Category chips start the chat directly: the panel opens and the category's
  // primary preset is sent (handled in AIAssistant.tsx).
  const startChat = (message: string) =>
    window.dispatchEvent(new CustomEvent('colabonate:ai-quick-action', { detail: message }));

  // ADR-405: the admin can hide the section platform-wide (hide-only flag).
  if (sectionHidden) return null;

  return (
    <section aria-label="Colabonate AI Assistant" className="hidden md:block section-animate mt-4 md:mt-6 mb-4 md:mb-8">
      {/* Line 1: pitch + CTA */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-8">
        <div className="flex-1 min-w-0">
          <Typography
            variant="h5"
            sx={{
              fontWeight: 700,
              mb: 0.75,
              width: 'fit-content',
              // Heading fades from the text color into the AI accent yellow.
              background: `linear-gradient(90deg, var(--theme-text) 0%, ${YELLOW} 85%)`,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Colabonate AI Assistant
          </Typography>
          <Typography variant="body1" sx={{ color: 'var(--theme-text-muted)', fontSize: { xs: 15, md: 16.5 }, lineHeight: 1.65, maxWidth: 720 }}>
            {hostedEnabled
              ? 'Your AI co-pilot, hosted by Colabonate. No API key, no setup, no subscription. '
              : 'Your AI co-pilot for Colabonate. Use your own API key or a local model. '}
            Ask it to find offers, draft a listing, start a cooperation or check your tickets.
          </Typography>
          <div className="mt-3 md:mt-4">
            <QuickActionCategoryChips onAction={startChat} guest={isAiGuest()} />
          </div>
        </div>
        <Button
          variant="outlined"
          onClick={openAssistant}
          startIcon={<Sparkles size={16} />}
          className="ai-promo-btn"
          sx={{
            flexShrink: 0,
            alignSelf: { xs: 'stretch', md: 'center' },
            fontWeight: 700,
            textTransform: 'none',
            borderRadius: '10px',
            px: 2.5,
            '--ai-btn-glow': YELLOW,
            color: YELLOW,
            border: `1px solid ${YELLOW}`,
            background: 'color-mix(in srgb, var(--theme-bg-subtle) 30%, transparent)',
            backdropFilter: 'blur(8px)',
            transition: 'box-shadow 0.2s ease, background 0.2s ease',
            '&:hover': {
              border: `1px solid ${YELLOW}`,
              background: `color-mix(in srgb, ${YELLOW} 8%, transparent)`,
            },
          }}
        >
          AI Assistent
        </Button>
      </div>

      {/* Same glowing divider as the "Connect your own agent" section — always shown */}
      <AiAccentDivider />

      {/* Line 2: credit packs (only while hosted AI is on and sales are open) */}
      {hostedEnabled && !salesPaused && (
      <div className="relative z-10 flex flex-col md:flex-row md:items-center gap-2 md:gap-5">
        <Typography variant="body1" sx={{ color: 'var(--theme-text-muted)', fontSize: 15 }}>
          {remaining && remaining > 0
            ? <><strong style={{ color: 'var(--theme-text)' }}>{remaining}</strong> requests left</>
            : localStorage.getItem('authToken')
              ? 'Pay per pack over Lightning. Credits never expire.'
              : 'No account needed. Buy session credits and start chatting.'}
        </Typography>
        {/* Pack tiles: a 3-up grid on mobile (equal width, label over price)
            so the three packs read as one tidy row instead of ragged,
            one-per-line chips — then back to compact inline chips from md up. */}
        <div className="grid grid-cols-3 gap-2 md:flex md:flex-wrap md:ml-auto">
          {tiers.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setBuyOpen(true)}
              className="ai-promo-chip flex flex-col items-start gap-1 rounded-lg border px-2 py-2 text-[13px] cursor-pointer md:flex-row md:items-center md:gap-2 md:px-3 md:py-1.5 md:text-sm"
              style={{
                borderColor: `color-mix(in srgb, ${YELLOW} 45%, var(--theme-border))`,
                color: 'var(--theme-text)',
              }}
            >
              <span className="font-semibold">{t.requests} requests</span>
              <SatsAmount sats={t.priceSats} size="sm" />
            </button>
          ))}
        </div>
      </div>
      )}

      <BuyAiCreditsDialog open={buyOpen} onClose={() => setBuyOpen(false)} />
    </section>
  );
}
