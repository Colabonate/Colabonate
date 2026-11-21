import { ExternalLink, Zap } from 'lucide-react'
import type { PurchasePath } from '@col/nostr-schema'
import { cn } from '@ds/utils'

type VisiblePurchasePath = Exclude<PurchasePath, 'in-app-native'>

interface PurchasePathMeta {
  label: string
  title: string
  icon: typeof ExternalLink
}

const PATH_META: Record<VisiblePurchasePath, PurchasePathMeta> = {
  'origin-link': {
    label: 'Order at merchant site',
    title: 'The merchant takes orders on their own site.',
    icon: ExternalLink,
  },
  'open-in-client': {
    label: 'View only: open in another client',
    title: 'No order link was published. Open the listing in another Nostr client to contact the publisher.',
    icon: ExternalLink,
  },
  'app-redirect': {
    label: 'Order in merchant app',
    title: 'The merchant recommends their own app for orders.',
    icon: ExternalLink,
  },
  'nostr-order': {
    label: 'Order via Nostr',
    title: 'Your order is sent to the merchant as an encrypted Nostr message.',
    icon: Zap,
  },
  'nostr-auto': {
    label: 'Order via Nostr',
    title: 'Your order is sent to the merchant as an encrypted Nostr message.',
    icon: Zap,
  },
  'zap-out': {
    label: 'Pay the seller with Lightning',
    title: 'You pay the seller directly over Lightning. Colabonate does not hold the payment.',
    icon: Zap,
  },
}

export function PurchasePathBadge({
  path,
  className,
  compact = false,
  label,
  title,
}: {
  path: PurchasePath
  className?: string
  compact?: boolean
  label?: string
  title?: string
}) {
  if (path === 'in-app-native') return null

  const meta = PATH_META[path]
  const Icon = meta.icon

  return (
    <span
      data-purchase-path={path}
      title={title ?? meta.title}
      className={cn(
        compact
          ? 'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold'
          : 'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold',
        className,
      )}
      style={{
        borderColor: 'var(--theme-border)',
        background: 'var(--theme-bg-subtle)',
        color: 'var(--theme-text)',
      }}
    >
      <Icon size={compact ? 12 : 16} aria-hidden="true" style={{ color: 'var(--color-primary-50)' }} />
      <span>{label ?? meta.label}</span>
    </span>
  )
}
