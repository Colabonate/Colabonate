import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIsMobile, useScrollVanish } from '@ds/utils'

interface SearchFABProps {
  bottomOffset?: string
  topOffset?: number
  scrollFade?: boolean
}

export function SearchFAB({ bottomOffset, topOffset, scrollFade = false }: SearchFABProps = {}) {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const wrapRef = useRef<HTMLDivElement>(null)

  useScrollVanish(wrapRef, { enabled: scrollFade })

  return (
    <div
      ref={wrapRef}
      className="fixed z-50 fab-layer"
      style={{
        ...(isMobile
          ? { bottom: bottomOffset ?? 'calc(58px + env(safe-area-inset-bottom, 0px) + 12px)', top: 'auto' }
          : { top: topOffset ?? 190, bottom: 'auto' }),
        right: isMobile ? 12 : 40,
        ...(scrollFade && { willChange: 'opacity, transform, filter' }),
      }}
    >
      <button
        onClick={() => navigate('/search')}
        aria-label="Search & Explore"
        className="shrink-0 flex items-center justify-center rounded-full cursor-pointer text-white transition-[box-shadow,filter] duration-200 hover:brightness-110 active:brightness-95"
        style={{
          width: isMobile ? 48 : 56,
          height: isMobile ? 48 : 56,
          background: 'var(--color-secondary-50)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)',
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: isMobile ? 26 : 32, height: isMobile ? 26 : 32, transform: 'translateY(-1px)' }}>
            <path fill="currentColor" d="M7 9H2V7h5zm0 3H2v2h5zm13.59 7-3.83-3.83c-.8.52-1.74.83-2.76.83-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5c0 1.02-.31 1.96-.83 2.75L22 17.59zM17 11c0-1.65-1.35-3-3-3s-3 1.35-3 3 1.35 3 3 3 3-1.35 3-3M2 19h10v-2H2z" />
          </svg>
      </button>
    </div>
  )
}
