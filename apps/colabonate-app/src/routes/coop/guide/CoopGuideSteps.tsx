// Guide card step content components for the unified CoopGuide (ADR-033)
// Exports: OptionCard, GuideStepContent, ModelStepContent

import { useEffect, useRef, Fragment } from 'react'
import { gsap } from 'gsap'
import {
  Box,
  Card,
  CardActionArea,
  Chip,
  Typography,
} from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import { Bot } from 'lucide-react'
import { CARD_THEME } from '@ds/ui'
import { useTheme } from '@ds/utils'
import { useReducedMotion } from '../../../hooks/useReducedMotion'
import {
  ROLE_OPTIONS, TYPE_OPTIONS, ACTION_OPTIONS,
  EXECUTOR_OPTIONS, SUPERVISION_OPTIONS,
  COOPERATION_TYPES, COOPERATION_TYPES_BY_COOP_TYPE, AGENT_COOPERATION_TYPE_COPY, AGENT_TYPE_COPY,
  MODEL_STEP_LABEL, MODEL_STEP_SUBTITLE,
  type CoopRole, type CoopType, type CoopAction, type CooperationType,
  type CoopGuideStepId, type CoopExecutor, type CoopAgentSupervision,
  type StepOption,
} from './coopGuideConstants'

// App-wide "Agent" purple identity — same values used for the Bot badge on
// marketplace-cards.tsx / BuyProductDetail.tsx / ListingsTab.tsx, not the
// guide's own local option.color (which is Colabonate red for the Executor
// card itself).
const AGENT_PURPLE = '#9F7AEA'
const AGENT_PURPLE_BG = 'rgba(159,122,234,0.12)'

// ─── OptionCard ───────────────────────────────────────────────────────────────

export function OptionCard<T extends string>({
  option,
  onSelect,
  selected = false,
  compact = false,
  // FU-483 (ADR-328 D4 scope call): a card that shows accurate copy but has
  // no real destination yet (Network+agent) — non-clickable, muted, no glow.
  disabled = false,
  disabledLabel,
}: {
  option: StepOption<T>
  onSelect: (id: T) => void
  selected?: boolean
  compact?: boolean
  disabled?: boolean
  disabledLabel?: string
}) {
  const Icon = option.icon
  const cardRef = useRef<HTMLDivElement>(null)
  const prefersReduced = useReducedMotion()
  const { theme } = useTheme()

  // Pulsing selected-glow, driven by GSAP directly on the Card's own
  // box-shadow. NOT a child overlay: MUI Card clips overflow, so a child's
  // outward-bleeding box-shadow gets cut off right at the Card edge and
  // never becomes visible. A box-shadow painted by the element itself is
  // unaffected by that element's own `overflow: hidden`.
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    if (disabled || !selected || prefersReduced) {
      gsap.killTweensOf(el)
      el.style.boxShadow = ''
      return
    }
    // Resolve `option.color` (a `var(--token)` reference, or a plain hex) to
    // real rgb components once, so alpha is an explicit rgba() number —
    // not dependent on color-mix() support/behavior, which rendered as
    // barely visible even at a high mix percentage.
    const varMatch = /^var\((--[\w-]+)\)$/.exec(option.color)
    const resolved = varMatch
      ? getComputedStyle(document.documentElement).getPropertyValue(varMatch[1]).trim()
      : option.color
    const hexMatch = /^#([0-9a-f]{6})$/i.exec(resolved)
    const [r, g, b] = hexMatch
      ? [parseInt(hexMatch[1].slice(0, 2), 16), parseInt(hexMatch[1].slice(2, 4), 16), parseInt(hexMatch[1].slice(4, 6), 16)]
      : [0, 0, 0]

    const proxy = { alpha: 0.22 }
    const tween = gsap.to(proxy, {
      alpha: 0.48,
      duration: 1.6,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
      onUpdate: () => {
        el.style.boxShadow = `0 0 16px 2px rgba(${r}, ${g}, ${b}, ${proxy.alpha.toFixed(2)})`
      },
    })
    return () => { tween.kill(); el.style.boxShadow = '' }
  }, [selected, disabled, prefersReduced, option.color])

  return (
    <Card
      ref={cardRef}
      variant="outlined"
      sx={{
        position: 'relative',
        borderRadius: compact ? 2 : 2.5,
        height: '100%',
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? option.color : 'divider',
        opacity: disabled ? 0.55 : 1,
        // Same background treatment as the marketplace list-entry cards
        // (OfferGalleryCard/OfferListRow, @ds/ui CARD_THEME) — the neutral
        // theme-aware gradient stays underneath regardless of selection;
        // the sheen + selected-tint overlays below layer on top of it.
        background: CARD_THEME.bg(theme),
        // box-shadow is excluded here while selected — GSAP writes it
        // directly every tick (see above) and a CSS transition on the same
        // property would fight that per-frame value and flicker.
        transition: selected
          ? 'border-color 180ms ease-out, transform 120ms ease-out'
          : 'box-shadow 180ms ease-out, border-color 180ms ease-out, transform 120ms ease-out',
        '&:hover': disabled ? undefined : {
          borderColor: option.color,
          boxShadow: selected ? undefined : `0 4px 20px ${option.bg.replace('0.10', '0.22').replace('0.08', '0.16').replace('0.12', '0.22')}`,
          transform: 'translateY(-2px)',
        },
        '&:active': disabled ? undefined : { transform: 'scale(0.97)' },
      }}
    >
      {/* Static sheen overlay — matches the marketplace list-entry cards */}
      <Box
        sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: CARD_THEME.overlay(theme) }}
      />
      {selected && (
        <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: option.bg }} />
      )}
      <CardActionArea
        disabled={disabled}
        onClick={() => { if (!disabled) onSelect(option.id) }}
        sx={{
          position: 'relative',
          p: compact ? { xs: 3.5, sm: 4 } : { xs: 5, sm: 6 },
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {/* Icon + Title row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: compact ? 2.5 : 3.5, width: '100%' }}>
          <Box
            sx={{
              width: compact ? 36 : 48,
              height: compact ? 36 : 48,
              borderRadius: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: option.bg,
              flexShrink: 0,
              transition: 'transform 150ms ease-out',
              '.MuiCardActionArea-root:hover &': { transform: 'scale(1.08)' },
            }}
          >
            <Icon size={compact ? 20 : 24} style={{ color: option.color }} />
          </Box>
          <Typography
            variant={compact ? 'subtitle1' : 'h6'}
            fontWeight={700}
            sx={{ lineHeight: 1.25 }}
          >
            {option.label}
          </Typography>
        </Box>

        {/* Subtitle chip */}
        <Chip
          label={disabled && disabledLabel ? disabledLabel : option.subtitle}
          size="small"
          sx={{
            mt: 1.5,
            fontSize: '0.68rem',
            height: 22,
            bgcolor: option.bg,
            color: option.color,
            fontWeight: 600,
            border: 'none',
            letterSpacing: '0.01em',
          }}
        />

        {/* Description — always visible; only the bullets below the divider
            are gated by the "Show/Hide details" toggle (compact). */}
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ lineHeight: 1.65, mt: 1.5, flexGrow: 1 }}
        >
          {option.description}
        </Typography>

        {/* Bullets */}
        {!compact && option.bullets.length > 0 && (
          <Box
            component="ul"
            sx={{
              m: 0,
              p: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 1.5,
              width: '100%',
              mt: 3,
              pt: 2.5,
              borderTop: '1px solid',
              borderColor: 'divider',
            }}
          >
            {option.bullets.map(bullet => (
              <Box
                key={bullet}
                component="li"
                sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}
              >
                <CheckIcon
                  sx={{
                    fontSize: 13,
                    color: option.color,
                    mt: 0.4,
                    flexShrink: 0,
                    opacity: 0.9,
                  }}
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ lineHeight: 1.55, fontSize: '0.78rem' }}
                >
                  {bullet}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </CardActionArea>
    </Card>
  )
}

// ─── Shared Card Grid ─────────────────────────────────────────────────────────

function CardGrid<T extends string>({
  options,
  onSelect,
  selected,
  colCount,
  compact = false,
  sx,
  disabledIds,
  disabledLabel,
}: {
  options: StepOption<T>[]
  onSelect: (id: T) => void
  selected: T | null
  colCount: 2 | 3 | 4
  compact?: boolean
  sx?: SxProps<Theme>
  disabledIds?: T[]
  disabledLabel?: string
}) {
  const gridCols = {
    2: { xs: '1fr', sm: '1fr 1fr' },
    3: { xs: '1fr', md: '1fr 1fr', lg: 'repeat(3, 1fr)' },
    4: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' },
  }[colCount]

  return (
    <Box
      sx={[
        {
          display: 'grid',
          gap: { xs: 2.5, sm: 3 },
          gridTemplateColumns: gridCols,
          alignItems: 'stretch',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {options.map(opt => (
        <OptionCard
          key={opt.id}
          option={opt}
          onSelect={onSelect}
          selected={selected === opt.id}
          compact={compact}
          disabled={disabledIds?.includes(opt.id)}
          disabledLabel={disabledLabel}
        />
      ))}
    </Box>
  )
}

// ─── Section Heading ──────────────────────────────────────────────────────────

function SectionHeading({
  step,
  label,
  subtitle,
}: {
  step: string
  label: string
  subtitle: string
}) {
  return (
    <Box sx={{ mb: { xs: 2.5, md: 3 } }}>
      <Typography
        variant="overline"
        color="primary"
        sx={{ letterSpacing: '0.1em', fontWeight: 700 }}
      >
        {step}
      </Typography>
      <Typography variant="h5" fontWeight={700} sx={{ mt: 0.25, lineHeight: 1.25 }}>
        {label}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, mb: 'var(--spacing-8)' }}>
        {subtitle}
      </Typography>
    </Box>
  )
}

// ─── GuideStepContent — Step 0 ────────────────────────────────────────────────
// Combined Role + Type + Action in one step (progressive disclosure)

interface GuideStepContentProps {
  role: CoopRole | null
  type: CoopType | null
  action: CoopAction | null
  executor: CoopExecutor
  agentSupervision: CoopAgentSupervision
  onSelectRole: (r: CoopRole) => void
  onSelectType: (t: CoopType) => void
  onSelectAction: (a: CoopAction) => void
  onSelectExecutor: (e: CoopExecutor) => void
  onSelectAgentSupervision: (s: CoopAgentSupervision) => void
  compact?: boolean
}

export function GuideStepContent({
  role,
  type,
  action,
  executor,
  agentSupervision,
  onSelectRole,
  onSelectType,
  onSelectAction,
  onSelectExecutor,
  onSelectAgentSupervision,
  compact = false,
}: GuideStepContentProps) {
  return (
    <Fragment>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 6, md: 8 } }}>
      {/* Role */}
      <Box>
        <SectionHeading
          step="Step 1 of 5"
          label="Who are you cooperating as?"
          subtitle="Your identity determines visibility, trust level, and escrow terms."
        />
        <CardGrid
          options={ROLE_OPTIONS}
          onSelect={onSelectRole}
          selected={role}
          colCount={2}
          compact={compact}
        />
      </Box>

      {/* ADR-328 D1 + ADR-365 D1: Executor + Supervision — orthogonal Role-step
          controls, revealed after role is picked. ADR-365 D1 makes the step
          shape stable: Supervision is ALWAYS visible (as "Step 3 of 5") and
          only becomes enabled once executor==='agent'; for executor='human'
          its cards are muted with a disabledLabel. Both sit side by side from
          `lg` up for every executor (heading and card-grid on explicit grid
          rows so row 1 — both headings — and row 2 — both card grids — each
          size to their tallest cell). Below `lg` the four boxes stack in DOM
          order (heading, cards, heading, cards). */}
      {role && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
            gap: { xs: 4, lg: 5 },
          }}
        >
          <Box className="guide-section-reveal" sx={{ gridColumn: { lg: 1 }, gridRow: { lg: 1 } }}>
            <SectionHeading
              step="Step 2 of 5"
              label="Who does the work?"
              subtitle="Pick the actor that will execute this cooperation. Selecting People leaves the cooperation type, model and details unchanged."
            />
          </Box>

          {/* Accountability boundary copy (per ADR-328 D1): 'autonomous' is
              about execution cadence, never about liability — ownerPubkey is
              always accountable (ADR-318). ADR-365 D1: heading renders for
              every executor; the cards below are disabled until 'agent'. */}
          <Box className="guide-section-reveal" sx={{ gridColumn: { lg: 2 }, gridRow: { lg: 1 } }}>
            <SectionHeading
              step="Step 3 of 5"
              label="Supervision"
              subtitle="Autonomous does not mean unaccountable — you stay responsible for the outcome either way."
            />
          </Box>

          <Box className="guide-section-reveal" sx={{ gridColumn: { lg: 1 }, gridRow: { lg: 2 } }}>
            <CardGrid
              options={EXECUTOR_OPTIONS}
              onSelect={onSelectExecutor}
              selected={executor}
              colCount={2}
              compact={compact}
              sx={{ height: { lg: '100%' } }}
            />
          </Box>

          <Box className="guide-section-reveal" sx={{ gridColumn: { lg: 2 }, gridRow: { lg: 2 } }}>
            <CardGrid
              options={SUPERVISION_OPTIONS}
              onSelect={onSelectAgentSupervision}
              selected={executor === 'agent' ? agentSupervision : null}
              colCount={2}
              compact={compact}
              disabledIds={executor === 'human' ? (['human', 'autonomous'] as CoopAgentSupervision[]) : undefined}
              disabledLabel="Select AI Agents above to enable"
              sx={{ height: { lg: '100%' } }}
            />
          </Box>
        </Box>
      )}

      {/* Type — revealed once role + executor are resolved. ADR-365 D1: the
          step numbering is fixed at "of 5" for every executor (Supervision
          above is always visible, just disabled for executor='human'). */}
      {role && executor && (
        <Box className="guide-section-reveal">
          <SectionHeading
            step="Step 4 of 5"
            label="What kind of cooperation?"
            subtitle="Each format uses a different protocol and payment model."
          />
          <CardGrid
            options={executor === 'agent'
              ? TYPE_OPTIONS.map(opt => {
                  const copy = AGENT_TYPE_COPY[opt.id]
                  return copy ? { ...opt, label: copy.label, description: copy.description } : opt
                })
              : TYPE_OPTIONS}
            onSelect={onSelectType}
            selected={type}
            colCount={3}
            compact={compact}
            disabledIds={executor === 'agent' ? (['network'] as CoopType[]) : undefined}
            disabledLabel="Coming soon"
          />
        </Box>
      )}

      {/* Action — revealed after type selected */}
      {role && executor && type && (
        <Box className="guide-section-reveal">
          <SectionHeading
            step="Step 5 of 5"
            label="What do you want to do?"
            subtitle="Start fresh, discover opportunities, or manage what you have."
          />
          <CardGrid
            options={ACTION_OPTIONS}
            onSelect={onSelectAction}
            selected={action}
            colCount={3}
            compact={compact}
          />
        </Box>
      )}
    </Box>

    <style>{`
      @keyframes guideSectionReveal {
        from { opacity: 0; transform: translateY(16px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .guide-section-reveal {
        animation: guideSectionReveal 0.4s ease-out both;
      }
    `}</style>
    </Fragment>
  )
}

// ─── ModelStepContent — Step 1 ───────────────────────────────────────────────
// Cooperation model selection (replaces CoopTypeSection from old create forms)

interface ModelStepContentProps {
  coopType: CoopType | null
  cooperationModel: CooperationType | null
  onSelect: (model: CooperationType) => void
  compact?: boolean
  // FU-483 (ADR-328 D2): same 4 Projects cards, agent-flavored copy only.
  executor?: CoopExecutor
  // FU-640: FormStepper keeps hidden steps mounted — the tenders auto-select
  // effect would fire on hidden mount right after the Create click, racing the
  // action param write and clobbering ?action=create out of the URL. Gate it
  // on the step actually being shown; handleContinue and parseSearchParams
  // cover the other tenders paths.
  autoSelect?: boolean
}

export function ModelStepContent({
  coopType,
  cooperationModel,
  onSelect,
  compact = false,
  executor = 'human',
  autoSelect = true,
}: ModelStepContentProps) {
  const modelIds = coopType ? COOPERATION_TYPES_BY_COOP_TYPE[coopType] : []
  const options  = COOPERATION_TYPES
    .filter(ct => modelIds.includes(ct.id))
    .map(ct => {
      const agentCopy = executor === 'agent' ? AGENT_COOPERATION_TYPE_COPY[ct.id] : undefined
      return agentCopy ? { ...ct, description: agentCopy.description, bullets: agentCopy.bullets } : ct
    })

  // Auto-select for tenders (single option) — only when the step is actually
  // shown (see autoSelect prop comment).
  useEffect(() => {
    if (autoSelect && coopType === 'tenders' && !cooperationModel) {
      onSelect('TENDER')
    }
  }, [autoSelect, coopType, cooperationModel, onSelect])

  const colCount = options.length <= 2 ? 2 : options.length === 3 ? 3 : 4

  return (
    <Box>
      <Box sx={{ mb: { xs: 2.5, md: 3 } }}>
        <Typography
          variant="overline"
          color="primary"
          sx={{ letterSpacing: '0.1em', fontWeight: 700 }}
        >
          Cooperation Model
        </Typography>
        <Typography variant="h5" fontWeight={700} sx={{ mt: 0.25, lineHeight: 1.25 }}>
          {MODEL_STEP_LABEL}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, mb: 'var(--spacing-8)' }}>
          {MODEL_STEP_SUBTITLE}
        </Typography>
      </Box>

      <CardGrid
        options={options}
        onSelect={onSelect}
        selected={cooperationModel}
        colCount={colCount as 2 | 3 | 4}
        compact={compact}
      />
    </Box>
  )
}

// ─── BreadcrumbChips ─────────────────────────────────────────────────────────
// Displays selected role → type → action → model as summary chips.
// Chips are deliberate edit-jumps (they clear downstream selections); a chip
// whose target step doesn't exist in the current flow (e.g. the model chip on
// the tenders flow, which has no Model step) renders non-clickable.

interface BreadcrumbChipsProps {
  role: CoopRole | null
  type: CoopType | null
  action: CoopAction | null
  cooperationModel: CooperationType | null
  executor: CoopExecutor
  agentSupervision: CoopAgentSupervision
  currentStepId: CoopGuideStepId
  steps: CoopGuideStepId[]
  onNavigate: (target: 'role' | 'type' | 'action' | 'model') => void
}

export function BreadcrumbChips({ role, type, action, cooperationModel, executor, agentSupervision, currentStepId, steps, onNavigate }: BreadcrumbChipsProps) {
  const roleOpt  = ROLE_OPTIONS.find(r => r.id === role)
  const typeOpt  = TYPE_OPTIONS.find(t => t.id === type)
  const actionOpt = ACTION_OPTIONS.find(a => a.id === action)
  const modelOpt  = COOPERATION_TYPES.find(m => m.id === cooperationModel)
  const executorOpt = EXECUTOR_OPTIONS.find(e => e.id === executor)
  // ADR-328 D1: the AI-agent context (executor + supervision) is orthogonal
  // to Role, not its own breadcrumb step — surfaced as a compact subtext
  // under the Role chip instead of two extra chips cluttering the overview.
  const aiContextLabel = executor === 'agent' && executorOpt
    ? `${executorOpt.label} · ${agentSupervision === 'autonomous' ? 'Autonomous' : 'Supervised'}`
    : null

  const targets: Array<'role' | 'type' | 'action' | 'model'> = ['role', 'type', 'action', 'model']

  const items = [
    roleOpt   && { opt: roleOpt,   label: roleOpt.label,   target: 'role' as const },
    typeOpt   && { opt: typeOpt,   label: typeOpt.label,   target: 'type' as const },
    actionOpt && { opt: actionOpt, label: actionOpt.label, target: 'action' as const },
    modelOpt  && { opt: modelOpt,  label: modelOpt.label,  target: 'model' as const },
  ].filter(Boolean) as Array<{ opt: StepOption; label: string; target: typeof targets[number] }>

  const stepForTarget = (target: typeof targets[number]): CoopGuideStepId => {
    return target === 'model' ? 'model' : 'guide'
  }

  return (
    // flex-start (not flex-end): the Role item grows a third line (AI-context
    // subtext) that no other item has — bottom-aligning the row would stagger
    // every other chip downward to match Role's extra height. Top-aligning
    // keeps every category-label + chip pair locked to the same row, with
    // only Role's extra line extending further down on its own.
    <Box sx={{ mt: 0, mb: 0, display: 'flex', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap', minHeight: 32 }}>
      {items.map((item, i) => {
        const targetStep = stepForTarget(item.target)
        const isCurrent = targetStep === currentStepId && i === items.length - 1
        const isNavigable = !isCurrent && steps.includes(targetStep)
        return (
          <Box key={item.opt.id} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
            {/* Connector — a thin rounded-full bar in a muted color, matching
                the FormStepper's own progress-bar track, instead of an arrow
                glyph. Offset to sit roughly at the chip's vertical center
                (below the fixed-height category label row). */}
            {i > 0 && (
              <Box sx={{ width: 16, height: 3, borderRadius: 999, bgcolor: 'var(--theme-border)', flexShrink: 0, mt: '22px' }} />
            )}
            {/* Chip itself is unchanged — the category label sits above it as
                a field-label-over-value pair, so the row reads as an
                overview of the actual selections made in the guide flow. */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, alignItems: 'flex-start' }}>
              <Typography
                variant="caption"
                sx={{
                  fontSize: '0.6rem',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'text.disabled',
                  lineHeight: 1,
                  px: 0.5,
                }}
              >
                {item.target}
              </Typography>
              <Chip
                label={item.label}
                size="small"
                clickable={isNavigable}
                onClick={isNavigable ? () => onNavigate(item.target) : undefined}
                sx={{
                  bgcolor: item.opt.bg,
                  color: item.opt.color,
                  fontWeight: 600,
                  cursor: isNavigable ? 'pointer' : 'default',
                  '&:hover': isNavigable ? { opacity: 0.85 } : {},
                  transition: 'opacity 150ms',
                }}
              />
              {item.target === 'role' && aiContextLabel && (
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, pl: 0.5, maxWidth: 170 }}>
                  <Box
                    sx={{
                      width: 20, height: 20, borderRadius: 1,
                      bgcolor: AGENT_PURPLE_BG,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, mt: '1px',
                    }}
                  >
                    <Bot size={12} style={{ color: AGENT_PURPLE }} />
                  </Box>
                  <Typography
                    variant="caption"
                    sx={{
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      lineHeight: 1.35,
                      whiteSpace: 'normal',
                      wordBreak: 'break-word',
                      color: 'text.secondary',
                    }}
                  >
                    {aiContextLabel}
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
