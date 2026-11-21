import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import {
  ExpandMore as ExpandMoreIcon,
  ContentCopy as ContentCopyIcon,
  Check as CheckIcon,
  ArrowForward as ArrowForwardIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { Cable, KeyRound, ShieldCheck, History, RefreshCw, Plug, Search, Sparkles, Ticket, Users, Landmark, Zap, Wallet, FileText, FlaskConical, Clock, Heart } from 'lucide-react';
import { PageContainer } from '@ds/ui';
import { cn } from '@ds/utils';
import { PageHeader } from '../../components/PageHeader';
import { Seo } from '../../components/Seo';
import { apiCall } from '../../lib/api';
import { useBetaMode } from '../../hooks/useBetaMode';
import { SatsAmount } from '../../components/currency/SatsAmount';
import { BuyMcpPassDialog } from '../../components/ai-assistant/BuyMcpPassDialog';
import type { McpPassTier } from '../../components/ai-assistant/McpPassesPanel';
import { AiAccentDivider, AI_ACCENT_YELLOW } from '../../components/home/AiAccentDivider';

// ADR-371 — Connect your own agent to Colabonate via MCP (D6 / Phases 2–3).
// Auth-aware guide page: logged-in users mint per-connection MCP tokens with
// opt-in write scopes and manage their connection ledger ("was passiert ist").
// Guests get the honest read-only explainer + login CTA (D4).

type ScopeFamily = 'offers' | 'cooperations' | 'tickets' | 'dao' | 'identity' | 'images';

const WRITE_FAMILIES: Array<{ family: ScopeFamily; label: string; description: string }> = [
  { family: 'offers', label: 'Offers', description: 'Create, publish and update your marketplace offers' },
  { family: 'cooperations', label: 'Cooperations', description: 'Create and update cooperations' },
  { family: 'tickets', label: 'Tickets', description: 'Create tickets and act on them (purchases)' },
  { family: 'dao', label: 'DAO', description: 'Submit and vote on proposals' },
  { family: 'identity', label: 'Identity', description: 'Edit your profile' },
  { family: 'images', label: 'Images', description: 'Upload images for offers and cooperations' },
];

interface McpConnectionRow {
  id: string;
  scope: string[];
  label: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  active: boolean;
  /** ADR-384 D11 / ADR-410: trial | lifetime (legacy rows: day | week | month); null = legacy free connection. */
  passTier?: string | null;
}

interface McpEventRow {
  id: string;
  connectionId: string;
  ts: string;
  tool: string;
  outcome: 'success' | 'error';
  agentLabel: string | null;
}

const STATUS_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: 'CONNECTED', color: 'var(--color-status-success, #23CA61)', bg: 'color-mix(in srgb, var(--color-status-success, #23CA61) 12%, transparent)' },
  expired: { label: 'EXPIRED', color: 'var(--theme-text-muted)', bg: 'var(--theme-bg-subtle)' },
  revoked: { label: 'REVOKED', color: 'var(--color-status-error, #E5484D)', bg: 'color-mix(in srgb, var(--color-status-error, #E5484D) 10%, transparent)' },
};

function connectionStatus(c: McpConnectionRow): 'active' | 'expired' | 'revoked' {
  if (c.revokedAt) return 'revoked';
  return c.active ? 'active' : 'expired';
}

function ConnectionStatusBadge({ status }: { status: 'active' | 'expired' | 'revoked' }) {
  const style = STATUS_STYLES[status];
  const live = status === 'active';
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 0.75,
        borderRadius: 999,
        background: style.bg,
        color: style.color,
        fontSize: '0.72rem',
        fontWeight: 800,
        letterSpacing: 0.4,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          flexShrink: 0,
          background: style.color,
          ...(live
            ? { boxShadow: '0 0 0 4px color-mix(in srgb, var(--color-status-success, #23CA61) 18%, transparent)' }
            : {}),
        }}
      />
      {live ? 'LIVE' : ''} {style.label}
    </Box>
  );
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '-';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortLabel(label: string | null): string {
  return label && label.trim() ? label.trim() : 'Unnamed connection';
}

// ── Copy button (same pattern as AccountsSection / TradeCockpit) ─────────────

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <Tooltip title={copied ? 'Copied!' : `Copy ${label}`}>
      <IconButton size="small" onClick={handleCopy} aria-label={copied ? 'Copied!' : `Copy ${label}`} sx={{ color: copied ? 'var(--color-status-success, #23CA61)' : 'var(--theme-text-muted)', p: 0.75 }}>
        {copied ? <CheckIcon sx={{ fontSize: 16 }} /> : <ContentCopyIcon sx={{ fontSize: 16 }} />}
      </IconButton>
    </Tooltip>
  );
}

function SectionCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Box
      className={cn('rounded-2xl border p-5 md:p-8', className)}
      sx={{ width: '100%', boxSizing: 'border-box', alignSelf: 'stretch', borderColor: 'var(--theme-border)', background: 'var(--theme-surface)' }}
    >
      {children}
    </Box>
  );
}

function SectionTitle({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
      {icon}
      <Typography variant="h6" sx={{ color: 'var(--theme-text)', fontWeight: 700, fontSize: '1.06rem', lineHeight: 1.3 }}>
        {children}
      </Typography>
    </Stack>
  );
}

function SectionLead({ children }: { children: ReactNode }) {
  return (
    <Typography
      variant="body2"
      sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.7, mt: 1.5, maxWidth: '72ch' }}
    >
      {children}
    </Typography>
  );
}

// ── Steps guide (shared between guests and logged-in users) ──────────────────

const STEPS = [
  { icon: <KeyRound size={18} />, title: 'Create a connection', text: 'Choose what your agent may do. Reading is always on, writes are opt-in per area.' },
  { icon: <Cable size={18} />, title: 'Copy the prompt', text: 'A short-lived token and ready-made config snippets for Claude Code, Kilo and other MCP clients.' },
  { icon: <Plug size={18} />, title: 'Paste into your agent', text: 'Your agent connects to Colabonate over MCP and gets exactly the tools you granted, nothing else.' },
];

function StepsGuide() {
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2.5}>
      {STEPS.map((step, i) => (
        <Box
          key={step.title}
          sx={{
            flex: 1,
            p: { xs: 2.5, md: 3.5 },
            borderRadius: 2.5,
            border: '1px solid var(--theme-border)',
            background: 'var(--theme-bg-subtle)',
            position: 'relative',
          }}
        >
          <Typography variant="caption" sx={{ color: 'var(--color-primary-50)', fontWeight: 700, letterSpacing: 0.4 }}>
            STEP {i + 1}
          </Typography>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 1.5, mb: 1.5 }}>
            <Box
              sx={{
                width: 34,
                height: 34,
                borderRadius: 1.5,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'color-mix(in srgb, var(--color-primary-50) 10%, transparent)',
                color: 'var(--color-primary-50)',
              }}
            >
              {step.icon}
            </Box>
            <Typography variant="subtitle1" sx={{ color: 'var(--theme-text)', fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.35 }}>
              {step.title}
            </Typography>
          </Stack>
          <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.65 }}>
            {step.text}
          </Typography>
        </Box>
      ))}
    </Stack>
  );
}

// ── Example prompts / use cases (for people new to connected agents) ─────────

interface ExamplePrompt {
  key: string;
  icon: ReactNode;
  title: string;
  description: string;
  prompt: string;
  /** Write-scope use case (requires the matching write family granted). */
  write?: boolean;
  /** Safe for guest (read-only, public-data) sessions. */
  guestOk?: boolean;
}

const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  {
    key: 'explore',
    icon: <Search size={17} />,
    title: 'Research the marketplace',
    description: 'Let your agent scout offers, sellers and prices before you buy.',
    prompt: 'Search for service offers in my region and list the 3 best matches with price, seller and delivery time.',
    guestOk: true,
  },
  {
    key: 'publish',
    icon: <Sparkles size={17} />,
    title: 'Draft and publish an offer',
    description: 'Hand your agent the details and it creates a draft you review before it goes live.',
    prompt: 'Create a DRAFT offer "One-page website" for 150000 sats (SERVICE, category services/web) and do not publish it yet.',
    write: true,
  },
  {
    key: 'tickets',
    icon: <Ticket size={17} />,
    title: 'Keep track of your tickets',
    description: 'Buy & sell orders, delivery steps and open to-dos at a glance.',
    prompt: 'Show my newest tickets and point out which ones need an action from me.',
  },
  {
    key: 'cooperate',
    icon: <Users size={17} />,
    title: 'Find projects to join',
    description: 'Discover cooperations and bounties that match what you can do.',
    prompt: 'Find cooperations or bounties matching my TypeScript skills and summarize what each one needs.',
    guestOk: true,
  },
  {
    key: 'dao',
    icon: <Landmark size={17} />,
    title: 'Follow the DAO',
    description: 'Stay on top of governance without opening the app.',
    prompt: 'What proposals are open in the Colabonate Foundation DAO right now and what are the latest arguments?',
    guestOk: true,
  },
  {
    key: 'profile',
    icon: <KeyRound size={17} />,
    title: 'Update your profile',
    description: 'Small edits, no tab-hopping. Your agent keeps your profile tidy.',
    prompt: 'Set my profile location to Berlin and add "Web developer" to my categories.',
    write: true,
  },
];

function WhatCanYouDoSection({ guest }: { guest?: boolean }) {
  const [open, setOpen] = useState(false); // collapsed by default — keeps the page focused on connecting
  const visible = EXAMPLE_PROMPTS.filter((p) => !guest || p.guestOk);

  return (
    <Box
      className="rounded-2xl border overflow-hidden"
      sx={{ borderColor: 'var(--theme-border)', background: 'var(--theme-surface)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group w-full flex items-center gap-4 md:gap-5 px-5 md:px-8 py-4 md:py-5 text-left cursor-pointer transition-colors duration-200 hover:bg-[rgba(232,69,65,0.05)] active:bg-[rgba(232,69,65,0.09)]"
      >
        <Box
          sx={{
            width: 42,
            height: 42,
            borderRadius: 2,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'color-mix(in srgb, var(--color-primary-50) 10%, transparent)',
            color: 'var(--color-primary-50)',
          }}
        >
          <Sparkles size={20} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="span" sx={{ color: 'var(--theme-text)', fontWeight: 700, fontSize: '1.02rem', lineHeight: 1.3, display: 'block' }}>
            What can your agent do?
          </Typography>
          <Typography component="span" variant="caption" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.5, display: 'block', mt: 0.75 }}>
            {guest ? 'Ready-to-copy read-only use cases for guests' : 'Ready-to-copy use cases for your connected agent'}
          </Typography>
        </Box>
        <Chip
          size="small"
          label={`${visible.length} ideas`}
          sx={{ height: 22, px: 0.5, fontSize: '0.68rem', fontWeight: 700, bgcolor: 'color-mix(in srgb, var(--color-primary-50) 8%, transparent)', color: 'var(--color-primary-50)', display: { xs: 'none', sm: 'inline-flex' }, flexShrink: 0 }}
        />
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: '50%',
            flexShrink: 0,
            background: 'color-mix(in srgb, var(--color-primary-50) 8%, transparent)',
            color: 'var(--color-primary-50)',
            transition: 'transform 200ms ease',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          <ExpandMoreIcon sx={{ fontSize: 20 }} />
        </Box>
      </button>

      {/* Animated collapse (design decision: whole header row toggles) */}
      <div
        className="grid transition-all duration-300 ease-in-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-5 md:px-8 pb-6 md:pb-8 pt-6 md:pt-7" style={{ borderTop: '1px solid var(--theme-border)' }}>
            <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.75, mb: 3, maxWidth: '76ch' }}>
              Your agent understands plain language. Tell it what you want and it works with Colabonate for you.
              Here are a few ready-to-copy ideas. {guest && 'As a guest your agent can read public data right away; log in to unlock the rest.'}
            </Typography>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                gap: 2,
              }}
            >
              {visible.map((example) => {
                const accent = example.write ? 'var(--color-primary-50)' : 'var(--color-accent-1, #6BB1FF)';
                return (
                  <Box
                    key={example.key}
                    sx={{
                      p: { xs: 2.5, md: 3 },
                      borderRadius: 2.5,
                      border: '1px solid var(--theme-border)',
                      background: 'var(--theme-bg-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      minWidth: 0,
                    }}
                  >
                    <Stack direction="row" alignItems="flex-start" spacing={1.5} sx={{ mb: 1.5 }}>
                      <Box
                        sx={{
                          width: 36,
                          height: 36,
                          borderRadius: 1.75,
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: `color-mix(in srgb, ${accent} 12%, transparent)`,
                          color: accent,
                          mt: 0.25,
                        }}
                      >
                        {example.icon}
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0, pt: 0.75 }}>
                        <Typography variant="subtitle1" sx={{ color: 'var(--theme-text)', fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.4 }}>
                          {example.title}
                        </Typography>
                      </Box>
                      <Chip
                        size="small"
                        label={example.write ? 'WRITE' : 'READ'}
                        sx={{
                          height: 20,
                          mt: 1,
                          fontSize: '0.64rem',
                          fontWeight: 800,
                          fontFamily: 'monospace',
                          color: accent,
                          bgcolor: `color-mix(in srgb, ${accent} 10%, transparent)`,
                        }}
                      />
                      <CopyButton value={example.prompt} label="prompt" />
                    </Stack>
                    <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.6, mb: 2.5, mt: 0.5 }}>
                      {example.description}
                    </Typography>
                    <Box
                      sx={{
                        mt: 'auto',
                        px: { xs: 2, md: 2.5 },
                        py: { xs: 1.75, md: 2 },
                        borderRadius: 2,
                        background: 'var(--theme-surface)',
                        border: '1px dashed var(--theme-border)',
                        color: 'var(--theme-text)',
                        fontSize: '0.8125rem',
                        lineHeight: 1.65,
                        fontStyle: 'italic',
                      }}
                    >
                      “{example.prompt}”
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </div>
        </div>
      </div>
    </Box>
  );
}

// ── Guest view (D4: honest read-only surface) ────────────────────────────────

function GuestView() {
  return (
    <main className="mt-5 md:mt-8 flex flex-col gap-5 md:gap-8">
      <WhatCanYouDoSection guest />
      <StepsGuide />

      <SectionCard>
        <SectionTitle icon={<ShieldCheck size={20} style={{ color: 'var(--color-primary-50)' }} />}>
          Connect your agent: read-only as a guest
        </SectionTitle>
        <SectionLead>
          Without logging in, an agent can connect over MCP and browse exactly what a logged-out visitor can see on
          the website: public offers, cooperations, companies, profiles, reviews and DAO overviews. No account data,
          no tickets, nothing write-capable.
        </SectionLead>
        <Box sx={{ mt: 3.5, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Button
            component={Link}
            to="/login?next=/ai/connect"
            variant="contained"
            startIcon={<KeyRound size={16} />}
            sx={{ textTransform: 'none', fontWeight: 600, background: 'var(--color-primary-50)', color: '#fff', '&:hover': { opacity: 0.9, background: 'var(--color-primary-50)' } }}
          >
            Log in to connect your own agent
          </Button>
          <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>
            Login is free and takes under a minute.
          </Typography>
        </Box>
      </SectionCard>
    </main>
  );
}

// ── Connection ledger (D5: sessions, activity, revocation) ───────────────────

function ConnectionCard({
  connection,
  onRevoked,
}: {
  connection: McpConnectionRow;
  onRevoked: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<McpEventRow[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const status = connectionStatus(connection);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && events === null && !eventsError) {
      setEventsLoading(true);
      try {
        const res = await apiCall(`/api/mcp/connections/${connection.id}/events?limit=100`);
        const data = await res.json();
        setEvents(data.events ?? []);
      } catch (err) {
        setEventsError(err instanceof Error ? err.message : 'Failed to load activity');
      } finally {
        setEventsLoading(false);
      }
    }
  };

  const revoke = async () => {
    setRevoking(true);
    try {
      await apiCall(`/api/mcp/connections/${connection.id}/revoke`, { method: 'POST' });
      onRevoked(connection.id);
    } finally {
      setRevoking(false);
    }
  };

  return (
    <Box
      sx={{
        width: '100%',
        borderRadius: 2,
        border: '1px solid var(--theme-border)',
        borderLeft: status === 'active' ? '4px solid var(--color-status-success, #23CA61)' : '4px solid transparent',
        background: status === 'active' ? 'color-mix(in srgb, var(--color-status-success, #23CA61) 3%, var(--theme-surface))' : 'var(--theme-surface)',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ px: { xs: 2, md: 3 }, pt: { xs: 2, md: 2.5 }, pb: { xs: 1.5, md: 2 } }}>
        <Stack direction="row" alignItems="center" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 1.5 }}>
          <Box
            sx={{
              width: 42,
              height: 42,
              borderRadius: 1.75,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: status === 'active' ? 'color-mix(in srgb, var(--color-status-success, #23CA61) 12%, transparent)' : 'var(--theme-bg-subtle)',
              color: status === 'active' ? 'var(--color-status-success, #23CA61)' : 'var(--theme-text-muted)',
            }}
          >
            <Cable size={19} />
          </Box>

          <Box sx={{ flex: 1, minWidth: 240 }}>
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" rowGap={1}>
              <Typography variant="subtitle1" sx={{ color: 'var(--theme-text)', fontWeight: 700, fontSize: '1rem', lineHeight: 1.4 }}>
                {shortLabel(connection.label)}
              </Typography>
              <ConnectionStatusBadge status={status} />
              {connection.passTier && (
                <Chip
                  size="small"
                  label={PASS_LABEL[connection.passTier] ?? connection.passTier}
                  sx={{ height: 22, fontSize: 11, fontWeight: 700, color: AI_ACCENT_YELLOW, border: `1px solid color-mix(in srgb, ${AI_ACCENT_YELLOW} 50%, transparent)`, background: `color-mix(in srgb, ${AI_ACCENT_YELLOW} 10%, transparent)` }}
                />
              )}
            </Stack>
            <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', display: 'block', mt: 1, lineHeight: 1.55 }}>
              {status === 'active'
                ? `Created ${formatWhen(connection.createdAt)} · last used ${formatWhen(connection.lastUsedAt)} · token expires ${formatWhen(connection.expiresAt)}`
                : status === 'revoked'
                  ? `Created ${formatWhen(connection.createdAt)} · revoked ${formatWhen(connection.revokedAt)}`
                  : `Created ${formatWhen(connection.createdAt)} · expired ${formatWhen(connection.expiresAt)}`}
            </Typography>
          </Box>

          <Stack direction="row" alignItems="center" spacing={1} sx={{ flexShrink: 0 }}>
            {status === 'active' && (
              <Button
                size="small"
                color="error"
                disabled={revoking}
                onClick={() => void revoke()}
                sx={{ textTransform: 'none', fontWeight: 600 }}
              >
                {revoking ? 'Revoking…' : 'Revoke'}
              </Button>
            )}
            <Tooltip title={open ? 'Hide activity' : 'What happened with this connection'}>
              <IconButton size="small" onClick={() => void toggle()} sx={{ color: 'var(--theme-text-muted)', p: 1, transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 150ms ease' }}>
                <ExpandMoreIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 2, gap: 0.75 }}>
          {connection.scope.map((scope) => (
            <Chip
              key={scope}
              size="small"
              label={scope}
              variant={scope === 'read' ? 'filled' : 'outlined'}
              sx={{
                height: 22,
                px: 0.5,
                fontSize: '0.7rem',
                fontFamily: 'monospace',
                fontWeight: scope === 'read' ? 700 : 500,
                bgcolor: scope === 'read' ? 'color-mix(in srgb, var(--color-primary-50) 10%, transparent)' : 'transparent',
                borderColor: 'var(--theme-border)',
                color: 'var(--theme-text-muted)',
              }}
            />
          ))}
        </Stack>

        <Button
          size="small"
          onClick={() => void toggle()}
          startIcon={<History size={14} />}
          sx={{ mt: 2, textTransform: 'none', color: 'var(--theme-text-muted)', fontWeight: 600, p: 0.5, minHeight: 0, '&:hover': { background: 'transparent', color: 'var(--color-primary-50)' } }}
        >
          Activity {status === 'active' && connection.lastUsedAt ? `· last used ${formatWhen(connection.lastUsedAt)}` : ''}
        </Button>
      </Box>

      <Collapse in={open}>
        <Box sx={{ borderTop: '1px solid var(--theme-border)', background: 'var(--theme-bg-subtle)', px: { xs: 2, md: 3 }, py: 2.5 }}>
          {eventsLoading && (
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 1 }}>
              <CircularProgress size={16} sx={{ color: 'var(--theme-text-muted)' }} />
              <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>Loading activity…</Typography>
            </Stack>
          )}
          {eventsError && (
            <Alert severity="warning" sx={{ py: 1, my: 1.5 }}>{eventsError}</Alert>
          )}
          {events !== null && events.length === 0 && (
            <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', display: 'block', py: 1.5 }}>
              No recorded activity yet. Tool calls made through this connection will appear here.
            </Typography>
          )}
          {events !== null && events.length > 0 && (
            <Stack spacing={1} sx={{ py: 0.5 }}>
              {events.map((e) => (
                <Stack
                  key={e.id}
                  direction="row"
                  spacing={1.5}
                  alignItems="center"
                  sx={{
                    px: { xs: 1.5, md: 2 },
                    py: 1.25,
                    borderRadius: 1.75,
                    background: 'var(--theme-surface)',
                    border: '1px solid var(--theme-border)',
                  }}
                >
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: e.outcome === 'success' ? 'var(--color-status-success, #23CA61)' : 'var(--color-status-error, #E5484D)',
                    }}
                  />
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'var(--theme-text)', fontWeight: 600, fontSize: '0.8125rem', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.tool}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', flexShrink: 0, textTransform: 'capitalize' }}>
                    {e.outcome}
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', flexShrink: 0 }}>
                    {e.agentLabel ?? 'agent'}
                  </Typography>
                  <Tooltip title={formatDateTime(e.ts)}>
                    <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', flexShrink: 0 }}>
                      {formatWhen(e.ts)}
                    </Typography>
                  </Tooltip>
                </Stack>
              ))}
            </Stack>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

function summarizeConnections(rows: McpConnectionRow[]): { activeCount: number; lastUsedAt: string | null } {
  let activeCount = 0;
  let lastUsedAt: string | null = null;
  for (const row of rows) {
    if (connectionStatus(row) !== 'active') continue;
    activeCount++;
    if (row.lastUsedAt && (lastUsedAt === null || row.lastUsedAt > lastUsedAt)) lastUsedAt = row.lastUsedAt;
  }
  return { activeCount, lastUsedAt };
}

function ConnectionLedger({
  pubkey,
  refreshKey,
  onStatusChange,
}: {
  pubkey: string;
  refreshKey: number;
  onStatusChange?: (activeCount: number, lastUsedAt: string | null) => void;
}) {
  const [rows, setRows] = useState<McpConnectionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiCall('/api/mcp/connections');
      const data = await res.json();
      const next = data.connections ?? [];
      setRows(next);
      onStatusChange?.(summarizeConnections(next).activeCount, summarizeConnections(next).lastUsedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connections');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load, pubkey, refreshKey]);

  const removeRow = (id: string) => {
    setRows((prev) => {
      const next = prev ? prev.filter((r) => r.id !== id) : prev;
      if (next) onStatusChange?.(summarizeConnections(next).activeCount, summarizeConnections(next).lastUsedAt);
      return next;
    });
  };

  const stats = summarizeConnections(rows ?? []);
  const activeCount = stats.activeCount;
  const mostRecentActive = stats.lastUsedAt
    ? (rows ?? []).find((r) => r.lastUsedAt === stats.lastUsedAt) ?? null
    : null;

  return (
    <SectionCard>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1.5 }}>
        <Box sx={{ flex: 1 }}>
          <SectionTitle icon={<History size={20} style={{ color: 'var(--color-primary-50)' }} />}>
            Your connections
          </SectionTitle>
        </Box>
        {rows && (
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexShrink: 0 }}>
            <Typography
              variant="body2"
              sx={{ color: activeCount > 0 ? 'var(--color-status-success, #23CA61)' : 'var(--theme-text-muted)', fontWeight: 800 }}
            >
              {activeCount} connected
            </Typography>
            <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)' }}>
              · {rows.length} total
            </Typography>
          </Stack>
        )}
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={() => void load()} aria-label="Refresh connections" sx={{ color: 'var(--theme-text-muted)', p: 1 }}>
            <RefreshCw size={16} />
          </IconButton>
        </Tooltip>
      </Stack>
      <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.7, mb: 3, maxWidth: '72ch' }}>
        A connection is a short-lived device credential for one agent. Revoking it immediately kills that agent's
        access, even if the token leaked.
      </Typography>

      {rows !== null && rows.length > 0 && (
        <Box
          sx={{
            mb: 3,
            px: { xs: 2, md: 2.5 },
            py: 1.75,
            borderRadius: 2,
            border: '1px solid',
            borderColor: activeCount > 0 ? 'color-mix(in srgb, var(--color-status-success, #23CA61) 40%, transparent)' : 'var(--theme-border)',
            background: activeCount > 0 ? 'color-mix(in srgb, var(--color-status-success, #23CA61) 7%, transparent)' : 'var(--theme-bg-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexWrap: 'wrap',
          }}
        >
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              flexShrink: 0,
              background: activeCount > 0 ? 'var(--color-status-success, #23CA61)' : 'var(--theme-text-muted)',
              boxShadow: activeCount > 0 ? '0 0 0 5px color-mix(in srgb, var(--color-status-success, #23CA61) 16%, transparent)' : 'none',
            }}
          />
          <Typography variant="body2" sx={{ color: activeCount > 0 ? 'var(--color-status-success, #23CA61)' : 'var(--theme-text-muted)', fontWeight: 700 }}>
            {activeCount > 0
              ? `${activeCount} connection${activeCount === 1 ? ' is' : 's are'} live. Your agent can connect now.`
              : 'No live connections. Create one above.'}
          </Typography>
          {activeCount > 0 && mostRecentActive && (
            <Box sx={{ flex: 1 }} />
          )}
          {activeCount > 0 && mostRecentActive && (
            <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>
              Last activity {formatWhen(mostRecentActive.lastUsedAt)}
            </Typography>
          )}
        </Box>
      )}

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}
      {rows === null && !error && (
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 3 }}>
          <CircularProgress size={18} sx={{ color: 'var(--theme-text-muted)' }} />
          <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>Loading connections…</Typography>
        </Stack>
      )}
      {rows !== null && rows.length === 0 && (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.7 }}>
            No connections yet. Create one above and paste the prompt into your local agent.
          </Typography>
        </Box>
      )}
      {rows !== null && rows.length > 0 && (
        <Stack spacing={2}>
          {rows.map((row) => (
            <ConnectionCard key={row.id} connection={row} onRevoked={removeRow} />
          ))}
        </Stack>
      )}
    </SectionCard>
  );
}

// ── Create-connection card with scope toggles (mint result shows above) ──────

function CreateConnectionCard({
  onMinted,
  needsPass,
  trialAvailable,
  onNeedPass,
}: {
  onMinted: (token: string, connectionId: string) => void;
  needsPass: boolean;
  trialAvailable: boolean;
  onNeedPass: () => void;
}) {
  const [writes, setWrites] = useState<Set<ScopeFamily>>(new Set());
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleWrite = (family: ScopeFamily) => {
    setWrites((prev) => {
      const next = new Set(prev);
      if (next.has(family)) next.delete(family);
      else next.add(family);
      return next;
    });
  };

  const create = async () => {
    // ADR-384 D11: no pass and the trial is spent: go straight to the pass dialog.
    if (needsPass) {
      onNeedPass();
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await apiCall('/api/mcp/connect', {
        method: 'POST',
        body: JSON.stringify({
          scopes: [...writes].map((w) => `${w}:write`),
          label: label.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { token?: string; connectionId?: string };
      if (!data.token || !data.connectionId) throw new Error('Minting did not return a token');
      setWrites(new Set());
      setLabel('');
      onMinted(data.token, data.connectionId);
    } catch (err) {
      const code = (err as { data?: { error?: string } } | undefined)?.data?.error;
      if (code === 'TRIAL_ALREADY_USED') onNeedPass();
      setError(err instanceof Error ? err.message : 'Failed to create connection');
    } finally {
      setCreating(false);
    }
  };

  const switchSx = {
    '& .MuiSwitch-switchBase.Mui-checked': { color: 'var(--color-primary-50)' },
    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: 'var(--color-primary-50)' },
  };

  return (
    <Box sx={{ mt: 4 }}>
      <SectionLead>
        Choose what this connection may do. Reading is always on; writing is opt-in per area and can be revoked any
        time. Changing scopes applies to new connections; the current token stays valid with what it was granted.{trialAvailable ? ' Your first connection is a free 30 minute trial.' : ''}
      </SectionLead>

      <Box
        sx={{
          mt: 3.5,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          columnGap: 4,
          rowGap: 2.5,
        }}
      >
        <FormControlLabel
          control={<Switch checked disabled sx={switchSx} />}
          label={
            <Stack spacing={0.5}>
              <Typography variant="body2" sx={{ color: 'var(--theme-text)', fontWeight: 650 }}>Read</Typography>
              <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.5 }}>Offers, cooperations, companies, tickets, DAO, always on</Typography>
            </Stack>
          }
          sx={{ width: '100%', m: 0, alignItems: 'flex-start', '& .MuiFormControlLabel-label': { flex: 1 } }}
        />
        {WRITE_FAMILIES.map(({ family, label: familyLabel, description }) => (
          <FormControlLabel
            key={family}
            control={
              <Switch
                checked={writes.has(family)}
                onChange={() => toggleWrite(family)}
                sx={switchSx}
              />
            }
            label={
              <Stack spacing={0.5}>
                <Typography variant="body2" sx={{ color: 'var(--theme-text)', fontWeight: 650 }}>
                  {familyLabel} write
                </Typography>
                <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.5 }}>{description}</Typography>
              </Stack>
            }
            sx={{ width: '100%', m: 0, alignItems: 'flex-start', '& .MuiFormControlLabel-label': { flex: 1 } }}
          />
        ))}
      </Box>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} sx={{ mt: 3.5 }}>
        <TextField
          size="small"
          label="Name this connection (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Claude Code on my laptop"
          sx={{ flex: 1, maxWidth: 360 }}
        />
        <Button
          variant="contained"
          disabled={creating}
          onClick={() => void create()}
          startIcon={creating ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : <KeyRound size={16} />}
          sx={{ textTransform: 'none', fontWeight: 600, px: 3, py: 1, background: 'var(--color-primary-50)', color: '#fff', '&:hover': { opacity: 0.9, background: 'var(--color-primary-50)' }, '&.Mui-disabled': { background: 'color-mix(in srgb, var(--color-primary-50) 45%, transparent)', color: '#fff' } }}
        >
          {creating ? 'Creating…' : needsPass ? 'Get a pass to connect' : trialAvailable ? 'Start free trial' : 'Create connection'}
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mt: 3 }}>{error}</Alert>}
    </Box>
  );
}

// ── One-time copy block (D2: URL + bearer + client snippets) ─────────────────

function SnippetBlock({ filename, code }: { filename: string; code: string }) {
  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', fontWeight: 650, fontSize: '0.78rem' }}>{filename}</Typography>
        <CopyButton value={code} label={filename} />
      </Stack>
      <pre
        className="rounded-xl p-3 md:p-4 text-[12.5px] leading-relaxed overflow-x-auto"
        style={{ background: 'var(--theme-bg)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', margin: 0 }}
      >
        <code className="font-mono">{code}</code>
      </pre>
    </Box>
  );
}

function TokenResultBlock({ token, onDone }: { token: string; onDone?: () => void }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://colabonate.com';
  const url = `${origin}/mcp`;
  const header = `Authorization: Bearer ${token}`;

  const mcpServers = JSON.stringify(
    {
      mcpServers: {
        colabonate: {
          type: 'http',
          url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );

  return (
    <Box
      sx={{
        borderRadius: 2.5,
        border: '1px solid color-mix(in srgb, var(--color-primary-50) 45%, transparent)',
        background: 'color-mix(in srgb, var(--color-primary-50) 5%, var(--theme-bg-subtle))',
        p: { xs: 2.5, md: 3.5 },
      }}
    >
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2.5 }} flexWrap="wrap" rowGap={1.5}>
        <Chip size="small" label="TOKEN, shown once" sx={{ height: 22, fontSize: '0.68rem', fontWeight: 800, bgcolor: 'color-mix(in srgb, var(--color-status-warning, #F5A623) 18%, transparent)', color: 'var(--color-status-warning, #F5A623)' }} />
        <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.55, flex: 1, minWidth: 200 }}>
          Treat it like a password. It expires automatically; revoke it on this page any time.
        </Typography>
        {onDone && (
          <Button
            size="small"
            onClick={onDone}
            endIcon={<CloseIcon sx={{ fontSize: 16 }} />}
            sx={{ textTransform: 'none', color: 'var(--theme-text-muted)', fontWeight: 650, flexShrink: 0, p: 0.5 }}
          >
            Got it
          </Button>
        )}
      </Stack>

      <Typography variant="body1" sx={{ color: 'var(--theme-text)', fontWeight: 700, mb: 2, lineHeight: 1.4 }}>
        Paste this into your agent to connect:
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5, px: 2, py: 1.75, borderRadius: 2, background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
        <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'var(--theme-text)', fontSize: '0.8125rem', flex: 1, wordBreak: 'break-all' }}>
          {url}
        </Typography>
        <CopyButton value={url} label="server URL" />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5, px: 2, py: 1.75, borderRadius: 2, background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
        <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'var(--theme-text)', fontSize: '0.8125rem', flex: 1, wordBreak: 'break-all' }}>
          {header}
        </Typography>
        <CopyButton value={header} label="authorization header" />
      </Box>

      <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', display: 'block', mb: 1.5, fontSize: '0.78rem', lineHeight: 1.5 }}>
        Or copy a ready-made config. The token goes in the HTTP header only, never in the URL.
      </Typography>
      <SnippetBlock filename="mcpServers.json (claude-code / kilo)" code={mcpServers} />
    </Box>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

// ADR-410: 'lifetime' is the only sold tier; day/week/month stay labelled for
// pre-switch rows that have not expired yet.
const PASS_LABEL: Record<string, string> = { trial: 'Trial', lifetime: 'Lifetime pass', day: 'Day pass', week: 'Week pass', month: 'Month pass' };

// ADR-384 D11 / ADR-410 - what the user can do right now: paywall on/off, free
// trial left, active pass (lifetime rows carry expiresAt null), and the
// purchasable passes.
interface McpAccess {
  paywallActive: boolean;
  trialAvailable: boolean;
  trialMinutes: number;
  activePass: { tier: string; expiresAt: string | null; lifetime?: boolean } | null;
  passes: McpPassTier[];
}

function useMcpAccess(enabled: boolean) {
  const [access, setAccess] = useState<McpAccess | null>(null);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      setAccess((await (await apiCall('/api/mcp/access')).json()) as McpAccess);
    } catch {
      // page stays usable without the access block
    }
  }, [enabled]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { access, refresh };
}

function McpAccessSection({ access, onBuy }: { access: McpAccess; onBuy: (tierId: string | null) => void }) {
  const { isBeta } = useBetaMode();
  const { activePass, trialAvailable, paywallActive, passes, trialMinutes } = access;

  const payMethods = [
    { icon: <Wallet size={16} />, title: 'Your connected wallet', text: 'NWC, Alby or a WebLN browser wallet pays in one click.' },
    { icon: <FileText size={16} />, title: 'Any Lightning wallet', text: 'Scan or paste the invoice, then paste the preimage to confirm.' },
    ...(isBeta ? [{ icon: <FlaskConical size={16} />, title: 'Demo payment (Beta)', text: 'Simulated with your demo balance. No real sats move.' }] : []),
  ];

  const lifetimeActive = Boolean(activePass && (activePass.lifetime || activePass.expiresAt === null));

  const status = activePass
    ? lifetimeActive
      ? { label: 'Lifetime pass active', detail: 'Your MCP access never expires. Mint a new connection any time and revoke it here.', color: 'var(--color-status-success)' }
      : { label: `${PASS_LABEL[activePass.tier] ?? activePass.tier} active`, detail: `Connections stay valid until ${formatDateTime(activePass.expiresAt!)}. After that, a single one-time payment unlocks lifetime access.`, color: 'var(--color-status-success)' }
    : !paywallActive
      ? { label: 'Free on this deployment', detail: 'Connections need no pass here.', color: 'var(--color-status-success)' }
      : trialAvailable
        ? { label: `First ${trialMinutes} minutes free`, detail: 'Your first connection is a free trial. After that a single one-time payment unlocks lifetime access.', color: AI_ACCENT_YELLOW }
        : { label: 'No active pass', detail: 'Your free trial is used up. One one-time payment unlocks lifetime access.', color: 'var(--color-status-error)' };

  return (
    <Box sx={{ mt: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <Zap size={15} style={{ color: 'var(--color-primary-50)' }} />
        <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)' }}>Access and payment</span>
      </Stack>

      <Stack direction="row" spacing={1.5} alignItems="center">
        <Clock size={18} style={{ color: status.color, flexShrink: 0 }} />
        <Typography sx={{ color: status.color, fontWeight: 700, fontSize: '1.05rem' }}>{status.label}</Typography>
      </Stack>
      <SectionLead>{status.detail}</SectionLead>

      {paywallActive && !lifetimeActive && (
        <>
          <AiAccentDivider />
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} justifyContent="space-between" sx={{ position: 'relative', zIndex: 1 }}>
            <Typography sx={{ color: 'var(--theme-text-muted)', fontSize: 15 }}>
              Paid directly to Colabonate, once — no subscription, no balance. It supports the development of
              Colabonate and the open protocol.
            </Typography>
            <Stack direction="row" flexWrap="wrap" sx={{ gap: 1 }}>
              {passes.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onBuy(t.id)}
                  className="ai-promo-chip flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm cursor-pointer"
                  style={{ borderColor: `color-mix(in srgb, ${AI_ACCENT_YELLOW} 45%, var(--theme-border))`, color: 'var(--theme-text)' }}
                >
                  <span className="font-semibold">{PASS_LABEL[t.id] ?? t.id}</span>
                  <Heart size={12} className="fill-current" style={{ color: AI_ACCENT_YELLOW }} />
                  <SatsAmount sats={t.priceSats} size="sm" />
                </button>
              ))}
            </Stack>
          </Stack>

          <Box sx={{ mt: 3, display: 'grid', gridTemplateColumns: { xs: '1fr', md: `repeat(${payMethods.length}, 1fr)` }, gap: 2 }}>
            {payMethods.map((m) => (
              <Box
                key={m.title}
                sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', p: 2, borderRadius: 2, border: '1px solid var(--theme-border)', background: 'var(--theme-bg-subtle)' }}
              >
                <Box sx={{ color: AI_ACCENT_YELLOW, display: 'flex', mt: 0.25 }}>{m.icon}</Box>
                <Box>
                  <Typography sx={{ color: 'var(--theme-text)', fontWeight: 650, fontSize: 15 }}>{m.title}</Typography>
                  <Typography sx={{ color: 'var(--theme-text-muted)', fontSize: 14, lineHeight: 1.55, mt: 0.25 }}>{m.text}</Typography>
                </Box>
              </Box>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}

function ChatColumn() {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        p: { xs: 2.5, md: 3 },
        borderRadius: 3,
        border: '1px solid var(--theme-border)',
        background: 'var(--theme-bg-subtle)',
        alignSelf: 'start',
      }}
    >
      <SectionTitle icon={<Sparkles size={20} style={{ color: 'var(--color-primary-50)' }} />}>
        Prefer chatting?
      </SectionTitle>
      <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.7 }}>
        Skip the setup and talk to the Colabonate AI Assistant directly. It is hosted by Colabonate, needs no API key
        and works with your marketplace data.
      </Typography>
      <Button
        component={Link}
        to="/ai"
        variant="outlined"
        startIcon={<Sparkles size={16} />}
        endIcon={<ArrowForwardIcon />}
        className="ai-promo-btn"
        sx={{
          alignSelf: 'flex-start',
          fontWeight: 700,
          textTransform: 'none',
          borderRadius: '10px',
          px: 2.5,
          color: 'var(--color-primary-50)',
          border: '1px solid var(--color-primary-50)',
          background: 'color-mix(in srgb, var(--theme-bg-subtle) 30%, transparent)',
          transition: 'box-shadow 0.2s ease, background 0.2s ease',
          '&:hover': { border: '1px solid var(--color-primary-50)', background: 'color-mix(in srgb, var(--color-primary-50) 8%, transparent)' },
        }}
      >
        Open the AI Assistant
      </Button>
    </Box>
  );
}

export function AIConnectPage() {
  const pubkey = localStorage.getItem('pubkey') ?? '';
  const [refreshKey, setRefreshKey] = useState(0);
  // One-time token of the connection that was just minted (stays visible even
  // though the "Connect a new agent" card collapses once a connection is live).
  const [freshToken, setFreshToken] = useState<{ token: string } | null>(null);
  const [hasActive, setHasActive] = useState(false);
  const tokenRef = useRef<HTMLDivElement | null>(null);
  const { access, refresh: refreshAccess } = useMcpAccess(Boolean(pubkey));
  const [buy, setBuy] = useState<{ open: boolean; tier: string | null }>({ open: false, tier: null });
  const needsPass = Boolean(access?.paywallActive && !access.trialAvailable && !access.activePass);

  const handleStatusChange = useCallback((activeCount: number) => {
    setHasActive(activeCount > 0);
  }, []);

  const handleMinted = useCallback((token: string) => {
    setFreshToken({ token });
    setHasActive(true);
    setRefreshKey((k) => k + 1);
    // Bring the one-time token block into view once the create card collapses.
    requestAnimationFrame(() => {
      setTimeout(() => tokenRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
    });
  }, []);

  return (
    <PageContainer size="wide" spacing="lg" gap="none" className="pt-0!">
      <Seo noindex path="/ai/connect" />
      <PageHeader
        icon={<Cable size={18} />}
        title="Connect your agent"
        subtitle="Run Colabonate tools from your own local agent over MCP"
        onBack={() => window.history.back()}
      />

      {!pubkey ? (
        <GuestView />
      ) : (
        <main className="mt-5 md:mt-8 flex flex-col gap-5 md:gap-8">
          <WhatCanYouDoSection />
          <StepsGuide />

          {freshToken && (
            <Box ref={tokenRef}>
              <TokenResultBlock token={freshToken.token} onDone={() => setFreshToken(null)} />
            </Box>
          )}

          {/* One section: connect (access, payment, scopes) next to the chat alternative.
              Once a connection is live the create form animates away, access stays. */}
          <SectionCard>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 340px' }, gap: { xs: 4, lg: 6 }, alignItems: 'start' }}>
              <Box sx={{ minWidth: 0 }}>
                <SectionTitle icon={<KeyRound size={20} style={{ color: 'var(--color-primary-50)' }} />}>
                  Connect a new agent
                </SectionTitle>
                {access && <McpAccessSection access={access} onBuy={(tier) => setBuy({ open: true, tier })} />}
                <Collapse in={!hasActive} unmountOnExit>
                  <CreateConnectionCard
                    onMinted={(token) => { handleMinted(token); void refreshAccess(); }}
                    needsPass={needsPass}
                    trialAvailable={Boolean(access?.trialAvailable)}
                    onNeedPass={() => setBuy({ open: true, tier: null })}
                  />
                </Collapse>
              </Box>
              <ChatColumn />
            </Box>
          </SectionCard>

          <ConnectionLedger pubkey={pubkey} refreshKey={refreshKey} onStatusChange={handleStatusChange} />
          <SectionCard>
            <Stack direction="row" spacing={2.5} alignItems="flex-start">
              <Box
                sx={{
                  width: 42,
                  height: 42,
                  borderRadius: 2,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'color-mix(in srgb, var(--color-primary-50) 10%, transparent)',
                  color: 'var(--color-primary-50)',
                }}
              >
                <ShieldCheck size={20} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle1" sx={{ color: 'var(--theme-text)', fontWeight: 700, fontSize: '1rem', lineHeight: 1.4, mb: 1 }}>
                  How scopes and security work
                </Typography>
                <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.75, maxWidth: '72ch' }}>
                  Connection tokens are short-lived device credentials that only work on the MCP endpoint. They can
                  never call the website API directly. The agent can only use the tools you granted, every call is
                  recorded here, and a leaked token expires automatically or can be revoked immediately. See the{' '}
                  <Link to="/help" style={{ color: 'var(--color-primary-50)' }}>Help center</Link> for details.
                </Typography>
              </Box>
            </Stack>
          </SectionCard>
        </main>
      )}

      {access && (
        <BuyMcpPassDialog
          open={buy.open}
          tiers={access.passes}
          autoBuyTierId={buy.tier}
          lifetimeActive={Boolean(access.activePass && (access.activePass.lifetime || access.activePass.expiresAt === null))}
          onClose={() => setBuy({ open: false, tier: null })}
          onPurchased={() => { void refreshAccess(); setRefreshKey((k) => k + 1); }}
        />
      )}

    </PageContainer>
  );
}
