import { ImageOff } from 'lucide-react'

export function ImagesFilterPanel({
  hideNoImageOffers,
  onHideNoImageOffersChange,
}: {
  hideNoImageOffers: boolean
  onHideNoImageOffersChange: (hide: boolean) => void
}) {
  return (
    <div className="shrink-0">
      <div className="flex items-center gap-1.5 px-0.5 mb-1">
        <ImageOff size={10} style={{ color: 'var(--theme-text-muted)' }} />
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)' }}>
          Images
        </span>
      </div>
      <button
        onClick={() => onHideNoImageOffersChange(!hideNoImageOffers)}
        aria-pressed={hideNoImageOffers}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] cursor-pointer transition-all duration-150 text-left w-full"
        style={{
          background: hideNoImageOffers ? 'rgba(99,179,237,0.12)' : 'var(--theme-bg-subtle)',
          border: hideNoImageOffers ? '1px solid rgba(99,179,237,0.30)' : '1px solid var(--theme-border)',
          color: hideNoImageOffers ? 'var(--color-primary-50)' : 'var(--theme-text)',
          fontWeight: hideNoImageOffers ? 600 : 400,
        }}
      >
        <ImageOff size={9} style={{ flexShrink: 0, opacity: hideNoImageOffers ? 1 : 0.5 }} />
        <span className="truncate">Hide items without images</span>
      </button>
    </div>
  )
}
