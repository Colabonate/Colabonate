import { Bot } from 'lucide-react'

// Agent (AGENT_SETUP) offers get a distinct card theme (ADR-315, purple):
// a subtle purple-tinted background with a slow aurora "drift" animation as a
// background overlay, plus a Bot badge in a circular chip. The badge placement
// varies by representation (see AgentCenterBadge positions below).
// Rendered only when the offer is an agent setup; see ProviderCard /
// OfferGalleryCard / OfferListRow.

export const AGENT_THEME = {
  tint: 'linear-gradient(135deg, rgba(159,122,234,0.08) 0%, rgba(159,122,234,0.03) 55%, transparent 100%)',
  ring: 'rgba(159,122,234,0.45)',
  solid: 'rgba(159,122,234,0.92)',
  soft: 'rgba(159,122,234,0.16)',
}

/**
 * Background layer for agent cards. Render inside the card's `relative` root,
 * before the content. `pointer-events-none` + low stacking so it never blocks
 * interaction. The drift animation is gated by `.agent-card-drift` (defined in
 * the app's index.css) which disables itself under prefers-reduced-motion.
 */
export function AgentCardBackground() {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 rounded-xl"
        style={{ background: AGENT_THEME.tint }}
      />
      <div
        className="agent-card-drift pointer-events-none absolute inset-0 rounded-xl"
        style={{
          background:
            'radial-gradient(115% 75% at 50% 0%, rgba(159,122,234,0.20) 0%, rgba(159,122,234,0.06) 42%, transparent 72%)',
        }}
      />
    </>
  )
}

/**
 * Bot badge in a circular chip. Decorative (`aria-hidden`) — the card's own
 * type badge already labels the offer as an Agent.
 *
 * `position`:
 * - 'center' (default): overlaid in the middle of the card (gallery / list rows)
 * - 'topRight': sits on the upper-right edge so the circle hangs half outside
 *   the card.
 * - 'slider': sized + placed like the card's favorite button (24px, inside the
 *   top-right corner, left of the favorite) so it reads as part of the card in
 *   SliderList representations.
 * - 'card': 24px, aligned on the same row as the grid card's favorite button and
 *   placed directly before (left of) it.
 * - 'inline': flows inline with surrounding text (list row category line), sized
 *   via `size`, replacing the muted static Bot glyph.
 */
export function AgentCenterBadge({
  position = 'center',
  size,
}: {
  position?: 'center' | 'topRight' | 'slider' | 'card' | 'inline'
  size?: number
}) {
  if (position === 'inline') {
    const s = size ?? 16
    return (
      <span
        className="inline-flex items-center justify-center rounded-full align-middle"
        style={{ width: s, height: s, background: AGENT_THEME.solid, marginRight: 4, verticalAlign: 'middle' }}
        aria-hidden="true"
      >
        <Bot size={Math.round(s * 0.62)} color="#FFFFFF" strokeWidth={2.4} />
      </span>
    )
  }
  if (position === 'card') {
    return (
      <div
        className="pointer-events-none absolute flex items-center justify-center rounded-full"
        style={{
          top: 6,
          right: 36,
          width: 24,
          height: 24,
          background: AGENT_THEME.solid,
          boxShadow: '0 2px 8px rgba(159,122,234,0.40)',
          zIndex: 20,
        }}
        aria-hidden="true"
      >
        <Bot size={12} color="#FFFFFF" strokeWidth={2.4} />
      </div>
    )
  }
  if (position === 'slider') {
    return (
      <div
        className="pointer-events-none absolute flex items-center justify-center rounded-full"
        style={{
          top: 8,
          right: 40,
          width: 24,
          height: 24,
          background: AGENT_THEME.solid,
          boxShadow: '0 2px 8px rgba(159,122,234,0.40)',
          zIndex: 20,
        }}
        aria-hidden="true"
      >
        <Bot size={12} color="#FFFFFF" strokeWidth={2.4} />
      </div>
    )
  }
  const posStyle =
    position === 'topRight'
      ? { right: 0, top: 0, transform: 'translate(50%, -50%)' }
      : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
  return (
    <div
      className="pointer-events-none absolute flex items-center justify-center rounded-full"
      style={{
        ...posStyle,
        width: 32,
        height: 32,
        background: AGENT_THEME.solid,
        boxShadow: '0 2px 10px rgba(159,122,234,0.45), 0 0 0 4px rgba(159,122,234,0.18)',
        zIndex: 20,
      }}
      aria-hidden="true"
    >
      <Bot size={18} color="#FFFFFF" strokeWidth={2.4} />
    </div>
  )
}
