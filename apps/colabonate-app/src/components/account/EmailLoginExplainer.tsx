import { Link } from 'react-router-dom'
import { Button } from '@mui/material'
import EmailIcon from '@mui/icons-material/Email'
import KeyIcon from '@mui/icons-material/Key'
import BoltIcon from '@mui/icons-material/Bolt'
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { cn } from '@ds/utils'

interface EmailLoginExplainerProps {
  email: string
  identityLevel: number
  hasLinkedLightning: boolean
}

export function EmailLoginExplainer({ email, identityLevel, hasLinkedLightning }: EmailLoginExplainerProps) {
  const upgraded = identityLevel >= 1
  const lightningLinked = hasLinkedLightning

  const title = upgraded
    ? 'Email login: your account is upgraded'
    : 'You signed in with Email. Here is what that means'

  const eyebrow = upgraded ? 'L' + identityLevel + ' · ' + email : 'Email · Level 0'

  return (
    <div
      className={cn(
        'rounded-2xl',
        'border-2',
        'overflow-hidden',
      )}
      style={{
        borderColor: upgraded ? 'var(--color-status-success)' : 'var(--color-status-warning)',
        backgroundColor: 'var(--theme-surface)',
      }}
    >
      <div
        className="h-1"
        style={{
          background: upgraded
            ? 'linear-gradient(90deg, var(--color-status-success), var(--color-primary-50))'
            : 'linear-gradient(90deg, var(--color-status-warning), var(--color-status-warning))',
        }}
      />

      <div className="px-5 py-5 md:px-6 md:py-6 space-y-5">
        <div className="flex items-start gap-4">
          <span
            className="flex items-center justify-center rounded-2xl border-2 shrink-0"
            style={{
              width: '3rem',
              height: '3rem',
              backgroundColor: upgraded
                ? 'color-mix(in srgb, var(--color-status-success) 12%, transparent)'
                : 'color-mix(in srgb, var(--color-status-warning) 14%, transparent)',
              borderColor: upgraded
                ? 'color-mix(in srgb, var(--color-status-success) 35%, transparent)'
                : 'color-mix(in srgb, var(--color-status-warning) 40%, transparent)',
              color: upgraded ? 'var(--color-status-success)' : 'var(--color-status-warning)',
            }}
          >
            <EmailIcon />
          </span>

          <div className="min-w-0 flex-1">
            <span
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wider"
              style={{
                backgroundColor: upgraded
                  ? 'color-mix(in srgb, var(--color-status-success) 14%, transparent)'
                  : 'color-mix(in srgb, var(--color-status-warning) 18%, transparent)',
                color: upgraded ? 'var(--color-status-success)' : 'var(--color-status-warning)',
                fontFamily: 'var(--typography-fontfamily-sans)',
              }}
            >
              {eyebrow}
            </span>
            <h3
              className="mt-2 text-[16px] font-bold leading-snug"
              style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              {title}
            </h3>
            <p
              className="mt-1.5 text-[13px] leading-relaxed"
              style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              {upgraded
                ? `Your account is bound to ${email}. It is now backed by a Nostr key you control, so you can create offers, sign tickets, and keep your reputation across devices and browsers.`
                : `Your account is bound to ${email}, but the private key that signs your Nostr events lives only in this browser. Clear your browser data without setting up an extension first and you lose your offers, tickets, reviews, and COL-Points. Only your email-bound identity is kept on the server.`}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <PathCard
            icon={<KeyIcon sx={{ fontSize: 20 }} />}
            tone={upgraded ? 'done' : 'todo'}
            title={upgraded ? 'Nostr key connected' : 'Connect a Nostr identity'}
            body={
              upgraded
                ? 'Your identity is portable. Backups live with your extension (Alby / nos2x) or NIP-46 bunker.'
                : 'Have a Nostr extension (Alby / nos2x)? Connect it to unlock Level 1. No extension? Generate a key instead. It never leaves your browser and takes about a minute.'
            }
            cta={upgraded ? 'Manage keys & backup' : 'No extension? Generate a key'}
            to={upgraded ? '/account#identity-security' : '/onboarding/generate-nostr-key'}
            secondaryCta={upgraded ? undefined : 'Or connect an existing extension'}
            secondaryTo={upgraded ? undefined : '/help/login-providers#lp-2'}
          />

          <PathCard
            icon={<BoltIcon sx={{ fontSize: 20 }} />}
            tone={lightningLinked ? 'done' : 'todo'}
            title={lightningLinked ? 'Lightning wallet linked' : 'Link a Lightning wallet'}
            body={
              lightningLinked
                ? 'You can pay and receive sats directly from Colabonate. No QR codes or external wallets needed.'
                : 'Required for tickets, escrow, and paying sellers. Alby Hub, Breez, Phoenix, or any LNURL wallet work.'
            }
            cta={lightningLinked ? 'Open wallet' : 'Open wallet settings'}
            to="/wallet"
          />
        </div>

        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2 border-t"
          style={{ borderColor: 'var(--theme-border)' }}
        >
          <Link
            to="/help/login-providers#lp-4"
            className="inline-flex items-center gap-1 text-[12px] font-semibold"
            style={{ color: 'var(--color-primary-50)' }}
          >
            Why email login is L0 only: the full picture
            <ArrowOutwardIcon sx={{ fontSize: 13 }} />
          </Link>
          <Link
            to="/account#identity-security"
            className="inline-flex items-center gap-1 text-[12px] font-semibold"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            Manage Identity & Security
            <ArrowForwardIcon sx={{ fontSize: 13 }} />
          </Link>
        </div>
      </div>
    </div>
  )
}

interface PathCardProps {
  icon: React.ReactNode
  tone: 'done' | 'todo'
  title: string
  body: string
  cta: string
  to: string
  secondaryCta?: string
  secondaryTo?: string
}

function PathCard({ icon, tone, title, body, cta, to, secondaryCta, secondaryTo }: PathCardProps) {
  const isDone = tone === 'done'
  return (
    <div
      className="flex flex-col gap-2 rounded-xl p-4"
      style={{
        backgroundColor: 'var(--theme-bg-subtle)',
        border: `1px solid ${isDone ? 'color-mix(in srgb, var(--color-status-success) 30%, transparent)' : 'var(--theme-border)'}`,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex items-center justify-center rounded-lg shrink-0"
          style={{
            width: '1.75rem',
            height: '1.75rem',
            backgroundColor: isDone
              ? 'color-mix(in srgb, var(--color-status-success) 18%, transparent)'
              : 'var(--theme-bg-elevated)',
            color: isDone ? 'var(--color-status-success)' : 'var(--color-primary-50)',
          }}
        >
          {icon}
        </span>
        <h4
          className="text-[13px] font-semibold leading-tight"
          style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
        >
          {title}
        </h4>
      </div>
      <p
        className="text-[12px] leading-relaxed"
        style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
      >
        {body}
      </p>
      <Button
        component={Link}
        to={to}
        variant={isDone ? 'outlined' : 'contained'}
        size="small"
        endIcon={<ArrowForwardIcon sx={{ fontSize: 14 }} />}
        sx={{
          alignSelf: 'flex-start',
          textTransform: 'none',
          borderRadius: '10px',
          fontWeight: 600,
          fontSize: '12px',
          px: 1.75,
          py: 0.5,
          fontFamily: 'var(--typography-fontfamily-sans)',
          ...(isDone
            ? { color: 'var(--color-status-success)', borderColor: 'color-mix(in srgb, var(--color-status-success) 50%, transparent)' }
            : { backgroundColor: 'var(--color-primary-50)', boxShadow: 'none', '&:hover': { backgroundColor: 'var(--color-primary-50)', opacity: 0.92, boxShadow: 'none' } }),
        }}
      >
        {cta}
      </Button>
      {secondaryCta && secondaryTo && (
        <Link
          to={secondaryTo}
          className="text-[11px] font-semibold"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          {secondaryCta}
        </Link>
      )}
    </div>
  )
}
