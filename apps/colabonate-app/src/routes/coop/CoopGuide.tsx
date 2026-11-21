// Cooperation Guide – Unified Route Component (ADR-033)
// ONE FormStepper spanning all steps: Guide -> Model & Category -> Details
// (ADR-365 D2: the old Classification step merged into Model & Category;
// title/description live on Details). Find/Manage path: Guide -> Result (2 steps)

import { useState, useMemo, useEffect, useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Typography } from '@mui/material'
import { Handshake, Eye, EyeOff } from 'lucide-react'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import { PageContainer, FormStepper } from '@ds/ui'
import { useIsMobile } from '@ds/utils'
import { PageHeader } from '../../components/PageHeader'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { apiCall, ApiError } from '../../lib/api'
import { richTextToPlainText } from '../../components/offers'
import { smoothScrollToTop } from '../../lib/lenis-setup'
import { signAndPublishFromTemplate, sendPrivateCooperationProposal } from '../../lib/nostr-ticket'
import type { NostrEventTemplate } from '../../lib/nostr-ticket'
import { useCoopGuide } from './guide/useCoopGuide'
import { useCoopForm } from './guide/useCoopForm'
import { useCoopFormData } from './guide/useCoopFormData'
import { GuideStepContent, ModelStepContent, BreadcrumbChips } from './guide/CoopGuideSteps'
import { DetailsStepContent } from './guide/CoopCreateSteps'
import { CoopCategorySection } from './guide/CoopFormBase'
import { CoopManageView } from './guide/CoopManageView'
import { MatchPreviewStep } from './guide/MatchPreviewStep'
import {
  COOPERATION_TYPE_DEFAULT_CATEGORY,
  GUIDE_STEP_META,
  getGuideSteps,
  type CooperationType,
  type CoopGuideStepId,
} from './guide/coopGuideConstants'
import type { FormStep } from '@ds/ui'
import type { CoopTemplate } from './guide/useCoopFormData'
import { useEntity } from '../../hooks/useEntityQueries'
import type { Cooperation, Offer } from '../../types/api'

// ADR-296: GET /api/cooperations/:id already parses Cooperation.skills/images
// (raw JSON-string Prisma columns) into arrays server-side (parseCooperation()
// in apps/server/index.ts) — the `string` type on the Cooperation interface
// describes the DB column, not what the API actually returns. Accept either
// shape defensively rather than re-JSON.parse()ing an already-parsed array.
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
  }
  return []
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CoopGuide() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const guide    = useCoopGuide()
  const isMobile = useIsMobile()

  // Form state lifted to guide level (role/type may be null initially — use safe defaults)
  const form = useCoopForm({
    role:     guide.role     ?? 'corporate',
    coopType: guide.type ?? 'projects',
  })
  const data = useCoopFormData(guide.role, guide.type)

  const [submitting,  setSubmitting]  = useState(false)
  const [success,     setSuccess]     = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({})
  const [showDetails, setShowDetails] = useState(false)

  const containerRef = usePageAnimation([
    { selector: '.guide-animate', from: { duration: 0.4, stagger: 0.1, y: 20 } },
  ])

  // Sync cooperationModel → form extension so buildPayload uses it
  useEffect(() => {
    if (guide.cooperationModel) {
      form.updateExtension('cooperationType', guide.cooperationModel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide.cooperationModel])

  // ADR-365 D2: category prefill moved up from the dissolved Classification
  // step — the merged Model & Category step pre-fills the cooperation-model's
  // default root category until the user picks their own.
  useEffect(() => {
    const model = guide.cooperationModel
    if (!model) return
    if (form.values.category && form.values.category !== 'services') return  // user already changed it
    const defaults = COOPERATION_TYPE_DEFAULT_CATEGORY[model]
    if (defaults.category !== form.values.category || defaults.subcategory !== form.values.subcategory) {
      form.setValues({
        category:    defaults.category,
        subcategory: defaults.subcategory,
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide.cooperationModel])

  // ─── Auto-apply template when navigating from CoopTemplateDetail ──────────
  const templateApplied = useRef(false)
  useEffect(() => {
    if (!guide.templateId || templateApplied.current) return

    let cancelled = false
    ;(async () => {
      try {
        const res = await apiCall(`/api/cooperation-templates/${guide.templateId}`)
        if (cancelled || !res.ok) return
        const data = await res.json()
        if (cancelled || !data?.template) return

        const t: CoopTemplate = data.template
        templateApplied.current = true

        // Set guide state: role=corporate, type=projects, action=create
        guide.setRole('corporate')
        guide.setType('projects')
        guide.setAction('create')
        // ADR-331 D3: if the template itself is an agent-orchestration
        // template, set executor='agent' so the wizard enters the matching
        // flow (OrchestrationStepsEditor in Details, Match-Preview step)
        // instead of the human-MILESTONE path. agentSupervision is left at
        // its default — templates don't carry that axis.
        if (t.isAgentOrchestration) {
          guide.setExecutor('agent')
        }

        // Determine cooperation model from template
        const coopModel = (t.cooperationType?.toUpperCase() ?? 'TRANSACTIONAL') as CooperationType
        guide.setCooperationModel(coopModel)

        // Apply template fields to form
        if (t.requiredSkills?.length) {
          t.requiredSkills.forEach(s => form.addSkill(s))
        }
        if (t.defaultMilestones?.length) {
          form.setMilestones(t.defaultMilestones.map((m, i) => ({
            title: m.title,
            description: '',
            percentage: m.percentage,
            sortOrder: i,
          })))
          // ADR-329 D6 / plan rule R2: authored milestones force MILESTONE so
          // the Smart Order selector stays hidden on template-driven drafts.
          form.setValues({ ticketType: 'MILESTONE' })
        }
        if (t.categoryCode) {
          form.setValues({
            category: t.categoryCode.split('/')[0] ?? t.categoryCode,
            subcategory: t.categoryCode.includes('/') ? t.categoryCode : '',
          })
        }

        // ADR-365 D2/D3: role/type/action/model + category are set (the merged
        // Model & Category step is complete) — the user still must enter
        // title & description on the Details step.
        guide.goTo('details')
      } catch (err) {
        console.warn('[CoopGuide] Failed to auto-apply template:', err)
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide.templateId])

  // ─── ADR-296: resume an existing DRAFT when navigated here from Manage ────
  // Manage's "Edit" on a DRAFT sends { editId } via location.state (useCoopGuide
  // reads it into guide.editId). Fetch the saved record, hydrate the form, and
  // jump to the first step that still needs input instead of starting blank.
  const editQuery = useEntity(guide.editId ?? '')
  const editApplied = useRef(false)
  // ADR-386: the resumed entity's persisted status. A published (non-DRAFT)
  // resume edits in place — it must NOT re-run the DRAFT→OPEN status transition
  // (which 409s on OPEN→OPEN) and must omit `status` from the content PATCH.
  const resumedStatusRef = useRef<string | null>(null)
  useEffect(() => {
    if (!guide.editId || editApplied.current || !editQuery.data) return
    editApplied.current = true
    const { type: entityType, data: entity } = editQuery.data

    if (entityType === 'offer') {
      const offer = entity as Offer
      resumedStatusRef.current = offer.status ?? null
      guide.setType('network')
      // Offer.companyId is the only persisted signal for corporate role on a
      // network draft — Cooperation rows have no equivalent column (FU-323).
      guide.setRole(offer.companyId ? 'corporate' : 'private')
      guide.setAction('create')
      // Offer has no cooperationType column (dropped server-side, FU-326) — the
      // Model step can't be recovered, so this is a display-only best guess;
      // it doesn't gate any Details-step validation for network cooperations.
      guide.setCooperationModel('EDUCATIONAL')

      form.setValues({
        title: offer.title ?? '',
        description: offer.description ?? '',
        category: offer.category ?? (offer.categoryCode?.split('/')[0] ?? ''),
        subcategory: offer.subcategory ?? (offer.categoryCode?.includes('/') ? offer.categoryCode : ''),
        location: offer.location ?? '',
        images: offer.images ?? [],
        visibility: offer.visibility ?? 'PUBLIC',
        disputeMode: offer.disputeMode ?? 'PUBLIC',
      })
      form.updateExtension('networkType', offer.networkType ?? 'open')
      if (offer.membershipCriteria) form.updateExtension('membershipCriteria', offer.membershipCriteria)
      if (offer.maxMembers) form.updateExtension('maxMembers', String(offer.maxMembers))
      if (offer.companyId) form.updateExtension('companyId', offer.companyId)

      // ADR-365 D2/D3: category now belongs to the merged Model & Category
      // step, title/description to Details — resume at the first step that
      // still needs input.
      guide.goTo(!offer.categoryCode ? 'model' : 'details')
    } else {
      const coop = entity as Cooperation
      resumedStatusRef.current = coop.status ?? null
      const isTenderEntity = coop.cooperationType === 'TENDER'
      guide.setType(isTenderEntity ? 'tenders' : 'projects')
      // ADR-331 D5 + FU-511: recover the Corporate role either from the
      // cooperation's own companyId snapshot (human-only Corporate flow) or,
      // failing that, from the first assigned agent's AgentProfile.companyId
      // (the GET response surfaces this via CoopMilestone.assigneeAgentProfile,
      // see D5.1). TenderDrafts never reach an agent orchestrator (type='tenders'
      // + executor='agent' redirects to /bounties/new at submit, see ADR-328
      // D2; renamed from /tasks/new by ADR-336), so the assignee lookup below
      // isProjects-only in practice — but the type-narrowed access keeps it
      // safe regardless.
      const firstAssignedAgent = coop.milestones?.find(m => m.assigneeAgentProfileId)?.assigneeAgentProfile
      const resumedCompanyId = coop.companyId ?? firstAssignedAgent?.companyId ?? null
      guide.setRole(resumedCompanyId ? 'corporate' : 'private')
      if (resumedCompanyId) form.updateExtension('companyId', resumedCompanyId)
      guide.setAction('create')
      guide.setCooperationModel(coop.cooperationType ?? 'TRANSACTIONAL')

      // ADR-331 D2: restore the executor/agentSupervision framing on resume.
      // Either signal is enough to re-enter the agent flow: a draft saved
      // with executor='agent' + agentSupervision but NO matches yet
      // (isAgentOrchestration=false) still needs to come back as agent, so
      // the user can re-run Match-Preview. agentSupervision presence is the
      // broader signal; isAgentOrchestration is the narrower one (assignments
      // were saved). Both are write-once on the server, so reading them
      // back here is safe — no recompute helper needed (the API never
      // exposes reassignment).
      const isAgentFlow = coop.isAgentOrchestration || coop.agentSupervision != null
      if (isAgentFlow) {
        guide.setExecutor('agent')
        // Null is treated as 'human' (safest default for resumed drafts;
        // matches the responsibility-boundary copy in ADR-328 D1).
        guide.setAgentSupervision(coop.agentSupervision === 'autonomous' ? 'autonomous' : 'human')
      } else {
        guide.setExecutor('human')
        guide.setAgentSupervision('human')
      }

      form.setValues({
        title: coop.title ?? '',
        description: coop.description ?? '',
        category: coop.categoryCode?.split('/')[0] ?? '',
        subcategory: coop.categoryCode?.includes('/') ? coop.categoryCode : '',
        priceSats: coop.budgetSats ? String(coop.budgetSats) : '',
        visibility: coop.visibility ?? 'PUBLIC',
        disputeMode: coop.disputeMode ?? 'PUBLIC',
        // ADR-329 D6: hydrate Payment Structure from the stored draft. A
        // resumed SMART_ORDER draft must not re-show the MilestoneEditor; the
        // server (FU-498) will generate the 3 canonical phases on publish.
        ticketType: coop.ticketType ?? 'MILESTONE',
        images: toStringArray(coop.images),
      })
      form.updateExtension('cooperationType', coop.cooperationType ?? 'TRANSACTIONAL')
      toStringArray(coop.skills).forEach(s => form.addSkill(s))
      if (coop.timeline) {
        const [start, end] = coop.timeline.split(' – ')
        if (start) form.updateExtension('timelineStart', start)
        if (end) form.updateExtension('timelineEnd', end)
      }
      if (coop.deadline) form.updateExtension('deadline', coop.deadline.slice(0, 10))
      if (coop.requirements) form.updateExtension('requirements', coop.requirements)
      if (coop.milestones?.length) {
        // ADR-332 D2: unified nested mapper — milestones hydrate WITH their
        // pipeline steps. New rows read m.steps directly; legacy flat rows
        // (pre-ADR-332, ADR-328/331) synthesize a single step from the
        // milestone-level assignee/capabilities columns, preserving the old
        // resume behavior on old data. Human milestones keep steps undefined.
        form.setMilestones(coop.milestones.map(m => {
          const legacyCaps = Array.isArray(m.requiredCapabilities) ? m.requiredCapabilities : []
          const steps = Array.isArray(m.steps) && m.steps.length > 0
            ? m.steps.map(s => ({
              title: s.title,
              requiredCapabilities: Array.isArray(s.requiredCapabilities) ? s.requiredCapabilities : [],
              assigneeAgentProfileId: s.assigneeAgentProfileId ?? undefined,
              // ADR-352 D1a (FU-606): restore the specific offer on resume too.
              assigneeOfferId: s.assigneeOfferId ?? undefined,
            }))
            : (m.assigneeAgentProfileId || legacyCaps.length > 0)
              ? [{
                  title: m.title,
                  requiredCapabilities: legacyCaps,
                  assigneeAgentProfileId: m.assigneeAgentProfileId ?? undefined,
                }]
              : undefined
          return {
            title: m.title,
            description: m.description ?? '',
            percentage: coop.budgetSats > 0 ? Math.round((m.amountSats / coop.budgetSats) * 100) : 0,
            steps,
          }
        }))
      }

      // ADR-365 D2/D3: category belongs to the merged Model & Category step,
      // title/description to Details — resume at the first step still needing
      // input.
      guide.goTo(!coop.categoryCode ? 'model' : 'details')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide.editId, editQuery.data])

  // "Find" → unified Search page (coop context, matching type tab). Search merges
  // both contexts with full category/sort/KPI filtering, so the in-guide result
  // page is redundant (ADR-237). replace: true keeps the back button usable.
  // Excludes Tenders+agent — that combo has its own Bounty Board handoff
  // below, which must win outright rather than race this effect (both are
  // separate useEffects; whichever navigate() ran later in the same commit
  // would otherwise "win" the browser location non-deterministically).
  useEffect(() => {
    if (guide.action === 'find' && guide.role && guide.type && !(guide.type === 'tenders' && guide.executor === 'agent')) {
      navigate(`/search?context=coop&tab=${guide.type}`, { replace: true })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide.action, guide.role, guide.type, guide.executor])

  // FU-483 (ADR-328 D2): Tenders + agent hands off to the Bounty Board
  // immediately — the Guide's own Model/Classification/Details steps for
  // Tenders are skipped entirely, the Bounty Board's own simpler form
  // replaces them. Renamed from "Task Board" / /tasks* by ADR-336.
  useEffect(() => {
    if (guide.type !== 'tenders' || guide.executor !== 'agent' || !guide.role || !guide.action) return
    if (guide.action === 'create') {
      const qs = guide.agentSupervision !== 'human' ? `?agentSupervision=${guide.agentSupervision}` : ''
      navigate(`/bounties/new${qs}`, { replace: true })
    } else if (guide.action === 'find') {
      // ADR-368 D1: the board is the bounties tab of Cooperate Manage now.
      navigate('/coop/manage?tab=bounties', { replace: true })
    } else {
      navigate('/coop/manage?tab=bounties', { replace: true })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide.type, guide.executor, guide.role, guide.action, guide.agentSupervision])

  // ─── Step definitions ────────────────────────────────────────────────────────

  // Payment-structure parity + ADR-332 D2: Match-Preview only exists for the
  // agent pipeline — an agent MILESTONE flow with at least one authored step.
  // Agent Smart Order and an empty pipeline (all-human milestones) run the
  // plain path and skip the step, exactly like the People flow.
  const stepIds = useMemo(
    () => getGuideSteps(guide.action, guide.type, guide.executor, form.values.ticketType, form.hasPipelineSteps),
    [guide.action, guide.type, guide.executor, form.values.ticketType, form.hasPipelineSteps],
  )

  const steps: FormStep[] = useMemo(
    () => stepIds.map((id, index) => ({
      id: index,
      label: GUIDE_STEP_META[id].label,
      description: GUIDE_STEP_META[id].description,
    })),
    [stepIds],
  )

  const currentStep = Math.max(0, stepIds.indexOf(guide.currentStepId))

  // ─── Validation ──────────────────────────────────────────────────────────────
  // ADR-365 D2/D3: the old validateClassification was dissolved — category now
  // validates on the merged Model & Category step, title/description moved into
  // the Details step (Section 1) and validate with the rest of the Details.

  function validateModel(): boolean {
    const errs: Record<string, string> = {}
    if (!form.values.category) errs.category = 'Please select a root category'
    setErrors(prev => ({ ...prev, model: errs }))
    return Object.keys(errs).length === 0
  }

  function validateDetails(): boolean {
    const errs: Record<string, string> = {}
    // Title & description (Section 1, ADR-365 D3) — publish-gating for every
    // create flow, network included.
    if (!form.values.title.trim()) errs.title = 'Title is required'
    if (!richTextToPlainText(form.values.description).trim()) errs.description = 'Description is required'
    if (guide.type !== 'network') {
      const price = parseInt(form.values.priceSats)
      if (!price || price <= 0) errs.priceSats = 'Budget must be greater than 0'
    }
    if (guide.role === 'corporate' && !form.extensions.companyId && guide.type !== 'network') {
      errs.companyId = 'Please select a company'
    }
    // ADR-332 D2: nested pipeline validation — every AUTHORED step needs a
    // name + ≥1 capability (form.pipelineValid). Steps are optional per
    // milestone (human milestone = no steps), so an agent flow with an empty
    // pipeline is legal mixed state, not an error.
    if (guide.type === 'projects' && guide.executor === 'agent' && form.hasPipelineSteps && !form.pipelineValid) {
      errs.pipelineSteps = 'Every pipeline step needs a name and at least one required capability'
    }
    setErrors(prev => ({ ...prev, details: errs }))
    return Object.keys(errs).length === 0
  }

  // ─── FormStepper: onContinue ─────────────────────────────────────────────────

  function handleContinue(step: number): boolean | void {
    // Dispatch on the step argument FormStepper passes (always reflects its
    // current-step prop at call time) rather than guide.currentStepId, which
    // only commits on the next render and can be stale in nested handlers.
    const stepId = stepIds[step]
    // Guide step: validate all 3 selections made
    if (stepId === 'guide') {
      if (!guide.role || !guide.type || !guide.action) return false
      // ADR-365 D2: Tenders auto-select the model but NO LONGER skip the next
      // step — the merged Model & Category step still needs its category half.
      if (guide.action === 'create' && guide.type === 'tenders') {
        guide.setCooperationModel('TENDER')
        guide.goTo('model')
        return false  // prevent FormStepper default goNext
      }
      // Find redirects to the unified Search page (effect above) — never advance.
      if (guide.action === 'find') return false
      // Manage: advance to result view
      if (guide.action !== 'create') return true
      // Create: advance to Model & Category step
      return true
    }
    // Model & Category step: validate model + category selected
    if (stepId === 'model') {
      if (guide.action !== 'create') return false
      if (!guide.cooperationModel) return false
      return validateModel()
    }
    // Details step: validate fields, then either submit (human flow, agent Smart
    // Order, agent flow with no authored steps) or advance to Match-Preview
    // (FU-483/ADR-332, Projects+agent pipeline — see getGuideSteps).
    if (stepId === 'details') {
      if (!validateDetails()) return false
      if (guide.type === 'projects' && guide.executor === 'agent'
        && form.values.ticketType !== 'SMART_ORDER' && form.hasPipelineSteps) {
        guide.goTo('match-preview')
        return false
      }
      submitCooperation('OPEN')
      return false  // prevent FormStepper default navigation
    }
    // Match-Preview step (FU-483): submit — matching itself has no
    // required-selection gate, an unmatched step just ships unassigned.
    if (stepId === 'match-preview') {
      submitCooperation('OPEN')
      return false
    }
    // Result step (manage): block keyboard advance
    return false
  }

  // ─── Submit ──────────────────────────────────────────────────────────────────

  async function submitCooperation(status: string = 'OPEN') {
    const pubkey = localStorage.getItem('pubkey') ?? ''
    if (!pubkey || submitting) return
    if (status !== 'DRAFT') {
      if (!form.isValid || !pubkey) return
      if (!validateDetails()) return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const payload = form.buildPayload(pubkey)
      const type    = guide.type
      const action  = guide.action
      const isProject = type === 'projects' && action === 'create'
      const isTender  = type === 'tenders'  && action === 'create'
      const endpoint  = isProject || isTender ? '/api/cooperations' : '/api/offers'
      // /api/offers validates status against OfferStatus enum (DRAFT|ACTIVE|CLOSED|ARCHIVED);
      // 'OPEN' is only valid for the cooperation endpoint. Map accordingly.
      const apiStatus = endpoint === '/api/offers'
        ? (status === 'DRAFT' ? 'DRAFT' : 'ACTIVE')
        : status
      // PATCH /api/cooperations/:id reads `budgetSats` only (matches the Prisma
      // column name) — unlike POST /api/cooperations, which falls back to
      // `priceSats` too. form.buildPayload() always sends `priceSats`, so a
      // resumed-draft PATCH silently dropped an edited budget without this,
      // leaving the stale (often 0) DB value behind for the publish check below.
      // FU-515: the server snapshots `agentSupervision` write-once on POST
      // (ADR-331 D1) but the client never sent it — only the isAgentOrchestration
      // branch (a step assignee) reached it, so an agent flow with no matches
      // yet (executor='agent', no assignee) lost the supervision selection.
      const body = endpoint === '/api/cooperations'
        ? {
          ...payload,
          budgetSats: payload.priceSats,
          status: apiStatus,
          ...(guide.executor === 'agent' && { agentSupervision: guide.agentSupervision }),
        }
        : { ...payload, status: apiStatus }

      // ADR-296: resuming a DRAFT saves onto the original row (PATCH) instead of
      // creating a duplicate (POST). Publishing a Cooperation additionally needs
      // the dedicated status-transition endpoint — the generic content PATCH
      // never triggers the Nostr status-update broadcast that endpoint fires.
      // The content PATCH must NOT also set status in this case: it applies
      // status unconditionally with no transition check, so if it already flips
      // DRAFT→OPEN, the status endpoint's own transition map (which requires the
      // stored status to still be DRAFT) then 409s on what looks like OPEN→OPEN.
      const isEditing = Boolean(guide.editId)
      // ADR-386: editing an already-published entity keeps its status — only a
      // DRAFT resume runs the dedicated DRAFT→OPEN status transition.
      const resumedStatus = resumedStatusRef.current?.toUpperCase() ?? null
      const isPublishedResume = isEditing && resumedStatus != null && resumedStatus !== 'DRAFT'
      const willUseStatusEndpoint = isEditing && !isPublishedResume && endpoint === '/api/cooperations' && apiStatus !== 'DRAFT'
      const contentBody = (isPublishedResume || willUseStatusEndpoint) ? { ...body, status: undefined } : body
      let res = await apiCall(isEditing ? `${endpoint}/${guide.editId}` : endpoint, {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contentBody),
      })
      if (res.ok && willUseStatusEndpoint) {
        res = await apiCall(`/api/cooperations/${guide.editId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: apiStatus }),
        })
      }
      if (res.ok) {
        const data = await res.json()
        // ADR-301: invalidate the home slider's cooperations + offers caches so
        // the new entity shows up the moment the user navigates back to /, not
        // after the staleTime (30s) expires. Keys must match what Home.tsx +
        // useEntityQueries register for the "Collaborations" segment and the
        // public discover pool. ADR-363 D1: the offer pools now live under the
        // unified ['listings'] family.
        queryClient.invalidateQueries({ queryKey: ['cooperations-discover'] })
        queryClient.invalidateQueries({ queryKey: ['listings'] })
        // The Management list and the Coop-Detail page keep their own caches:
        // useCooperations reads ['cooperations', pubkey], useEntity reads
        // ['entity', id]. Without these, an already-visited detail page kept
        // rendering its pre-edit payload (e.g. a newly uploaded image never
        // showed up in the hero gallery) until the 30s poll caught up.
        queryClient.invalidateQueries({ queryKey: ['cooperations'] })
        if (isEditing) queryClient.invalidateQueries({ queryKey: ['entity', guide.editId] })
        // ADR-152 / Plan Phase 3.2: PUBLIC cooperations are signed + published
        // as an addressable Kind 30414 event. PRIVATE cooperations are sent as
        // a NIP-17 gift-wrapped DM (Kind 14) to the partner — never raw-published
        // to public relays (that would leak the proposal).
        const tmpl = data.nostrEventTemplate as NostrEventTemplate | undefined
        const coop = data.cooperation
        const isPrivateCoop = coop?.visibility === 'PRIVATE' || tmpl?.kind === 14
        if (status !== 'DRAFT' && isProject && coop) {
          if (isPrivateCoop && coop.partnerPubkey) {
            sendPrivateCooperationProposal({
              cooperationId: coop.id,
              type: 'proposal',
              initiatorPubkey: coop.initiatorPubkey,
              partnerPubkey: coop.partnerPubkey,
              title: coop.title,
              budgetSats: coop.budgetSats,
              timeline: coop.timeline || undefined,
              status: coop.status,
              cooperationType: coop.cooperationType || undefined,
              content: coop.description || undefined,
            }).catch(err => console.warn('[CoopGuide] PRIVATE coop DM failed:', err))
          } else if (!isPrivateCoop && tmpl) {
            signAndPublishFromTemplate(tmpl).catch(err =>
              console.warn('[CoopGuide] NIP-C signing failed:', err)
            )
          }
        }
        setSuccess(true)
        smoothScrollToTop()
      } else {
        const data = await res.json()
        setSubmitError(data.error || 'Failed to publish. Please try again.')
        smoothScrollToTop()
      }
    } catch (err) {
      const message = err instanceof ApiError && err.message
        ? err.message
        : 'Network error. Please check your connection and try again.'
      setSubmitError(message)
      smoothScrollToTop()
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Success Screen ──────────────────────────────────────────────────────────

  if (success) {
    return (
      <PageContainer size="wide" spacing="lg" className="px-3! md:px-6! pb-6! pt-0!">
        <Box sx={{ textAlign: 'center', py: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <CheckCircleOutlineIcon sx={{ fontSize: 56, color: 'success.main' }} />
          <Typography variant="h5" fontWeight={700}>
            Cooperation Published!
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400 }}>
            Your {guide.type} cooperation has been published to the network. Partners can now find and respond to it.
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, mt: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Button variant="outlined" onClick={guide.reset}>
              Create Another
            </Button>
            <Button variant="contained" onClick={() => navigate('/coop')}>
              Go to Dashboard
            </Button>
          </Box>
        </Box>
      </PageContainer>
    )
  }

  // ─── Footer visibility ───────────────────────────────────────────────────────
  // Result step (find/manage) has no Continue button
  // Guide step: hide Continue until all 3 selections are made

  const guideStepIncomplete = guide.currentStepId === 'guide' && (!guide.role || !guide.type || !guide.action)
  const hideFooter = guideStepIncomplete || guide.action === 'find' || (guide.action !== 'create' && guide.currentStepId === 'result')

  // ─── Continue label ──────────────────────────────────────────────────────────

  // FU-483: Projects+agent's final step is Match-Preview, not Details —
  // Details there just advances (see handleContinue). Payment-structure
  // parity: an agent Smart Order — or an agent flow with no authored steps —
  // has no Match-Preview step, so its Details IS the final (Publish) step,
  // same as People.
  const isFinalStep = guide.currentStepId === 'match-preview' ||
    (guide.currentStepId === 'details'
      && !(guide.type === 'projects' && guide.executor === 'agent'
        && form.values.ticketType !== 'SMART_ORDER' && form.hasPipelineSteps))
  const continueLabel = isFinalStep
    ? (submitting ? 'Publishing…' : 'Publish')
    : 'Continue'

  // Steps that render OptionCard grids — show the details toggle there
  const isCardStep = guide.currentStepId === 'guide' ||
    (guide.currentStepId === 'model' && guide.action === 'create')

  // ─── Step children ───────────────────────────────────────────────────────────

  const guideNode = (
    <GuideStepContent
      role={guide.role}
      type={guide.type}
      action={guide.action}
      executor={guide.executor}
      agentSupervision={guide.agentSupervision}
      onSelectRole={guide.setRole}
      onSelectType={guide.setType}
      onSelectAction={guide.setAction}
      onSelectExecutor={guide.setExecutor}
      onSelectAgentSupervision={guide.setAgentSupervision}
      compact={!showDetails}
    />
  )

  // ADR-365 D2: the Model step is now the merged "Model & Category" step —
  // cooperation-model cards + the standard-category classification stacked.
  const modelNode = guide.action !== 'create'
    ? (guide.action === 'manage'
        ? <CoopManageView role={guide.role ?? 'corporate'} coopType={guide.type ?? 'projects'} onCreateNew={guide.reset} />
        : null)
    : (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <ModelStepContent
          coopType={guide.type}
          cooperationModel={guide.cooperationModel}
          onSelect={guide.setCooperationModel}
          compact={!showDetails}
          executor={guide.executor}
          autoSelect={guide.currentStepId === 'model'}
        />
        <CoopCategorySection
          categories={data.categories}
          categoriesLoading={data.categoriesLoading}
          categorySlug={form.values.category}
          subcategorySlug={form.values.subcategory}
          onCategoryChange={slug => {
            form.setValues({ category: slug, subcategory: '' })
            setErrors(prev => ({ ...prev, model: {} }))
          }}
          onSubcategoryChange={slug => {
            form.setValues({ subcategory: slug })
            setErrors(prev => ({ ...prev, model: {} }))
          }}
          error={errors.model?.category}
        />
      </Box>
    )

  const detailsNode = (
    <DetailsStepContent
      form={form}
      role={guide.role}
      coopType={guide.type}
      companies={data.companies}
      templates={data.templates}
      errors={errors.details ?? {}}
      submitting={submitting}
      onClearErrors={() => setErrors(prev => ({ ...prev, details: {} }))}
      executor={guide.executor}
    />
  )

  // FU-483 (ADR-328 D2): Projects+agent only — see getGuideSteps.
  // isActive gate: FormStepper keeps hidden steps mounted — without it the
  // match mutation fires on every Details-step keystroke (ADR-332 fix).
  const matchPreviewNode = (
    <MatchPreviewStep form={form} isActive={guide.currentStepId === 'match-preview'} />
  )

  const manageViewNode = (
    guide.action === 'manage'
      ? <CoopManageView role={guide.role ?? 'corporate'} coopType={guide.type ?? 'projects'} onCreateNew={guide.reset} />
      : null
  )

  const stepNodes: Record<CoopGuideStepId, ReactNode> = {
    guide: guideNode,
    model: modelNode,
    details: detailsNode,
    'match-preview': matchPreviewNode,
    result: manageViewNode,
  }

  const children = stepIds.map(id => stepNodes[id])

  // PageHeader returns null on mobile (nav bar shows title) — always render it
  // so useSetMobileNavHeader runs, but skip the wrapper div on mobile so it
  // doesn't create an empty flex item + gap above the first content row.
  const pageHeaderNode = (
      <PageHeader
        icon={<Handshake size={18} />}
        title="Cooperation Guide"
        subtitle="Role, type, model — then publish to the network"
        onBack={guide.goBack}
      />
  )

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
      <PageContainer size="wide" spacing="lg" className="coop-guide-page px-3! md:px-6! pt-0! pb-6! md:!max-w-[960px]" ref={containerRef}>
      {isMobile ? pageHeaderNode : <div className="guide-animate">{pageHeaderNode}</div>}

      {/* Breadcrumb chips + Show details toggle — one row, space-between */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', mt: 1, mb: 0.5 }}>
        <BreadcrumbChips
          role={guide.role}
          type={guide.type}
          action={guide.action}
          cooperationModel={guide.cooperationModel}
          executor={guide.executor}
          agentSupervision={guide.agentSupervision}
          currentStepId={guide.currentStepId}
          steps={stepIds}
          onNavigate={guide.navigateBreadcrumb}
        />
        {isCardStep && (
          <Button
            size="small"
            onClick={() => setShowDetails(v => !v)}
            startIcon={showDetails ? <EyeOff size={15} /> : <Eye size={15} />}
            sx={{
              color: 'text.secondary',
              textTransform: 'none',
              fontSize: '0.8rem',
              fontWeight: 600,
              minWidth: 'auto',
              ml: 'auto',
            }}
          >
            {showDetails ? 'Hide details' : 'Show details'}
          </Button>
        )}
      </Box>

      {submitError && (
        <Alert severity="error" onClose={() => setSubmitError(null)} sx={{ mt: 2 }}>
          {submitError}
        </Alert>
      )}

      <Box>
        <FormStepper
          steps={steps}
          currentStep={currentStep}
          onStepChange={(index) => {
            const id = stepIds[index]
            if (id) guide.goTo(id)
          }}
          onContinue={handleContinue}
          onBack={guide.goBack}
          onLastStepComplete={() => submitCooperation('OPEN')}
          hideFooter={hideFooter}
          disabled={submitting}
          continueLabel={continueLabel}
          secondaryAction={guide.action === 'create' ? {
            label: 'Save Draft',
            onClick: () => submitCooperation('DRAFT'),
            // ADR-332 D2: an agent draft with authored steps must have every
            // step valid (name + ≥1 capability) before it's savable — an
            // invalid step would resume as a corrupted half-entry. An agent
            // draft with NO steps is now legal (all-human milestones, mixed
            // flow), so it only needs a title — same as every other draft.
            disabled: submitting
              || !form.values.title
              || (guide.type === 'projects' && guide.executor === 'agent'
                && form.hasPipelineSteps && !form.pipelineValid),
          } : undefined}
        >
          {children}
        </FormStepper>
      </Box>
    </PageContainer>
  )
}
