import type { ReactNode } from 'react'
import LightbulbIcon from '@mui/icons-material/Lightbulb'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import InfoIcon from '@mui/icons-material/Info'
import { ExternalLink } from 'lucide-react'
import type { HelpArticle as HelpArticleType, HelpTip } from './helpData'

interface HelpArticleOpenProps {
  article: HelpArticleType
  accentColor?: string
}

interface TipStyle {
  icon: ReactNode
  bg: string
  border: string
  color: string
}

const TIP_STYLE: Record<HelpTip['icon'], TipStyle> = {
  warning: {
    icon: <WarningAmberIcon sx={{ fontSize: 18 }} />,
    bg: 'color-mix(in srgb, var(--color-status-error) 10%, transparent)',
    border: 'color-mix(in srgb, var(--color-status-error) 30%, transparent)',
    color: 'var(--color-status-error)',
  },
  lightbulb: {
    icon: <LightbulbIcon sx={{ fontSize: 18 }} />,
    bg: 'color-mix(in srgb, var(--color-accent-2) 10%, transparent)',
    border: 'color-mix(in srgb, var(--color-accent-2) 30%, transparent)',
    color: 'var(--color-accent-2)',
  },
  info: {
    icon: <InfoIcon sx={{ fontSize: 18 }} />,
    bg: 'color-mix(in srgb, var(--color-accent-1) 10%, transparent)',
    border: 'color-mix(in srgb, var(--color-accent-1) 30%, transparent)',
    color: 'var(--color-accent-1)',
  },
}

export function HelpArticleOpen({ article, accentColor = 'var(--color-accent-1)' }: HelpArticleOpenProps) {
  return (
    <article id={article.id} className="scroll-mt-24 flex flex-col">
      {/* Header */}
      <header className="flex flex-col gap-3">
        <span
          className="text-[length:var(--typography-smallcaps-regular-fontsize)] font-semibold uppercase tracking-wider"
          style={{ color: accentColor }}
        >
          Guide
        </span>
        <h2 className="!my-0">
          {article.title}
        </h2>
        <p
          className="!my-0 text-[length:var(--typography-paragraph-base-regular-fontsize)] leading-relaxed max-w-2xl"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          {article.summary}
        </p>
      </header>

      {/* Lead content */}
      <div className="mt-6 max-w-3xl">
        <p
          className="!my-0 text-[length:var(--typography-paragraph-base-regular-fontsize)] leading-relaxed"
          style={{ color: 'var(--theme-text)' }}
        >
          {article.content}
        </p>
      </div>

      {/* Steps grid */}
      {article.steps && article.steps.length > 0 && (
        <section className="mt-10">
          <h3 className="!my-0 mb-5">
            How it works
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {article.steps.map((step, i) => (
              <div
                key={i}
                className="flex flex-col gap-2.5 p-5 rounded-xl"
                style={{
                  background: 'var(--theme-surface)',
                  border: '1px solid var(--theme-border)',
                }}
              >
                <div
                  className="flex items-center justify-center w-8 h-8 rounded-lg text-[length:var(--typography-paragraph-small-heavy-fontsize)] font-bold shrink-0"
                  style={{ background: accentColor, color: 'var(--color-neutral-white)' }}
                >
                  {i + 1}
                </div>
                <h4 className="!my-0">
                  {step.label}
                </h4>
                {step.description && (
                  <p
                    className="!my-0 text-[length:var(--typography-paragraph-xsmall-regular-fontsize)] leading-[length:var(--typography-paragraph-xsmall-regular-lineheight)]"
                    style={{ color: 'var(--theme-text-muted)' }}
                  >
                    {step.description}
                  </p>
                )}
                {step.link && (
                  <a
                    href={step.link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 w-fit mt-1 text-[length:var(--typography-paragraph-small-heavy-fontsize)] font-medium"
                    style={{ color: 'var(--color-primary-50)' }}
                  >
                    {step.link.label}
                    <ExternalLink size={12} aria-hidden="true" />
                  </a>
                )}
                {step.link?.subtext && (
                  <p
                    className="!my-0 text-[length:var(--typography-paragraph-xsmall-regular-fontsize)] leading-[length:var(--typography-paragraph-xsmall-regular-lineheight)]"
                    style={{ color: 'var(--theme-text-muted)' }}
                  >
                    {step.link.subtext}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Tips */}
      {article.tips && article.tips.length > 0 && (
        <section className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-3">
          {article.tips.map((tip, i) => {
            const s = TIP_STYLE[tip.icon]
            return (
              <div
                key={i}
                className="flex items-start gap-3 p-4 rounded-xl"
                style={{ background: s.bg, border: `1px solid ${s.border}` }}
              >
                <div className="shrink-0 mt-0.5" style={{ color: s.color }}>
                  {s.icon}
                </div>
                <p
                  className="!my-0 text-[length:var(--typography-paragraph-small-regular-fontsize)] leading-relaxed"
                  style={{ color: 'var(--theme-text)' }}
                >
                  {tip.text}
                </p>
              </div>
            )
          })}
        </section>
      )}

      {/* Expanded sections */}
      {article.expandedSections && article.expandedSections.length > 0 && (
        <section className="mt-10">
          <h3 className="!my-0 mb-5">
            Learn more
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {article.expandedSections.map((sec, i) => (
              <div
                key={i}
                className="flex flex-col gap-2 p-5 rounded-xl"
                style={{
                  background: 'var(--theme-bg-subtle)',
                  border: '1px solid var(--theme-border)',
                }}
              >
                <h4 className="!my-0">
                  {sec.title}
                </h4>
                <p
                  className="!my-0 text-[length:var(--typography-paragraph-small-regular-fontsize)] leading-relaxed"
                  style={{ color: 'var(--theme-text-muted)' }}
                >
                  {sec.content}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </article>
  )
}
