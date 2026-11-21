// AgentFilterPanel — ADR-313 D2/D3 sidebar filter section for AGENT_SETUP
// offers (FU-421). Server + hook already accept `capability` (repeatable,
// OR-combined), `minReputation` and `agentBillingModel` (see
// apps/server/routes/search.ts + hooks/useOfferSearch.ts) — this component is
// the missing UI that sets them.
//
// Mirrors GammaTagPanel's frequency-sorted chip pattern (ADR-277 D3/D7) for
// capabilities: chips are built from the capabilities actually present on
// the currently-loaded AGENT_SETUP offers (same "no dedicated facet
// endpoint, derive from loaded results" approach as the gamma tag axis).
// A free-text input covers capabilities not yet present in the loaded
// result set (D3's "capability autocomplete" scoped down to a chip input,
// since no dedicated capability-suggestion endpoint exists — see ADR-313 D3).

import { useState } from 'react'
import { Bot, Hash, Sparkles, Star, Frame } from 'lucide-react'
import { cn } from '@ds/utils'
import type { GammaTagFacet } from '../../../components/list-browser/list-browser.types'

// Mirrors apps/server/lib/capability-normalize.ts's normalizeCapability() —
// small pure function, not worth a shared package for a client/server split
// this codebase has no existing precedent for (server never imports @ds/*).
// Keeps free-typed capabilities ("Code Review") matchable against the
// server's stored, already-normalized tags ("code-review").
function normalizeCapability(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

const BILLING_MODELS: Array<{ value: string; label: string }> = [
  { value: 'ONE_TIME', label: 'One-time' },
  { value: 'PER_HOUR', label: 'Per hour' },
  { value: 'PER_TOKEN', label: 'Per token' },
  { value: 'SUBSCRIPTION', label: 'Subscription' },
]

const REPUTATION_THRESHOLDS = [3, 4, 4.5]

// ADR-370 D6 (Phase 2, FU-671): canvas axis — filter agents by whether a
// collaboration canvas is included and whether it is the hosted one.
const CANVAS_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'doop-hosted', label: 'Hosted canvas', hint: 'Colabonate-hosted canvas on this setup' },
  { value: 'doop-local', label: 'Own canvas', hint: "Collaboration canvas on the seller's own instance" },
]

export interface AgentFilterPanelProps {
  capabilityFacets: GammaTagFacet[]
  selectedCapabilities: string[]
  onSelectCapabilities: (caps: string[]) => void
  billingModel: string
  onBillingModelChange: (model: string) => void
  minReputation: number
  onMinReputationChange: (min: number) => void
  /** ADR-370 D6: selected canvasProvider filter ('' = any). */
  canvasProvider: string
  onCanvasProviderChange: (value: string) => void
  /**
   * ADR-333 V3: when true (default) the panel draws its own top divider —
   * wanted in BuyDashboard's sidebarExtraBottom slot. Pass false when a
   * parent (Search.tsx's ordered panel stack) already owns the divider so
   * it isn't drawn twice.
   */
  showDivider?: boolean
}

export function AgentFilterPanel({
  capabilityFacets,
  selectedCapabilities,
  onSelectCapabilities,
  billingModel,
  onBillingModelChange,
  minReputation,
  onMinReputationChange,
  canvasProvider,
  onCanvasProviderChange,
  showDivider = true,
}: AgentFilterPanelProps) {
  const [capabilityInput, setCapabilityInput] = useState('')

  // Union of frequency-sorted facets and any manually-typed selections not
  // (yet) present among the loaded offers, so a chip stays visible/removable
  // after being added even if no currently-loaded agent carries it.
  const chips: GammaTagFacet[] = [
    ...capabilityFacets,
    ...selectedCapabilities
      .filter(c => !capabilityFacets.some(f => f.tag === c))
      .map(tag => ({ tag, count: 0 })),
  ]

  function toggleCapability(tag: string) {
    onSelectCapabilities(
      selectedCapabilities.includes(tag)
        ? selectedCapabilities.filter(t => t !== tag)
        : [...selectedCapabilities, tag],
    )
  }

  function addCapabilityFromInput() {
    const normalized = normalizeCapability(capabilityInput)
    if (normalized && !selectedCapabilities.includes(normalized)) {
      onSelectCapabilities([...selectedCapabilities, normalized])
    }
    setCapabilityInput('')
  }

  return (
    <div
      className={cn('shrink-0 flex flex-col gap-2', showDivider && 'pt-1.5 mt-1.5')}
      style={showDivider ? { borderTop: '1px solid var(--theme-border)' } : undefined}
    >
      <div className="flex items-center gap-1.5 px-0.5">
        <Bot size={10} style={{ color: 'var(--color-primary-50)' }} />
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)' }}>
          Agent Filters
        </span>
      </div>

      {/* Capabilities */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 px-0.5">
          <Sparkles size={9} style={{ color: 'var(--theme-text-muted)' }} />
          <span className="text-[10px] font-medium" style={{ color: 'var(--theme-text-muted)' }}>Capabilities</span>
        </div>
        <div className="flex gap-1">
          <input
            value={capabilityInput}
            onChange={e => setCapabilityInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCapabilityFromInput() } }}
            placeholder="e.g. code-review"
            className="flex-1 min-w-0 rounded-md text-[11px] px-2 py-1 outline-none"
            style={{
              background: 'var(--theme-bg-subtle)',
              border: '1px solid var(--theme-border)',
              color: 'var(--theme-text)',
            }}
            aria-label="Add capability filter"
          />
          <button
            onClick={addCapabilityFromInput}
            disabled={!capabilityInput.trim()}
            className="px-2 py-1 rounded-md text-[11px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-default"
            style={{ background: 'rgba(99,179,237,0.12)', border: '1px solid rgba(99,179,237,0.30)', color: 'var(--color-primary-50)' }}
          >
            Add
          </button>
        </div>
        {chips.length === 0 ? (
          <span className="text-[10px] px-0.5" style={{ color: 'var(--theme-text-muted)' }}>No agent offers loaded yet</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {chips.map(({ tag, count }) => {
              const isSelected = selectedCapabilities.includes(tag)
              return (
                <button
                  key={tag}
                  onClick={() => toggleCapability(tag)}
                  className="inline-flex items-center gap-1 rounded-md cursor-pointer transition-all duration-150"
                  style={{
                    padding: '3px 7px',
                    background: isSelected ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                    border: isSelected ? '1px solid var(--color-primary-50)' : '1px solid var(--theme-border)',
                    color: isSelected ? 'white' : 'var(--theme-text)',
                  }}
                  aria-pressed={isSelected}
                >
                  <Hash size={9} style={{ flexShrink: 0, opacity: isSelected ? 1 : 0.5 }} />
                  <span className="text-[11px] font-medium whitespace-nowrap">{tag}</span>
                  {count > 0 && (
                    <span className="text-[10px] font-semibold" style={{ color: isSelected ? 'rgba(255,255,255,0.85)' : 'var(--theme-text-muted)' }}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Billing model */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium px-0.5" style={{ color: 'var(--theme-text-muted)' }}>Billing model</span>
        <div className="flex flex-col gap-0.5">
          <button
            onClick={() => onBillingModelChange('')}
            className="flex items-center px-2 py-1 rounded-md text-[11px] cursor-pointer transition-all duration-150 text-left"
            style={{
              background: billingModel === '' ? 'rgba(99,179,237,0.12)' : 'var(--theme-bg-subtle)',
              border: billingModel === '' ? '1px solid rgba(99,179,237,0.30)' : '1px solid var(--theme-border)',
              color: billingModel === '' ? 'var(--color-primary-50)' : 'var(--theme-text)',
              fontWeight: billingModel === '' ? 600 : 400,
            }}
          >
            Any
          </button>
          {BILLING_MODELS.map(m => (
            <button
              key={m.value}
              onClick={() => onBillingModelChange(billingModel === m.value ? '' : m.value)}
              className="flex items-center px-2 py-1 rounded-md text-[11px] cursor-pointer transition-all duration-150 text-left"
              style={{
                background: billingModel === m.value ? 'rgba(99,179,237,0.12)' : 'var(--theme-bg-subtle)',
                border: billingModel === m.value ? '1px solid rgba(99,179,237,0.30)' : '1px solid var(--theme-border)',
                color: billingModel === m.value ? 'var(--color-primary-50)' : 'var(--theme-text)',
                fontWeight: billingModel === m.value ? 600 : 400,
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Canvas (ADR-370 D6) */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 px-0.5">
          <Frame size={9} style={{ color: 'var(--theme-text-muted)' }} />
          <span className="text-[10px] font-medium" style={{ color: 'var(--theme-text-muted)' }}>Collaboration canvas</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <button
            onClick={() => onCanvasProviderChange('')}
            className="flex items-center px-2 py-1 rounded-md text-[11px] cursor-pointer transition-all duration-150 text-left"
            style={{
              background: canvasProvider === '' ? 'rgba(99,179,237,0.12)' : 'var(--theme-bg-subtle)',
              border: canvasProvider === '' ? '1px solid rgba(99,179,237,0.30)' : '1px solid var(--theme-border)',
              color: canvasProvider === '' ? 'var(--color-primary-50)' : 'var(--theme-text)',
              fontWeight: canvasProvider === '' ? 600 : 400,
            }}
          >
            Any
          </button>
          {CANVAS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => onCanvasProviderChange(canvasProvider === opt.value ? '' : opt.value)}
              className="flex flex-col px-2 py-1 rounded-md text-[11px] cursor-pointer transition-all duration-150 text-left"
              style={{
                background: canvasProvider === opt.value ? 'rgba(99,179,237,0.12)' : 'var(--theme-bg-subtle)',
                border: canvasProvider === opt.value ? '1px solid rgba(99,179,237,0.30)' : '1px solid var(--theme-border)',
                color: canvasProvider === opt.value ? 'var(--color-primary-50)' : 'var(--theme-text)',
                fontWeight: canvasProvider === opt.value ? 600 : 400,
              }}
            >
              <span>{opt.label}</span>
              <span className="text-[9px] font-normal opacity-70">{opt.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Min. reputation */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 px-0.5">
          <Star size={9} style={{ color: 'var(--theme-text-muted)' }} />
          <span className="text-[10px] font-medium" style={{ color: 'var(--theme-text-muted)' }}>Min. reputation</span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => onMinReputationChange(0)}
            className="flex-1 flex items-center justify-center px-1.5 py-1 rounded-md text-[11px] cursor-pointer transition-all duration-150"
            style={{
              background: minReputation === 0 ? 'rgba(99,179,237,0.12)' : 'var(--theme-bg-subtle)',
              border: minReputation === 0 ? '1px solid rgba(99,179,237,0.30)' : '1px solid var(--theme-border)',
              color: minReputation === 0 ? 'var(--color-primary-50)' : 'var(--theme-text)',
              fontWeight: minReputation === 0 ? 600 : 400,
            }}
          >
            Any
          </button>
          {REPUTATION_THRESHOLDS.map(t => (
            <button
              key={t}
              onClick={() => onMinReputationChange(minReputation === t ? 0 : t)}
              className="flex-1 flex items-center justify-center gap-0.5 px-1.5 py-1 rounded-md text-[11px] cursor-pointer transition-all duration-150"
              style={{
                background: minReputation === t ? 'rgba(99,179,237,0.12)' : 'var(--theme-bg-subtle)',
                border: minReputation === t ? '1px solid rgba(99,179,237,0.30)' : '1px solid var(--theme-border)',
                color: minReputation === t ? 'var(--color-primary-50)' : 'var(--theme-text)',
                fontWeight: minReputation === t ? 600 : 400,
              }}
            >
              <Star size={8} className={minReputation === t ? 'fill-current' : ''} />
              {t.toFixed(1)}+
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
