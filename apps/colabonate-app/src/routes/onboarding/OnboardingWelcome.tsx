import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  Star,
  Fingerprint,
  Wallet,
  Building2,
  LayoutGrid,
  Handshake,
  FileCheck,
  Landmark,
  ExternalLink,
} from 'lucide-react'
import { LogoIcon } from '@ds/ui'
import { cn } from '@ds/utils'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { OnboardingSectionPage } from './components/OnboardingSectionPage'
import { OnboardingFooter } from './components/OnboardingFooter'
import { OnboardingStagger } from './components/OnboardingStagger'
import { Seo } from '../../components/Seo'

// ── Types ──────────────────────────────────────────────────────────────

interface Badge {
  label: string
  variant: 'accent' | 'muted'
}

interface Slide {
  id: number
  step: number          // 0 = welcome, 1–3 = step number
  stepLabel?: string    // e.g. "Step 1 · Discover & Trust"
  icon?: React.ReactNode
  useLogo?: boolean
  title: string
  description: string
  highlight?: string
  badges?: Badge[]
  bgGradient?: string
}

// ── Slide Data (1 Welcome + 3 × 3 Content = 10 slides) ────────────────

const SLIDES: Slide[] = [
  // ── Welcome (1 slide) ────────────────────────────────────────────
  {
    id: 0,
    step: 0,
    useLogo: true,
    title: 'Welcome to Colabonate',
    description:
      'Your platform for local commerce — buy, sell and cooperate in your region. Decentralized, open source and community-governed.',
    highlight: 'local commerce',
    badges: [
      { label: 'Open Source', variant: 'muted' },
      { label: 'Decentralized', variant: 'muted' },
    ],
    bgGradient: 'linear-gradient(135deg, rgba(99,179,237,0.08) 0%, rgba(232,69,65,0.06) 100%)',
  },

  // ── Step 1: Discover & Trust (Buy) ───────────────────────────────
  {
    id: 1,
    step: 1,
    stepLabel: 'Step 1 · Discover & Trust',
    icon: <Search size={40} />,
    title: 'Local Providers',
    description:
      'Browse categories and discover providers and offers in your area. Find exactly what you need — locally and transparently.',
    highlight: 'Local Providers',
    badges: [
      { label: 'Local-First', variant: 'muted' },
      { label: 'Transparent', variant: 'muted' },
    ],
  },
  {
    id: 2,
    step: 1,
    stepLabel: 'Step 1 · Discover & Trust',
    icon: <Star size={40} />,
    title: 'Reviews & Trust',
    description:
      'Real reviews from verified buyers help you make informed decisions. Build a reputation that actually means something.',
    highlight: 'Trust',
    badges: [
      { label: 'Verified', variant: 'accent' },
      { label: 'Transparent', variant: 'muted' },
    ],
  },
  {
    id: 3,
    step: 1,
    stepLabel: 'Step 1 · Discover & Trust',
    icon: <Fingerprint size={40} />,
    title: 'Human Identity',
    description:
      'Your unique, decentralized identity — no fake profiles, only real people. Verified through biometric proof and peer validation.',
    highlight: 'decentralized',
    badges: [
      { label: 'Decentralized', variant: 'accent' },
      { label: 'Sybil-Resistant', variant: 'muted' },
    ],
  },

  // ── Step 2: Build & Sell ─────────────────────────────────────────
  {
    id: 4,
    step: 2,
    stepLabel: 'Step 2 · Build & Sell',
    icon: <Building2 size={40} />,
    title: 'Business Profile',
    description:
      'Create your creator profile with opening hours, contact info and branding — for free. Your shop, your rules.',
    highlight: 'free',
    badges: [
      { label: 'Free', variant: 'accent' },
      { label: 'Self-Hosted', variant: 'muted' },
    ],
  },
  {
    id: 5,
    step: 2,
    stepLabel: 'Step 2 · Build & Sell',
    icon: <LayoutGrid size={40} />,
    title: 'Catalogs & Categories',
    description:
      'Organize your products and services into searchable, structured catalogs. Manage everything in real time.',
    highlight: 'searchable',
    badges: [
      { label: 'Open Protocol', variant: 'accent' },
      { label: 'Real-Time', variant: 'muted' },
    ],
  },
  {
    id: 6,
    step: 2,
    stepLabel: 'Step 2 · Build & Sell',
    icon: <Wallet size={40} />,
    title: 'BTC / Lightning Wallet',
    description:
      'Send and receive payments instantly via Bitcoin Lightning — user to user, no bank required. Built on a secure Bitcoin L2 infrastructure.',
    highlight: 'Bitcoin Lightning',
    badges: [
      { label: 'Be Your Own Bank', variant: 'accent' },
      { label: 'Borderless', variant: 'muted' },
    ],
  },

  // ── Step 3: Cooperate & Govern ───────────────────────────────────
  {
    id: 7,
    step: 3,
    stepLabel: 'Step 3 · Cooperate & Govern',
    icon: <Handshake size={40} />,
    title: 'Find Partners',
    description:
      'Discover providers with complementary skills for joint ventures. Build networks that create real value.',
    highlight: 'Partners',
    badges: [
      { label: 'Collaboration', variant: 'accent' },
      { label: 'Network Effect', variant: 'muted' },
    ],
  },
  {
    id: 8,
    step: 3,
    stepLabel: 'Step 3 · Cooperate & Govern',
    icon: <FileCheck size={40} />,
    title: 'Smart Contracts & Tickets',
    description:
      'Trustless agreements with automated payments, conditional releases and AI-assisted milestone tracking — enforced on-chain.',
    highlight: 'Trustless',
    badges: [
      { label: 'Trustless', variant: 'accent' },
      { label: 'AI-Powered', variant: 'muted' },
    ],
  },
  {
    id: 9,
    step: 3,
    stepLabel: 'Step 3 · Cooperate & Govern',
    icon: <Landmark size={40} />,
    title: 'DAO & Open Protocols',
    description:
      'Communities can form their own DAOs — one person, one vote. Governed by the Colabonate Codex, fully open source.',
    highlight: 'Open Source',
    badges: [
      { label: 'Open Source', variant: 'accent' },
      { label: 'Governance', variant: 'muted' },
      { label: 'One Person One Vote', variant: 'muted' },
    ],
  },
]

// ── Step color mapping ─────────────────────────────────────────────────

const STEP_COLORS: Record<number, string> = {
  0: 'var(--color-primary-50)',
  1: 'rgba(107,177,255,1)',   // blue
  2: 'rgba(232,69,65,1)',     // red
  3: 'rgba(42,232,102,1)',    // green
}

const STEP_BG: Record<number, string> = {
  0: 'linear-gradient(135deg, rgba(99,179,237,0.08) 0%, rgba(232,69,65,0.06) 100%)',
  1: 'rgba(107,177,255,0.08)',
  2: 'rgba(232,69,65,0.08)',
  3: 'rgba(42,232,102,0.08)',
}

// ── Pagination: 10 slides → 4 pages (1 welcome + 3 step pages of 3 each) ─

const PAGES: Slide[][] = [
  [SLIDES[0]],
  SLIDES.filter((s) => s.step === 1),
  SLIDES.filter((s) => s.step === 2),
  SLIDES.filter((s) => s.step === 3),
]

// ── Component ──────────────────────────────────────────────────────────

export function OnboardingWelcome() {
  const navigate = useNavigate()
  const [currentPage, setCurrentPage] = useState(0)
  const [direction, setDirection] = useState<'next' | 'prev'>('next')
  const [isAnimating, setIsAnimating] = useState(false)
  const prefersReduced = useReducedMotion()
  const touchStartX = useRef<number | null>(null)

  const totalPages = PAGES.length
  const page = PAGES[currentPage]
  const pageStep = page[0].step
  const isFirst = currentPage === 0
  const isLast = currentPage === totalPages - 1
  const progress = ((currentPage + 1) / totalPages) * 100
  const stepColor = STEP_COLORS[pageStep] ?? 'var(--color-primary-50)'
  const stepBg = page[0].bgGradient ?? STEP_BG[pageStep] ?? 'rgba(99,179,237,0.08)'

  const goToPage = useCallback(
    (index: number, dir: 'next' | 'prev' = 'next') => {
      if (isAnimating) return
      if (index < 0 || index >= totalPages) return
      setDirection(dir)
      setIsAnimating(true)
      setCurrentPage(index)
      setTimeout(() => setIsAnimating(false), prefersReduced ? 0 : 350)
    },
    [totalPages, isAnimating, prefersReduced],
  )

  const goNext = useCallback(() => goToPage(currentPage + 1, 'next'), [currentPage, goToPage])
  const goPrev = useCallback(() => goToPage(currentPage - 1, 'prev'), [currentPage, goToPage])

  const handleContinue = useCallback(() => {
    if (isLast) {
      navigate('/onboarding/features')
    } else {
      goNext()
    }
  }, [isLast, goNext, navigate])

  const handleSkip = useCallback(() => {
    navigate('/onboarding/features')
  }, [navigate])

  // Skip the entire onboarding flow (same pattern as OnboardingCreator).
  const handleSkipAll = useCallback(() => {
    localStorage.setItem('hasCompletedOnboarding', 'true')
    navigate('/')
  }, [navigate])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') handleContinue()
      if (e.key === 'ArrowLeft') goPrev()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleContinue, goPrev])

  // Touch swipe support
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return
    const diff = touchStartX.current - e.changedTouches[0].clientX
    if (Math.abs(diff) > 50) {
      if (diff > 0) goNext()
      else goPrev()
    }
    touchStartX.current = null
  }

  // Page transition animation class
  const pageAnimClass = prefersReduced
    ? ''
    : direction === 'next'
      ? 'animate-slide-in-next'
      : 'animate-slide-in-prev'

  return (
    <>
      <Seo noindex />
    <OnboardingSectionPage
      pageKey={currentPage}
      topBar={
        <div
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Progress Bar */}
          <div className="px-6 mb-3">
            <div
              className="h-1 overflow-hidden rounded-full"
              style={{ background: 'var(--theme-border)' }}
            >
              <div
                className="h-full transition-all duration-500 ease-out rounded-full"
                style={{ width: `${progress}%`, background: stepColor }}
              />
            </div>
          </div>

          {/* Page Dot Indicators (one per page) */}
          <div className="flex items-center justify-center gap-1.5 mb-2">
            {PAGES.map((p, idx) => {
              const dotColor = STEP_COLORS[p[0].step] ?? 'var(--color-primary-50)'
              return (
                <button
                  key={idx}
                  onClick={() => goToPage(idx, idx > currentPage ? 'next' : 'prev')}
                  className={cn(
                    'rounded-full transition-all duration-300 border-none cursor-pointer',
                    idx === currentPage ? 'w-6 h-2' : 'w-2 h-2',
                  )}
                  style={{
                    background: idx === currentPage ? dotColor : 'var(--theme-border)',
                  }}
                  aria-label={`Go to page ${idx + 1}`}
                  aria-current={idx === currentPage}
                />
              )
            })}
          </div>
        </div>
      }
      footer={
        <OnboardingFooter
          onBack={isFirst ? undefined : goPrev}
          onContinue={handleContinue}
          continueLabel={isLast ? 'Choose Your Features' : 'Continue'}
          onSkip={isFirst ? handleSkipAll : handleSkip}
          skipLabel={isFirst ? 'Skip all' : 'Skip'}
        />
      }
    >
      {/* ── Page Content ───────────────────────────────────────────── */}
      <div className="flex flex-col items-center justify-center min-h-full px-6 py-8">
        <div
          key={currentPage}
          className={cn(
            'w-full max-w-md mx-auto',
            // Slide-in transition only for the standalone welcome page;
            // content pages reveal their sections via OnboardingStagger instead.
            !prefersReduced && isFirst && pageAnimClass,
          )}
        >
          {isFirst ? (
            <WelcomeSlide
              slide={page[0]}
              stepColor={stepColor}
              stepBg={stepBg}
            />
          ) : (
            <>
              {/* Step label */}
              {page[0].stepLabel && (
                <span
                  className="block text-center text-[11px] font-bold uppercase tracking-widest mb-2"
                  style={{ color: stepColor }}
                >
                  {page[0].stepLabel}
                </span>
              )}
              <OnboardingStagger className="space-y-10">
                {page.map((slide) => (
                  <ContentSection
                    key={slide.id}
                    slide={slide}
                    stepColor={stepColor}
                    stepBg={stepBg}
                  />
                ))}
              </OnboardingStagger>
            </>
          )}
        </div>
      </div>

      {/* ── Inline Animation Styles ──────────────────────────────── */}
      <style>{`
        @keyframes slideInNext {
          from { opacity: 0; transform: translateX(40px) scale(0.97); }
          to   { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes slideInPrev {
          from { opacity: 0; transform: translateX(-40px) scale(0.97); }
          to   { opacity: 1; transform: translateX(0) scale(1); }
        }
        .animate-slide-in-next { animation: slideInNext 0.35s ease-out; }
        .animate-slide-in-prev { animation: slideInPrev 0.35s ease-out; }
      `}</style>
    </OnboardingSectionPage>
    </>
  )
}

// ── Welcome slide (page 1, standalone) ─────────────────────────────────

function WelcomeSlide({
  slide,
  stepColor,
  stepBg,
}: {
  slide: Slide
  stepColor: string
  stepBg: string
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <div
        className="flex items-center justify-center w-24 h-24 mb-6 rounded-2xl"
        style={{ background: stepBg }}
      >
        <div style={{ width: 56, height: 56, '--fill-0': 'var(--color-primary-50, #E94541)' } as React.CSSProperties}>
          <LogoIcon />
        </div>
      </div>

      <h1
        className="text-[24px] sm:text-[28px] font-bold leading-tight mb-4"
        style={{ color: 'var(--theme-text)' }}
      >
        {highlight(slide.title, slide.highlight, stepColor)}
      </h1>

      <p
        className="text-[15px] leading-relaxed mb-6"
        style={{ color: 'var(--theme-text-muted)', maxWidth: 360 }}
      >
        {slide.description}
      </p>

      {slide.badges && slide.badges.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
          {slide.badges.map((badge) => (
            <span
              key={badge.label}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold"
              style={{
                background: 'var(--theme-surface-secondary)',
                color: 'var(--theme-text-muted)',
                border: '1px solid var(--theme-border)',
              }}
            >
              {badge.label}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col items-center">
        <p
          className="text-[12px] leading-relaxed mb-1.5"
          style={{ color: 'var(--theme-text-muted)', maxWidth: 300 }}
        >
          Learn more about our mission, the Colabonate Codex and how we're building a decentralized future.
        </p>
        <a
          href="https://www.colabonate.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium cursor-pointer transition-colors duration-200 hover:opacity-70 bg-transparent border-none"
          style={{ color: stepColor }}
        >
          www.colabonate.com
          <ExternalLink size={13} />
        </a>
      </div>
    </div>
  )
}

// ── Content section (pages 2–4, ≤3 stacked) ────────────────────────────

function ContentSection({
  slide,
  stepColor,
  stepBg,
}: {
  slide: Slide
  stepColor: string
  stepBg: string
}) {
  return (
    <div className="flex flex-col items-center text-center">
      {/* Icon tile */}
      <div
        className="flex items-center justify-center w-24 h-24 mb-5 rounded-2xl"
        style={{ background: stepBg, color: stepColor }}
      >
        {slide.icon}
      </div>

      {/* Title */}
      <h2
        className="text-[22px] sm:text-[26px] font-bold leading-tight mb-3"
        style={{ color: 'var(--theme-text)' }}
      >
        {highlight(slide.title, slide.highlight, stepColor)}
      </h2>

      {/* Description */}
      <p
        className="text-[14px] leading-relaxed mb-4"
        style={{ color: 'var(--theme-text-muted)', maxWidth: 380 }}
      >
        {slide.description}
      </p>

      {/* Badges */}
      {slide.badges && slide.badges.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {slide.badges.map((badge) => (
            <span
              key={badge.label}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold"
              style={{
                background: 'var(--theme-surface-secondary)',
                color: 'var(--theme-text-muted)',
                border: '1px solid var(--theme-border)',
              }}
            >
              {badge.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Highlight helper — color the `highlight` word within `title` ────────

function highlight(title: string, highlightWord: string | undefined, color: string) {
  if (!highlightWord) return title
  const parts = title.split(new RegExp(`(${highlightWord})`, 'i'))
  return parts.map((part, i) =>
    part.toLowerCase() === highlightWord.toLowerCase() ? (
      <span key={i} style={{ color }}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}
