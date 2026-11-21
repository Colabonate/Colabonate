import { cn } from '@ds/utils'
import type { PartnerAvatarProps } from './partner-avatar.types'

export function PartnerAvatar({ name, role, avatarUrl, onClick, className, ...props }: PartnerAvatarProps) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
      className={cn(
        'flex-shrink-0 snap-start flex items-center gap-3 px-3 py-2.5 rounded-xl',
        'bg-white border border-[#EBEEF2] shadow-[0_1px_4px_rgba(0,0,0,0.05)]',
        'hover:shadow-[0_4px_16px_rgba(0,0,0,0.10)] hover:border-[#DADEE3]',
        'transition-all duration-200',
        onClick && 'cursor-pointer',
        className
      )}
      {...props}
    >
      {/* Avatar */}
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className="w-10 h-10 rounded-full object-cover flex-shrink-0 ring-2 ring-[#F4F6F9]" />
      ) : (
        <div
          className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ring-2 ring-[#EBEEF2]"
          style={{ background: 'linear-gradient(135deg, #3D4C53 0%, #1D242B 100%)' }}
        >
          <span
            className="text-sm font-bold text-white"
            style={{ fontFamily: 'var(--typography-fontfamily-barlow, Barlow, sans-serif)' }}
          >
            {name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      {/* Info */}
      <div className="flex flex-col min-w-0">
        <span
          className="text-[11px] font-medium text-[#A5ABB3] leading-tight uppercase tracking-wide truncate"
          style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
        >
          {role}
        </span>
        <span
          className="text-[13px] font-semibold text-[#2A2A2A] leading-tight truncate"
          style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
        >
          {name}
        </span>
      </div>
    </div>
  )
}
