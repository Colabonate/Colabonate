import { useNavigate } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import { useIsMobile } from '@ds/utils'

export function DaoFAB() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  return (
    <button
      onClick={() => navigate('/dao/create')}
      aria-label="Create a new DAO"
      className="fixed shrink-0 flex items-center justify-center rounded-full cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95 z-50"
      style={{
        ...(isMobile
          ? { bottom: 'calc(58px + env(safe-area-inset-bottom, 0px) + 12px)', top: 'auto' }
          : { top: 130, bottom: 'auto' }),
        right: isMobile ? 12 : 40,
        width: isMobile ? 48 : 56,
        height: isMobile ? 48 : 56,
        background: 'var(--color-primary-50)',
        boxShadow: '0 4px 16px rgba(99,179,237,0.35), 0 2px 6px rgba(0,0,0,0.15)',
      }}
    >
      <Building2 size={isMobile ? 18 : 22} color="white" />
    </button>
  )
}
