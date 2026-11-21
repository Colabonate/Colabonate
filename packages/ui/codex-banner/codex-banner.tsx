import { cn } from '@ds/utils'

const BOOTSTRAP_DISCLOSURE = 'The Colabonate Arbitration Council currently operates in bootstrap mode with founding arbitrators. The Council will expand to elected members as the protocol matures.'

export interface CodexBannerProps {
  className?: string
}

export function CodexBanner({ className }: CodexBannerProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 px-4 py-3 rounded-lg',
        'bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)]',
        className
      )}
    >
      <p className="text-xs text-[var(--color-text-secondary)] italic leading-relaxed">
        {BOOTSTRAP_DISCLOSURE}
      </p>
      <a
        href="/about/foundation"
        className="text-xs text-[var(--color-accent)] hover:underline self-start"
      >
        View the Codex Constitution →
      </a>
    </div>
  )
}
