// Cooperation Template Detail – view, edit, or create templates (ADR-112)

import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@ds/utils'
import { PageContainer } from '@ds/ui'
import {
  Clock, Sparkles, FileText, ChevronRight, Copy, Zap, Plus, X,
  Check, Info, AlertTriangle, ChevronDown, ChevronUp,
  Wallet, Tag, Globe, Lock, ListChecks,
} from 'lucide-react'
import { PageHeader } from '../../components/PageHeader'
import { NotFoundState } from '../../components/NotFoundState'
import { SatsAmount } from '../../components/currency/SatsAmount'
import { MultiImageUploadInput } from '../../components/offers/MultiImageUploadInput'
import { apiCall } from '../../lib/api'
import { useCooperationTemplate } from '../../hooks/useEntityQueries'
import { TYPE_COLORS, TIMELINE_LABELS, COOPERATION_TYPES, TIMELINE_PRESETS, MAX_TEMPLATE_IMAGES, getCooperationTypeInfo } from './coop-constants'
import type { CoopTemplate, TemplateMilestone, CoopTemplateFormData } from './coop-types'

type Mode = 'view' | 'edit' | 'create'

const STEPS = [
  { id: 'basics', label: 'Basics', description: 'Name, type, description' },
  { id: 'structure', label: 'Structure', description: 'Timeline, skills, milestones' },
  { id: 'terms', label: 'Terms & Visibility', description: 'Legal terms and visibility' },
]

const EMPTY_MILESTONE = (): TemplateMilestone => ({ title: '', percentage: 0 })

// ─── Progress Indicator ─────────────────────────────────────────────────────
function ProgressIndicator({ activeStep, completedSteps, onStepClick }: {
  activeStep: string
  completedSteps: Set<string>
  onStepClick: (id: string) => void
}) {
  return (
    <div className="flex items-center gap-0 mb-6">
      {STEPS.map((step, i) => {
        const isCompleted = completedSteps.has(step.id)
        const isActive = activeStep === step.id
        return (
          <div key={step.id} className="flex items-center">
            {i > 0 && (
              <div
                className={cn(
                  'w-8 h-[2px] mx-1 transition-colors duration-300',
                  isCompleted || isActive ? 'bg-[var(--color-primary-50)]' : 'bg-[var(--theme-border)]',
                )}
              />
            )}
            <button
              onClick={() => onStepClick(step.id)}
              className={cn(
                'flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg transition-all duration-200',
                'hover:bg-[var(--theme-bg-subtle)]',
                isActive && 'bg-[var(--theme-bg-subtle)]',
              )}
            >
              <div
                className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-200',
                  isCompleted
                    ? 'bg-[var(--color-status-success)] text-[var(--color-neutral-black)]'
                    : isActive
                    ? 'bg-[var(--color-primary-50)] text-white'
                    : 'bg-[var(--theme-border)] text-[var(--theme-text-muted)]',
                )}
              >
                {isCompleted ? <Check size={11} /> : i + 1}
              </div>
              <span
                className={cn(
                  'text-[10px] font-semibold uppercase tracking-widest whitespace-nowrap',
                  isActive ? 'text-[var(--color-primary-50)]' : 'text-[var(--theme-text-muted)]',
                )}
                style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                {step.label}
              </span>
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ─── Help Tooltip ───────────────────────────────────────────────────────────
function HelpTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full transition-colors hover:bg-[var(--theme-bg-subtle)]"
        style={{ color: 'var(--theme-text-muted)' }}
      >
        <Info size={12} />
      </button>
      {open && (
        <div
          className="absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 w-48 p-2.5 rounded-lg shadow-lg text-[11px] leading-relaxed"
          style={{
            background: 'var(--theme-surface)',
            border: '1px solid var(--theme-border)',
            color: 'var(--theme-text-muted)',
            fontFamily: 'var(--typography-fontfamily-sans)',
          }}
        >
          {text}
          <div className="absolute right-full top-1/2 -translate-y-1/2 border-[6px] border-transparent border-r-[var(--theme-border)]" />
        </div>
      )}
    </div>
  )
}

// ─── Form Input ─────────────────────────────────────────────────────────────
function FormInput({ id, label, helpText, error, ...props }: {
  id: string
  label: string
  helpText?: string
  error?: string
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className="text-[12px] font-semibold" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>{label}</label>
        {helpText && <HelpTooltip text={helpText} />}
      </div>
      <input
        id={id}
        {...props}
        className={cn(
          'w-full px-3 py-2.5 rounded-xl text-[13px] outline-none transition-all duration-200',
          'placeholder:text-[var(--theme-text-muted)]',
          'focus:ring-2 focus:ring-[var(--color-primary-50)]/25 focus:border-[var(--color-primary-50)]/50',
          error ? 'border-red-500/50' : '',
        )}
        style={{
          background: 'var(--theme-surface)',
          border: '1px solid var(--theme-border)',
          color: 'var(--theme-text)',
          fontFamily: 'var(--typography-fontfamily-sans)',
        }}
      />
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </div>
  )
}

// ─── Form Textarea ───────────────────────────────────────────────────────────
function FormTextarea({ id, label, helpText, error, ...props }: {
  id: string
  label: string
  helpText?: string
  error?: string
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className="text-[12px] font-semibold" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>{label}</label>
        {helpText && <HelpTooltip text={helpText} />}
      </div>
      <textarea
        id={id}
        {...props}
        rows={3}
        className={cn(
          'w-full px-3 py-2.5 rounded-xl text-[13px] outline-none transition-all duration-200 resize-y',
          'placeholder:text-[var(--theme-text-muted)]',
          'focus:ring-2 focus:ring-[var(--color-primary-50)]/25 focus:border-[var(--color-primary-50)]/50',
          error ? 'border-red-500/50' : '',
        )}
        style={{
          background: 'var(--theme-surface)',
          border: '1px solid var(--theme-border)',
          color: 'var(--theme-text)',
          fontFamily: 'var(--typography-fontfamily-sans)',
        }}
      />
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </div>
  )
}

// ─── Type Selector ───────────────────────────────────────────────────────────
function TypeSelector({ value, onChange, error }: {
  value: string
  onChange: (v: string) => void
  error?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] font-semibold" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>Cooperation Type</span>
        <HelpTooltip text="Defines how participants interact — each type has different legal and tax implications" />
      </div>
      <div className="flex flex-wrap gap-2">
        {COOPERATION_TYPES.map(type => {
          const cfg = TYPE_COLORS[type]
          const isSelected = value === type
          return (
            <button
              key={type}
              type="button"
              onClick={() => onChange(type)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-widest transition-all duration-200 border',
                isSelected
                  ? 'text-white border-transparent'
                  : 'border-[var(--theme-border)] hover:border-[var(--color-primary-50)]',
              )}
              style={{
                background: isSelected ? cfg.bar : 'var(--theme-surface)',
                color: isSelected ? 'white' : cfg.text,
                fontFamily: 'var(--typography-fontfamily-sans)',
              }}
            >
              {type}
            </button>
          )
        })}
      </div>
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </div>
  )
}

// ─── Timeline Selector ───────────────────────────────────────────────────────
function TimelineSelector({ value, onChange }: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] font-semibold" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>Timeline Preset</span>
        <HelpTooltip text="Suggested duration — actual dates are set when creating a cooperation" />
      </div>
      <div className="flex flex-wrap gap-2">
        {TIMELINE_PRESETS.map(preset => {
          const isSelected = value === preset
          return (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(preset)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition-all duration-200 border',
                isSelected
                  ? 'border-[var(--color-primary-50)] bg-[var(--color-primary-50)]/8 text-[var(--color-primary-50)]'
                  : 'border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:border-[var(--color-primary-50)]',
              )}
              style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              {TIMELINE_LABELS[preset]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Skills Tag Input ────────────────────────────────────────────────────────
function SkillsTagInput({ value, onChange }: {
  value: string[]
  onChange: (v: string[]) => void
}) {
  const [input, setInput] = useState('')

  function addSkill() {
    const trimmed = input.trim()
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed])
      setInput('')
    }
  }

  function removeSkill(skill: string) {
    onChange(value.filter(s => s !== skill))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addSkill()
    }
    if (e.key === 'Backspace' && !input && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] font-semibold" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>Required Skills</span>
        <HelpTooltip text="Skills participants should bring. Shown to cooperation seekers" />
      </div>
      <div
        className="flex flex-wrap gap-1.5 p-2.5 rounded-xl min-h-[48px] cursor-text"
        style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
        onClick={() => document.getElementById('skill-input')?.focus()}
      >
        {value.map(skill => (
          <span
            key={skill}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold"
            style={{
              border: '1px solid rgba(72,187,120,0.25)',
              background: 'rgba(72,187,120,0.08)',
              color: 'var(--color-status-success)',
              fontFamily: 'var(--typography-fontfamily-sans)',
            }}
          >
            {skill}
            <button
              type="button"
              onClick={() => removeSkill(skill)}
              className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-white/20 transition-colors"
            >
              <X size={9} />
            </button>
          </span>
        ))}
        <input
          id="skill-input"
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={addSkill}
          placeholder={value.length === 0 ? "Type a skill and press Enter…" : ""}
          className="flex-1 min-w-[120px] bg-transparent text-[13px] outline-none placeholder:text-[var(--theme-text-muted)]"
          style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
        />
      </div>
    </div>
  )
}

// ─── Milestone Editor ────────────────────────────────────────────────────────
function MilestoneEditor({ milestones, onChange, error }: {
  milestones: TemplateMilestone[]
  onChange: (v: TemplateMilestone[]) => void
  error?: string
}) {
  function update(i: number, field: keyof TemplateMilestone, val: string | number) {
    onChange(milestones.map((m, idx) => idx === i ? { ...m, [field]: field === 'percentage' ? Number(val) : val } : m))
  }

  function add() {
    onChange([...milestones, EMPTY_MILESTONE()])
  }

  function remove(i: number) {
    onChange(milestones.filter((_, idx) => idx !== i))
  }

  const total = milestones.reduce((s, m) => s + (m.percentage || 0), 0)
  const isValid = total === 100

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] font-semibold" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>Default Milestones</span>
        <HelpTooltip text="Standard phases with percentage splits. Total should be 100%" />
      </div>
      <div className="flex flex-col gap-2">
        {milestones.map((m, i) => (
          <div
            key={i}
            className="flex items-start gap-2 p-3 rounded-xl"
            style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
          >
            <span
              className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold shrink-0 mt-0.5"
              style={{ background: 'var(--color-primary-50)', color: 'white' }}
            >
              {i + 1}
            </span>
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              <input
                type="text"
                value={m.title}
                onChange={e => update(i, 'title', e.target.value)}
                placeholder="Milestone title"
                className="w-full px-2.5 py-1.5 rounded-lg text-[12px] outline-none transition-all duration-200 placeholder:text-[var(--theme-text-muted)]"
                style={{
                  background: 'var(--theme-bg-subtle)',
                  border: '1px solid var(--theme-border)',
                  color: 'var(--theme-text)',
                  fontFamily: 'var(--typography-fontfamily-sans)',
                }}
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={m.percentage || ''}
                  onChange={e => update(i, 'percentage', e.target.value)}
                  placeholder="0"
                  min={0}
                  max={100}
                  className="w-20 px-2.5 py-1.5 rounded-lg text-[12px] outline-none transition-all duration-200 text-right tabular-nums"
                  style={{
                    background: 'var(--theme-bg-subtle)',
                    border: '1px solid var(--theme-border)',
                    color: 'var(--theme-text)',
                    fontFamily: 'var(--typography-fontfamily-sans)',
                  }}
                />
                <span className="text-[11px] text-[var(--theme-text-muted)]">%</span>
              </div>
              <textarea
                value={m.description ?? ''}
                onChange={e => update(i, 'description', e.target.value)}
                placeholder="Describe what gets delivered in this phase (optional)…"
                rows={2}
                className="w-full px-2.5 py-1.5 rounded-lg text-[12px] outline-none transition-all duration-200 resize-y placeholder:text-[var(--theme-text-muted)]"
                style={{
                  background: 'var(--theme-bg-subtle)',
                  border: '1px solid var(--theme-border)',
                  color: 'var(--theme-text)',
                  fontFamily: 'var(--typography-fontfamily-sans)',
                }}
              />
            </div>
            {milestones.length > 1 && (
              <button
                type="button"
                onClick={() => remove(i)}
                className="inline-flex items-center justify-center w-6 h-6 rounded-full shrink-0 transition-colors hover:bg-red-500/10"
                style={{ color: 'var(--theme-text-muted)' }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1.5 text-[12px] font-semibold transition-colors hover:text-[var(--color-primary-50)] py-1"
        style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
      >
        <Plus size={12} />
        Add milestone
      </button>
      <div
        className={cn(
          'flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold',
          isValid ? 'bg-green-500/10 text-green-600' : 'bg-yellow-500/10 text-yellow-600',
        )}
        style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
      >
        {isValid ? <Check size={11} /> : <AlertTriangle size={11} />}
        Total: {total}% {isValid ? '✓' : `– ${100 - total}% remaining`}
      </div>
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </div>
  )
}

// ─── Visibility Toggle ───────────────────────────────────────────────────────
function VisibilityToggle({ value, onChange }: {
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between p-4 rounded-xl" style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}>
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-semibold" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>Public Template</span>
        <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
          Public templates are visible to all users. Private ones are only yours.
        </span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={cn(
          'relative w-11 h-6 rounded-full transition-colors duration-200',
          value ? 'bg-[var(--color-primary-50)]' : 'bg-[var(--theme-border)]',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200',
            value ? 'left-5' : 'left-0.5',
          )}
        />
      </button>
    </div>
  )
}

// ─── Form Section Wrapper ────────────────────────────────────────────────────
function FormSection({ id, title, children, helpText, isCollapsible }: {
  id: string
  title: string
  children: React.ReactNode
  helpText?: string
  isCollapsible?: boolean
}) {
  const [collapsed, setCollapsed] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  return (
    <div id={`section-${id}`} ref={ref} className="flex flex-col gap-4 p-5 rounded-xl" style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="text-[13px] font-bold uppercase tracking-widest"
            style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            {title}
          </span>
          {helpText && <HelpTooltip text={helpText} />}
        </div>
        {isCollapsible && (
          <button
            type="button"
            onClick={() => setCollapsed(c => !c)}
            className="p-1 rounded transition-colors hover:bg-[var(--theme-bg-subtle)]"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        )}
      </div>
      {!collapsed && children}
    </div>
  )
}

// ─── Loading State ───────────────────────────────────────────────────────────
function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <div className="h-6 w-24 rounded-md bg-[var(--color-neutral-8)]" />
          <div className="h-6 w-16 rounded-md bg-[var(--color-neutral-8)]" />
          <div className="h-6 w-20 rounded-md bg-[var(--color-neutral-8)]" />
        </div>
        <div className="h-8 w-2/3 rounded bg-[var(--color-neutral-8)]" />
        <div className="h-4 w-full rounded bg-[var(--color-neutral-9)]" />
        <div className="h-4 w-3/4 rounded bg-[var(--color-neutral-9)]" />
      </div>
      <div className="h-px bg-[var(--theme-border)]" />
      <div className="flex flex-col gap-3">
        <div className="h-5 w-32 rounded bg-[var(--color-neutral-8)]" />
        {[1, 2, 3].map(i => (
          <div key={i} className="flex flex-col gap-2 p-4 rounded-xl" style={{ border: '1px solid var(--theme-border)' }}>
            <div className="flex justify-between">
              <div className="h-4 w-40 rounded bg-[var(--color-neutral-8)]" />
              <div className="h-4 w-12 rounded bg-[var(--color-neutral-8)]" />
            </div>
            <div className="h-1.5 w-full rounded-full bg-[var(--color-neutral-8)]" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────
export function CoopTemplateDetail() {
  const queryClient = useQueryClient()
  const { templateId } = useParams<{ templateId: string }>()
  const navigate = useNavigate()
  const isCreateMode = templateId === 'new'
  
  const {
    data: fetchedTemplate,
    isLoading: isQueryLoading,
    isError,
  } = useCooperationTemplate(templateId ?? '')

  const template = fetchedTemplate as CoopTemplate | null
  const loading = !isCreateMode && isQueryLoading
  const notFound = !isCreateMode && (isError || (!isQueryLoading && !template))

  const [mode, setMode] = useState<Mode>(isCreateMode ? 'create' : 'view')
  const [activeStep, setActiveStep] = useState('basics')
  const [completedSteps] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const [form, setForm] = useState<CoopTemplateFormData>({
    name: '',
    description: '',
    cooperationType: 'transactional',
    timelinePreset: '1month',
    requiredSkills: [],
    defaultMilestones: [{ title: '', percentage: 100 }],
    images: [],
    terms: '',
    isPublic: false,
  })

  useEffect(() => {
    if (isCreateMode) {
      setMode('create')
    } else {
      setMode('view')
    }
  }, [isCreateMode])

  useEffect(() => {
    if (template) {
      setForm({
        name: template.name ?? '',
        description: template.description ?? '',
        cooperationType: template.cooperationType ?? 'transactional',
        timelinePreset: template.timelinePreset ?? '1month',
        requiredSkills: template.requiredSkills ?? [],
        defaultMilestones: template.defaultMilestones?.length ? template.defaultMilestones : [{ title: '', percentage: 100 }],
        images: template.images ?? [],
        terms: template.terms ?? '',
        isPublic: template.isPublic ?? false,
      })
    }
  }, [template])

  function scrollToSection(id: string) {
    setActiveStep(id)
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!form.name.trim()) errs.name = 'Name is required'
    if (!form.cooperationType) errs.cooperationType = 'Type is required'
    if (form.defaultMilestones.length === 0) errs.defaultMilestones = 'At least one milestone is required'
    const total = form.defaultMilestones.reduce((s, m) => s + (m.percentage || 0), 0)
    if (total !== 100) errs.defaultMilestones = `Milestones must total 100% (currently ${total}%)`
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    try {
      const pubkey = localStorage.getItem('pubkey') ?? ''
      const payload = JSON.stringify({ ...form, createdByPubkey: pubkey })
      let res: Response
      if (mode === 'create') {
        res = await apiCall('/api/cooperation-templates', { method: 'POST', body: payload })
      } else if (templateId && templateId !== 'new') {
        res = await apiCall(`/api/cooperation-templates/${templateId}`, { method: 'PATCH', body: payload })
      } else {
        throw new Error('Invalid mode')
      }
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.message || 'Failed to save')
      }
      const data = await res.json()
      
      if (templateId && templateId !== 'new') {
        queryClient.invalidateQueries({ queryKey: ['cooperationTemplate', templateId] })
      }
      
      setToast({ type: 'success', message: mode === 'create' ? 'Template created!' : 'Template saved!' })
      setTimeout(() => {
        if (mode === 'create') navigate('/coop/templates')
        else navigate(`/coop/templates/${data.template?.id ?? templateId}`)
      }, 1200)
    } catch (err: unknown) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save' })
      setTimeout(() => setToast(null), 4000)
    } finally {
      setSaving(false)
    }
  }

  function updateField<K extends keyof CoopTemplateFormData>(key: K, value: CoopTemplateFormData[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors(prev => { const e = { ...prev }; delete e[key]; return e })
  }

  if (loading) {
    return (
      <PageContainer size="narrow" spacing="lg">
        <PageHeader icon={<FileText size={18} />} title={mode === 'create' ? 'New Template' : 'Template Details'} onBack={() => navigate('/coop/templates')} />
        <DetailSkeleton />
      </PageContainer>
    )
  }

  if (notFound || (!template && mode !== 'create')) {
    return (
      <NotFoundState
        icon={<FileText size={48} />}
        title="Template not found"
        message="This template may have been removed or is no longer available."
        primary={{ label: 'Back to templates', to: '/coop/templates' }}
        secondary={{ label: 'Go back', onClick: () => navigate(-1) }}
      />
    )
  }

  const cfg = template ? TYPE_COLORS[template.cooperationType] ?? TYPE_COLORS.transactional : TYPE_COLORS.transactional
  const isSystem = template?.createdByPubkey === 'SYSTEM'
  const typeInfo = template ? getCooperationTypeInfo(template.cooperationType) : null
  const hasBudget = !!template?.budgetRange && (template.budgetRange.min > 0 || template.budgetRange.max > 0)
  const images = template?.images ?? []

  return (
    <PageContainer size="narrow" spacing="lg">

      {/* ── Toast ─────────────────────────────────────────────────── */}
      {toast && (
        <div
          className={cn(
            'fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-[13px] font-semibold animate-fade-in',
            toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white',
          )}
          style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
        >
          {toast.type === 'success' ? <Check size={14} /> : <AlertTriangle size={14} />}
          {toast.message}
        </div>
      )}

      {/* ── Page Header ─────────────────────────────────────────────── */}
      <PageHeader
        icon={<FileText size={18} />}
        title={mode === 'create' ? 'New Template' : mode === 'edit' ? 'Edit Template' : (template?.name ?? 'Template Details')}
        subtitle={mode === 'view' && template?.description ? template.description : undefined}
        onBack={() => navigate('/coop/templates')}
      />

      {/* ── Edit/Create Mode UI ─────────────────────────────────────── */}
      {(mode === 'edit' || mode === 'create') && (
        <>
          <ProgressIndicator
            activeStep={activeStep}
            completedSteps={completedSteps}
            onStepClick={scrollToSection}
          />

          <FormSection id="basics" title="Basics" helpText="Name, type, and description">
            <div className="flex flex-col gap-4">
              <FormInput
                id="name"
                label="Template Name"
                helpText="A clear name that describes this template's purpose"
                value={form.name}
                onChange={e => updateField('name', e.target.value)}
                placeholder="e.g. Standard Service Agreement"
                error={errors.name}
                required
              />
              <TypeSelector
                value={form.cooperationType}
                onChange={v => updateField('cooperationType', v)}
                error={errors.cooperationType}
              />
              <FormTextarea
                id="description"
                label="Description"
                helpText="Optional. Briefly describe when and why to use this template"
                value={form.description}
                onChange={e => updateField('description', e.target.value)}
                placeholder="Describe when to use this template and what makes it effective…"
              />
            </div>
          </FormSection>

          <FormSection id="structure" title="Structure" helpText="Timeline, skills, and milestones">
            <div className="flex flex-col gap-4">
              <TimelineSelector
                value={form.timelinePreset}
                onChange={v => updateField('timelinePreset', v)}
              />
              <SkillsTagInput
                value={form.requiredSkills}
                onChange={v => updateField('requiredSkills', v)}
              />
              <MilestoneEditor
                milestones={form.defaultMilestones}
                onChange={v => updateField('defaultMilestones', v)}
                error={errors.defaultMilestones}
              />
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-semibold" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>Template Images</span>
                  <HelpTooltip text="Context images shown in the template detail. First image is the cover." />
                </div>
                <MultiImageUploadInput
                  values={form.images}
                  onChange={urls => updateField('images', urls)}
                  maxImages={MAX_TEMPLATE_IMAGES}
                />
              </div>
            </div>
          </FormSection>

          <FormSection id="terms" title="Terms & Visibility">
            <div className="flex flex-col gap-4">
              <FormTextarea
                id="terms"
                label="Terms"
                helpText="Optional legal/operational terms. Can be copied into cooperation agreements"
                value={form.terms}
                onChange={e => updateField('terms', e.target.value)}
                placeholder="Enter any legal or operational terms that should be included with this template…"
              />
              <VisibilityToggle
                value={form.isPublic}
                onChange={v => updateField('isPublic', v)}
              />
            </div>
          </FormSection>

          {/* ── Action Buttons ─────────────────────────────────────── */}
          <div className="flex items-center justify-end gap-3 pt-2 sticky bottom-4 z-10">
            <button
              type="button"
              onClick={() => mode === 'create' ? navigate('/coop/templates') : setMode('view')}
              className="px-5 py-2.5 rounded-xl text-[12px] font-bold uppercase tracking-widest transition-all duration-200 hover:opacity-80 active:scale-95"
              style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 rounded-xl text-[12px] font-bold uppercase tracking-widest transition-all duration-200',
                'hover:opacity-90 active:scale-95 disabled:opacity-50',
              )}
              style={{ background: 'var(--color-primary-50)', color: 'white', fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              {saving ? 'Saving…' : mode === 'create' ? 'Create Template' : 'Save Changes'}
            </button>
          </div>
        </>
      )}

      {/* ── View Mode UI ───────────────────────────────────────────── */}
      {mode === 'view' && template && (
        <>
          {/* ── Type + Meta Badges ──────────────────────────────────── */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest leading-none"
              style={{ background: cfg.bg, color: cfg.text, fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              {template.cooperationType}
            </span>
            {template.timelinePreset && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider" style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                <Clock size={9} />
                {TIMELINE_LABELS[template.timelinePreset] ?? template.timelinePreset}
              </span>
            )}
            {isSystem && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider" style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                System template
              </span>
            )}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider" style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
              {template.isPublic ? <Globe size={9} /> : <Lock size={9} />}
              {template.isPublic ? 'Public' : 'Private'}
            </span>
            {template.categoryCode && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-semibold tracking-wider" style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                <Tag size={9} />
                {template.categoryCode}
              </span>
            )}
            {template.requiredSkills.length > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider" style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                {template.requiredSkills.length} skills
              </span>
            )}
          </div>

          {/* ── Images Gallery ─────────────────────────────────────────── */}
          {images.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--theme-border)' }}>
                <img
                  src={images[0]}
                  alt={template.name}
                  className="w-full aspect-video object-cover"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              </div>
              {images.length > 1 && (
                <div className="grid grid-cols-4 gap-2">
                  {images.slice(1).map((img, i) => (
                    <div key={i} className="rounded-lg overflow-hidden aspect-square" style={{ border: '1px solid var(--theme-border)' }}>
                      <img
                        src={img}
                        alt={`${template.name} ${i + 2}`}
                        className="w-full h-full object-cover"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Description ────────────────────────────────────────────── */}
          {template.description && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <FileText size={14} style={{ color: 'var(--theme-text-muted)' }} />
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  Description
                </span>
              </div>
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                {template.description}
              </p>
            </div>
          )}

          {/* ── What this cooperation type means ───────────────────────── */}
          {typeInfo && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <ListChecks size={14} style={{ color: 'var(--theme-text-muted)' }} />
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  What this type means
                </span>
              </div>
              <div className="flex flex-col gap-3 p-4 rounded-xl" style={{ border: '1px solid var(--theme-border)', background: cfg.bg }}>
                <div className="flex flex-col gap-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-[14px] font-bold capitalize" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                      {template.cooperationType}
                    </span>
                    <span className="text-[11px] font-semibold" style={{ color: cfg.text, fontFamily: 'var(--typography-fontfamily-sans)' }}>
                      · {typeInfo.subtitle}
                    </span>
                  </div>
                  <span className="text-[12px] leading-relaxed" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                    {typeInfo.description}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {typeInfo.bullets.map((b, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Check size={12} className="shrink-0 mt-0.5" style={{ color: cfg.bar }} />
                      <span className="text-[12px] leading-relaxed" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                        {b}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Budget Range ────────────────────────────────────────────── */}
          {hasBudget && template.budgetRange && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Wallet size={14} style={{ color: 'var(--theme-text-muted)' }} />
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  Budget Range
                </span>
              </div>
              <div className="flex items-center gap-3 p-4 rounded-xl flex-wrap" style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}>
                {template.budgetRange.min > 0 ? (
                  <>
                    <SatsAmount sats={template.budgetRange.min} size="md" />
                    <span className="text-[12px] font-semibold" style={{ color: 'var(--theme-text-muted)' }}>–</span>
                    <SatsAmount sats={template.budgetRange.max} size="md" />
                  </>
                ) : (
                  <>
                    <span className="text-[12px] font-semibold" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>up to</span>
                    <SatsAmount sats={template.budgetRange.max} size="md" />
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Edit Button (non-system only) ──────────────────────── */}
          {!isSystem && (
            <button
              onClick={() => setMode('edit')}
              className="self-start px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all duration-200 hover:opacity-80 active:scale-95"
              style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              Edit Template
            </button>
          )}

          {/* ── Milestones ──────────────────────────────────────────── */}
          {template.defaultMilestones.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Sparkles size={14} style={{ color: 'var(--theme-text-muted)' }} />
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  Default Milestones
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {template.defaultMilestones.map((m, i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-2 p-4 rounded-xl transition-all duration-200"
                    style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                        {m.title}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold tabular-nums" style={{ color: 'var(--color-warning-primary)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                        <Zap size={10} style={{ fill: 'var(--color-warning-primary)', color: 'var(--color-warning-primary)' }} />
                        {m.percentage}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--theme-border)' }}>
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${m.percentage}%`, background: 'var(--color-status-success)' }} />
                    </div>
                    {m.description && (
                      <span className="text-[12px] leading-relaxed" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                        {m.description}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Required Skills ────────────────────────────────────── */}
          {template.requiredSkills.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Copy size={14} style={{ color: 'var(--theme-text-muted)' }} />
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  Required Skills
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {template.requiredSkills.map(skill => (
                  <span
                    key={skill}
                    className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold"
                    style={{ border: '1px solid rgba(72,187,120,0.25)', background: 'rgba(72,187,120,0.08)', color: 'var(--color-status-success)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Terms ─────────────────────────────────────────────── */}
          {template.terms && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <FileText size={14} style={{ color: 'var(--theme-text-muted)' }} />
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  Terms
                </span>
              </div>
              <div className="p-4 rounded-xl text-[13px] leading-relaxed whitespace-pre-wrap" style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                {template.terms}
              </div>
            </div>
          )}

          {/* ── Use Template CTA ────────────────────────────────────── */}
          <button
            onClick={() => navigate('/coop/guide', { state: { templateId: template.id } })}
            className={cn(
              'flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3 rounded-xl',
              'text-[13px] font-bold uppercase tracking-widest transition-all duration-200',
              'hover:opacity-90 active:scale-95',
            )}
            style={{ background: 'var(--color-primary-50)', color: 'white', fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            <Zap size={14} style={{ fill: 'currentColor' }} />
            Use this template
            <ChevronRight size={14} />
          </button>
        </>
      )}
    </PageContainer>
  )
}