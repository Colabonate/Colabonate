/**
 * Footer – Colabonate Design System
 *
 * Two variants:
 * - `extended`: Full footer for the landing page (Home)
 *   with newsletter section, 4-column link grid, and copyright bar.
 * - `minimal`: Compact single-line variant for all internal pages.
 *
 * Design: Glassmorphism surface matching the MainMenu navbar style
 * (translucent white/dark bg + backdrop blur).
 *
 * @see docs/decisions/082-dual-variant-footer-component.md
 *
 * @example
 * <Footer variant="extended" />
 * <Footer variant="minimal" />
 */

import { Box, Typography, Divider, TextField, Button, Link as MuiLink, useTheme as useMuiTheme } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import { Bolt as BoltIcon } from '@mui/icons-material'
import { LogoIcon } from '../logo/logo-svgs'
import type { ReactNode } from 'react'
import type { FooterProps, FooterLinkSectionProps, FooterLink, FooterNewsletterProps, FooterNewsletterState } from './footer.types'

type NavFn = (href: string) => void

// ─── Glassmorphism surface tokens (mirrors MainMenu navbar) ───────────────────

const SURFACE = {
  light: {
    bg:          'rgba(255,255,255,0.72)',
    border:      'rgba(0,0,0,0.06)',
    textPrimary: 'var(--color-neutral-1)',
    textMuted:   'var(--color-neutral-5)',
    link:        'var(--color-neutral-3)',
    linkHover:   'var(--color-primary-50)',
    divider:     'rgba(0,0,0,0.06)',
    inputBg:     'rgba(255,255,255,0.6)',
    inputBorder: 'rgba(0,0,0,0.12)',
    inputFocus:  'var(--color-primary-50)',
    mutedText:   'var(--color-neutral-5)',
    captionText: 'var(--color-neutral-5)',
    dotColor:    'var(--color-neutral-5)',
  },
  dark: {
    bg:          'rgba(29,36,43,0.72)',
    border:      'rgba(255,255,255,0.06)',
    textPrimary: 'var(--color-neutral-9)',
    textMuted:   'var(--color-neutral-6)',
    link:        'var(--color-neutral-7)',
    linkHover:   'var(--color-primary-50)',
    divider:     'rgba(255,255,255,0.08)',
    inputBg:     'rgba(255,255,255,0.06)',
    inputBorder: 'rgba(255,255,255,0.12)',
    inputFocus:  'var(--color-primary-50)',
    mutedText:   'var(--color-neutral-6)',
    captionText: 'var(--color-neutral-7)',
    dotColor:    'var(--color-neutral-7)',
  },
}

// Aligns exactly with PageContainer size="wide" (max 1600px) so the footer is
// flush with the home page content box at every breakpoint.
// See packages/ui/page-container/page-container.tsx → maxWidthClasses + centered.
const CONTENT_MAX_W = '1600px'
// PageContainer's `px-4 md:px-6 lg:px-8` runs on Tailwind v4 DEFAULT screens
// (md=768px, lg=1024px — the custom 600/900 config is not loaded via @config),
// while MUI theme breakpoints sit at 600/900. Use raw media queries pinned to
// Tailwind's effective breakpoints so the footer switches padding at the same
// viewport widths as the page content.
//
// This wrapper reproduces PageContainer's outer box (max-w + centered + px),
// so the glass surface INSIDE it starts exactly at the content's left edge —
// the footer is a flush card, not a full-bleed bar.
const ALIGN_WRAPPER_SX = {
  width: '100%',
  maxWidth: CONTENT_MAX_W,
  mx: 'auto',
  px: '16px',                                    // = px-4
  '@media (min-width:768px)':  { px: '24px' },   // = md:px-6
  '@media (min-width:1024px)': { px: '32px' },   // = lg:px-8
  // Mobile-only clearance for MainMenu's fixed bottom nav (58px + safe-area,
  // matching the pb reserved elsewhere e.g. PageContainer/FABs). Kept as
  // margin on this plain wrapper — NOT padding inside the glass surface below —
  // so the reserved zone stays transparent instead of stacking two blurred
  // translucent panels (footer + nav) on top of each other.
  mb: { xs: 'calc(58px + env(safe-area-inset-bottom, 0px) + 72px)', md: 0 },
}

// ─── Link Section ──────────────────────────────────────────────────────────────

function FooterLinkSection({ title, links, onNavigate }: FooterLinkSectionProps & { onNavigate?: NavFn }) {
  const theme = useMuiTheme()
  const isDark = theme.palette.mode === 'dark'
  const tk = isDark ? SURFACE.dark : SURFACE.light

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography
        variant="overline"
        sx={{
          fontWeight: 300,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontSize: '0.7rem',
          color: tk.link,
        }}
      >
        {title}
      </Typography>
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {links.map((link) => (
          <li key={link.label}>
            {link.external ? (
              <Button
                component="a"
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                variant="text"
                sx={{ ...footerLinkSx, color: tk.link, minWidth: 0, py: 0, px: 'var(--spacing-4)', justifyContent: 'flex-start' }}
              >
                {link.label}
              </Button>
            ) : onNavigate ? (
              <Button
                variant="text"
                onClick={() => onNavigate(link.href)}
                sx={{ ...footerLinkSx, color: tk.link, minWidth: 0, py: 0, px: 'var(--spacing-4)', justifyContent: 'flex-start' }}
              >
                {link.label}
              </Button>
            ) : (
              <Button
                component="a"
                href={link.href}
                variant="text"
                sx={{ ...footerLinkSx, color: tk.link, minWidth: 0, py: 0, px: 'var(--spacing-4)', justifyContent: 'flex-start' }}
              >
                {link.label}
              </Button>
            )}
          </li>
        ))}
      </Box>
    </Box>
  )
}

// ─── Newsletter ────────────────────────────────────────────────────────────────

function FooterNewsletter({
  title,
  description,
  placeholder = 'your@email.com',
  buttonText,
  successMessage = 'Check your inbox to confirm your subscription.',
  email,
  onEmailChange,
  onSubmit,
  status = 'idle',
  errorMessage,
}: FooterNewsletterProps) {
  const theme = useMuiTheme()
  const isDark = theme.palette.mode === 'dark'
  const tk = isDark ? SURFACE.dark : SURFACE.light
  const isLoading = status === 'loading'
  const isSuccess = status === 'success'

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        alignItems: { md: 'flex-end' },
        justifyContent: 'space-between',
        gap: { xs: 2.5, md: 3 },
      }}
    >
      <Box sx={{ flex: 1, maxWidth: { md: '50%' }, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography
          variant="h5"
          sx={{ fontWeight: 700, lineHeight: 1.2 }}
        >
          {title}
        </Typography>
        <Typography
          variant="body2"
          sx={{ color: tk.mutedText, lineHeight: 1.5 }}
        >
          {description}
        </Typography>
      </Box>
      <Box sx={{ flex: 1, maxWidth: { xs: '100%', md: 400 }, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {isSuccess ? (
          <Typography
            variant="body2"
            role="status"
            sx={{ color: 'var(--color-primary-50)', fontWeight: 600, fontSize: '0.875rem' }}
          >
            {successMessage}
          </Typography>
        ) : (
          <>
            <Box
              component="form"
              onSubmit={onSubmit}
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                gap: 1.5,
              }}
            >
              <TextField
                type="email"
                placeholder={placeholder}
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                required
                disabled={isLoading}
                size="small"
                fullWidth
                error={status === 'error'}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 'var(--radius-md)',
                    bgcolor: tk.inputBg,
                    color: tk.textPrimary,
                    backdropFilter: 'blur(8px)',
                    '& fieldset': { borderColor: tk.inputBorder },
                    '&:hover fieldset': { borderColor: isDark ? 'rgba(255,255,255,0.24)' : 'rgba(0,0,0,0.2)' },
                    '&.Mui-focused fieldset': { borderColor: tk.inputFocus },
                    '& input::placeholder': { color: tk.mutedText, opacity: 1 },
                  },
                }}
                InputProps={{ sx: { fontSize: '0.875rem' } }}
              />
              <Button
                type="submit"
                variant="contained"
                size="small"
                disabled={isLoading}
                sx={{
                  bgcolor: 'var(--color-primary-50)',
                  borderRadius: 'var(--radius-md)',
                  textTransform: 'none',
                  fontWeight: 600,
                  px: 3,
                  '&:hover': { bgcolor: 'var(--color-primary-70)' },
                  '&.Mui-disabled': { bgcolor: 'var(--color-primary-50)', opacity: 0.6, color: '#fff' },
                  whiteSpace: 'nowrap',
                }}
              >
                {isLoading ? 'Subscribing…' : buttonText}
              </Button>
            </Box>
            {status === 'error' && errorMessage && (
              <Typography variant="caption" role="alert" sx={{ color: 'var(--color-status-error)' }}>
                {errorMessage}
              </Typography>
            )}
          </>
        )}
      </Box>
    </Box>
  )
}

// ─── Social Icons ──────────────────────────────────────────────────────────────

function FooterSocialLinks({ links }: { links: FooterLink[] }) {
  const theme = useMuiTheme()
  const isDark = theme.palette.mode === 'dark'
  const tk = isDark ? SURFACE.dark : SURFACE.light

  return (
    <Box sx={{ display: 'flex', gap: 1, mt: { xs: 1, sm: 0 } }}>
      {links.map((link) => (
        <MuiLink
          key={link.label}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={link.label}
          sx={{
            color: tk.mutedText,
            transition: 'all 150ms ease',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: 'var(--radius-md)',
            bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
            '&:hover': {
              color: tk.linkHover,
              bgcolor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
              transform: 'translateY(-2px)',
            },
          }}
        >
          {socialIcon(link.label)}
        </MuiLink>
      ))}
    </Box>
  )
}

function socialIcon(label: string) {
  switch (label.toLowerCase()) {
    case 'x':
    case 'twitter':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      )
    case 'instagram':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
        </svg>
      )
    case 'nostr':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
        </svg>
      )
    default:
      return <span>{label}</span>
  }
}

// ─── Shared Styles ─────────────────────────────────────────────────────────────

const footerLinkSx: SxProps<Theme> = {
  textDecoration: 'none',
  fontSize: '0.875rem',
  fontWeight: 300,
  lineHeight: 1.6,
  transition: 'color 150ms ease',
  cursor: 'pointer',
  '&:hover': {
    color: 'var(--color-primary-50)',
  },
}

// ─── Extended Footer ───────────────────────────────────────────────────────────

const productLinks: FooterLink[] = [
  { label: 'About',    href: '/about' },
  { label: 'Features', href: '/features' },
  { label: 'Pricing',  href: '/pricing' },
  { label: 'Roadmap',  href: '/roadmap' },
]

const roleLinks: FooterLink[] = [
  { label: 'Buy', href: '/buy' },
  { label: 'Sell', href: '/sell' },
  { label: 'Cooperate', href: '/coop' },
]

const resourceLinks: FooterLink[] = [
  { label: 'Help & FAQ', href: '/legal/help' },
  { label: 'Contact', href: '/legal/contact' },
  { label: 'Nostr Protocol', href: 'https://nostr.com', external: true },
  { label: 'Creator Guide', href: '/coop/guide' },
  // ADR-414: raw Markdown file served by nginx, not an SPA route → real anchor.
  { label: 'For AI agents', href: '/agents.md', external: true },
]

const legalLinks: FooterLink[] = [
  { label: 'Imprint', href: '/legal/imprint' },
  { label: 'Privacy', href: '/legal/privacy' },
  { label: 'Terms', href: '/legal/terms' },
]

const socialLinks: FooterLink[] = [
  { label: 'X', href: '#', external: true },
  { label: 'Instagram', href: 'https://www.instagram.com/colabonate/', external: true },
]

// Inert fallback so <Footer variant="extended" /> stays functional (no crash)
// even when the app-level container doesn't wire up newsletter state.
const NOOP_NEWSLETTER: FooterNewsletterState = {
  email: '',
  onEmailChange: () => {},
  onSubmit: (e) => e.preventDefault(),
}

function ExtendedFooter({
  onNavigate,
  stateBadge,
  version,
  newsletter = NOOP_NEWSLETTER,
}: {
  onNavigate?: NavFn
  stateBadge?: ReactNode
  version?: string
  newsletter?: FooterNewsletterState
}) {
  const theme = useMuiTheme()
  const isDark = theme.palette.mode === 'dark'
  const tk = isDark ? SURFACE.dark : SURFACE.light

  return (
    <Box component="footer" sx={ALIGN_WRAPPER_SX}>
      <Box
        sx={{
          bgcolor: tk.bg,
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: `1px solid ${tk.divider}`,
          // Mobile: the card now floats above the reserved nav-clearance margin
          // (not flush with the true page bottom anymore) — close it off. Desktop:
          // still flush with the page's true bottom edge, so stays open there.
          borderBottom: { xs: `1px solid ${tk.divider}`, md: 'none' },
          borderTopLeftRadius: 'var(--radius-lg)',
          borderTopRightRadius: 'var(--radius-lg)',
          borderBottomLeftRadius: { xs: 'var(--radius-lg)', md: 0 },
          borderBottomRightRadius: { xs: 'var(--radius-lg)', md: 0 },
          px: { xs: 4, md: 6 },
          py: { xs: 4, md: 7 },
          display: 'flex',
          flexDirection: 'column',
          gap: { xs: 3.5, md: 5 },
        }}
      >
        {/* Brand header */}
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'center' }, justifyContent: 'space-between', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 44,
                height: 44,
                borderRadius: 'var(--radius-lg)',
                bgcolor: 'rgba(232,69,65,0.10)',
                p: 1.25,
                boxSizing: 'border-box',
                flexShrink: 0,
              }}
            >
              <LogoIcon />
            </Box>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
                Colabonate
              </Typography>
              <Typography variant="caption" sx={{ color: tk.mutedText, fontSize: '0.7rem' }}>
                Decentral commerce powered by Bitcoin &amp; Nostr
              </Typography>
            </Box>
          </Box>
          <FooterSocialLinks links={socialLinks} />
        </Box>

        <FooterNewsletter
          title="Stay in the loop"
          description="Follow our community and open-markets approach — development notes on Colabonate, Nostr and open markets. No spam, ever."
          buttonText="Subscribe"
          {...newsletter}
        />

        <Divider sx={{ borderColor: tk.divider }} />

        {/* Link Grid – 2 columns on mobile, 4 on desktop */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, 1fr)',
              md: 'repeat(4, 1fr)',
            },
            gap: { xs: 3, md: 4 },
          }}
        >
          <Box>
            <FooterLinkSection title="Product" links={productLinks} onNavigate={onNavigate} />
          </Box>
          <Box>
            <FooterLinkSection title="Roles" links={roleLinks} onNavigate={onNavigate} />
          </Box>
          <Box>
            <FooterLinkSection title="Resources" links={resourceLinks} onNavigate={onNavigate} />
          </Box>
          <Box>
            <FooterLinkSection title="Legal" links={legalLinks} onNavigate={onNavigate} />
          </Box>
        </Box>

        <Divider sx={{ borderColor: tk.divider }} />

        {/* Status + version (mobile only) */}
        {(stateBadge || version) && (
          <Box
            sx={{
              display: { xs: 'flex', sm: 'none' },
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
            }}
          >
            {stateBadge}
            {version && (
              <Typography component="span" variant="caption" sx={{ color: tk.mutedText, fontSize: '0.7rem' }}>
                v{version}
              </Typography>
            )}
          </Box>
        )}

        {/* Copyright bar */}
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <BoltIcon sx={{ fontSize: '0.9rem', color: 'var(--color-warning-primary)' }} />
            <Typography
              variant="caption"
              sx={{ color: tk.mutedText, fontSize: '0.75rem' }}
            >
              &copy; {new Date().getFullYear()} Colabonate. All rights reserved.
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ color: tk.mutedText, fontSize: '0.7rem' }}>
            Open source · Community-governed · P2P
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}

// ─── Minimal Footer ────────────────────────────────────────────────────────────

const minimalLinks: FooterLink[] = [
  { label: 'Foundation DAO', href: '/about/foundation' },
  { label: 'Help', href: '/legal/help' },
  { label: 'Privacy', href: '/legal/privacy' },
  { label: 'Terms', href: '/legal/terms' },
  { label: 'Contact', href: '/legal/contact' },
  { label: 'AI agents', href: '/agents.md', external: true },
]

function MinimalFooter({ onNavigate, stateBadge, version }: { onNavigate?: NavFn; stateBadge?: ReactNode; version?: string }) {
  const theme = useMuiTheme()
  const isDark = theme.palette.mode === 'dark'
  const tk = isDark ? SURFACE.dark : SURFACE.light

  return (
    <Box component="footer" sx={ALIGN_WRAPPER_SX}>
      <Box
        sx={{
          bgcolor: tk.bg,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: `1px solid ${tk.divider}`,
          // Mobile: the card now floats above the reserved nav-clearance margin
          // (not flush with the true page bottom anymore) — close it off. Desktop:
          // still flush with the page's true bottom edge, so stays open there.
          borderBottom: { xs: `1px solid ${tk.divider}`, md: 'none' },
          borderTopLeftRadius: 'var(--radius-lg)',
          borderTopRightRadius: 'var(--radius-lg)',
          borderBottomLeftRadius: { xs: 'var(--radius-lg)', md: 0 },
          borderBottomRightRadius: { xs: 'var(--radius-lg)', md: 0 },
          px: { xs: 4, md: 6 },
          py: { xs: 2, sm: 2.5 },
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: 'center',
          justifyContent: 'center',
          gap: { xs: 0.75, sm: 0.5 },
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: { xs: 0.5, sm: 0 } }}>
          <BoltIcon sx={{ fontSize: '0.8rem', color: 'var(--color-warning-primary)' }} />
          <Typography
            variant="caption"
            sx={{ color: tk.mutedText, fontSize: '0.75rem' }}
          >
            &copy; {new Date().getFullYear()} Colabonate
          </Typography>
        </Box>

        {(stateBadge || version) && (
          <Box
            sx={{
              display: { xs: 'flex', sm: 'none' },
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
            }}
          >
            {stateBadge}
            {version && (
              <Typography component="span" variant="caption" sx={{ color: tk.mutedText, fontSize: '0.7rem' }}>
                v{version}
              </Typography>
            )}
          </Box>
        )}

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
            gap: { xs: 0.25, sm: 0 },
            '& > * + *::before': {
              content: '"·"',
              mx: 0.75,
              color: tk.dotColor,
              fontSize: '0.75rem',
            },
          }}
        >
          {minimalLinks.map((link) => (
            <Box key={link.label} component="span" sx={{ display: 'inline-flex' }}>
              {onNavigate && !link.external ? (
                <Button
                  variant="text"
                  onClick={() => onNavigate(link.href)}
                  sx={{ ...footerLinkSx, color: tk.link, fontSize: '0.75rem', minWidth: 0, py: 0, px: 'var(--spacing-4)', justifyContent: 'flex-start' }}
                >
                  {link.label}
                </Button>
              ) : (
                <Button
                  component="a"
                  href={link.href}
                  {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  variant="text"
                  sx={{ ...footerLinkSx, color: tk.link, fontSize: '0.75rem', minWidth: 0, py: 0, px: 'var(--spacing-4)', justifyContent: 'flex-start' }}
                >
                  {link.label}
                </Button>
              )}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

// ─── Footer (Public API) ───────────────────────────────────────────────────────

export function Footer({ variant = 'minimal', onNavigate, stateBadge, version, ...props }: FooterProps) {
  return variant === 'extended'
    ? <ExtendedFooter onNavigate={onNavigate} stateBadge={stateBadge} version={version} {...props} />
    : <MinimalFooter  onNavigate={onNavigate} stateBadge={stateBadge} version={version} {...props} />
}
