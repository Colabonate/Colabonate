// Form field step content for the unified CoopGuide FormStepper (ADR-033)
// Exports: DetailsStepContent
// Extracted from CoopCreateProjectForm / CoopCreateTenderForm / CoopCreateNetworkForm
// ADR-365 D2/D3: the classification step was merged into the guide's Model
// step (category) and the Details step (Title & Description as Section 1).

import { useEffect, useState, useCallback } from 'react'
import {
  Alert,
  Box,
  Card,
  CardActionArea,
  Chip,
  Collapse,
  FormControl,
  Grid,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material'
import BoltIcon from '@mui/icons-material/Bolt'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined'
import PersonOutlinedIcon from '@mui/icons-material/PersonOutlined'
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined'
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined'
import HandshakeOutlinedIcon from '@mui/icons-material/HandshakeOutlined'
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined'
import CloseIcon from '@mui/icons-material/Close'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { MultiImageUploadInput } from '../../../components/offers/MultiImageUploadInput'
import { RichDescriptionEditor } from '../../../components/offers'
import { SatsAmountInput } from '../../../components/currency/SatsAmountInput'
import { SatsAmount } from '../../../components/currency/SatsAmount'
import { PrivateReputationNotice } from '../../../components/offers/PrivateReputationNotice'
import { MilestoneEditor } from '../../../components/offers/MilestoneEditor'
import { OrchestrationStepsEditor } from './OrchestrationStepsEditor'
import {
  type CoopRole, type CoopType, type CoopExecutor, type CooperationType,
} from './coopGuideConstants'
import type { CoopTemplate } from './useCoopFormData'
import type { useCoopForm } from './useCoopForm'

type CoopFormInstance = ReturnType<typeof useCoopForm>

// ─── Timeline preset helper ───────────────────────────────────────────────────

const TIMELINE_TO_DATES: Record<string, { start: string; end: string }> = {
  '2weeks': {
    start: new Date().toISOString().slice(0, 10),
    end: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
  },
  '1month': {
    start: new Date().toISOString().slice(0, 10),
    end: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  },
  '3months': {
    start: new Date().toISOString().slice(0, 10),
    end: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
  },
}

const DURATION_PRESETS = [
  { label: '3d',  days: 3 },
  { label: '5d',  days: 5 },
  { label: '2w',  days: 14 },
  { label: '4w',  days: 28 },
  { label: '3m',  days: 90 },
  { label: '6m',  days: 180 },
] as const

function computeEndDate(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
}

// ─── Network access type options ──────────────────────────────────────────────

const NETWORK_ACCESS_TYPES = [
  {
    id: 'open' as const,
    label: 'Open Network',
    description: 'Anyone can join immediately. Best for broad communities and public interest groups.',
    icon: LockOpenOutlinedIcon,
    color: 'var(--color-status-success)',
    bg: 'rgba(72,187,120,0.10)',
  },
  {
    id: 'closed' as const,
    label: 'Closed Network',
    description: 'New members require approval. Best for professional groups and curated talent pools.',
    icon: LockOutlinedIcon,
    color: 'var(--color-secondary-50)',
    bg: 'rgba(159,122,234,0.10)',
  },
]

// ─── Shared Section Header (matches Step 3 Paper pattern) ─────────────────────

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
      <Box
        sx={{
          width: 40, height: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--color-primary-50)',
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Typography variant="subtitle1" fontWeight={700}>
        {title}
      </Typography>
    </Box>
  )
}

// ADR-330 D2 / R7: Details section chips ("Section 1 of 4" …) make the canonical
// order scannable at a glance and stable across types. The number anchors
// muscle memory; the icon + title identifies the content.
function NumberedSectionHeader({
  number, total, title, icon, collapsible, collapsed, onToggle,
}: {
  number: number; total: number; title: string; icon: React.ReactNode
  collapsible?: boolean; collapsed?: boolean; onToggle?: () => void
}) {
  return (
    <Box
      onClick={onToggle}
      role={collapsible ? 'button' : undefined}
      tabIndex={collapsible ? 0 : undefined}
      onKeyDown={collapsible ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle?.() } }) : undefined}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 2.5,
        mb: collapsed ? 0 : 3,
        cursor: collapsible ? 'pointer' : 'default',
        userSelect: collapsible ? 'none' : 'auto',
        borderRadius: collapsible ? 1 : 0,
        mx: collapsible ? -0.5 : 0,
        px: collapsible ? 0.5 : 0,
        py: collapsible ? 0.25 : 0,
        transition: 'background-color 0.15s',
        '&:hover': collapsible ? { bgcolor: 'var(--theme-bg-subtle)' } : {},
      }}
    >
      <Box
        sx={{
          width: 40, height: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--color-primary-50)',
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Typography variant="caption" color="primary" className="guide-eyebrow-label" sx={{ fontWeight: 700, letterSpacing: '0.08em', display: 'block', lineHeight: '15px' }}>
          Section {number} of {total}
        </Typography>
        <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'block', lineHeight: '25px', mt: 0 }}>
          {title}
        </Typography>
      </Box>
      {collapsible && (
        <ExpandMoreIcon
          sx={{
            fontSize: 22,
            color: 'var(--theme-text-muted)',
            mt: 0.25,
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
          }}
        />
      )}
    </Box>
  )
}

// ─── Card-based Intro (replaces StepIntro for Detail steps) ───────────────────

export function CardIntro({
  icon,
  title,
  what,
  why,
  how,
}: {
  icon: React.ReactNode
  title: string
  what: string
  why: string
  how: string
}) {
  const cards = [
    { label: 'What', text: what },
    { label: 'Why', text: why },
    { label: 'How', text: how },
  ]

  return (
    <Box sx={{ mb: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        {icon}
        <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 3 }}>
        {cards.map(c => (
          <Box key={c.label}>
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ fontWeight: 700, letterSpacing: '0.08em', fontSize: '0.7rem' }}
            >
              {c.label}
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.5, lineHeight: 1.7, fontSize: '0.875rem' }}
            >
              {c.text}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ─── Title & Description — Details Section 1 (ADR-365 D3) ────────────────────
// The identity fields relocated from the dissolved Classification step. Rendered
// as Section 1 of the Details step: numbered + collapsible for projects/tenders
// (D4: starts open while every other section starts collapsed), plain first card
// (always open) for network, which has no numbered-section layout.

interface TitleDescriptionSectionProps {
  form: CoopFormInstance
  coopType: CoopType | null
  errors: Record<string, string>
  onClearErrors: () => void
  /** Numbered, collapsible header config — omit for network (plain header, always open). */
  sectionNumber?: number
  totalSections?: number
  collapsed?: boolean
  onToggle?: () => void
}

export function TitleDescriptionSection({
  form,
  coopType,
  errors,
  onClearErrors,
  sectionNumber,
  totalSections,
  collapsed = false,
  onToggle,
}: TitleDescriptionSectionProps) {
  const isNetwork = coopType === 'network'
  const numbered = sectionNumber !== undefined && totalSections !== undefined

  const titleLabel       = isNetwork ? 'Network Name' : coopType === 'tenders' ? 'Tender Title' : 'Project Title'
  const titlePlaceholder = isNetwork
    ? 'e.g. Berlin Bitcoin Builders · Open Source Lightning Devs'
    : coopType === 'tenders'
    ? 'e.g. Co-develop mobile app backend with revenue share'
    : 'e.g. Build and launch open-source inventory management system'
  const titleHelper = isNetwork
    ? 'Choose a memorable name that signals the network\'s purpose.'
    : coopType === 'tenders'
    ? 'Short, descriptive — what are you proposing?'
    : 'Name the deliverable — what will be produced at the end?'

  const descLabel = isNetwork ? 'Network Description' : 'Description'
  const descHelper = isNetwork
    ? 'Be specific about the focus, audience, and how the network operates.'
    : 'Include scope, success criteria, and what collaboration looks like day-to-day.'

  const headingTitle = isNetwork ? 'Name & Description' : 'Title & Description'

  return (
    <Paper variant="outlined" sx={{ p: { xs: 3.5, sm: 5 }, borderRadius: 2 }}>
      {numbered ? (
        <NumberedSectionHeader
          number={sectionNumber}
          total={totalSections}
          icon={<DescriptionOutlinedIcon sx={{ fontSize: 20 }} />}
          title={headingTitle}
          collapsible
          collapsed={collapsed}
          onToggle={onToggle}
        />
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
          <Box
            sx={{
              width: 40, height: 40,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-primary-50)',
            }}
          >
            <DescriptionOutlinedIcon sx={{ fontSize: 20 }} />
          </Box>
          <Typography variant="subtitle1" fontWeight={700}>
            {headingTitle}
          </Typography>
        </Box>
      )}

      <Collapse in={numbered ? !collapsed : true} unmountOnExit>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3.5 }}>
          <TextField
            label={titleLabel}
            value={form.values.title}
            onChange={e => { form.setValues({ title: e.target.value }); onClearErrors() }}
            placeholder={titlePlaceholder}
            required
            fullWidth
            error={!!errors.title}
            helperText={errors.title || titleHelper}
          />

          {/* ADR-295: WYSIWYG description editor + AI assist */}
          <RichDescriptionEditor
            label={descLabel}
            value={form.values.description}
            onChange={(html) => { form.setValues({ description: html }); onClearErrors() }}
            required
            error={!!errors.description}
            helperText={errors.description || descHelper}
            aiContext={{
              title: form.values.title,
              offerType: isNetwork ? 'NETWORK' : coopType === 'tenders' ? 'TENDER' : 'COOPERATION',
              category: form.values.subcategory || form.values.category,
            }}
          />
        </Box>
      </Collapse>
    </Paper>
  )
}

// ─── DetailsStepContent — final step (title/description + type sections) ─────

interface DetailsStepProps {
  form: CoopFormInstance
  role: CoopRole | null
  coopType: CoopType | null
  companies: { id: string; name: string }[]
  templates: CoopTemplate[]
  errors: Record<string, string>
  submitting: boolean
  onClearErrors: () => void
  executor?: CoopExecutor
}

export function DetailsStepContent({
  form,
  role,
  coopType,
  companies,
  templates,
  errors,
  submitting: _submitting,
  onClearErrors,
  executor = 'human',
}: DetailsStepProps) {
  useEffect(() => {
    if (role === 'corporate' && companies.length > 0 && !form.extensions.companyId) {
      form.updateExtension('companyId', companies[0].id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, role])

  if (coopType === 'network') {
    return <NetworkDetailsStep form={form} coopType={coopType} errors={errors} onClearErrors={onClearErrors} />
  }
  if (coopType === 'tenders') {
    return <TenderDetailsStep form={form} coopType={coopType} role={role} companies={companies} errors={errors} onClearErrors={onClearErrors} />
  }
  return <ProjectDetailsStep form={form} coopType={coopType} role={role} companies={companies} templates={templates} errors={errors} onClearErrors={onClearErrors} executor={executor} />
}

// ─── Project Details ──────────────────────────────────────────────────────────

function ProjectDetailsStep({
  form,
  coopType,
  role,
  companies,
  templates,
  errors,
  onClearErrors,
  executor = 'human',
}: {
  form: CoopFormInstance
  coopType: CoopType | null
  role: CoopRole | null
  companies: { id: string; name: string }[]
  templates: CoopTemplate[]
  errors: Record<string, string>
  onClearErrors: () => void
  executor?: CoopExecutor
}) {
  const [skillInput, setSkillInput] = useState('')
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)
  // ADR-365 D4: every section starts collapsed except Section 1 (Title &
  // Description) — the section list stays scannable on all viewports, and the
  // newly-relocated identity fields are the one thing that starts open.
  // Toggle is per-section (Record), so opening a later section doesn't
  // re-collapse another.
  const [collapsed, setCollapsed] = useState<Partial<Record<number, boolean>>>(() => (
    { 2: true, 3: true, 4: true, 5: true }
  ))
  const toggleSection = useCallback((n: number) => {
    setCollapsed(prev => ({ ...prev, [n]: !prev[n] }))
  }, [])

  const applyTemplate = useCallback((t: CoopTemplate) => {
    form.updateExtension('cooperationType', t.cooperationType as CooperationType)
    if (t.requiredSkills.length > 0) {
      t.requiredSkills.forEach(s => form.addSkill(s))
    }
    if (t.defaultMilestones.length > 0) {
      form.setMilestones(t.defaultMilestones.map((m, i) => ({
        title: m.title,
        description: '',
        percentage: m.percentage,
        sortOrder: i,
      })))
      // ADR-329 D6 / plan rule R2: authored milestones force MILESTONE.
      form.setValues({ ticketType: 'MILESTONE' })
    }
    if (t.timelinePreset && TIMELINE_TO_DATES[t.timelinePreset]) {
      form.updateExtension('timelineStart', TIMELINE_TO_DATES[t.timelinePreset].start)
      form.updateExtension('timelineEnd', TIMELINE_TO_DATES[t.timelinePreset].end)
    }
    if (t.categoryCode) {
      form.setValues({ category: t.categoryCode.split('/')[0] ?? t.categoryCode, subcategory: t.categoryCode })
    }
    setActiveTemplateId(t.id)
  }, [form])

  function handleAddSkill() {
    const trimmed = skillInput.trim()
    if (!trimmed) return
    form.addSkill(trimmed)
    setSkillInput('')
  }

  const activeTemplate = templates.find(t => t.id === activeTemplateId)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <CardIntro
        icon={<TuneOutlinedIcon fontSize="small" />}
        title="Title, Specifics, Schedule, Terms & Partner"
        what="Start with the title & description, then set project specifics, schedule, budget, and partner preferences."
        why="A consistent section order keeps publish predictable: identity first, specifics next, schedule, budget, then partner visibility."
        how="Write the title & description first (Section 1 is the only one open). Pick a Quick Start Template in Section 2 to auto-fill sections 2–4."
      />

      {/* ── Section 1: Title & Description (ADR-365 D3) ─────────────────────── */}
      <TitleDescriptionSection
        form={form}
        coopType={coopType}
        errors={errors}
        onClearErrors={onClearErrors}
        sectionNumber={1}
        totalSections={5}
        collapsed={!!collapsed[1]}
        onToggle={() => toggleSection(1)}
      />

      {/* ── Section 2: Project specifics (skills + quick-start templates) ──── */}
      <Paper variant="outlined" sx={{ p: { xs: 3.5, sm: 5 }, borderRadius: 2 }}>
        <NumberedSectionHeader
          number={2}
          total={5}
          icon={<LayersOutlinedIcon sx={{ fontSize: 20 }} />}
          title="Project Specifics"
          collapsible
          collapsed={!!collapsed[2]}
          onToggle={() => toggleSection(2)}
        />
        <Collapse in={!collapsed[2]} unmountOnExit>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3.5 }}>
          {/* Required Skills */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="subtitle2" fontWeight={600} color="text.secondary">
              Required Skills
            </Typography>
            <Typography variant="caption" color="text.secondary">
              List the skills you need from partners. Partners can self-select based on this list.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <TextField
                value={skillInput}
                onChange={e => setSkillInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddSkill() } }}
                placeholder="e.g. React, Rust, UX Design…"
                size="small"
                fullWidth
                helperText="Press Enter or click Add"
              />
              <Box
                component="button"
                type="button"
                onClick={handleAddSkill}
                sx={{
                  px: 2,
                  borderRadius: 1.5,
                  border: 'none',
                  bgcolor: 'primary.main',
                  color: 'white',
                  fontWeight: 600,
                  fontSize: '0.8125rem',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  alignSelf: 'flex-start',
                  height: 40,
                  '&:hover': { opacity: 0.85 },
                }}
              >
                Add
              </Box>
            </Box>
            {form.extensions.requiredSkills.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {form.extensions.requiredSkills.map(skill => (
                  <Chip
                    key={skill}
                    label={skill}
                    size="small"
                    onDelete={() => form.removeSkill(skill)}
                    deleteIcon={<CloseIcon />}
                    color="success"
                    variant="outlined"
                  />
                ))}
              </Box>
            )}
          </Box>

          {/* Quick Start Templates */}
          {templates.length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
              <Typography variant="subtitle2" fontWeight={600} color="text.secondary">
                Quick Start Templates
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Apply a preset to auto-fill sections 2–4 (timeline, skills, milestones).
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {templates.map(t => (
                  <Chip
                    key={t.id}
                    label={t.name}
                    icon={<LayersOutlinedIcon sx={{ fontSize: '0.85rem !important' }} />}
                    variant={activeTemplateId === t.id ? 'filled' : 'outlined'}
                    color={activeTemplateId === t.id ? 'primary' : 'default'}
                    onClick={() => applyTemplate(t)}
                    sx={{
                      fontWeight: 600,
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      transition: 'all 150ms',
                    }}
                  />
                ))}
              </Box>
              {activeTemplate && activeTemplate.requiredSkills.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Skills from template — click to toggle
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                    {activeTemplate.requiredSkills.map(skill => {
                      const isActive = form.extensions.requiredSkills.includes(skill)
                      return (
                        <Chip
                          key={skill}
                          label={skill}
                          size="small"
                          variant={isActive ? 'filled' : 'outlined'}
                          color={isActive ? 'success' : 'default'}
                          onClick={() => isActive ? form.removeSkill(skill) : form.addSkill(skill)}
                          sx={{
                            fontSize: '0.72rem',
                            height: 26,
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 150ms',
                          }}
                        />
                      )
                    })}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </Box>
        </Collapse>
      </Paper>

      {/* ── Section 3: Schedule & Requirements ─────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: { xs: 3.5, sm: 5 }, borderRadius: 2 }}>
        <NumberedSectionHeader
          number={3}
          total={5}
          icon={<CalendarMonthOutlinedIcon sx={{ fontSize: 20 }} />}
          title="Schedule & Requirements"
          collapsible
          collapsed={!!collapsed[3]}
          onToggle={() => toggleSection(3)}
        />
        <Collapse in={!collapsed[3]} unmountOnExit>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Start Date"
              type="date"
              value={form.extensions.timelineStart}
              onChange={e => form.updateExtension('timelineStart', e.target.value)}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
              helperText="Planned or approximate project start"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="End Date"
              type="date"
              value={form.extensions.timelineEnd}
              onChange={e => form.updateExtension('timelineEnd', e.target.value)}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
              helperText="Target completion date"
            />
            <Box sx={{ display: 'flex', gap: 0.75, mt: 1, flexWrap: 'wrap' }}>
              {DURATION_PRESETS.map(p => (
                <Chip
                  key={p.label}
                  label={p.label}
                  size="small"
                  variant={form.extensions.timelineEnd === computeEndDate(p.days) ? 'filled' : 'outlined'}
                  onClick={() => form.updateExtension('timelineEnd', computeEndDate(p.days))}
                  sx={{
                    fontSize: '0.72rem',
                    height: 26,
                    fontWeight: 600,
                    fontFamily: 'var(--typography-fontfamily-monospace, monospace)',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </Box>
          </Grid>
        </Grid>
        </Collapse>
      </Paper>

      {/* ── Section 4: Terms & Budget ───────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: { xs: 3.5, sm: 5 }, borderRadius: 2 }}>
        <NumberedSectionHeader
          number={4}
          total={5}
          icon={<BoltIcon sx={{ fontSize: 20 }} />}
          title="Terms & Budget"
          collapsible
          collapsed={!!collapsed[4]}
          onToggle={() => toggleSection(4)}
        />
        <Collapse in={!collapsed[4]} unmountOnExit>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3.5 }}>
          {role === 'corporate' && (
            <FormControl fullWidth error={!!errors.companyId} required>
              <InputLabel>Company</InputLabel>
              <Select
                value={form.extensions.companyId}
                label="Company"
                onChange={e => { form.updateExtension('companyId', e.target.value); onClearErrors() }}
              >
                <MenuItem value=""><em>— Select company —</em></MenuItem>
                {companies.map(c => (
                  <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                ))}
              </Select>
              {errors.companyId && (
                <Typography variant="caption" color="error" sx={{ mt: 0.5, ml: 1.5 }}>
                  {errors.companyId}
                </Typography>
              )}
            </FormControl>
          )}

          <Box>
            <SatsAmountInput
              label="Project Budget"
              valueSats={form.values.priceSats === '' ? '' : Number(form.values.priceSats)}
              onChangeSats={sats => { form.setValues({ priceSats: sats === '' ? '' : String(sats) }); onClearErrors() }}
              required
              error={!!errors.priceSats}
              // Leave helperText unset when valid — SatsAmountInput then shows its
              // own live sats↔fiat conversion line (Settings currency) instead of
              // a static caption. Only take the slot back over for the error.
              helperText={errors.priceSats || undefined}
            />
            {!errors.priceSats && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, ml: 1.75 }}>
                Total project value, distributed via milestones.
              </Typography>
            )}
          </Box>

          {/* ADR-329 D1: Payment Structure selector — projects + tenders only.
              Payment-structure parity for AI Agent (2026-08-22): same toggle,
              same editors as People — supersedes ADR-328 D2's MILESTONE-forced
              carve-out for Projects+agent. setPaymentStructure clears the
              orchestration pipeline when Smart Order is picked (authored steps
              would be orphaned by the fixed 25/50/25 phases); Milestone keeps
              any authored pipeline mirroring onto the milestones below. */}
          <Box>
            <Typography variant="subtitle2" fontWeight={600} color="text.secondary" gutterBottom>
              Payment Structure
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Smart Order auto-generates the canonical 3-phase escrow. Milestone lets you author custom phases.
            </Typography>
            <Grid container spacing={1.5}>
              {(['SMART_ORDER', 'MILESTONE'] as const).map(opt => {
                const active = form.values.ticketType === opt
                return (
                  <Grid key={opt} size={{ xs: 12, sm: 6 }}>
                    <Card variant="outlined" sx={{
                      borderRadius: 2,
                      borderColor: active ? 'var(--color-primary-50)' : 'var(--theme-border)',
                      borderWidth: active ? 2 : 1,
                      background: active ? 'rgba(99,179,237,0.06)' : 'var(--theme-surface)',
                    }}>
                      <CardActionArea onClick={() => { form.setPaymentStructure(opt); onClearErrors() }} sx={{ p: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          {opt === 'SMART_ORDER'
                            ? <BoltIcon sx={{ fontSize: 18, color: 'var(--color-primary-50)' }} />
                            : <LayersOutlinedIcon sx={{ fontSize: 18, color: 'var(--color-secondary-50)' }} />}
                          <Typography variant="subtitle2" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>
                            {opt === 'SMART_ORDER' ? 'Smart Order' : 'Milestone'}
                          </Typography>
                        </Box>
                        <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', display: 'block', lineHeight: 1.5 }}>
                          {opt === 'SMART_ORDER'
                            ? 'Auto escrow phases: Start 25% / Progress 50% / Completion 25%. No setup.'
                            : 'Author custom deliverable phases that must sum to 100%.'}
                        </Typography>
                      </CardActionArea>
                    </Card>
                  </Grid>
                )
              })}
            </Grid>
          </Box>

          {/* ADR-332 D2 (V2 nested pipeline): the agent pipeline lives INSIDE
              each milestone card (renderMilestoneExtras slot below) — one
              editor, one truth. The standalone "Agent Pipeline" block that
              authored milestones 1:1 is gone. A milestone without steps is a
              human milestone (mixed human/agent cooperations). */}
          {form.values.ticketType === 'SMART_ORDER' ? (
            <Box>
              <Typography variant="subtitle2" fontWeight={600} color="text.secondary" gutterBottom>
                Phases
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Funds split into 3 automatic escrow phases (pattern at CoopDetail 25/50/25).
              </Typography>
              <Box sx={{ borderRadius: 2, border: '1px solid var(--theme-border)', overflow: 'hidden', background: 'var(--theme-bg-elevated)' }}>
                {([
                  { label: 'Start', pct: 25 },
                  { label: 'Progress', pct: 50 },
                  { label: 'Completion', pct: 25 },
                ]).map((p, i, arr) => {
                  const budget = parseInt(form.values.priceSats) || 0
                  const phaseSats = Math.round(budget * p.pct / 100)
                  return (
                    <Box key={p.label} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 1.5, py: 1, borderBottom: i < arr.length - 1 ? '1px solid' : 'none', borderColor: 'var(--theme-border)' }}>
                      <Typography variant="caption" color="text.secondary" fontWeight={500}>{p.label}</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                        {budget > 0 ? (
                          <SatsAmount sats={phaseSats} size="sm" showUnit />
                        ) : (
                          <Typography variant="caption" color="text.disabled" fontWeight={700}>— sats</Typography>
                        )}
                      </Box>
                    </Box>
                  )
                })}
              </Box>
            </Box>
          ) : (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="subtitle2" fontWeight={600} color="text.secondary">
                  Project Milestones
                </Typography>
                {executor === 'agent' && form.milestones.length > 1 && (
                  <Box
                    component="button"
                    type="button"
                    onClick={form.splitMilestonesEvenly}
                    sx={{
                      border: 'none', bgcolor: 'transparent', cursor: 'pointer',
                      color: 'var(--color-primary-50)', fontWeight: 600, fontSize: '0.78rem',
                      px: 1, py: 0.5, borderRadius: 1,
                      '&:hover': { textDecoration: 'underline' },
                      '&:focus-visible': { outline: '2px solid var(--color-primary-50)', outlineOffset: 2 },
                    }}
                  >
                    Split evenly
                  </Box>
                )}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                {executor === 'agent'
                  ? 'Each milestone is an escrow phase released on confirmation — assign the agent work that belongs to it via its pipeline. Total must equal 100%.'
                  : 'Break the budget into deliverable phases. Each phase is released from escrow upon confirmation. Total must equal 100%.'}
              </Typography>
              <MilestoneEditor
                milestones={form.milestones}
                onMilestonesChange={form.setMilestones}
                color="secondary"
                richDescription
                renderMilestoneExtras={executor === 'agent' ? (mi, m) => (
                  <OrchestrationStepsEditor
                    steps={m.steps ?? []}
                    onChange={steps => form.setMilestoneSteps(mi, steps)}
                  />
                ) : undefined}
              />
              {executor === 'agent' && !form.pipelineValid && form.hasPipelineSteps && (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  Every pipeline step needs a name and at least one required capability.
                </Alert>
              )}
              {/* Milestone sum feedback lives inside MilestoneEditor (live
                  progress row) — no duplicate 100% warning here. */}
            </Box>
          )}
        </Box>
        </Collapse>
      </Paper>

      {/* ── Section 5: Partner & Visibility ─────────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: { xs: 3.5, sm: 5 }, borderRadius: 2 }}>
        <NumberedSectionHeader
          number={5}
          total={5}
          icon={<HandshakeOutlinedIcon sx={{ fontSize: 20 }} />}
          title="Partner & Visibility"
          collapsible
          collapsed={!!collapsed[5]}
          onToggle={() => toggleSection(5)}
        />
        <Collapse in={!collapsed[5]} unmountOnExit>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3.5 }}>
          <Typography variant="caption" color="text.secondary">
            Choose how partners join your cooperation.
          </Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            {([
              { value: 'WHOLE' as const, label: 'Whole Cooperation', desc: 'One partner accepts the entire project. Simpler flow.', icon: <HandshakeOutlinedIcon fontSize="small" /> },
              { value: 'PER_MILESTONE' as const, label: 'Per Milestone', desc: 'Partners apply for individual milestones. Like a tender.', icon: <LayersOutlinedIcon fontSize="small" /> },
            ]).map(option => (
              <Card
                key={option.value}
                variant={form.extensions.partnerMode === option.value ? 'elevation' : 'outlined'}
                elevation={form.extensions.partnerMode === option.value ? 4 : 0}
                sx={{
                  flex: 1, cursor: 'pointer', borderRadius: 2,
                  border: form.extensions.partnerMode === option.value ? '2px solid' : '1px solid',
                  borderColor: form.extensions.partnerMode === option.value ? 'primary.main' : 'divider',
                  transition: 'all 0.15s',
                }}
                onClick={() => form.updateExtension('partnerMode', option.value)}
              >
                <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Box sx={{
                      width: 28, height: 28, borderRadius: 1.5,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: form.extensions.partnerMode === option.value ? 'rgba(99,179,237,0.12)' : 'var(--theme-bg-subtle)',
                      color: form.extensions.partnerMode === option.value ? 'var(--color-primary-50)' : 'text.secondary',
                    }}>
                      {option.icon}
                    </Box>
                    <Typography variant="body2" fontWeight={700}>{option.label}</Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                    {option.desc}
                  </Typography>
                </Box>
              </Card>
            ))}
          </Box>

          <TextField
            label="Invite Specific Partner (optional)"
            value={form.extensions.partnerPubkey}
            onChange={e => form.updateExtension('partnerPubkey', e.target.value)}
            placeholder="npub1… or hex pubkey"
            fullWidth
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <PersonOutlinedIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              },
            }}
            helperText="Optional: send a direct invitation to a known partner via their Nostr public key."
            inputProps={{ style: { fontFamily: 'var(--typography-fontfamily-monospace, monospace)' } }}
          />

          {/* ── Privacy & Visibility (ADR-152 / Plan Phase 3.1) ── */}
          <Box>
            <Typography variant="subtitle2" fontWeight={600} color="text.secondary" gutterBottom>
              Privacy & Visibility
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5, lineHeight: 1.5 }}>
              Private cooperations travel via NIP-17 encrypted DMs — no public discovery, no reputation, opt-in mutual arbiter.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              {([
                { value: 'PUBLIC' as const, label: 'Public', icon: <LockOpenOutlinedIcon sx={{ fontSize: 18 }} />, desc: 'Listed publicly. Reputation builds. DAO disputes.' },
                { value: 'PRIVATE' as const, label: 'Private', icon: <LockOutlinedIcon sx={{ fontSize: 18 }} />, desc: 'NIP-17 DM only. No public listing. Mutual arbiter.' },
              ]).map(card => {
                const selected = form.values.visibility === card.value
                return (
                  <Paper
                    key={card.value}
                    onClick={() => form.setValues({
                      visibility: card.value,
                      disputeMode: card.value === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
                    })}
                    variant={selected ? 'elevation' : 'outlined'}
                    elevation={selected ? 4 : 0}
                    sx={{
                      flex: 1,
                      p: 1.5,
                      cursor: 'pointer',
                      borderRadius: 2,
                      borderColor: selected ? 'primary.main' : 'divider',
                      borderWidth: selected ? 2 : 1,
                      borderStyle: 'solid',
                      transition: 'box-shadow 150ms, border-color 150ms',
                      '&:hover': { borderColor: 'primary.main' },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                      <Box sx={{ color: selected ? 'primary.main' : 'action.active', display: 'flex' }}>{card.icon}</Box>
                      <Typography variant="body2" fontWeight={700}>{card.label}</Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                      {card.desc}
                    </Typography>
                  </Paper>
                )
              })}
            </Box>
          </Box>

          {form.values.visibility === 'PRIVATE' && <PrivateReputationNotice />}

          <Box>
            <Typography variant="subtitle2" fontWeight={600} color="text.secondary" gutterBottom>
              Project Images (optional)
            </Typography>
            <MultiImageUploadInput
              values={form.values.images}
              onChange={urls => form.setValues({ images: urls })}
            />
          </Box>
        </Box>
        </Collapse>
      </Paper>

    </Box>
  )
}

// ─── Tender Details ───────────────────────────────────────────────────────────

function TenderDetailsStep({
  form,
  coopType,
  role,
  companies,
  errors,
  onClearErrors,
}: {
  form: CoopFormInstance
  coopType: CoopType | null
  role: CoopRole | null
  companies: { id: string; name: string }[]
  errors: Record<string, string>
  onClearErrors: () => void
}) {
  // ADR-365 D4: every section starts collapsed except Section 1 (Title &
  // Description) — same default as ProjectDetailsStep, on all viewports.
  const [collapsed, setCollapsed] = useState<Partial<Record<number, boolean>>>(() => (
    { 2: true, 3: true, 4: true }
  ))
  const toggleSection = useCallback((n: number) => {
    setCollapsed(prev => ({ ...prev, [n]: !prev[n] }))
  }, [])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <CardIntro
        icon={<TuneOutlinedIcon fontSize="small" />}
        title="Title, Terms, Schedule & Partner"
        what="Start with the title & description, then set budget, application deadline, requirements, and partner preferences."
        why="Tenders are open calls — a clear title, deadline + requirements filters the right applicants fast."
        how="Write the title & description first (Section 1 is the only one open), then a realistic budget and a deadline at least a few days out."
      />

      {/* ── Section 1: Title & Description (ADR-365 D3) ─────────────────────── */}
      <TitleDescriptionSection
        form={form}
        coopType={coopType}
        errors={errors}
        onClearErrors={onClearErrors}
        sectionNumber={1}
        totalSections={4}
        collapsed={!!collapsed[1]}
        onToggle={() => toggleSection(1)}
      />

      {/* ── Section 2: Terms & Budget ───────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: { xs: 3.5, sm: 5 }, borderRadius: 2 }}>
        <NumberedSectionHeader
          number={2}
          total={4}
          icon={<BoltIcon sx={{ fontSize: 20 }} />}
          title="Terms & Budget"
          collapsible
          collapsed={!!collapsed[2]}
          onToggle={() => toggleSection(2)}
        />
        <Collapse in={!collapsed[2]} unmountOnExit>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3.5 }}>
          {role === 'corporate' && (
            <FormControl fullWidth error={!!errors.companyId} required>
              <InputLabel>Company</InputLabel>
              <Select
                value={form.extensions.companyId}
                label="Company"
                onChange={e => { form.updateExtension('companyId', e.target.value); onClearErrors() }}
              >
                <MenuItem value=""><em>— Select company —</em></MenuItem>
                {companies.map(c => (
                  <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                ))}
              </Select>
              {errors.companyId && (
                <Typography variant="caption" color="error" sx={{ mt: 0.5, ml: 1.5 }}>
                  {errors.companyId}
                </Typography>
              )}
            </FormControl>
          )}

          <Box>
            <SatsAmountInput
              label="Budget"
              valueSats={form.values.priceSats === '' ? '' : Number(form.values.priceSats)}
              onChangeSats={sats => { form.setValues({ priceSats: sats === '' ? '' : String(sats) }); onClearErrors() }}
              required
              error={!!errors.priceSats}
              helperText={errors.priceSats || undefined}
            />
            {!errors.priceSats && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, ml: 1.75 }}>
                Held in Lightning escrow until completion.
              </Typography>
            )}
          </Box>

          <Box>
            {/* ADR-329 D1: Payment Structure selector — projects + tenders only */}
            <Typography variant="subtitle2" fontWeight={600} color="text.secondary" gutterBottom>
              Payment Structure
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Smart Order auto-generates the canonical 3-phase escrow. Milestone lets you author custom phases.
            </Typography>
            <Grid container spacing={1.5}>
              {(['SMART_ORDER', 'MILESTONE'] as const).map(opt => {
                const active = form.values.ticketType === opt
                return (
                  <Grid key={opt} size={{ xs: 12, sm: 6 }}>
                    <Card variant="outlined" sx={{
                      borderRadius: 2,
                      borderColor: active ? 'var(--color-primary-50)' : 'var(--theme-border)',
                      borderWidth: active ? 2 : 1,
                      background: active ? 'rgba(99,179,237,0.06)' : 'var(--theme-surface)',
                    }}>
                      <CardActionArea onClick={() => { form.setPaymentStructure(opt); onClearErrors() }} sx={{ p: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          {opt === 'SMART_ORDER'
                            ? <BoltIcon sx={{ fontSize: 18, color: 'var(--color-primary-50)' }} />
                            : <LayersOutlinedIcon sx={{ fontSize: 18, color: 'var(--color-secondary-50)' }} />}
                          <Typography variant="subtitle2" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>
                            {opt === 'SMART_ORDER' ? 'Smart Order' : 'Milestone'}
                          </Typography>
                        </Box>
                        <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', display: 'block', lineHeight: 1.5 }}>
                          {opt === 'SMART_ORDER'
                            ? 'Auto escrow phases: Start 25% / Progress 50% / Completion 25%. No setup.'
                            : 'Author custom deliverable phases that must sum to 100%.'}
                        </Typography>
                      </CardActionArea>
                    </Card>
                  </Grid>
                )
              })}
            </Grid>
          </Box>

          {form.values.ticketType === 'SMART_ORDER' ? (
            <Box>
              <Typography variant="subtitle2" fontWeight={600} color="text.secondary" gutterBottom>
                Phases
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Funds split into 3 automatic escrow phases (pattern at CoopDetail 25/50/25).
              </Typography>
              <Box sx={{ borderRadius: 2, border: '1px solid var(--theme-border)', overflow: 'hidden', background: 'var(--theme-bg-elevated)' }}>
                {([
                  { label: 'Start', pct: 25 },
                  { label: 'Progress', pct: 50 },
                  { label: 'Completion', pct: 25 },
                ]).map((p, i, arr) => {
                  const budget = parseInt(form.values.priceSats) || 0
                  const phaseSats = Math.round(budget * p.pct / 100)
                  return (
                    <Box key={p.label} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 1.5, py: 1, borderBottom: i < arr.length - 1 ? '1px solid' : 'none', borderColor: 'var(--theme-border)' }}>
                      <Typography variant="caption" color="text.secondary" fontWeight={500}>{p.label}</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                        {budget > 0 ? (
                          <SatsAmount sats={phaseSats} size="sm" showUnit />
                        ) : (
                          <Typography variant="caption" color="text.disabled" fontWeight={700}>— sats</Typography>
                        )}
                      </Box>
                    </Box>
                  )
                })}
              </Box>
            </Box>
          ) : (
            <Box>
              <Typography variant="subtitle2" fontWeight={600} color="text.secondary" gutterBottom>
                Payment Milestones
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Split the budget into phases. Each milestone is released independently when confirmed. Percentages must total 100%.
              </Typography>
              <MilestoneEditor
                milestones={form.milestones}
                onMilestonesChange={form.setMilestones}
                color="secondary"
                richDescription
              />
              {!form.milestoneValid && form.milestones.length > 0 && (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  Milestone percentages must add up to exactly 100%.
                </Alert>
              )}
            </Box>
          )}
        </Box>
        </Collapse>
      </Paper>

      {/* ── Section 3: Schedule & Requirements ─────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: { xs: 3.5, sm: 5 }, borderRadius: 2 }}>
        <NumberedSectionHeader
          number={3}
          total={4}
          icon={<CalendarMonthOutlinedIcon sx={{ fontSize: 20 }} />}
          title="Schedule & Requirements"
          collapsible
          collapsed={!!collapsed[3]}
          onToggle={() => toggleSection(3)}
        />
        <Collapse in={!collapsed[3]} unmountOnExit>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3.5 }}>
          <TextField
            label="Application Deadline"
            type="date"
            value={form.extensions.deadline}
            onChange={e => form.updateExtension('deadline', e.target.value)}
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
            helperText="Deadline for partners to submit their proposals"
          />
          <TextField
            label="Requirements / Leistungsbeschreibung"
            value={form.extensions.requirements}
            onChange={e => form.updateExtension('requirements', e.target.value)}
            placeholder="Describe detailed requirements, deliverables, and evaluation criteria…"
            multiline
            rows={4}
            fullWidth
            helperText="Detailed requirements that applicants must fulfill"
          />
        </Box>
        </Collapse>
      </Paper>

      {/* ── Section 4: Partner & Visibility ────────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: { xs: 3.5, sm: 5 }, borderRadius: 2 }}>
        <NumberedSectionHeader
          number={4}
          total={4}
          icon={<HandshakeOutlinedIcon sx={{ fontSize: 20 }} />}
          title="Partner & Visibility"
          collapsible
          collapsed={!!collapsed[4]}
          onToggle={() => toggleSection(4)}
        />
        <Collapse in={!collapsed[4]} unmountOnExit>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3.5 }}>
          <TextField
            label="Invite Partner (optional)"
            value={form.extensions.partnerPubkey}
            onChange={e => form.updateExtension('partnerPubkey', e.target.value)}
            placeholder="npub1... or hex pubkey"
            fullWidth
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <PersonOutlinedIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              },
            }}
            helperText="Optional: send a direct invitation to a specific partner via their Nostr public key."
            inputProps={{ style: { fontFamily: 'var(--typography-fontfamily-monospace, monospace)' } }}
          />

          <Box>
            <Typography variant="subtitle2" fontWeight={600} color="text.secondary" gutterBottom>
              Privacy & Visibility
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5, lineHeight: 1.5 }}>
              Private tenders travel via NIP-17 encrypted DMs — no public discovery, opt-in mutual arbiter.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              {([
                { value: 'PUBLIC' as const, label: 'Public', icon: <LockOpenOutlinedIcon sx={{ fontSize: 18 }} />, desc: 'Listed publicly. Partners can apply directly.' },
                { value: 'PRIVATE' as const, label: 'Private', icon: <LockOutlinedIcon sx={{ fontSize: 18 }} />, desc: 'NIP-17 DM only. No public listing. Mutual arbiter.' },
              ]).map(card => {
                const selected = form.values.visibility === card.value
                return (
                  <Paper
                    key={card.value}
                    onClick={() => form.setValues({
                      visibility: card.value,
                      disputeMode: card.value === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
                    })}
                    variant={selected ? 'elevation' : 'outlined'}
                    elevation={selected ? 4 : 0}
                    sx={{
                      flex: 1,
                      p: 1.5,
                      cursor: 'pointer',
                      borderRadius: 2,
                      borderColor: selected ? 'primary.main' : 'divider',
                      borderWidth: selected ? 2 : 1,
                      borderStyle: 'solid',
                      transition: 'box-shadow 150ms, border-color 150ms',
                      '&:hover': { borderColor: 'primary.main' },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                      <Box sx={{ color: selected ? 'primary.main' : 'action.active', display: 'flex' }}>{card.icon}</Box>
                      <Typography variant="body2" fontWeight={700}>{card.label}</Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                      {card.desc}
                    </Typography>
                  </Paper>
                )
              })}
            </Box>
          </Box>

          {form.values.visibility === 'PRIVATE' && <PrivateReputationNotice />}

          <Box>
            <Typography variant="subtitle2" fontWeight={600} color="text.secondary" gutterBottom>
              Images (optional)
            </Typography>
            <MultiImageUploadInput
              values={form.values.images}
              onChange={urls => form.setValues({ images: urls })}
            />
          </Box>
        </Box>
        </Collapse>
      </Paper>
    </Box>
  )
}

// ─── Network Details ──────────────────────────────────────────────────────────

function NetworkDetailsStep({
  form,
  coopType,
  errors,
  onClearErrors,
}: {
  form: CoopFormInstance
  coopType: CoopType | null
  errors: Record<string, string>
  onClearErrors: () => void
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <CardIntro
        icon={<TuneOutlinedIcon fontSize="small" />}
        title="Name, Membership & Community Rules"
        what="Start with the network name & description, then set membership criteria so potential members can self-assess fit, and optionally cap the community size."
        why="A clear name and description help people find the network; clear criteria reduce noise — the right people apply, the wrong ones self-filter."
        how="Write the name & description first, then 2–4 bullet-point criteria. Leave Max Members empty for unlimited growth."
      />

      {/* Title & Description first (ADR-365 D3) — plain card, always open.
          Network's Details step has no numbered-section/collapse layout. */}
      <TitleDescriptionSection
        form={form}
        coopType={coopType}
        errors={errors}
        onClearErrors={onClearErrors}
      />

      <Grid container spacing={2.5}>
        {/* Access Control */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper variant="outlined" sx={{ p: { xs: 3.5, sm: 5 }, borderRadius: 2 }}>
            <SectionHeader
              icon={<LockOpenOutlinedIcon sx={{ fontSize: 20 }} />}
              title="Access Control"
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
              Decide who can join your network and whether approval is required.
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              {NETWORK_ACCESS_TYPES.map(opt => {
                const isSelected = form.extensions.networkType === opt.id
                const Icon = opt.icon
                return (
                  <Card
                    key={opt.id}
                    variant="outlined"
                    sx={{
                      borderRadius: 2,
                      borderWidth: isSelected ? 2 : 1,
                      borderColor: isSelected ? opt.color : 'divider',
                      bgcolor: isSelected ? opt.bg : 'transparent',
                      transition: 'all 150ms',
                    }}
                  >
                    <CardActionArea
                      onClick={() => form.updateExtension('networkType', opt.id)}
                      sx={{ p: 2.5, display: 'flex', alignItems: 'flex-start', gap: 2 }}
                    >
                      <Box
                        sx={{
                          width: 40,
                          height: 40,
                          borderRadius: 1.5,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          bgcolor: opt.bg,
                          flexShrink: 0,
                        }}
                      >
                        <Icon fontSize="small" style={{ color: opt.color }} />
                      </Box>
                      <Box>
                        <Typography
                          variant="subtitle2"
                          fontWeight={700}
                          sx={{ color: isSelected ? opt.color : 'text.primary' }}
                          gutterBottom
                        >
                          {opt.label}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.55, display: 'block' }}>
                          {opt.description}
                        </Typography>
                      </Box>
                    </CardActionArea>
                  </Card>
                )
              })}
            </Box>
          </Paper>
        </Grid>

        {/* Membership */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper variant="outlined" sx={{ p: { xs: 3.5, sm: 5 }, borderRadius: 2 }}>
            <SectionHeader
              icon={<GroupsOutlinedIcon sx={{ fontSize: 20 }} />}
              title="Membership"
            />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3.5 }}>
              <TextField
                label="Membership Criteria"
                value={form.extensions.membershipCriteria}
                onChange={e => form.updateExtension('membershipCriteria', e.target.value)}
                placeholder={'e.g.\n• Active contributor to open-source projects\n• At least 1 year of Bitcoin/Lightning experience\n• Willing to collaborate on joint initiatives'}
                multiline
                rows={4}
                fullWidth
                helperText="Describe who should join. Used to screen applicants for Closed networks and set expectations for Open ones."
              />

              <TextField
                label="Maximum Members (optional)"
                type="number"
                value={form.extensions.maxMembers}
                onChange={e => form.updateExtension('maxMembers', e.target.value)}
                placeholder="Leave empty for unlimited"
                inputProps={{ min: 2 }}
                fullWidth
                slotProps={{
                  input: {
                    startAdornment: (
                      <Box sx={{ mr: 1, display: 'flex', color: 'text.secondary' }}>
                        <GroupsOutlinedIcon fontSize="small" />
                      </Box>
                    ),
                  },
                }}
                helperText="Optional cap on total members. Useful for maintaining quality in early-stage curated networks."
              />
            </Box>
          </Paper>
        </Grid>

        {/* Network Image — full width */}
        <Grid size={12}>
          <Paper variant="outlined" sx={{ p: { xs: 3.5, sm: 5 }, borderRadius: 2 }}>
            <SectionHeader
              icon={<LayersOutlinedIcon sx={{ fontSize: 20 }} />}
              title="Network Image"
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Add a logo or banner to make your network recognizable in listings.
            </Typography>
            <MultiImageUploadInput
              values={form.values.images}
              onChange={urls => form.setValues({ images: urls })}
              maxImages={1}
            />
          </Paper>
        </Grid>
      </Grid>
    </Box>
  )
}
