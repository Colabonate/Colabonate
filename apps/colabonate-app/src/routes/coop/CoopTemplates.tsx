// Cooperation Templates – reusable templates for creating cooperations (ADR-112)

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@ds/utils'
import { PageContainer, FloatingAddButton } from '@ds/ui'
import {
  FolderKanban, ChevronRight, Clock, Sparkles, LayoutGrid,
} from 'lucide-react'
import { PageHeader } from '../../components/PageHeader'
import { SearchInput } from '../../components/ui/SearchInput'
import { useFABActions } from '../../context/FABContext'
import { apiCall } from '../../lib/api'
import { TYPE_COLORS, TIMELINE_LABELS } from './coop-constants'
import type { CoopTemplate } from './coop-types'

// ─── KPI Bar ─────────────────────────────────────────────────────────────────
function TemplateKpiBar({ templates, activeTab, onTabClick }: {
  templates: CoopTemplate[]
  activeTab: string
  onTabClick: (tab: string) => void
}) {
  const items = useMemo(() => {
    const c: Record<string, number> = {}
    for (const t of templates) c[t.cooperationType] = (c[t.cooperationType] ?? 0) + 1
    const types = Object.keys(c).slice(0, 4)
    return [
      { id: 'all', label: 'Total', value: templates.length, color: 'var(--theme-text)', dim: 'var(--theme-text-muted)' },
      ...types.map(type => ({
        id: type,
        label: type.charAt(0).toUpperCase() + type.slice(1),
        value: c[type] ?? 0,
        color: TYPE_COLORS[type]?.bar ?? 'var(--color-primary-50)',
        dim: TYPE_COLORS[type]?.text ?? 'var(--theme-text-muted)',
      })),
    ]
  }, [templates])

  return (
    <div
      className="flex items-stretch overflow-hidden rounded-xl"
      style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
    >
      {items.map((item, i) => {
        const isActive = activeTab === item.id
        return (
          <button
            key={item.id}
            onClick={() => onTabClick(item.id)}
            aria-pressed={isActive}
            className={cn(
              'flex flex-col items-center justify-center flex-1 py-3 px-1.5 gap-0.5 cursor-pointer',
              'transition-all duration-200 hover:bg-[var(--theme-bg-subtle)]',
              i > 0 && 'border-l border-[var(--theme-border)]',
              isActive && 'bg-[var(--theme-bg-subtle)]',
            )}
          >
            <span
              className="text-[20px] font-black leading-none tabular-nums"
              style={{ color: item.color }}
            >
              {item.value}
            </span>
            <span
              className="text-[9px] font-semibold uppercase tracking-widest leading-none"
              style={{ color: item.dim, fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              {item.label}
            </span>
            {isActive && (
              <div className="w-4 h-[2px] rounded-full mt-0.5" style={{ backgroundColor: item.color }} />
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── Skeleton Row ───────────────────────────────────────────────────────────
function TemplateCardSkeleton() {
  return (
    <div
      className="flex flex-col rounded-xl overflow-hidden animate-pulse"
      style={{ border: '1px solid var(--theme-border)' }}
    >
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <div className="h-5 w-20 rounded bg-[var(--color-neutral-8)]" />
          <div className="h-4 w-12 rounded bg-[var(--color-neutral-8)]" />
        </div>
        <div className="h-4 w-3/4 rounded bg-[var(--color-neutral-8)]" />
        <div className="h-3 w-full rounded bg-[var(--color-neutral-9)]" />
        <div className="h-3 w-2/3 rounded bg-[var(--color-neutral-9)]" />
        <div className="flex gap-2">
          <div className="h-5 w-16 rounded bg-[var(--color-neutral-8)]" />
          <div className="h-5 w-20 rounded bg-[var(--color-neutral-8)]" />
        </div>
      </div>
    </div>
  )
}

// ─── Template Card ────────────────────────────────────────────────────────────
function TemplateCard({ template, onClick }: {
  template: CoopTemplate
  onClick: () => void
}) {
  const cfg = TYPE_COLORS[template.cooperationType] ?? TYPE_COLORS.transactional

  return (
    <div className="group flex flex-col">
      <button
        onClick={onClick}
        className={cn(
          'w-full text-left flex flex-col flex-1 overflow-hidden rounded-xl',
          'transition-all duration-200 cursor-pointer',
          'hover:shadow-[0_4px_20px_rgba(0,0,0,0.1)] hover:-translate-y-px',
        )}
        style={{
          background: 'var(--theme-surface)',
          border: '1px solid var(--theme-border)',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = cfg.bar }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--theme-border)' }}
      >
        {/* Type accent bar */}
        <div className="h-[3px] w-full" style={{ backgroundColor: cfg.bar }} />

        {/* Card content */}
        <div className="flex flex-col flex-1 gap-3 p-4">

          {/* Type badge + System badge */}
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest leading-none"
              style={{
                background: cfg.bg,
                color: cfg.text,
                fontFamily: 'var(--typography-fontfamily-sans)',
              }}
            >
              {template.cooperationType}
            </span>
            {template.isPublic && template.createdByPubkey === 'SYSTEM' && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider"
                style={{
                  border: '1px solid var(--theme-border)',
                  color: 'var(--theme-text-muted)',
                  fontFamily: 'var(--typography-fontfamily-sans)',
                }}
              >
                System
              </span>
            )}
          </div>

          {/* Name */}
          <span
            className="text-[15px] font-semibold leading-tight"
            style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            {template.name}
          </span>

          {/* Description */}
          {template.description && (
            <span
              className="text-[12px] leading-relaxed line-clamp-2"
              style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              {template.description}
            </span>
          )}

          {/* Meta chips */}
          <div className="flex items-center gap-1.5 flex-wrap mt-auto">
            {template.timelinePreset && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider"
                style={{
                  border: '1px solid var(--theme-border)',
                  color: 'var(--theme-text-muted)',
                  fontFamily: 'var(--typography-fontfamily-sans)',
                }}
              >
                <Clock size={9} />
                {TIMELINE_LABELS[template.timelinePreset] ?? template.timelinePreset}
              </span>
            )}
            {template.defaultMilestones.length > 0 && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider"
                style={{
                  border: '1px solid var(--theme-border)',
                  color: 'var(--theme-text-muted)',
                  fontFamily: 'var(--typography-fontfamily-sans)',
                }}
              >
                <Sparkles size={9} />
                {template.defaultMilestones.length} milestones
              </span>
            )}
            {template.requiredSkills.length > 0 && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider"
                style={{
                  border: '1px solid var(--theme-border)',
                  color: 'var(--theme-text-muted)',
                  fontFamily: 'var(--typography-fontfamily-sans)',
                }}
              >
                {template.requiredSkills.length} skills
              </span>
            )}
          </div>
        </div>

        {/* Arrow indicator */}
        <div
          className="flex items-center justify-end px-4 pb-3 transition-transform duration-200 group-hover:translate-x-0.5"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          <ChevronRight size={14} />
        </div>
      </button>
    </div>
  )
}

// ─── Empty State ────────────────────────────────────────────────────────────
function EmptyState({ title, description, action }: {
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center py-16 gap-3">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: 'var(--theme-bg-subtle)' }}
      >
        <FolderKanban size={28} style={{ color: 'var(--theme-text-muted)' }} />
      </div>
      <span className="text-[15px] font-semibold" style={{ color: 'var(--theme-text)' }}>{title}</span>
      <span
        className="text-[13px] text-center max-w-[260px]"
        style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
      >
        {description}
      </span>
      {action}
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export function CoopTemplates() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<CoopTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeType, setActiveType] = useState<string>('all')
  const pubkey = localStorage.getItem('pubkey') ?? ''
  const { actions: fabActions, setActions: setFABActions, clear: clearFAB } = useFABActions()

  useEffect(() => {
    setFABActions([
      { id: 'create-template', label: 'Template', info: 'Create cooperation template', group: 'Create', icon: 'plus', onClick: () => navigate('/coop/templates/new') },
    ])
    return () => clearFAB()
  }, [setFABActions, clearFAB, navigate])

  const fetchTemplates = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (pubkey) params.set('pubkey', pubkey)
      const response = await apiCall(`/api/cooperation-templates?${params.toString()}`)
      const data = await response.json()
      setTemplates(data.templates ?? [])
    } catch {
      console.error('Failed to fetch templates')
    } finally {
      setLoading(false)
    }
  }, [pubkey])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  const filteredTemplates = useMemo(() => {
    let list = activeType === 'all' ? templates : templates.filter(t => t.cooperationType === activeType)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.cooperationType.includes(q) ||
        t.requiredSkills.some(s => s.toLowerCase().includes(q))
      )
    }
    return list
  }, [templates, activeType, searchQuery])

  const hasActiveFilters = searchQuery.trim() !== '' || activeType !== 'all'

  return (
    <>
    {/* Top spacing = 0 like /bounties (user feedback 2026-08-24): flush under
        the desktop top bar / 16px mobile edge via Layout's main padding. */}
    <PageContainer size="wide" spacing="lg" className="pt-0!">

      {/* ── Page Header ─────────────────────────────────────────────── */}
      <PageHeader
        icon={<LayoutGrid size={18} />}
        title="Cooperation Templates"
        subtitle="Start faster — load a template to pre-fill your cooperation form"
        onBack={() => navigate('/coop')}
      />

      {/* ── KPI Bar ─────────────────────────────────────────────────── */}
      {loading ? (
        <div
          className="h-[72px] rounded-xl animate-pulse"
          style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
        />
      ) : (
        <TemplateKpiBar templates={templates} activeTab={activeType} onTabClick={setActiveType} />
      )}

      {/* ── Search ──────────────────────────────────────────────────── */}
      <SearchInput
        variant="expanded"
        size="md"
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search templates by name, type, or skills…"
        ariaLabel="Search templates"
        className="w-full"
      />

      {/* ── Template Grid ───────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <TemplateCardSkeleton key={i} />)}
        </div>
      ) : filteredTemplates.length === 0 ? (
        <EmptyState
          title={searchQuery ? 'No matches found' : activeType === 'all' ? 'No templates yet' : `No ${activeType} templates`}
          description={
            searchQuery
              ? 'Try a different search term or clear the filter.'
              : activeType === 'all'
              ? 'Create the first template to get started.'
              : `No templates found with type "${activeType}".`
          }
          action={
            hasActiveFilters ? (
              <button
                onClick={() => { setSearchQuery(''); setActiveType('all') }}
                className="mt-1 px-4 py-2 rounded-full text-[11px] font-bold uppercase tracking-widest transition-all duration-200 hover:opacity-90 active:scale-95"
                style={{
                  background: 'var(--color-primary-50)',
                  color: 'white',
                  fontFamily: 'var(--typography-fontfamily-sans)',
                }}
              >
                Clear filters
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Result count */}
          <p
            className="col-span-full text-[11px] font-semibold uppercase tracking-widest mb-0.5"
            style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            {filteredTemplates.length} {filteredTemplates.length === 1 ? 'template' : 'templates'}
            {searchQuery && ` · "${searchQuery}"`}
          </p>

          {filteredTemplates.map(template => (
            <TemplateCard
              key={template.id}
              template={template}
              onClick={() => navigate(`/coop/templates/${template.id}`)}
            />
          ))}
        </div>
      )}
    </PageContainer>

    <FloatingAddButton
      offsetRight={40}
      offsetTop={130}
      actions={fabActions}
    />
    </>
  )
}