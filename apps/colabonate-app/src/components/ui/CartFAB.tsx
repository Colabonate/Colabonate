import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShoppingCart } from 'lucide-react'
import { gsap } from 'gsap'
import { useIsMobile, useScrollVanish } from '@ds/utils'
import { useCart } from '../../context/CartContext'
import { useReducedMotion } from '../../hooks/useReducedMotion'

interface CartFABProps {
  /** Mobile `bottom` offset (CSS value). Defaults to the standard tier shared with the AI-FAB. */
  bottomOffset?: string
  /** Desktop `top` offset in px. Defaults to the standard tier shared with the Add-FAB. */
  topOffset?: number
  /** Enable overscroll-driven rubber-band fade matching the Add-FAB and AI-FAB. */
  scrollFade?: boolean
}

const RESTING_SHADOW = '0 4px 16px rgba(37, 211, 102, 0.35), 0 2px 6px rgba(0,0,0,0.15)'

export function CartFAB({ bottomOffset, topOffset, scrollFade = false }: CartFABProps = {}) {
  const { itemCount } = useCart()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const prevCountRef = useRef(itemCount)
  const prefersReducedMotion = useReducedMotion()

  useScrollVanish(wrapRef, { enabled: scrollFade })

  // Pulse the FAB whenever the cart count grows (item just added).
  useEffect(() => {
    if (prefersReducedMotion) {
      prevCountRef.current = itemCount
      return
    }
    if (itemCount > prevCountRef.current) {
      const btn = btnRef.current
      if (btn) {
        gsap.fromTo(btn,
          { scale: 1, boxShadow: RESTING_SHADOW },
          {
            scale: 1.18,
            boxShadow: '0 0 0 8px rgba(37, 211, 102, 0.35), 0 6px 22px rgba(37, 211, 102, 0.55), 0 2px 8px rgba(0,0,0,0.20)',
            duration: 0.18,
            ease: 'power2.out',
            yoyo: true,
            repeat: 1,
            onComplete: () => { gsap.set(btn, { clearProps: 'transform' }) },
          },
        )
      }
    }
    prevCountRef.current = itemCount
  }, [itemCount, prefersReducedMotion])

  if (itemCount === 0) return null

  return (
    <div
      ref={wrapRef}
      className="fixed z-50 fab-layer"
      style={{
        ...(isMobile
          ? { bottom: bottomOffset ?? 'calc(58px + env(safe-area-inset-bottom, 0px) + 12px)', top: 'auto' }
          : { top: topOffset ?? 130, bottom: 'auto' }),
        right: isMobile ? 12 : 40,
        ...(scrollFade && { willChange: 'opacity, transform, filter' }),
      }}
    >
      <button
        ref={btnRef}
        onClick={() => navigate('/buy/cart')}
        aria-label={`Cart with ${itemCount} items`}
        className="cart-fab-btn shrink-0 flex items-center justify-center rounded-full cursor-pointer transition-[box-shadow,filter] duration-200 hover:brightness-110 active:brightness-95"
        style={{
          width: isMobile ? 48 : 56,
          height: isMobile ? 48 : 56,
          background: 'var(--color-status-success)',
          boxShadow: RESTING_SHADOW,
        }}
      >
        <ShoppingCart size={isMobile ? 18 : 22} color="white" />

        {itemCount > 0 && (
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
            {itemCount > 99 ? '99+' : itemCount}
          </span>
        )}
      </button>
    </div>
  )
}
