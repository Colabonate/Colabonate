// Form hook for cooperation creation (ADR-033)
// Wraps useOfferForm with cooperation-specific defaults and extensions

import { useState, useCallback, useMemo } from 'react'
import { useOfferForm, type OfferCreatePayload } from '../../../hooks/useOfferForm'
import type { MilestoneStepDraft } from '../../../components/offers/offerFormConstants'
import type { CoopRole, CoopType, CooperationType } from './coopGuideConstants'

// ADR-332 D2 (V2 nested pipeline): agent pipeline steps live ON the milestone
// they belong to (`MilestoneFormItem.steps: MilestoneStepDraft[]`) — one
// editor, one truth. The milestone stays the escrow/release unit; steps carry
// capabilities + per-step agent assignment. Replaces the former flat
// `extensions.orchestrationSteps` (ADR-328 D2 / FU-483) where one milestone
// == one pipeline step.
export type { MilestoneStepDraft }

export interface CoopExtensions {
  cooperationType: CooperationType
  partnerMode: 'WHOLE' | 'PER_MILESTONE'
  partnerPubkey: string
  requiredSkills: string[]
  timelineStart: string
  timelineEnd: string
  networkType: 'open' | 'closed'
  membershipCriteria: string
  maxMembers: string
  deadline: string
  requirements: string
  companyId: string
}

export interface CoopPayload extends Omit<OfferCreatePayload, 'offerType'> {
  // Widened beyond the marketplace OfferType union: network cooperations are
  // persisted as Offer records tagged with the dedicated OfferType.COOP value
  // (Prisma enum), which the marketplace-only frontend OfferType type doesn't model.
  offerType?: OfferCreatePayload['offerType'] | 'COOP'
  cooperationType?: CooperationType
  partnerMode?: 'WHOLE' | 'PER_MILESTONE'
  partnerPubkey?: string
  skills?: string[]
  timeline?: string
  networkType?: 'open' | 'closed'
  membershipCriteria?: string
  maxMembers?: number
  deadline?: string
  requirements?: string
  companyId?: string
}

interface UseCoopFormOptions {
  role: CoopRole
  coopType: CoopType
}

const today = () => new Date().toISOString().slice(0, 10)

const DEFAULT_EXTENSIONS: CoopExtensions = {
  cooperationType: 'TRANSACTIONAL',
  partnerMode: 'WHOLE',
  partnerPubkey: '',
  requiredSkills: [],
  timelineStart: today(),
  timelineEnd: '',
  networkType: 'open',
  membershipCriteria: '',
  maxMembers: '',
  deadline: '',
  requirements: '',
  companyId: '',
}

export function useCoopForm({ role, coopType }: UseCoopFormOptions) {
  const context = role === 'corporate' ? 'corporate' : 'private'
  const isNetwork = coopType === 'network'

  // ADR-078: category and subcategory are now slug-based
  // 'services' is the L1 slug, 'services/cooperation' is the L2 slug
  const offerForm = useOfferForm({
    offerType: 'SERVICE',
    context,
    initialValues: {
      category: 'services',
      subcategory: 'services/cooperation',
      ticketType: 'SMART_ORDER',
    },
  })

  const [extensions, setExtensions] = useState<CoopExtensions>(DEFAULT_EXTENSIONS)

  const updateExtension = useCallback(<K extends keyof CoopExtensions>(
    key: K,
    value: CoopExtensions[K],
  ) => {
    setExtensions(prev => ({ ...prev, [key]: value }))
  }, [])

  // Pairs the Payment Structure selector with the nested agent pipeline so
  // AI Agent flows behave the same as People (ADR-329 parity, ADR-332 D2).
  // Smart Order = 3 auto phases + pipeline steps stripped from every
  // milestone (they'd be orphaned by the fixed 25/50/25 structure — Smart
  // Order has no per-step capabilities); Milestone keeps them.
  const setPaymentStructure = useCallback((type: 'SMART_ORDER' | 'MILESTONE') => {
    if (type === 'SMART_ORDER') {
      offerForm.setValues({ ticketType: 'SMART_ORDER' })
      offerForm.setMilestones(prev => prev.map(m => (m.steps?.length ? { ...m, steps: [] } : m)))
    } else {
      offerForm.setValues({ ticketType: 'MILESTONE' })
    }
  }, [offerForm.setValues, offerForm.setMilestones])

  const addSkill = useCallback((skill: string) => {
    const trimmed = skill.trim()
    if (!trimmed) return
    setExtensions(prev => ({
      ...prev,
      requiredSkills: prev.requiredSkills.includes(trimmed)
        ? prev.requiredSkills
        : [...prev.requiredSkills, trimmed],
    }))
  }, [])

  const removeSkill = useCallback((skill: string) => {
    setExtensions(prev => ({
      ...prev,
      requiredSkills: prev.requiredSkills.filter(s => s !== skill),
    }))
  }, [])

  // ADR-332 D2: replace the pipeline of ONE milestone (the per-milestone
  // "Agent Pipeline" editor inside each milestone card). Milestones without
  // steps are legal — that's a human milestone inside an otherwise-agent
  // cooperation (mixed flow).
  const setMilestoneSteps = useCallback((milestoneIndex: number, steps: MilestoneStepDraft[]) => {
    offerForm.setMilestones(prev => prev.map((m, i) => (i === milestoneIndex ? { ...m, steps } : m)))
  }, [offerForm.setMilestones])

  // Match-Preview selection — patches one step's agent (+ its specific Offer,
  // ADR-352 D1a/FU-606: AgentProfile<->Offer is many-to-one) inside its milestone.
  const setStepAssignment = useCallback((milestoneIndex: number, stepIndex: number, agentProfileId: string, offerId: string) => {
    offerForm.setMilestones(prev => prev.map((m, mi) => {
      if (mi !== milestoneIndex || !m.steps) return m
      return {
        ...m,
        steps: m.steps.map((s, si) => (si === stepIndex ? { ...s, assigneeAgentProfileId: agentProfileId, assigneeOfferId: offerId } : s)),
      }
    }))
  }, [offerForm.setMilestones])

  // "Split evenly" — even percentage split across milestones, remainder on
  // the last (mirrors the old setOrchestrationSteps even-split arithmetic).
  const splitMilestonesEvenly = useCallback(() => {
    offerForm.setMilestones(prev => {
      if (prev.length === 0) return prev
      const evenPct = Math.floor(100 / prev.length)
      const remainder = 100 - evenPct * prev.length
      return prev.map((m, i) => ({ ...m, percentage: evenPct + (i === prev.length - 1 ? remainder : 0) }))
    })
  }, [offerForm.setMilestones])

  // ADR-332 D2: derived pipeline state over the nested steps — flat view in
  // global execution order (M1.s1, M1.s2, M2.s1, …) for Match-Preview and
  // the match endpoint, plus validity/emptiness predicates for the wizard.
  const flatSteps = useMemo(() => {
    const out: Array<{ milestoneIndex: number; stepIndex: number; step: MilestoneStepDraft }> = []
    offerForm.milestones.forEach((m, mi) => m.steps?.forEach((s, si) => out.push({ milestoneIndex: mi, stepIndex: si, step: s })))
    return out
  }, [offerForm.milestones])
  const hasPipelineSteps = flatSteps.length > 0
  const pipelineValid = useMemo(
    () => flatSteps.every(({ step }) => step.title.trim().length > 0 && step.requiredCapabilities.length > 0),
    [flatSteps],
  )

  const isCoopValid = useMemo(() => {
    const baseValid = offerForm.values.title.trim().length > 0
    if (isNetwork) return baseValid
    const priceValid = !isNaN(parseInt(offerForm.values.priceSats)) && parseInt(offerForm.values.priceSats) > 0
    // ADR-329 D1: Smart Order cooperations don't author milestones — the
    // server fallback generates the 3 canonical phases. The 100%-sum guard
    // only applies when the user picks Milestone.
    const structureValid = offerForm.values.ticketType === 'SMART_ORDER' || offerForm.milestoneValid
    return baseValid && priceValid && structureValid
  }, [offerForm.values, offerForm.milestoneValid, isNetwork])

  const buildCoopPayload = useCallback((pubkey: string): CoopPayload => {
    // ADR-078: categoryCode is the StandardCategory slug (subcategory slug takes precedence)
    const categoryCode = offerForm.values.subcategory || offerForm.values.category

    const base: CoopPayload = {
      title: offerForm.values.title,
      description: offerForm.values.description,
      priceSats: isNetwork ? 0 : parseInt(offerForm.values.priceSats) || 0,
      category: offerForm.values.category,
      categoryCode,
      subcategory: offerForm.values.subcategory || undefined,
      location: offerForm.values.location || undefined,
      // ADR-329: value flows from the Details-step selector; networks stay
      // hardcoded SMART_ORDER (they post to /api/offers, not /api/cooperations).
      ticketType: isNetwork ? 'SMART_ORDER' : (offerForm.values.ticketType ?? 'SMART_ORDER'),
      // Network cooperations are Offer records (Cooperation model has no
      // networkType/membershipCriteria/maxMembers columns) — tag them with the
      // dedicated OfferType.COOP so they're discoverable as cooperations, not
      // generic marketplace services. Projects/tenders post to
      // /api/cooperations, which never reads offerType (ADR-366 D3) — a
      // Cooperation is not an Offer, so no fake value is sent for them.
      offerType: isNetwork ? 'COOP' : undefined,
      creatorPubkey: pubkey,
      status: 'ACTIVE',
      images: offerForm.values.images.length > 0 ? offerForm.values.images : undefined,
      cooperationType: extensions.cooperationType,
      partnerMode: extensions.partnerMode,
      // ADR-152 / Plan Phase 3.1: trade visibility + dispute mode flow from the
      // base offer form (default PUBLIC). PRIVATE cooperations are DM-only.
      visibility: offerForm.values.visibility,
      disputeMode: offerForm.values.disputeMode,
    }

    if (!isNetwork && offerForm.values.ticketType === 'MILESTONE') {
      // ADR-332 D2: nested pipeline rides along — steps only exist on agent
      // flows; the plain offers/human flow maps to `steps: undefined` (the
      // spread skips empty arrays so the payload stays byte-identical to the
      // pre-nested shape for human milestones).
      base.milestones = offerForm.milestones.map((m, i) => ({
        ...m,
        sortOrder: i,
        steps: m.steps?.length
          ? m.steps.map(s => ({
            title: s.title,
            requiredCapabilities: s.requiredCapabilities,
            assigneeAgentProfileId: s.assigneeAgentProfileId,
            // ADR-352 D1a (FU-606): validated server-side against
            // assigneeAgentProfileId (must be the same agent's active offer).
            assigneeOfferId: s.assigneeOfferId,
          }))
          : undefined,
      }))
    } else if (!isNetwork && offerForm.values.ticketType === 'SMART_ORDER') {
      // ADR-329 D3: Smart Order cooperations carry the 3 canonical phases as
      // authored CoopMilestone rows. The server (apps/server/index.ts) also
      // generates them defensively when no milestones arrive, but the client
      // sends them here so the offer/coop payload shape stays uniform.
      base.milestones = [
        { title: 'Start', description: '', percentage: 25, sortOrder: 0 },
        { title: 'Progress', description: '', percentage: 50, sortOrder: 1 },
        { title: 'Completion', description: '', percentage: 25, sortOrder: 2 },
      ]
    }

    if (extensions.partnerPubkey) {
      base.partnerPubkey = extensions.partnerPubkey
    }

    if (coopType === 'projects') {
      if (extensions.requiredSkills.length > 0) base.skills = extensions.requiredSkills
      if (extensions.timelineStart && extensions.timelineEnd) {
        base.timeline = `${extensions.timelineStart} – ${extensions.timelineEnd}`
      }
    }

    if (isNetwork) {
      base.networkType = extensions.networkType
      if (extensions.membershipCriteria) base.membershipCriteria = extensions.membershipCriteria
      if (extensions.maxMembers) base.maxMembers = parseInt(extensions.maxMembers) || undefined
    }

    if (extensions.cooperationType === 'TENDER') {
      if (extensions.deadline) base.deadline = extensions.deadline
      if (extensions.requirements.trim()) base.requirements = extensions.requirements.trim()
    }

    if ((coopType === 'projects' || coopType === 'tenders') && extensions.companyId) {
      base.companyId = extensions.companyId
    }

    return base
  }, [offerForm.values, offerForm.milestones, extensions, coopType, isNetwork])

  const resetCoopForm = useCallback(() => {
    offerForm.reset()
    setExtensions(DEFAULT_EXTENSIONS)
  }, [offerForm.reset])

  return {
    // Base offer form
    values: offerForm.values,
    setValues: offerForm.setValues,
    milestones: offerForm.milestones,
    setMilestones: offerForm.setMilestones,
    milestoneValid: offerForm.milestoneValid,
    milestonePercentageSum: offerForm.milestonePercentageSum,

    // Cooperation extensions
    extensions,
    updateExtension,
    addSkill,
    removeSkill,
    setPaymentStructure,
    // ADR-332 D2: nested pipeline API (steps live on milestones)
    setMilestoneSteps,
    setStepAssignment,
    splitMilestonesEvenly,

    // Derived
    isNetwork,
    isValid: isCoopValid,
    context,
    // ADR-332 D2: pipeline predicates for the wizard (gates + Match-Preview)
    hasPipelineSteps,
    pipelineValid,

    // Actions
    buildPayload: buildCoopPayload,
    reset: resetCoopForm,
  }
}
