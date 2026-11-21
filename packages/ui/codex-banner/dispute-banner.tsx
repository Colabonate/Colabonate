import { cn } from '@ds/utils'

export interface DisputeBannerProps {
  className?: string
}

export function DisputeBanner({ className }: DisputeBannerProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 px-4 py-3 rounded-lg',
        'bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)]',
        className
      )}
    >
      <p className="text-xs text-[var(--color-text-secondary)] italic leading-relaxed">
        This ticket is under dispute review by the Colabonate Arbitration Council. A ruling will be published within 48 hours.
      </p>
      <a
        href="/council"
        className="text-xs text-[var(--color-accent)] hover:underline self-start"
      >
        View Council Dashboard →
      </a>
    </div>
  )
}
