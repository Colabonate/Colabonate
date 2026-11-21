import EditIcon from '@mui/icons-material/Edit'
import { cn } from '@ds/utils'
import type { UserSectionProps, ActionItem } from './user-section.types'

function ActionBtn({ action }: { action: ActionItem }) {
  return (
    <a
      href={action.to}
      {...(action.to.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cn(
        'flex flex-col items-center justify-center gap-1',
        'min-w-[64px] px-3 py-3 rounded-xl',
        'bg-[#F4F6F9] hover:bg-[#EBEEF2]',
        'border border-transparent hover:border-[#DADEE3]',
        'transition-all duration-200 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E84541]'
      )}
    >
      <span className="text-[#3D4C53] group-hover:text-[#E84541] transition-colors duration-200">
        {action.icon}
      </span>
      <span
        className="text-[10px] font-semibold uppercase tracking-wide text-[#A5ABB3] group-hover:text-[#3D4C53] transition-colors duration-200"
        style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
      >
        {action.label}
      </span>
    </a>
  )
}

export function UserSection({ name, lnAddress, avatarUrl, actions, className, ...props }: UserSectionProps) {
  return (
    <section
      className={cn(
        'rounded-2xl overflow-hidden',
        'bg-white border border-[#EBEEF2]',
        'shadow-[0_2px_12px_rgba(0,0,0,0.06)]',
        className
      )}
      {...props}
    >
      {/* Top stripe – brand accent */}
      <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg, #E84541 0%, #CF3632 50%, #3D4C53 100%)' }} />

      <div className="px-4 pt-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Avatar */}
          {avatarUrl ? (
            <img src={avatarUrl} alt={name} className="w-11 h-11 rounded-full object-cover ring-2 ring-[#EBEEF2]" />
          ) : (
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center ring-2 ring-[#EBEEF2] flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #3D4C53 0%, #1D242B 100%)' }}
            >
              <span
                className="text-base font-bold text-white"
                style={{ fontFamily: 'var(--typography-fontfamily-barlow, Barlow, sans-serif)' }}
              >
                {name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          {/* Name + LN */}
          <div>
            <p
              className="text-sm font-semibold text-[#2A2A2A] leading-tight"
              style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              {name}
            </p>
            {lnAddress && (
              <p
                className="text-[11px] text-[#A5ABB3] font-mono leading-tight mt-0.5 truncate max-w-[180px]"
              >
                ⚡ {lnAddress}
              </p>
            )}
          </div>
        </div>
        <button
          aria-label="Profil bearbeiten"
          className="p-2 rounded-xl text-[#A5ABB3] hover:text-[#E84541] hover:bg-[#F4F6F9] transition-all duration-200"
        >
          <EditIcon sx={{ fontSize: 14 }} />
        </button>
      </div>

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          {actions.map((action, i) => <ActionBtn key={i} action={action} />)}
        </div>
      )}
    </section>
  )
}
