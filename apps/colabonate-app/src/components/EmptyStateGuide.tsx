// Shared "helpful empty state" pattern: hero intro + feature grid explaining
// what the page does + help links. Originally built for the Sell tabs
// (CatalogsTab/ListingsTab/ProductsTab); promoted here so any list-style page
// (e.g. Bounty Board) can reuse the same empty-state UX instead of a bare
// "nothing here" message.
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, Sparkles } from 'lucide-react'

export interface EmptyFeature {
  icon: ReactNode
  title: string
  text: string
  color: string
  bg: string
}

export interface EmptyHelpLink {
  label: string
  to: string
}

interface EmptyStateGuideProps {
  icon: ReactNode
  title: string
  intro: string
  accent: string
  accentSoft: string
  features: EmptyFeature[]
  helpLinks: EmptyHelpLink[]
  ctaLabel: string
  ctaTo?: string
  onCta?: () => void
  secondaryCtaLabel?: string
  secondaryCtaTo?: string
}

export function EmptyStateGuide({
  icon, title, intro, accent, accentSoft,
  features, helpLinks, ctaLabel, ctaTo, onCta,
  secondaryCtaLabel, secondaryCtaTo,
}: EmptyStateGuideProps) {
  return (
    <div className="flex flex-col gap-5 mt-4">
      {/* Hero card */}
      <div
        className="flex flex-col gap-4 p-6 rounded-2xl"
        style={{
          background: 'var(--theme-surface)',
          border: '1px solid var(--theme-border)',
          boxShadow: 'var(--theme-shadow)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Accent top bar */}
        <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }} />
        {/* Soft accent glow */}
        <div
          className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none"
          style={{ background: accentSoft, filter: 'blur(40px)' }}
        />

        <div className="flex items-start gap-4 relative">
          <div
            className="flex items-center justify-center w-14 h-14 rounded-2xl shrink-0"
            style={{ background: accentSoft, color: accent, border: `1px solid ${accent}30` }}
          >
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[18px] font-semibold mb-1.5" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-display)' }}>
              {title}
            </h3>
            <p
              className="text-[13px] leading-relaxed"
              style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              {intro}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 relative">
          {onCta ? (
            <button
              onClick={onCta}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 cursor-pointer hover:opacity-90 active:scale-95"
              style={{ background: accent, color: 'white' }}
            >
              <Sparkles size={15} /> {ctaLabel}
            </button>
          ) : ctaTo ? (
            <Link
              to={ctaTo}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 cursor-pointer hover:opacity-90 active:scale-95 no-underline"
              style={{ background: accent, color: 'white' }}
            >
              <Sparkles size={15} /> {ctaLabel}
            </Link>
          ) : null}
          {secondaryCtaLabel && secondaryCtaTo && (
            <Link
              to={secondaryCtaTo}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 cursor-pointer hover:opacity-80 no-underline"
              style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
            >
              {secondaryCtaLabel}
            </Link>
          )}
        </div>
      </div>

      {/* Feature grid — what it means / functionalities */}
      <div>
        <p
          className="text-[11px] font-bold uppercase tracking-[0.1em] mb-3 ml-1"
          style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-display)' }}
        >
          What you can do here
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="flex flex-col gap-2 p-4 rounded-xl transition-all duration-200 hover:-translate-y-0.5"
              style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
            >
              <div
                className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0"
                style={{ background: f.bg, color: f.color }}
              >
                {f.icon}
              </div>
              <h4 className="text-[13px] font-semibold" style={{ color: 'var(--theme-text)' }}>{f.title}</h4>
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                {f.text}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Help integration */}
      <div
        className="flex flex-col gap-3 p-4 rounded-xl"
        style={{ background: accentSoft, border: `1px solid ${accent}20` }}
      >
        <div className="flex items-center gap-2">
          <BookOpen size={15} style={{ color: accent }} />
          <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: accent, fontFamily: 'var(--typography-fontfamily-display)' }}>
            Learn more
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {helpLinks.map((h) => (
            <Link
              key={h.to}
              to={h.to}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-all duration-200 cursor-pointer hover:opacity-80 no-underline"
              style={{ background: 'var(--theme-surface)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
            >
              {h.label}
              <ArrowRight size={12} />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
