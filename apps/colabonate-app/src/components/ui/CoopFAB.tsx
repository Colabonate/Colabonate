import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Handshake } from 'lucide-react'
import { useIsMobile } from '@ds/utils'
import { useCooperationsForProjects } from '../../hooks/useEntityQueries'

const PENDING_STATUSES = ['OPEN', 'ACCEPTED', 'IN_PROGRESS', 'PAID']

interface CoopFABProps {
  target?: string
  /** Mobile `bottom` offset (CSS value). Defaults to the standard tier shared with the Add-FAB. */
  bottomOffset?: string
  /** Desktop `top` offset in px. Defaults to the standard tier shared with the Add-FAB. */
  topOffset?: number
}

export function CoopFAB({ target = '/coop/manage?tab=cooperations', bottomOffset, topOffset }: CoopFABProps) {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [pubkey] = useState(() => localStorage.getItem('pubkey') ?? '')
  // ADR-324 FU-408: canonical `['cooperations', pubkey]` cache (30s poll)
  // instead of a mount-only plain fetch.
  const { data: coops = [] } = useCooperationsForProjects(pubkey)
  const pendingCount = coops.filter(c => c.status && PENDING_STATUSES.includes(c.status)).length

  return (
    <button
      onClick={() => navigate(pendingCount > 0 ? target : '/coop/guide')}
      aria-label={pendingCount > 0 ? `${pendingCount} pending cooperations` : 'Start a cooperation'}
      className="fixed shrink-0 flex items-center justify-center rounded-full cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95 z-50"
      style={{
        ...(isMobile
          ? { bottom: bottomOffset ?? 'calc(58px + env(safe-area-inset-bottom, 0px) + 12px)', top: 'auto' }
          : { top: topOffset ?? 130, bottom: 'auto' }),
        right: isMobile ? 12 : 40,
        width: isMobile ? 48 : 56,
        height: isMobile ? 48 : 56,
        background: 'var(--color-secondary-50)',
        boxShadow: '0 4px 16px rgba(159,122,234,0.35), 0 2px 6px rgba(0,0,0,0.15)',
      }}
    >
      <Handshake size={isMobile ? 18 : 22} color="white" />

      {pendingCount > 0 && (
        <span
          className="absolute flex items-center justify-center rounded-full text-[10px] font-bold shrink-0"
          style={{
            top: -4,
            right: -4,
            minWidth: 20,
            height: 20,
            padding: '0 4px',
            background: '#E84541',
            color: 'white',
            boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
          }}
        >
          {pendingCount > 99 ? '99+' : pendingCount}
        </span>
      )}
    </button>
  )
}
