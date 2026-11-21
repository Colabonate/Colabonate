import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Cable, Eye, Heart, ShieldCheck, Undo2, PlugZap } from 'lucide-react';
import { apiCall } from '../../lib/api';
import { AiAccentDivider, AI_ACCENT_YELLOW } from './AiAccentDivider';

// ADR-371 D6/D4: pre-footer "Connect your own agent" section on the Home page,
// in the same flat style as the Colabonate AI Assistant section above it (no
// card, no icon tile, gradient heading, ghost glow CTA, yellow divider, animated
// chips). Auth-aware copy: guests learn about the reduced read-only MCP access
// (with a login CTA); logged-in users get the direct connect flow. Everything
// leads to the single /ai/connect destination (no duplicated state).

export function McpConnectSection() {
  const [pubkey] = useState(() => localStorage.getItem('pubkey') ?? '');
  const isGuest = !pubkey;
  // ADR-384 D11: show the price line only where MCP access is actually paid.
  const [pricing, setPricing] = useState<{ paywallActive: boolean; salesPaused: boolean; sectionHidden: boolean; trialMinutes: number; passes: Array<{ id: string; hours: number | null; priceSats: number }> } | null>(null);
  useEffect(() => {
    apiCall('/api/mcp/pricing').then((r) => r.json()).then(setPricing).catch(() => {});
  }, []);
  // ADR-410: a single lifetime tier at the lowest tier price is the default.
  const pass = pricing?.passes[0];

  // ADR-405: the admin can hide the section platform-wide (hide-only flag).
  if (pricing?.sectionHidden) return null;

  const highlights = isGuest
    ? [
        { icon: <Eye size={15} />, label: 'Read-only public data' },
        { icon: <ShieldCheck size={15} />, label: 'Log in for scoped write access' },
        { icon: <Undo2 size={15} />, label: 'Revoke any time' },
      ]
    : [
        { icon: <ShieldCheck size={15} />, label: 'You pick the scopes' },
        { icon: <PlugZap size={15} />, label: 'Copy-paste setup prompt' },
        { icon: <Undo2 size={15} />, label: 'Revoke any time' },
      ];

  return (
    <section aria-label="Connect your own agent" className="section-animate mt-6 md:mt-8">
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
              background: `linear-gradient(90deg, var(--theme-text) 0%, ${AI_ACCENT_YELLOW} 85%)`,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Connect your own agent
          </Typography>
          <Typography
            variant="body1"
            sx={{ color: 'var(--theme-text-muted)', fontSize: { xs: 15, md: 16.5 }, lineHeight: 1.65, maxWidth: 720 }}
          >
            {isGuest ? (
              <>
                Run Colabonate from Claude, Kilo or any MCP agent. As a guest you get{' '}
                <strong style={{ color: 'var(--theme-text)' }}>read-only access to public data</strong>: offers,
                cooperations, companies and profiles. Log in to grant your agent scoped write access.
              </>
            ) : (
              <>
                Run Colabonate tools from your own local agent over MCP. Create a connection, pick what it may do,
                copy the prompt, and revoke it any time.
              </>
            )}
          </Typography>
        </div>

        <div className="flex flex-col sm:flex-row md:items-center gap-2.5 shrink-0">
          <Button
            component={Link}
            to="/ai/connect"
            variant="outlined"
            startIcon={<Cable size={16} />}
            className="ai-promo-btn"
            sx={{
              fontWeight: 700,
              textTransform: 'none',
              borderRadius: '10px',
              px: 2.5,
              color: 'var(--color-primary-50)',
              border: '1px solid var(--color-primary-50)',
              background: 'color-mix(in srgb, var(--theme-bg-subtle) 30%, transparent)',
              backdropFilter: 'blur(8px)',
              transition: 'box-shadow 0.2s ease, background 0.2s ease',
              '&:hover': {
                border: '1px solid var(--color-primary-50)',
                background: 'color-mix(in srgb, var(--color-primary-50) 8%, transparent)',
              },
            }}
          >
            {isGuest ? 'Get read-only MCP access' : 'Connect your agent via MCP'}
          </Button>
          {isGuest && (
            <Button
              component={Link}
              to="/login?next=/ai/connect"
              variant="outlined"
              sx={{
                fontWeight: 600,
                textTransform: 'none',
                borderRadius: '10px',
                px: 2.5,
                color: 'var(--theme-text)',
                borderColor: 'var(--theme-border)',
                '&:hover': { borderColor: 'var(--color-primary-50)', background: 'color-mix(in srgb, var(--color-primary-50) 6%, transparent)' },
              }}
            >
              Log in
            </Button>
          )}
        </div>
      </div>

      <AiAccentDivider />

      {/* Line 2: short glimpse of what you get */}
      <div className="relative z-10 flex flex-col md:flex-row md:items-center gap-2 md:gap-5">
        <Typography variant="body1" sx={{ color: 'var(--theme-text-muted)', fontSize: 15 }}>
          Works with Claude, Kilo and any MCP client.
          {pricing?.paywallActive && !pricing?.salesPaused && pass && pass.hours === null && (
            <>
              {` First ${pricing.trialMinutes} minutes free, then a one-time ${pass.priceSats} sats for lifetime access`}
              <Heart size={12} className="fill-current" style={{ color: AI_ACCENT_YELLOW, margin: '0 3px', verticalAlign: 'baseline' }} />
              <span>{' — it supports Colabonate and the open protocol.'}</span>
            </>
          )}
          {pricing?.paywallActive && !pricing?.salesPaused && pass && pass.hours !== null && (
            ` First ${pricing.trialMinutes} minutes free, then from ${pass.priceSats} sats.`
          )}
        </Typography>
        <div className="flex flex-wrap gap-2 md:ml-auto">
          {highlights.map((h) => (
            <Link
              key={h.label}
              to="/ai/connect"
              className="ai-promo-chip flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
              style={{
                borderColor: `color-mix(in srgb, ${AI_ACCENT_YELLOW} 45%, var(--theme-border))`,
                color: 'var(--theme-text)',
              }}
            >
              <span style={{ color: AI_ACCENT_YELLOW, display: 'flex' }}>{h.icon}</span>
              <span className="font-semibold">{h.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
