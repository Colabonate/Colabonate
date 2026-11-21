import { Link } from 'react-router-dom'
import { Tooltip } from '@mui/material'
import { cn } from '@ds/utils'
import type { IdentityLevel } from '../../types/identity'

interface UserLinkProps {
  pubkey: string
  name?: string | null
  identityLevel?: IdentityLevel
  showBadge?: boolean
  size?: 'small' | 'medium'
  className?: string
  mono?: boolean
}

function truncatePubkey(pk: string): string {
  if (pk.length <= 16) return pk
  return `${pk.slice(0, 8)}…${pk.slice(-4)}`
}

export function UserLink({
  pubkey,
  name,
  identityLevel,
  showBadge = false,
  size = 'small',
  className,
  mono = false,
}: UserLinkProps) {
  const displayName = name || truncatePubkey(pubkey)

  const levelColors: Record<number, string> = {
    0: 'var(--identity-anonymous-color)',
    1: 'var(--identity-nostr-color)',
    2: 'var(--identity-peer-color)',
    3: 'var(--identity-hid-color)',
  }

  const link = (
    <Link
      to={`/u/${pubkey}`}
      className={cn(
        'inline-flex',
        'items-center',
        'gap-1.5',
        'rounded-md',
        'transition-colors',
        'duration-150',
        'hover:bg-[var(--theme-bg-subtle)]',
        'no-underline',
        size === 'small' ? 'px-1.5 py-0.5' : 'px-2 py-1',
        className,
      )}
      style={{
        color: 'var(--theme-text)',
      }}
    >
      <span
        className={cn(
          size === 'small' ? 'text-[13px]' : 'text-[15px]',
          'font-medium',
          'truncate',
          'max-w-[200px]',
          mono && 'font-mono',
        )}
      >
        {displayName}
      </span>
      {showBadge && identityLevel !== undefined && identityLevel > 0 && (
        <span
          className={cn(
            'inline-flex',
            'items-center',
            'justify-center',
            'rounded-full',
            size === 'small' ? 'w-4 h-4 text-[9px]' : 'w-5 h-5 text-[10px]',
            'font-bold',
            'flex-shrink-0',
          )}
          style={{
            backgroundColor: `${levelColors[identityLevel] ?? levelColors[0]}20`,
            color: levelColors[identityLevel] ?? levelColors[0],
          }}
        >
          L{identityLevel}
        </span>
      )}
    </Link>
  )

  if (name && name.length > 20) {
    return <Tooltip title={name}>{link}</Tooltip>
  }

  return link
}
