// Shared yellow "AI accent" divider for the Home AI sections: the login divider
// recipe (LoginTabs.tsx) in yellow. No yellow design token exists (the warning
// token is red in this theme), so the literal lives here once.
import { Bot } from 'lucide-react'

export const AI_ACCENT_YELLOW = '#eab308'

// Small assistant icons that drift down through the glow and fade out — a quiet
// nod to the assistant, kept subtle and inside the glow's height. Each entry
// staggers the loop so the icons never fall in sync.
const FALLING_ICONS = [
  { left: '10%', delay: '0s', duration: '3.4s' },
  { left: '28%', delay: '1.3s', duration: '3.8s' },
  { left: '46%', delay: '0.6s', duration: '3.1s' },
  { left: '64%', delay: '1.9s', duration: '3.6s' },
  { left: '82%', delay: '1s', duration: '3.3s' },
]

export function AiAccentDivider() {
  return (
    <div className="relative w-full my-3 md:my-4">
      <div
        className="w-full h-px"
        style={{ background: `linear-gradient(90deg, var(--theme-bg), ${AI_ACCENT_YELLOW} 50%, var(--theme-bg))` }}
      />
      <div
        aria-hidden="true"
        className="login-divider-glow absolute left-1/2 -translate-x-1/2 top-0 z-0 pointer-events-none"
        style={{
          width: 'min(100%, 420px)',
          height: 110,
          borderRadius: '0 0 50% 50% / 0 0 100% 100%',
          background: `radial-gradient(60% 100% at 50% 0%, color-mix(in srgb, ${AI_ACCENT_YELLOW} 34%, transparent) 0%, color-mix(in srgb, ${AI_ACCENT_YELLOW} 12%, transparent) 28%, color-mix(in srgb, ${AI_ACCENT_YELLOW} 3%, transparent) 55%, transparent 78%)`,
        }}
      />
      <div
        aria-hidden="true"
        className="absolute left-1/2 -translate-x-1/2 top-0 h-16 z-0 pointer-events-none overflow-hidden"
        style={{ width: 'min(100%, 420px)' }}
      >
        {FALLING_ICONS.map((icon, i) => (
          <span
            key={i}
            className="ai-divider-fall"
            style={{ left: icon.left, animationDelay: icon.delay, animationDuration: icon.duration, color: AI_ACCENT_YELLOW }}
          >
            <Bot size={12} />
          </span>
        ))}
      </div>
    </div>
  )
}
