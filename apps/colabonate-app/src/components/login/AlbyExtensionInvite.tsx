import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Puzzle, ChevronDown, ExternalLink, Smartphone, Monitor } from 'lucide-react'

export function AlbyExtensionInvite() {
  const [open, setOpen] = useState(false)

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        background: 'var(--theme-bg-subtle)',
        border: '1px solid var(--theme-border)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center justify-between w-full gap-2 px-3 py-2 text-left"
        style={{ color: 'var(--theme-text)' }}
      >
        <span className="flex items-center gap-2 text-xs font-medium">
          <Puzzle size={14} aria-hidden="true" style={{ color: 'var(--color-accent-2)' }} />
          New to Nostr? Get started
        </span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          style={{
            color: 'var(--theme-text-muted)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 150ms ease',
          }}
        />
      </button>

      {open && (
        <div
          className="px-3 pb-3 pt-1 space-y-2 text-xs"
          style={{ color: 'var(--theme-text-muted)', borderTop: '1px solid var(--theme-border)' }}
        >
          <p>
            New to Nostr? Follow our{' '}
            <Link
              to="/help/getting-started#gs-6"
              className="inline-flex items-center gap-0.5 font-medium"
              style={{ color: 'var(--color-primary-50)' }}
            >
              Get Started guide
            </Link>
            {' '}to set up your Nostr identity, then install the Alby browser extension
            as your signer and Lightning wallet.
          </p>

          <ul className="space-y-1 ml-1">
            <li className="flex items-center gap-2">
              <Monitor size={12} aria-hidden="true" style={{ color: 'var(--color-primary-50)' }} />
              <span>Desktop: Chrome, Firefox, Edge, Safari, Opera</span>
            </li>
            <li className="flex items-center gap-2">
              <Smartphone size={12} aria-hidden="true" style={{ color: 'var(--color-primary-50)' }} />
              <span>Mobile: iOS and Android</span>
            </li>
          </ul>

          <a
            href="https://getalby.com/alby-extension"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium"
            style={{ color: 'var(--color-primary-50)' }}
          >
            Install Alby extension
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
      )}
    </div>
  )
}
