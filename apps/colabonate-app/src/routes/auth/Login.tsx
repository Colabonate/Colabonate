import { useEffect } from 'react'
import { gsap } from 'gsap'
import { AppLogo } from '../../components/branding/AppLogo'
import { LoginTabs } from '../../components/login/LoginTabs'
import { Seo } from '../../components/Seo'

import { BackgroundImageSlider } from '../../components/BackgroundImageSlider'
import { useReducedMotion } from '../../hooks/useReducedMotion'

const BACKGROUND_LOGO_IMAGES = [
  new URL('../../assets/Colabonate_Logo_7_008.webp', import.meta.url).href,
  new URL('../../assets/Colabonate_Logo_7_05.webp', import.meta.url).href,
  new URL('../../assets/Colabonate_Logo_7_06.webp', import.meta.url).href,
]

export function Login({ embedded = false }: { embedded?: boolean }) {
  const prefersReduced = useReducedMotion()

  // ── Entrance Animation ────────────────────────────────────────────────────
  useEffect(() => {
    if (embedded || prefersReduced) return

    const rafId = requestAnimationFrame(() => {
      // Logo + tagline
      gsap.from('.login-animate-logo', {
        opacity: 0,
        y: -16,
        duration: 0.5,
        ease: 'power2.out',
        clearProps: 'opacity,transform',
      })
      // Card + demo section
      gsap.from('.login-animate-card', {
        opacity: 0,
        y: 24,
        duration: 0.55,
        delay: 0.15,
        ease: 'power2.out',
        clearProps: 'opacity,transform',
      })
      // Footer tagline
      gsap.from('.login-animate-footer', {
        opacity: 0,
        duration: 0.4,
        delay: 0.3,
        ease: 'power2.out',
        clearProps: 'opacity',
      })
    })

    return () => cancelAnimationFrame(rafId)
  }, [embedded, prefersReduced])

  const card = (
    <div className="w-full overflow-hidden login-animate-card">
      <div className={embedded ? 'p-4' : 'p-6'}>
        <LoginTabs embedded={embedded} />
      </div>
    </div>
  )

  if (embedded) return card

  return (
    <>
      <Seo noindex />
    <div
      className="relative flex flex-col items-center justify-center min-h-screen p-4 overflow-hidden"
      style={{ background: 'var(--theme-bg-elevated)' }}
    >
      {/* Background Image Slider — same as Home */}
      <BackgroundImageSlider images={BACKGROUND_LOGO_IMAGES} interval={3000} />

      <div className="relative z-10 flex flex-col items-center w-full">
        {/* Logo + tagline */}
        <div className="mb-8 text-center login-animate-logo">
          <div className="flex items-center justify-center mb-3">
            <AppLogo brand="colabonate" height={32} />
          </div>
          <p className="text-sm font-light tracking-wide" style={{ color: 'var(--theme-text-muted)' }}>
            Decentralized Collaboration and Commerce
          </p>
        </div>

        <div className="w-full max-w-sm space-y-4">
          {card}
        </div>

        <p className="mt-6 text-xs login-animate-footer" style={{ color: 'var(--theme-text-muted)' }}>
          Bitcoin-Native - Powered by Nostr
        </p>
      </div>
    </div>
    </>
  )
}
