import { useState, useEffect, type ReactNode } from 'react'
import { Zap, KeyRound } from 'lucide-react'
import { FormControl, InputLabel, Select, MenuItem } from '@mui/material'
import { cn } from '@ds/utils'
import { TabLightning } from './TabLightning'
import { TabEmail } from './TabEmail'
import { TabNostr, NewToNostrSection } from './TabNostr'
import { TabNostrConnect } from './TabNostrConnect'
import { TabAlby } from './TabAlby'
import { TabMetaMask } from './TabMetaMask'
import { TabNsec } from './TabNsec'

// Note (ADR-158 / FU-158-A): Google login was removed. It only yielded a
// device-bound burner key; Email is now the universal bootstrap and the real
// key comes via NIP-46 (Nostr Connect) / Alby / extension / MetaMask.
export type LoginTab = 'nostr' | 'nostrconnect' | 'lightning' | 'email' | 'alby' | 'metamask' | 'nsec'

interface LoginTabDef {
  id: LoginTab
  label: string
  title: string
  icon: ReactNode
}

export const LOGIN_TABS: LoginTabDef[] = [
  {
    id: 'nostr',
    label: 'via Browser Extension',
    title: 'Sign in with a Nostr signer (NIP-07)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    id: 'nsec',
    label: 'nsec',
    title: 'Sign in with a Nostr private key (nsec) — one-shot, never stored',
    icon: <KeyRound size={14} aria-hidden="true" />,
  },
  {
    id: 'lightning',
    label: 'Lightning',
    title: 'Sign in with Lightning',
    icon: <Zap size={14} aria-hidden="true" />,
  },
  {
    id: 'email',
    label: 'Email',
    title: 'Sign in with Email',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
      </svg>
    ),
  },
  {
    id: 'alby',
    label: 'Alby',
    title: 'Sign in with Alby',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
      </svg>
    ),
  },
  {
    id: 'metamask',
    label: 'MetaMask',
    title: 'Sign in with MetaMask',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M21.1 1.5L13.6 7.8l-1.3-2.7 8.8-3.6z" fill="#E17726" />
        <path d="M2.9 1.5l7.4 6.3-1.2 2.7-8.6-3.5z" fill="#E27625" />
        <path d="M19.1 15.5l-2.3 3.5 5 1.5 1.4-4.8z" fill="#E27625" />
        <path d="M.8 15.7l1.4 4.8 5-1.5-2.3-3.5z" fill="#E27625" />
        <path d="M6.5 10.8l-1.5 2.2 6.5.3-.2-7z" fill="#E27625" />
        <path d="M17.5 10.8l-4.7-4.6-.3 7.1 6.5-.3z" fill="#E27625" />
        <path d="M6.5 18.9l3.9-1.9-3.3-2.6z" fill="#E27625" />
        <path d="M13.6 17l3.9 1.9-.6-4.5z" fill="#E27625" />
        <path d="M16.8 14.4l-3.2 2.4 3.7.5z" fill="#D5BFB2" />
        <path d="M7.2 14.4l-.5 3 3.7-.5z" fill="#D5BFB2" />
        <path d="M10.4 16.8l-.4-3.3-2.8.6z" fill="#233447" />
        <path d="M13.6 16.8l3.2-2.7-2.8-.6z" fill="#233447" />
        <path d="M13.6 16.8l-3.2 0-.2-3.4h3.6z" fill="#CC6228" />
        <path d="M17.5 10.8l-4.8 2.6.2 3.4 4.7-2.7z" fill="#E27525" />
        <path d="M6.5 10.8l-.1 3.3 4.8 2.7.2-3.4z" fill="#E27525" />
        <path d="M6.5 10.8l4.9-2.5-4.6-1.7z" fill="#F5841F" />
        <path d="M17.5 10.8l-.3-4.2-4.6 1.7 4.9 2.5z" fill="#F5841F" />
        <path d="M13.6 7.8l4.6-1.7-3.9-3.3z" fill="#C0AC9D" />
        <path d="M6.5 10.8l4.6-3-4.4-1.4z" fill="#C0AC9D" />
        <path d="M10.4 16.8l3.2 0-.3 2z" fill="#E17726" />
      </svg>
    ),
  },
  {
    id: 'nostrconnect',
    label: 'Connect',
    title: 'Sign in with a remote Nostr signer (NIP-46)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M15 3h6v6" />
        <path d="M21 3l-7 7" />
        <path d="M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1-2-2h5" />
      </svg>
    ),
  },
]

export function LoginTabs({ embedded = false }: { embedded?: boolean }) {
  const [activeTab, setActiveTab] = useState<LoginTab>('nostr')

  // Magic-link deeplink: when the URL contains ?token=<…>, switch to the email
  // tab on mount so TabEmail is actually rendered. Otherwise TabEmail's useEffect
  // (which calls /api/auth/email/verify) never runs — the user lands on the
  // Nostr tab with a raw token in the URL and no visible feedback.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const token = new URLSearchParams(window.location.search).get('token')
    if (token) setActiveTab('email')
  }, [])

  return (
    <div className={cn('w-full', embedded && 'h-full')}>
      <div className="mb-6">
        <NewToNostrSection />
      </div>

      <div className="relative w-full mb-6">
        <div
          className="w-full h-px"
          style={{ background: 'linear-gradient(90deg, var(--theme-bg), var(--color-primary-50) 50%, var(--theme-bg))' }}
        />
        <div
          aria-hidden="true"
          className="login-divider-glow absolute left-1/2 -translate-x-1/2 top-0 z-0 pointer-events-none"
          style={{
            width: 'min(100%, 420px)',
            height: 160,
            borderRadius: '0 0 50% 50% / 0 0 100% 100%',
            background:
              'radial-gradient(60% 100% at 50% 0%, color-mix(in srgb, var(--color-primary-50) 34%, transparent) 0%, color-mix(in srgb, var(--color-primary-50) 12%, transparent) 28%, color-mix(in srgb, var(--color-primary-50) 3%, transparent) 55%, transparent 78%)',
          }}
        />
      </div>

      <div className="relative z-10 flex items-center justify-between gap-3 mb-3">
        <h4 className="mb-0 whitespace-nowrap">Sign in</h4>

        <FormControl size="small" sx={{ flex: 1, minWidth: 0, maxWidth: 220 }}>
          <InputLabel id="login-method-label">Method</InputLabel>
          <Select
            labelId="login-method-label"
            label="Method"
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value as LoginTab)}
            renderValue={(id) => {
              const tab = LOGIN_TABS.find(t => t.id === id)
              if (!tab) return id
              return (
                <span className="flex items-center gap-2 truncate">
                  {tab.icon}
                  {tab.label}
                </span>
              )
            }}
          >
            {LOGIN_TABS.map(tab => (
              <MenuItem key={tab.id} value={tab.id} title={tab.title}>
                <span className="flex items-center gap-2">
                  {tab.icon}
                  {tab.label}
                </span>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </div>

      <div
        key={activeTab}
        className={cn('relative z-10 login-flow-enter', embedded ? 'h-full' : '')}
      >
        {activeTab === 'nostr' && <TabNostr embedded={embedded} />}
        {activeTab === 'nostrconnect' && <TabNostrConnect embedded={embedded} />}
        {activeTab === 'lightning' && <TabLightning embedded={embedded} />}
        {activeTab === 'email' && <TabEmail embedded={embedded} />}
        {activeTab === 'alby' && <TabAlby embedded={embedded} />}
        {activeTab === 'metamask' && <TabMetaMask embedded={embedded} />}
        {activeTab === 'nsec' && <TabNsec embedded={embedded} />}
      </div>
    </div>
  )
}
