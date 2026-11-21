// State machine hook for the unified Cooperation Guide (ADR-033, ADR-330 D1/D4/D5)
// Manages: Guide (Role+Type+Action) -> Model -> Classification -> Details
// URL sync: ?role=X&type=Y&action=Z&model=M&step=S
// ?step= is the step source of truth; step transitions push a history entry
// while selection params keep replace (ADR-330 D5). Links without ?step=
// derive the step from the selection params (legacy back-compat).

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useSearchParams, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import {
  getGuideSteps,
  type CoopRole, type CoopType, type CoopAction, type CooperationType,
  type CoopGuideStepId,
  type CoopExecutor, type CoopAgentSupervision,
} from './coopGuideConstants'

export interface CoopGuideState {
  step: CoopGuideStepId
  role: CoopRole | null
  type: CoopType | null
  action: CoopAction | null
  cooperationModel: CooperationType | null
  // ADR-328 D1: orthogonal to role. 'human' (default, today's behavior) vs
  // 'agent' (CoopGuide routes to the agent-flavored Create/Find/Manage
  // surfaces per ADR-328 D2/D4). When 'agent', agentSupervision is set and
  // selects between 'human' (per-step approval) and 'autonomous' (agents
  // self-coordinate, ADR-328 D1).
  executor: CoopExecutor
  agentSupervision: CoopAgentSupervision
}

export interface UseCoopGuideReturn {
  currentStepId: CoopGuideStepId
  role: CoopRole | null
  type: CoopType | null
  action: CoopAction | null
  cooperationModel: CooperationType | null
  executor: CoopExecutor
  agentSupervision: CoopAgentSupervision
  templateId: string | null
  editId: string | null
  setRole: (r: CoopRole) => void
  setType: (t: CoopType) => void
  setAction: (a: CoopAction) => void
  setCooperationModel: (m: CooperationType) => void
  setExecutor: (e: CoopExecutor) => void
  setAgentSupervision: (s: CoopAgentSupervision) => void
  goTo: (step: CoopGuideStepId, opts?: { replace?: boolean }) => void
  goBack: () => void
  reset: () => void
  navigateBreadcrumb: (target: 'role' | 'type' | 'action' | 'model') => void
}

// Derive the guide state from URL params. ?step= wins when present and valid
// for the flow; otherwise the step is derived from the selections (legacy).
function parseSearchParams(params: URLSearchParams): CoopGuideState {
  const rawRole = params.get('role')
  const role: CoopRole | null = (rawRole === 'corporate' || rawRole === 'private') ? rawRole : rawRole === 'creator' ? 'corporate' : null
  const type = params.get('type') as CoopType | null
  const action = params.get('action') as CoopAction | null
  const modelParam = params.get('model') as CooperationType | null
  // ADR-328 D1: executor axis. Default 'human' (today's behavior, unchanged).
  const executor: CoopExecutor = params.get('executor') === 'agent' ? 'agent' : 'human'
  // ADR-328 D1: supervision axis. Only meaningful when executor==='agent';
  // default 'human' (per-step approval) — 'autonomous' is the explicit opt-in.
  const agentSupervision: CoopAgentSupervision = params.get('agentSupervision') === 'autonomous' ? 'autonomous' : 'human'

  // Incomplete or no params → Guide step (pre-select Creator)
  if (!role || !type || !action) {
    return { step: 'guide', role: 'corporate', type: null, action: null, cooperationModel: null, executor, agentSupervision }
  }

  // Tenders auto-select TENDER — the Model & Category step still renders for
  // tenders (it needs the category half); the model half shows one auto card.
  const cooperationModel = action === 'create' && type === 'tenders' ? 'TENDER' : modelParam

  // Legacy derivation (links without ?step=). ADR-365 D2: the Model step now
  // also owns Category Classification, so every create link lands on 'model'
  // regardless of whether a cooperation model was already chosen — the old
  // 'classification' step (and the model?classification split) no longer exist.
  let step: CoopGuideStepId
  if (action === 'create') step = 'model'
  else step = 'result'

  // ADR-365 D2 back-compat: ?step=classification deep links (pre-merge URLs,
  // bookmarks) resolve to 'model', where the category half now lives.
  const rawStep = params.get('step')
  const stepParam = (rawStep === 'classification' ? 'model' : rawStep) as CoopGuideStepId | null
  if (stepParam && getGuideSteps(action, type, executor).includes(stepParam)) {
    step = stepParam
  }

  return { step, role, type, action, cooperationModel, executor, agentSupervision }
}

export function useCoopGuide(): UseCoopGuideReturn {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const locationState = location.state as { templateId?: string; editId?: string } | null
  const templateId = locationState?.templateId ?? null
  // ADR-296: set when Manage's "Edit" on a DRAFT navigates here — CoopGuide uses
  // this to fetch and hydrate the existing draft instead of starting a blank form.
  //
  // Tracked in state (not read fresh from location.state on every render) for two
  // reasons: (1) Manage is itself the result-step child of this same /coop/guide
  // route, so clicking Edit there navigates within the SAME mounted component — no
  // remount — meaning a plain useState(() => location.state...) lazy initializer
  // would freeze on whatever location.state held at the very first mount (often
  // null, from before the click). (2) syncParams() below calls setSearchParams(
  // ..., { replace: true }), which clears location.state as a side effect — the
  // moment the hydration effect's first setRole/setType/setAction/setModel call
  // fires, location.state.editId would go back to undefined, well before
  // "Save Draft"/"Publish" (which need editId for the rest of the session) run.
  // So: adopt a fresh non-null editId whenever one appears, but never let a
  // later clearing of location.state revert what's already been captured.
  const [editId, setEditId] = useState<string | null>(null)
  useEffect(() => {
    if (locationState?.editId && locationState.editId !== editId) {
      setEditId(locationState.editId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationState?.editId])

  const initialState = useMemo(() => parseSearchParams(searchParams), [])

  const [state, setState] = useState<CoopGuideState>(initialState)

  // FU-640 (ADR-330 D5): browser-back/forward must walk the wizard. The
  // mount-only initialState left state.step stale on POP navigations — the URL
  // moved to ?step=model while the Details step kept rendering. Re-derive from
  // the router's searchParams whenever they change; returning `prev` on
  // equality keeps this a no-op for goTo/syncParams writes (they set state
  // first, then the URL). Derive from `searchParams` — NOT
  // window.location.search — because react-router commits location updates in
  // a deferred transition: an effect keyed on location.search can observe the
  // new router location while window.location still holds the previous write,
  // and a merge parsed from that stale URL nulls fresh selections (the
  // FU-640 tenders action-section collapse). Also normalizes the legacy
  // ?step=classification alias (ADR-365 D2) out of the address bar once.
  // FU-640 (ADR-330 D5): browser-back/forward must walk the wizard. The
  // mount-only initialState left state.step stale on POP navigations — the URL
  // moved to ?step=model while the Details step kept rendering. Re-derive ONLY
  // the step, and only on POP navigations, parsing window.location.search —
  // for a history pop the browser URL is already current when this effect
  // fires, while useSearchParams can lag one deferred commit behind (deriving
  // from it reverts a just-popped step). The POP gate keeps app-driven
  // PUSH/REPLACE writes out (goTo/syncParams set state before writing the
  // URL; a deferred-commit parse there would fight them or null a fresh
  // selection — the FU-640 tenders action-section collapse). POP never changes
  // selections in this wizard, so a step-only merge is sound. The initial load
  // is a POP too, so the legacy ?step=classification alias (ADR-365 D2) is
  // normalized out of deep links.
  const navigationType = useNavigationType()
  useEffect(() => {
    if (navigationType !== 'POP') return
    const raw = new URLSearchParams(window.location.search)
    const next = parseSearchParams(raw)
    setState(prev => (prev.step === next.step ? prev : { ...prev, step: next.step }))
    if (raw.get('step') === 'classification') {
      raw.set('step', 'model')
      setSearchParams(raw, { replace: true })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, navigationType])

  // Read the live URL rather than trusting react-router's `prev` from the
  // updater form: with rapid successive setSearchParams calls, the prev passed
  // to the updater is the last-rendered searchParams, not the latest committed
  // URL — so a second call in the same React commit can clobber a param the
  // first call just wrote. window.location.search is always current (history
  // mutations are synchronous), so this is race-free.
  const syncParams = useCallback((updates: Partial<Omit<CoopGuideState, 'step'>>) => {
    const next = new URLSearchParams(window.location.search)
    if ('role' in updates) {
      if (updates.role) next.set('role', updates.role)
      else next.delete('role')
    }
    if ('type' in updates) {
      if (updates.type) next.set('type', updates.type)
      else next.delete('type')
    }
    if ('action' in updates) {
      if (updates.action) next.set('action', updates.action)
      else next.delete('action')
    }
    if ('cooperationModel' in updates) {
      if (updates.cooperationModel) next.set('model', updates.cooperationModel)
      else next.delete('model')
    }
    // ADR-328 D1: executor/agentSupervision are first-class selection params
    // (replace semantics, like role/type/action/model). They survive browser-back
    // and round-trip a deep link unchanged. When the user re-picks the role we
    // also clear both via the setRole setter — keeping the same setRole semantics
    // avoided here (navigateBreadcrumb('role') owns the "change identity"
    // clearing per ADR-330 D4).
    if ('executor' in updates) {
      if (updates.executor && updates.executor !== 'human') next.set('executor', updates.executor)
      else next.delete('executor')
    }
    if ('agentSupervision' in updates) {
      if (updates.agentSupervision && updates.agentSupervision !== 'human') next.set('agentSupervision', updates.agentSupervision)
      else next.delete('agentSupervision')
    }
    setSearchParams(next, { replace: true })
  }, [setSearchParams])

  const setRole = useCallback((role: CoopRole) => {
    setState(prev => ({ ...prev, role }))
    syncParams({ role })
  }, [syncParams])

  const setType = useCallback((type: CoopType) => {
    // ADR-331 D7: switching to the Network type collapses executor to 'human'
    // because the Network+Agent wizard is not built yet (FU-485–487). Without
    // this guard, executor='agent' state survives past the disabled card and
    // silently flows into other state (breadcrumb chips, JSON snapshot, etc.)
    // while the rest of the flow ignores it. Pure state hygiene — no UI
    // change at the Guide step itself.
    const isNetwork = type === 'network'
    setState(prev => ({
      ...prev,
      type,
      ...(isNetwork ? { executor: 'human' as CoopExecutor, agentSupervision: 'human' as CoopAgentSupervision } : {}),
    }))
    syncParams({
      type,
      // Mirror the local-state collapse into the URL so deep links and the
      // sessionStorage draft snapshot stay in sync.
      ...(isNetwork ? { executor: 'human' as CoopExecutor, agentSupervision: 'human' as CoopAgentSupervision } : {}),
    })
  }, [syncParams])

  const setAction = useCallback((action: CoopAction) => {
    setState(prev => ({ ...prev, action }))
    syncParams({ action })
  }, [syncParams])

  const setCooperationModel = useCallback((cooperationModel: CooperationType) => {
    setState(prev => ({ ...prev, cooperationModel }))
    syncParams({ cooperationModel })
  }, [syncParams])

  // ADR-328 D1: picking the executor collapses agentSupervision to its default
  // ('human'). Re-picking People resets to the no-params baseline. We don't
  // touch role/type/action/model here — the user can still change Role later
  // without losing their executor pick (same as choosing Role before Executor
  // leaves Executor intact on the URL until the user re-picks Role).
  const setExecutor = useCallback((executor: CoopExecutor) => {
    const nextSupervision: CoopAgentSupervision = executor === 'agent' ? 'human' : 'human'
    setState(prev => ({ ...prev, executor, agentSupervision: nextSupervision }))
    syncParams({ executor, agentSupervision: nextSupervision })
  }, [syncParams])

  const setAgentSupervision = useCallback((agentSupervision: CoopAgentSupervision) => {
    setState(prev => ({ ...prev, agentSupervision }))
    syncParams({ agentSupervision })
  }, [syncParams])

  // Step transitions write ?step= and push a history entry (ADR-330 D5).
  // `replace` is for mount-time state synthesis (draft/template restore), never
  // for user-driven navigation. Reads window.location.search (current) rather
  // than the updater-form `prev` to avoid the same rapid-click clobber race
  // documented on syncParams.
  const goTo = useCallback((step: CoopGuideStepId, opts?: { replace?: boolean }) => {
    setState(prev => ({ ...prev, step }))
    const next = new URLSearchParams(window.location.search)
    next.set('step', step)
    setSearchParams(next, { replace: opts?.replace ?? false })
  }, [setSearchParams])

  // ADR-330 D4: back is pure view navigation — it changes the step and never
  // clears role/type/action/model. At the first step it exits to /coop and
  // clears the step param so a deep-linked back from the wizard doesn't leave
  // `?step=guide` lingering in the address bar.
  const goBack = useCallback(() => {
    const flow = getGuideSteps(state.action, state.type, state.executor)
    const idx = flow.indexOf(state.step)
    if (idx <= 0) {
      const next = new URLSearchParams(window.location.search)
      next.delete('step')
      setSearchParams(next, { replace: true })
      navigate('/coop')
      return
    }
    goTo(flow[idx - 1])
  }, [state.action, state.type, state.executor, state.step, goTo, navigate, setSearchParams])

  const reset = useCallback(() => {
    const initial: CoopGuideState = {
      step: 'guide',
      role: null,
      type: null,
      action: null,
      cooperationModel: null,
      executor: 'human',
      agentSupervision: 'human',
    }
    setState(initial)
    setSearchParams(new URLSearchParams(), { replace: true })
    // ADR-296: "Create Another" after publishing must start a genuinely blank
    // draft, not carry the just-finished draft's id into the new session.
    setEditId(null)
  }, [setSearchParams])

  // Breadcrumb chips are deliberate edit-jumps: they DO clear downstream
  // selections (unlike goBack, ADR-330 D4) and push a history entry.
  // ADR-328 D1: navigating back to Role resets the executor axis too — the
  // question "who does the work" is downstream of "whose identity cooperates"
  // and is no longer valid once the identity itself changes.
  const navigateBreadcrumb = useCallback((target: 'role' | 'type' | 'action' | 'model') => {
    const stepId: CoopGuideStepId = target === 'model' ? 'model' : 'guide'
    if (!getGuideSteps(state.action, state.type, state.executor).includes(stepId)) return
    setState(prev => {
      if (target === 'role') return { ...prev, step: stepId, executor: 'human', agentSupervision: 'human', type: null, action: null, cooperationModel: null }
      if (target === 'type') return { ...prev, step: stepId, action: null, cooperationModel: null }
      if (target === 'action') return { ...prev, step: stepId, cooperationModel: null }
      return { ...prev, step: stepId }
    })
    const next = new URLSearchParams(window.location.search)
    if (target === 'role') {
      next.delete('type')
      next.delete('action')
      next.delete('model')
      next.delete('executor')
      next.delete('agentSupervision')
    } else if (target === 'type') {
      next.delete('action')
      next.delete('model')
    } else if (target === 'action') {
      next.delete('model')
    }
    next.set('step', stepId)
    setSearchParams(next, { replace: false })
  }, [state.action, state.type, state.executor, setSearchParams])

  return {
    currentStepId: state.step,
    role: state.role,
    type: state.type,
    action: state.action,
    cooperationModel: state.cooperationModel,
    executor: state.executor,
    agentSupervision: state.agentSupervision,
    templateId,
    editId,
    setRole,
    setType,
    setAction,
    setCooperationModel,
    setExecutor,
    setAgentSupervision,
    goTo,
    goBack,
    reset,
    navigateBreadcrumb,
  }
}
