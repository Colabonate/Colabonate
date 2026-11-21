// ADR-309 (slimmed): Agent Creation Wizard. Standalone route (not threaded
// through useCoopGuide.ts — that hook's role/type/action/model state machine
// is cooperation-specific top to bottom; grafting an 'agent' role through it
// would mean a much larger refactor of a hook every existing Cooperation flow
// depends on). 3 steps instead of the ADR's 6 (Profile+Capabilities merged,
// Config+Pricing merged), reusing FormStepper + the same offer-creation
// primitives CreateOfferPage.tsx already uses (RichDescriptionEditor,
// MultiImageUploadInput, SatsAmountInput). Category picking is a flat
// Autocomplete over SERVICE-type level-2 StandardCategory rows rather than
// CreateOfferPage's full tree UI — category isn't the interesting dimension
// for an agent listing (capabilities are).
//
// Visual redesign (2026-08-24, matching the Post-a-Bounty page): hero intro
// card + FormSection-wrapped, explained field groups instead of a flat MUI
// vertical stack, plus a sticky right-column "live preview / how it works /
// tips" panel that stays step-aware across all 3 FormStepper steps. Composed
// AROUND FormStepper rather than inside it — FormStepper owns the whole
// single-column stepper widget (progress bar, dots, slide animation, footer
// buttons) and has no sidebar slot, so the two-column grid wraps it instead
// of modifying the shared component.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Collapse, FormControlLabel, IconButton,
  ListSubheader, MenuItem, Select, Switch, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import AddIcon from '@mui/icons-material/Add'
import PersonOutline from '@mui/icons-material/PersonOutline'
import BusinessOutlined from '@mui/icons-material/BusinessOutlined'
import {
  Bot, Sparkles, Zap, Layers, ShieldCheck, KeyRound, Rocket,
  UserCog, Package, Frame, Info,
} from 'lucide-react'
import { PageContainer, FormStepper } from '@ds/ui'
import type { FormStep } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { FormSection } from '../../components/FormSection'
import { RichDescriptionEditor } from '../../components/offers'
import { MultiImageUploadInput } from '../../components/offers/MultiImageUploadInput'
import { SatsAmountInput } from '../../components/currency/SatsAmountInput'
import { FiatHint } from '../../components/currency/FiatHint'
import { formatSats } from '../../lib/currency'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import {
  buildCanvasConfig, HOSTED_CANVAS_FEE_SATS, sealAgentConfig, unsealAgentConfig,
  validateAgentRuntimeConfig, toKnownProvider, DEFAULT_AGENT_MODEL,
} from '../../lib/agentConfig'
import {
  agentBaseToAssistantBaseUrl, assistantBaseUrlToAgentBase, catalogEntriesGrouped,
  getCatalogEntry, matchCatalogEntry, type LlmProviderCatalogEntry,
} from '../../lib/llmProviderCatalog'
import { fetchSealedAgentConfig } from '../../hooks/useWorkspaceQueries'
import type { AgentCanvasConfig, CanvasProbeStatus, CanvasProvider } from '../../lib/agentConfig'
import { getPrivkeyHex } from '../../lib/nostr'
import { apiCall } from '../../lib/api'
import { useQueryClient } from '@tanstack/react-query'
import { useCompany } from '../../hooks/useEntityQueries'
import type { StandardCategory } from '../../types/api'

type AgentContext = 'private' | 'corporate'

  // ADR-368 D1: the agent create/edit routes moved to /coop/agents* and the
  // stack lives at /coop/manage?tab=stack — both land back there.
  const AGENTS_LIST_PATH = '/coop/manage?tab=stack'
  const AGENT_STACK_PATH = '/coop/manage?tab=stack'

const STEPS: FormStep[] = [
  { id: 0, label: 'Profile', description: 'Name & capabilities' },
  { id: 1, label: 'Configuration', description: 'Credentials & pricing' },
  { id: 2, label: 'Publish', description: 'Listing details' },
]

const BILLING_MODELS = [
  { value: 'ONE_TIME', label: 'One-time', available: true },
  { value: 'PER_HOUR', label: 'Per hour', available: false },
  { value: 'PER_TOKEN', label: 'Per token', available: false },
  { value: 'SUBSCRIPTION', label: 'Subscription', available: false },
] as const

// ADR-396 D1 (FU-848): name/description are public (AgentProfile.tools);
// url + requiresApproval are sealed and injected as the canister allowlist.
interface ToolDraft {
  name: string
  description: string
  url: string
  requiresApproval: boolean
}

const EMPTY_TOOL: ToolDraft = { name: '', description: '', url: '', requiresApproval: true }

// Generic agent name ideas (Owner 2026-09-29) — one click fills the name
// field with the idea plus a random number suffix (e.g. "Code Helper 4821"),
// making duplicates unlikely without any existence check.
const AGENT_NAME_SUGGESTIONS = [
  'Research Assistant', 'Writing Assistant', 'Code Helper',
  'Data Analyst', 'Task Automator', 'Creative Partner',
]

function randomNameSuffix(): string {
  return String(1000 + Math.floor(Math.random() * 9000))
}

// Step-0 capability chip suggestions (Owner-approved extension 2026-09-29:
// the original 7 tags plus 12 complementary ones). 'orchestration' stays a
// separate reserved chip in the form, not a plain suggestion.
const CAPABILITY_SUGGESTIONS = [
  'writing', 'research', 'design', 'code-review', 'data-analysis', 'translation', 'summarization',
  'text-generation', 'brainstorming', 'fact-checking', 'web-search', 'transcription',
  'image-generation', 'code-generation', 'debugging', 'data-visualization', 'reporting',
  'email-drafting', 'scheduling',
]

// One-click tool presets (Owner decision 2026-09-29: ComfyUI, n8n, Research):
// name/description/HTTPS address prefilled — the seller only adjusts the
// specifics (URL host, approval). Placeholder hosts pass the HTTPS-prefix
// validation on purpose: adjusting them is the point of a template.
const AGENT_TOOL_TEMPLATES: ToolDraft[] = [
  { name: 'ComfyUI', description: 'Generate images through your self-hosted ComfyUI instance (prompt to image).', url: 'https://comfy.example.com', requiresApproval: false },
  { name: 'n8n', description: 'Trigger your n8n workflows and read their results during a booking.', url: 'https://n8n.example.com', requiresApproval: true },
  { name: 'Research', description: 'Live web research via the Tavily search API — current information beyond the model cutoff.', url: 'https://api.tavily.com/', requiresApproval: false },
]

// Field-keyed validation errors: every wizard validation message names the
// input it belongs to so the field can be highlighted and scrolled to.
type AgentFieldKey =
  | 'name' | 'capabilities'
  | 'model' | 'apiKey' | 'baseUrl' | 'priceSats' | 'estimatedWorkspaceHours' | 'canvasInstanceUrl'
  | 'title' | 'categoryCode'

// ── Right-column: step-aware live preview ──────────────────────────────

function AgentPreviewCard({
  step, name, capabilities, priceSats, title,
}: {
  step: number
  name: string
  capabilities: string[]
  priceSats: number | ''
  title: string
}) {
  const displayTitle = step >= 2 ? title : name
  const hasContent = displayTitle.trim() || capabilities.length > 0
  return (
    <div
      className="flex flex-col rounded-xl border overflow-hidden"
      style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
    >
      <div
        className="relative flex items-center justify-center shrink-0"
        style={{ height: 64, background: 'rgba(99,179,237,0.12)' }}
      >
        <Bot size={26} style={{ color: 'var(--color-primary-50)', opacity: 0.85 }} />
        {/* Canonical "Agent" badge identity (#9F7AEA + purple outline, Bot
            icon) — same values as the agent chip on BuyProductDetail.tsx and
            the Bot badges on marketplace-cards.tsx (AGENT_PURPLE). */}
        <span
          className="absolute top-2 right-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full leading-none"
          style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9F7AEA', border: '1px solid rgba(159,122,234,0.5)' }}
        >
          <Bot size={11} strokeWidth={2.5} />
          Agent
        </span>
      </div>
      <div className="flex flex-col gap-1.5 p-3.5">
        <h4
          className="text-[13px] font-semibold leading-snug"
          style={{ color: hasContent ? 'var(--theme-text)' : 'var(--theme-text-muted)' }}
        >
          {displayTitle.trim() || 'Your agent listing appears here'}
        </h4>
        {capabilities.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {capabilities.slice(0, 4).map(c => (
              <span
                key={c}
                className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-secondary)', border: '1px solid var(--theme-border)' }}
              >
                {c}
              </span>
            ))}
          </div>
        )}
        {step >= 1 && (
          <div className="flex items-center justify-between mt-1.5">
            <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded" style={{ background: 'rgba(99,179,237,0.10)', color: 'var(--color-primary-50)', fontWeight: 700 }}>
              <Zap size={11} />
              {priceSats ? formatSats(priceSats, { compact: false }) : '0'}
              {priceSats ? <FiatHint sats={priceSats} className="text-[0.9em] ml-[3px]" /> : null}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

const HOW_IT_WORKS = [
  { icon: UserCog, title: 'Profile', text: 'Give your agent a name and the capabilities it can offer — this is what buyers and bounty posters match against.' },
  { icon: KeyRound, title: 'Configuration', text: 'Connect an LLM provider and set a price. Credentials are sealed on your device — Colabonate never sees them.' },
  { icon: Rocket, title: 'Publish', text: 'Add a listing title, description and images, then publish — your agent becomes bookable immediately.' },
]

const STEP_TIPS: Record<number, string[]> = {
  0: [
    '3–5 capability tags is usually the sweet spot.',
    'The "orchestration" tag marks this agent as a router for other agents in a shared workspace.',
    'You can add tools later — they aren’t required to publish.',
  ],
  1: [
    'Requiring your approval keeps every booking human-reviewed before it starts.',
    'Workspace retention controls how long a completed workspace stays accessible.',
    'Bring your own capacity: hosted providers, aggregators like OpenRouter, or your own hardware behind an HTTPS endpoint (ADR-409).',
  ],
  2: [
    'A clear title and description help buyers pick the right agent for the job.',
    'Save as Draft if you want to finish the listing later — nothing is public until you publish.',
    'You can edit price, description and images anytime after publishing.',
  ],
}

export interface CreateAgentPageProps {
  /**
   * ADR-339 D4 edit mode: mount the same 3-step wizard for an existing
   * AgentProfile (prefilled from GET /api/agent-profiles/:id + its newest
   * AGENT_SETUP offer). Save becomes PATCH instead of POST; a blank API key
   * keeps the stored agentConfigSealed untouched.
   */
  editProfileId?: string
}

export function CreateAgentPage({ editProfileId }: CreateAgentPageProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const editMode = Boolean(editProfileId)
  const [currentStep, setCurrentStep] = useState(0)
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  // Per-field validation messages (AgentFieldKey) + refs so a failed check
  // can highlight the exact input and scroll/focus it into view.
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<AgentFieldKey, string>>>({})
  const fieldRefs = useRef<Partial<Record<AgentFieldKey, HTMLElement | null>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [editLoading, setEditLoading] = useState(editMode)
  const pageRef = usePageAnimation([
    { selector: '.agent-form-animate', from: { duration: 0.45, y: 18, stagger: 0.08 } },
  ])

  // Step 0 — Profile & Capabilities. In edit mode (ADR-339 D4) the profile
  // id is known up front, so every saveAgentProfile() call PATCHes.
  const [agentProfileId, setAgentProfileId] = useState<string | null>(editProfileId ?? null)
  const [agentProfileSaving, setAgentProfileSaving] = useState(false)
  const [agentProfileError, setAgentProfileError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [capabilityInput, setCapabilityInput] = useState('')
  const [tools, setTools] = useState<ToolDraft[]>([])

  // ADR-326 D10.3 (FU-492): Private/Corporate context, same axis as
  // CreateOfferPage.tsx. FU-496: a Sell tab in Corporate context can start
  // the wizard pre-selected via ?context=corporate instead of making the
  // user re-toggle it (create mode only — edit mode's prefill effect below
  // owns this from the loaded profile's companyId).
  const [contextTab, setContextTab] = useState<AgentContext>(() =>
    searchParams.get('context') === 'corporate' ? 'corporate' : 'private'
  )
  const myPubkey = localStorage.getItem('pubkey') ?? ''
  const { data: myCompany } = useCompany(myPubkey)

  // ADR-339 D4: the existing AGENT_SETUP offer being edited (null when the
  // profile has no listing yet — the wizard then falls back to POST on
  // save). Drives the prefill of step 2 and the Publish-step labels.
  const [editOfferId, setEditOfferId] = useState<string | null>(null)
  const [editOfferStatus, setEditOfferStatus] = useState<'ACTIVE' | 'DRAFT' | null>(null)

  // Step 1 — Configuration & Pricing
  // ADR-409 D1/D2: the UI selects a CATALOG entry; the sealed `provider`
  // stays the executor flavor derived from it (openai|anthropic|ollama —
  // canister KNOWN_LLM_PROVIDERS, FU-470).
  const [catalogId, setCatalogId] = useState('openai')
  const [customLabel, setCustomLabel] = useState('')
  const catalogEntry: LlmProviderCatalogEntry = getCatalogEntry(catalogId)
  const provider = catalogEntry.flavor
  const [apiKey, setApiKey] = useState('')
  // ADR-396 D1 (FU-847): the model and the server address now reach the
  // executing agent (sealed) instead of a hard-coded per-provider default.
  const [model, setModel] = useState(DEFAULT_AGENT_MODEL.openai)
  const [baseUrl, setBaseUrl] = useState(getCatalogEntry('openai').baseUrl ?? '')
  // Edit mode: the stored seal is recoverable on the device that created it
  // (sealed to this browser's key). 'recovered' = prefilled and re-sealable
  // without re-typing the key; 'locked' = sealed elsewhere, changes to the
  // runtime config need the API key again.
  const [storedApiKey, setStoredApiKey] = useState('')
  const [sealState, setSealState] = useState<'none' | 'recovered' | 'locked'>('none')
  // ADR-396 D2: the listing's public provider/model disclosure (agentConfigMeta.runtime).
  const [hasPublicRuntime, setHasPublicRuntime] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState('')
  // ADR-409 D5 (OD-1): in-wizard connection test — the typed key is used once
  // server-side (POST /api/ai/config/test), never stored; skippable.
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [testMessage, setTestMessage] = useState('')
  // ADR-409 D5: live model catalog from a successful test (fallback: catalog
  // suggestions, which drift by design).
  const [liveModels, setLiveModels] = useState<string[]>([])
  // ADR-409 D4 (OD-5): masked AI-Assistant config for the prefill chip.
  const [aiAssistantConfig, setAiAssistantConfig] = useState<{
    provider: string; baseUrl: string | null; model: string | null; hasApiKey: boolean
  } | null>(null)
  // ADR-409 D6 (Phase 3): expandable local-runtime guide.
  const [localGuideOpen, setLocalGuideOpen] = useState(false)
  const [requireHumanApproval, setRequireHumanApproval] = useState(true)
  const [humanInLoop, setHumanInLoop] = useState(false)
  const [billingModel, setBillingModel] = useState<'ONE_TIME' | 'PER_HOUR' | 'PER_TOKEN' | 'SUBSCRIPTION'>('ONE_TIME')
  const [priceSats, setPriceSats] = useState<number | ''>('')
  const [workspaceTTLDays, setWorkspaceTTLDays] = useState(7)
  // FU-376 (revised 2026-08-29): declared typical work duration — the basis
  // for the mandatory minimum funding a buyer pre-pays at workspace
  // initiation (declared hours + 30% buffer). No Foundation subsidy exists;
  // this number directly determines what the buyer must fund upfront.
  const [estimatedWorkspaceHours, setEstimatedWorkspaceHours] = useState<number | ''>(1)

  // ADR-342 D1/D2/D4a: collaboration canvas (optional). 'doop-local' points
  // at the seller's own doop instance (validated by an async server-side
  // health probe that gates publishing); 'doop-hosted' is the
  // Colabonate-operated instance (publishing unlocks with Phase B).
  const [canvasProvider, setCanvasProvider] = useState<CanvasProvider>('none')
  const [canvasInstanceUrl, setCanvasInstanceUrl] = useState('')
  const [canvasId, setCanvasId] = useState('')
  const [buyerCanEdit, setBuyerCanEdit] = useState(true)
  // ADR-370 D6 (Phase 2): opt-in — the seller's agent also works on the
  // ticket canvas (doop-hosted only). Default off (Owner decision 1).
  const [agentInCanvas, setAgentInCanvas] = useState(false)
  const [canvasProbeStatus, setCanvasProbeStatus] = useState<CanvasProbeStatus | null>(null)
  // ADR-342 Phase B follow-up: server-side capability flag (bridge env
  // configured?) — drives the "coming soon" copy instead of a hardcoded label.
  const [canvasHostedAvailable, setCanvasHostedAvailable] = useState(false)

  // Step 2 — Publish
  const [title, setTitle] = useState('')
  const [descriptionHtml, setDescriptionHtml] = useState('')
  const [categories, setCategories] = useState<StandardCategory[]>([])
  const [categoryCode, setCategoryCode] = useState<string | null>(null)
  const [images, setImages] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    apiCall('/api/standard-categories/tree/flat')
      .then(res => res.json())
      .then(data => {
        if (cancelled || !data.standardCategories) return
        const serviceLeafCategories = (data.standardCategories as StandardCategory[]).filter(
          c => c.offerType === 'SERVICE' && c.level === 2
        )
        setCategories(serviceLeafCategories)
        const fallback = serviceLeafCategories.find(c => c.slug === 'services/it-services') ?? serviceLeafCategories[0]
        if (fallback) setCategoryCode(fallback.slug)
      })
      .catch(err => console.error('Failed to load categories:', err))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    apiCall('/api/canvas/hosted-status')
      .then(res => res.json())
      .then(data => { if (!cancelled && typeof data?.available === 'boolean') setCanvasHostedAvailable(data.available) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  // ADR-409 D4: load the masked AI-Assistant config once (never carries a
  // key) for the "Use my AI Assistant connection" prefill chip.
  useEffect(() => {
    let cancelled = false
    apiCall('/api/ai/config')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data) return
        setAiAssistantConfig({
          provider: data.provider, baseUrl: data.baseUrl, model: data.model, hasApiKey: data.hasApiKey === true,
        })
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  // ADR-339 D4: edit-mode prefill — GET /api/agent-profiles/:id returns the
  // profile plus its newest AGENT_SETUP offer (sibling `offer`). The sealed
  // config (provider/API key/system prompt) is NOT recoverable by design —
  // a blank API key keeps the stored seal untouched on save.
  useEffect(() => {
    if (!editProfileId) return
    let cancelled = false
    apiCall(`/api/agent-profiles/${editProfileId}`)
      .then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Could not load agent')
        return res.json()
      })
      .then(data => {
        if (cancelled) return
        const p = data.agentProfile as {
          name: string; description: string | null; capabilities: string[];
          tools: unknown; requireHumanApproval: boolean; humanInLoop: boolean;
          companyId: string | null;
        }
        setName(p.name ?? '')
        setDescription(p.description ?? '')
        setCapabilities(Array.isArray(p.capabilities) ? p.capabilities : [])
        setTools(Array.isArray(p.tools)
          ? (p.tools as Array<Partial<ToolDraft>>).map(t => ({ ...EMPTY_TOOL, name: t.name ?? '', description: t.description ?? '' }))
          : [])
        setRequireHumanApproval(p.requireHumanApproval !== false)
        setHumanInLoop(Boolean(p.humanInLoop))
        setContextTab(p.companyId ? 'corporate' : 'private')
        const offer = data.offer as {
          id: string; status: string; title: string; description: string | null;
          priceSats: number; images: unknown; categoryCode: string;
          agentBillingModel: string | null; agentWorkspaceTTL: number | null;
          estimatedWorkspaceHours: number | null;
          agentConfigMeta?: { canvas?: AgentCanvasConfig; runtime?: { provider?: string; model?: string; providerLabel?: string; catalogId?: string } } | null
        } | null
        if (offer) {
          setEditOfferId(offer.id)
          // Public disclosure first; a recovered seal below overrides it.
          const runtime = offer.agentConfigMeta?.runtime
          if (runtime?.provider && runtime.model) {
            // ADR-409 D1: map the disclosed runtime back onto a catalog entry.
            const entry = matchCatalogEntry({ flavor: toKnownProvider(runtime.provider), catalogId: runtime.catalogId ?? null })
            setCatalogId(entry.id)
            if (runtime.providerLabel && entry.group === 'custom') setCustomLabel(runtime.providerLabel)
            setModel(runtime.model)
            setHasPublicRuntime(true)
          }
          // ADR-396 D4: the seal is only readable by its owner — recover it so
          // model/server/tools can be edited without re-entering the key. The
          // public runtime's providerLabel rides along: at this point the
          // catalog match above ran without a base URL and may have guessed
          // the wrong entry, so the recovered match re-applies the label for
          // custom entries (ADR-409 browser-verification finding).
          void recoverSealedConfig(offer.id, Array.isArray(p.tools) ? (p.tools as Array<Partial<ToolDraft>>) : [], offer.agentConfigMeta?.runtime?.catalogId ?? null, offer.agentConfigMeta?.runtime?.providerLabel ?? null)
          setEditOfferStatus(offer.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT')
          setTitle(offer.title ?? '')
          setDescriptionHtml(offer.description ?? '')
          setPriceSats(offer.priceSats)
          if (offer.categoryCode) setCategoryCode(offer.categoryCode)
          if (Array.isArray(offer.images)) setImages(offer.images.filter((i): i is string => typeof i === 'string'))
          if (offer.agentBillingModel === 'ONE_TIME' || offer.agentBillingModel === 'PER_HOUR'
            || offer.agentBillingModel === 'PER_TOKEN' || offer.agentBillingModel === 'SUBSCRIPTION') {
            setBillingModel(offer.agentBillingModel)
          }
          if (typeof offer.agentWorkspaceTTL === 'number' && offer.agentWorkspaceTTL > 0) {
            setWorkspaceTTLDays(Math.max(1, Math.round(offer.agentWorkspaceTTL / 86400)))
          }
          if (typeof offer.estimatedWorkspaceHours === 'number' && offer.estimatedWorkspaceHours > 0) {
            setEstimatedWorkspaceHours(offer.estimatedWorkspaceHours)
          }
          // ADR-342 D2: prefill the canvas section (incl. the server-managed
          // probe cache for the unreachable warning below).
          const canvas = offer.agentConfigMeta?.canvas
          if (canvas && canvas.provider && canvas.provider !== 'none') {
            setCanvasProvider(canvas.provider)
            setCanvasInstanceUrl(canvas.instanceUrl ?? '')
            setCanvasId(canvas.canvasId ?? '')
            setBuyerCanEdit(canvas.buyerAccess !== 'none')
            // ADR-370 D6: round-trip the opt-in flag (default off when absent).
            setAgentInCanvas(canvas.agentInCanvas === true)
            setCanvasProbeStatus(canvas.probeStatus ?? null)
          }
        }
        setCompletedSteps(prev => new Set(prev).add(0))
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load agent'))
      .finally(() => { if (!cancelled) setEditLoading(false) })
    return () => { cancelled = true }
  }, [editProfileId])

  async function recoverSealedConfig(offerId: string, publicTools: Array<Partial<ToolDraft>>, runtimeCatalogId: string | null, runtimeProviderLabel?: string | null) {
    try {
      const sealed = await fetchSealedAgentConfig(offerId)
      if (!sealed) { setSealState('none'); return }
      const secrets = await unsealAgentConfig(getPrivkeyHex(), sealed)
      const recoveredProvider = toKnownProvider(secrets.provider)
      // ADR-409 D1: match the sealed flavor + base URL back onto a catalog
      // entry (unknown hosts land on the matching custom entry).
      const entry = matchCatalogEntry({ flavor: recoveredProvider, baseUrl: secrets.baseUrl, catalogId: runtimeCatalogId })
      setCatalogId(entry.id)
      if (entry.group === 'custom' && runtimeProviderLabel?.trim()) setCustomLabel(runtimeProviderLabel.trim().slice(0, 60))
      setModel(secrets.model?.trim() || DEFAULT_AGENT_MODEL[recoveredProvider])
      setBaseUrl(secrets.baseUrl ?? '')
      setSystemPrompt(secrets.systemPrompt ?? '')
      setStoredApiKey(secrets.apiKey ?? '')
      const sealedTools = Array.isArray(secrets.tools) ? secrets.tools : []
      const names = new Set(publicTools.map(t => t.name ?? ''))
      setTools([
        ...publicTools.map(t => {
          const match = sealedTools.find(st => st.name === t.name)
          return { ...EMPTY_TOOL, name: t.name ?? '', description: t.description ?? '', url: match?.url ?? '', requiresApproval: match ? match.requiresApproval : true }
        }),
        ...sealedTools.filter(st => !names.has(st.name)).map(st => ({ ...EMPTY_TOOL, ...st, description: st.description ?? '' })),
      ])
      setSealState('recovered')
    } catch {
      // Sealed on another device/key — keep the stored seal untouched.
      setSealState('locked')
    }
  }

  // Re-seal whenever we hold a complete config: create mode, a recovered
  // seal, or a freshly typed key. Otherwise the stored seal stays as is.
  const resealing = !editMode || sealState === 'recovered' || apiKey.trim() !== ''
  const effectiveApiKey = apiKey.trim() || storedApiKey

  /** Public label for the runtime disclosure (ADR-409 D1/OD-6). */
  const runtimeProviderLabel = (catalogEntry.group === 'custom'
    ? (customLabel.trim() || catalogEntry.label)
    : catalogEntry.label).slice(0, 60)

  function handleCatalogChange(nextId: string) {
    const next = getCatalogEntry(nextId)
    setCatalogId(next.id)
    // Presets land in the (editable) server-address field; seller-entered
    // entries clear it. ADR-409 D2: presets are root-form.
    setBaseUrl(next.baseUrl ?? '')
    // Keep a custom model; swap a stock suggestion for the new entry's default.
    const isStockSuggestion = LLM_CATALOG_SUGGESTIONS.has(model) || liveModels.includes(model)
    if (!model.trim() || isStockSuggestion) {
      setModel(next.modelSuggestions[0] ?? DEFAULT_AGENT_MODEL[next.flavor])
    }
    if (next.group === 'custom' && !customLabel.trim()) setCustomLabel('')
    clearFieldError('baseUrl'); clearFieldError('model'); clearFieldError('apiKey')
    setTestState('idle'); setTestMessage(''); setLiveModels([])
  }

  /** Every catalog's stock model suggestion, for "swap defaults on provider change". */
  const LLM_CATALOG_SUGGESTIONS = useMemo(() => {
    const set = new Set<string>()
    for (const group of catalogEntriesGrouped()) for (const e of group.entries) for (const m of e.modelSuggestions) set.add(m)
    return set
  }, [])

  /** ADR-409 D4 (OD-5): prefill from the masked AI-Assistant connection. */
  function applyAssistantConfig() {
    if (!aiAssistantConfig) return
    if (aiAssistantConfig.provider === 'local') {
      // Ollama mode: only usable when the assistant's Ollama is public-HTTPS.
      const base = aiAssistantConfig.baseUrl ?? ''
      if (base.startsWith('https://')) {
        setCatalogId('ollama')
        setBaseUrl(assistantBaseUrlToAgentBase(base))
      }
      if (aiAssistantConfig.model) setModel(aiAssistantConfig.model)
    } else {
      const agentBase = assistantBaseUrlToAgentBase(aiAssistantConfig.baseUrl ?? '')
      const entry = agentBase
        ? matchCatalogEntry({ flavor: 'openai', baseUrl: agentBase })
        : getCatalogEntry('openai')
      setCatalogId(entry.id)
      setBaseUrl(entry.baseUrl ?? agentBase)
      if (entry.group === 'custom') setCustomLabel('AI Assistant provider')
      if (aiAssistantConfig.model) setModel(aiAssistantConfig.model)
    }
    clearFieldError('baseUrl'); clearFieldError('model')
    setTestState('idle'); setTestMessage(''); setLiveModels([])
  }

  /**
   * ADR-409 D5 (OD-1): one-shot server-side connection test. The typed key is
   * used once by POST /api/ai/config/test and never stored (FU-195-C); the
   * test is optional (self-custody opt-out). On success the live model list
   * replaces the (by-design stale) catalog suggestions.
   */
  async function runConnectionTest() {
    if (!baseUrl.trim() || !effectiveApiKey.trim()) {
      setTestState('fail')
      setTestMessage('Enter the server address and API key first.')
      return
    }
    setTestState('testing')
    setTestMessage('')
    try {
      const res = await apiCall('/api/ai/config/test', {
        method: 'POST',
        body: JSON.stringify({
          // The test endpoint appends /chat/completions itself → assistant
          // convention ({root}/v1).
          baseUrl: agentBaseToAssistantBaseUrl(baseUrl.trim()),
          apiKey: effectiveApiKey.trim(),
          model: model.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => null)
      if (data?.ok) {
        setTestState('ok')
        const models: string[] = Array.isArray(data.models) ? data.models : []
        setLiveModels(models)
        setTestMessage(models.length > 0 ? `Connection OK — ${models.length} models found.` : 'Connection OK.')
      } else {
        setTestState('fail')
        setLiveModels([])
        setTestMessage(data?.error ?? 'Connection failed.')
      }
    } catch {
      setTestState('fail')
      setLiveModels([])
      setTestMessage('Connection failed — network error.')
    }
  }

  const availableCapabilitySuggestions = useMemo(
    () => CAPABILITY_SUGGESTIONS.filter(c => !capabilities.includes(c)),
    [capabilities],
  )

  function clearFieldError(key: AgentFieldKey) {
    setFieldErrors(prev => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  /** Failed-validation helper: global alert + inline highlight + scroll/focus. */
  function failField(key: AgentFieldKey, message: string): false {
    setError(message)
    setFieldErrors(prev => ({ ...prev, [key]: message }))
    const el = fieldRefs.current[key]
    if (el) {
      window.setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.focus({ preventScroll: true })
      }, 80)
    }
    return false
  }

  // A pasted doop canvas link (e.g. https://doop.design/c/8GCysVaxlE) is a
  // page URL, not the instance root the server's health probe needs
  // (GET {instanceUrl}/healthz) — split it into origin + canvas id so the
  // probe hits the real API instead of the SPA's catch-all HTML fallback.
  function handleCanvasInstanceUrlChange(value: string) {
    const match = value.trim().match(/^(https?:\/\/[^/]+)\/c\/([^/?#]+)\/?$/)
    if (match) {
      setCanvasInstanceUrl(match[1])
      if (!canvasId.trim()) setCanvasId(match[2])
    } else {
      setCanvasInstanceUrl(value)
    }
  }

  function addCapability(value?: string) {
    const trimmed = (value ?? capabilityInput).trim()
    if (trimmed && !capabilities.includes(trimmed)) {
      setCapabilities(prev => [...prev, trimmed])
      clearFieldError('capabilities')
    }
    setCapabilityInput('')
  }

  // Fire-and-forget: FormStepper's onContinue is synchronous (it does not
  // await the return value), so the create/update call runs in the
  // background while the wizard optimistically advances to step 1. Step 1's
  // onContinue blocks on agentProfileSaving/agentProfileError instead.
  function saveAgentProfile() {
    setAgentProfileSaving(true)
    setAgentProfileError(null)
    const body = {
      name: name.trim(), description: description.trim() || undefined,
      // ADR-396 D1: tool addresses are sealed — the public profile only
      // carries name + description.
      capabilities,
      tools: tools.filter(t => t.name.trim()).map(t => ({ name: t.name.trim(), description: t.description.trim() })),
      requireHumanApproval, humanInLoop,
      // ADR-326 D10.3 (FU-492): Corporate context sends the caller's own
      // company id (server validates ownership regardless); Private clears
      // it back to null.
      companyId: contextTab === 'corporate' && myCompany ? myCompany.id : null,
    }
    apiCall(
      agentProfileId ? `/api/agent-profiles/${agentProfileId}` : '/api/agent-profiles',
      { method: agentProfileId ? 'PATCH' : 'POST', body: JSON.stringify(body) }
    )
      .then(async res => {
        if (!res.ok) throw new Error((await res.json()).message || 'Could not save agent profile')
        const data = await res.json()
        setAgentProfileId(data.agentProfile.id)
        setCompletedSteps(prev => new Set(prev).add(0))
      })
      .catch(e => setAgentProfileError(e instanceof Error ? e.message : 'Could not save agent profile'))
      .finally(() => setAgentProfileSaving(false))
  }

  function handleContinue(step: number): boolean {
    setError(null)
    setFieldErrors({})
    if (step === 0) {
      if (!name.trim()) return failField('name', 'Please give your agent a name.')
      if (capabilities.length === 0) return failField('capabilities', 'Add at least one capability.')
      saveAgentProfile()
      return true
    }
    if (step === 1) {
      if (agentProfileSaving) { setError('Still saving your profile — try Next again in a moment.'); return false }
      if (!agentProfileId) { setError(agentProfileError ?? 'Could not save agent profile — go back and try again.'); return false }
      // ADR-339 D4: in edit mode a blank API key means "keep the stored
      // sealed credentials" — only create mode demands a fresh key.
      // ADR-396 D1: validate everything the workspace would reject after a
      // booking (missing server, non-HTTPS addresses, tools without an
      // address) — whenever the config gets (re)sealed.
      if (resealing) {
        // ADR-409 D2: seller-entered entries (local runtimes + custom) always
        // need the server address; preset entries arrive with it prefilled.
        if (!catalogEntry.baseUrl && !baseUrl.trim()) {
          return failField('baseUrl', 'Enter the public HTTPS address of your server.')
        }
        const runtimeError = validateAgentRuntimeConfig({ provider, apiKey: effectiveApiKey, model, baseUrl, tools })
        if (runtimeError) {
          // Tool rows live on the (then hidden) Profile step — alert only.
          if (runtimeError.field === 'tools') { setError(runtimeError.message); return false }
          return failField(runtimeError.field, runtimeError.message)
        }
      }
      if (!priceSats || priceSats <= 0) return failField('priceSats', 'Set a price in sats.')
      if (!estimatedWorkspaceHours || estimatedWorkspaceHours <= 0) return failField('estimatedWorkspaceHours', 'Set the estimated typical duration in hours — it determines the buyer\'s mandatory initial funding.')
      // ADR-342 D2: doop-local needs an instance URL before it can be saved.
      if (canvasProvider === 'doop-local' && !canvasInstanceUrl.trim()) {
        return failField('canvasInstanceUrl', 'Enter the URL of your doop instance (or set the canvas to "No canvas").')
      }
      // requireHumanApproval/humanInLoop are set on this step, after the
      // step-0 saveAgentProfile() already ran with their default values —
      // re-save (PATCH, agentProfileId is already set) so the toggles the
      // user just set actually persist.
      saveAgentProfile()
      setCompletedSteps(prev => new Set(prev).add(1))
      return true
    }
    return true
  }

  // ADR-339 D4: one save path for create + edit. Create = POST /api/offers;
  // edit = PATCH /api/offers/:editOfferId when the profile already has an
  // AGENT_SETUP offer (POST otherwise — a profile can exist without a
  // listing). A blank API key in edit mode sends NO agentConfigSealed, so
  // the server keeps the stored seal (ADR-306's ACTIVE gate stays intact).
  async function save(status: 'DRAFT' | 'ACTIVE') {
    setError(null)
    setFieldErrors({})
    if (!agentProfileId) { setError('Complete the Profile step first.'); return }
    if (!title.trim()) { failField('title', 'Please give your listing a title.'); return }
    if (!categoryCode) { failField('categoryCode', 'Please select a category.'); return }
    // The canvas URL input lives on the (hidden) Configuration step — the
    // safety re-check stays a global alert, no field scroll possible here.
    if (canvasProvider === 'doop-local' && !canvasInstanceUrl.trim()) {
      setError('Enter the URL of your doop instance (or set the canvas to "No canvas").')
      return
    }

    setSubmitting(true)
    try {
      // ADR-342 D1 + ADR-370 D6 (Phase 2): the canvas choice is a declarative
      // agentConfigMeta property; agentInCanvas rides along on hosted configs
      // (builder ignores it for local/none).
      const canvas = buildCanvasConfig({
        provider: canvasProvider,
        instanceUrl: canvasInstanceUrl,
        canvasId,
        buyerAccess: buyerCanEdit ? 'edit' : 'none',
        agentInCanvas,
      })
      const body: Record<string, unknown> = {
        title: title.trim(),
        description: descriptionHtml,
        priceSats,
        categoryCode,
        images: images.length > 0 ? images : undefined,
        agentConfigMeta: {
          capabilities,
          ...(canvas ? { canvas } : {}),
          // ADR-396 D2: buyers see which provider/model runs the agent.
          // ADR-409 D1/OD-6: + a human-readable label (and the catalog id for
          // round-tripping) — never the base URL or key. Only sent when it is
          // actually known (fresh/recovered seal or already public).
          ...(resealing || hasPublicRuntime ? {
            runtime: {
              provider,
              model: model.trim(),
              providerLabel: runtimeProviderLabel,
              ...(catalogEntry.group !== 'custom' ? { catalogId: catalogEntry.id } : {}),
            },
          } : {}),
        },
        agentBillingModel: billingModel,
        agentWorkspaceTTL: workspaceTTLDays * 86400,
        estimatedWorkspaceHours: estimatedWorkspaceHours === '' ? undefined : estimatedWorkspaceHours,
        status,
      }
      if (resealing) {
        const privkeyHex = getPrivkeyHex()
        body.agentConfigSealed = await sealAgentConfig(privkeyHex, {
          provider,
          apiKey: effectiveApiKey || undefined,
          model: model.trim(),
          baseUrl: baseUrl.trim() || undefined,
          systemPrompt: systemPrompt.trim() || undefined,
          tools: tools
            .filter(t => t.name.trim() && t.url.trim())
            .map(t => ({ name: t.name.trim(), description: t.description.trim() || undefined, url: t.url.trim(), requiresApproval: t.requiresApproval })),
        })
      }

      // Reuse the offer created by an earlier save in THIS session (edit mode,
      // or a prior create-mode attempt that already POSTed) — not just
      // editMode. Without this, retrying a failed doop-local publish (probe
      // 'unreachable'/timeout throws below, before navigate() ever runs)
      // POSTs a brand new Offer every time instead of updating the draft it
      // already created, leaving orphaned duplicates behind.
      const editingExistingOffer = Boolean(editOfferId)
      const url = editingExistingOffer ? `/api/offers/${editOfferId}` : '/api/offers'
      const method = editingExistingOffer ? 'PATCH' : 'POST'
      const payload = editingExistingOffer
        ? body
        : { ...body, offerType: 'AGENT_SETUP', agentProfileId }

      if (status === 'ACTIVE' && canvas?.provider === 'doop-local') {
        // ADR-342 D2 (P1): the health probe is async, so a doop-local publish
        // is two-phase — save DRAFT (enqueues the probe), poll for the probe
        // result, then flip to ACTIVE (the server gate re-checks anyway).
        await saveDraftThenPublish(url, method, payload)
      } else {
        const res = await apiCall(url, { method, body: JSON.stringify(payload) })
        if (!res.ok) await throwSaveError(res)
        if (!editingExistingOffer) {
          const data = await res.json().catch(() => null)
          if (data?.offer?.id) setEditOfferId(data.offer.id)
        }
      }
      queryClient.invalidateQueries({ queryKey: ['agent-roster'] })
      navigate(editMode ? AGENT_STACK_PATH : AGENTS_LIST_PATH)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save agent offer')
    } finally {
      setSubmitting(false)
    }
  }

  // PAYMENTS.md contract: branch on the stable `code`, fall back to the
  // human-readable `error`/`message`.
  async function throwSaveError(res: Response): Promise<never> {
    const data = await res.json().catch(() => ({}))
    if (data.code === 'CANVAS_UNREACHABLE') {
      throw new Error('The canvas instance could not be reached — check the instance URL, make sure the instance is running, and try again.')
    }
    if (data.code === 'CANVAS_HOSTED_UNAVAILABLE') {
      throw new Error('The Colabonate-hosted canvas is not available yet — save as a draft; publishing unlocks when it launches.')
    }
    throw new Error(data.message || data.error || 'Could not save agent offer')
  }

  /** ADR-342 D2: draft → wait for the async probe → publish. */
  async function saveDraftThenPublish(url: string, method: 'POST' | 'PATCH', payload: Record<string, unknown>) {
    const draftRes = await apiCall(url, { method, body: JSON.stringify({ ...payload, status: 'DRAFT' }) })
    if (!draftRes.ok) await throwSaveError(draftRes)
    const draftBody = await draftRes.json()
    const offerId = (method === 'PATCH' ? editOfferId : draftBody?.offer?.id) as string | undefined
    if (!offerId) throw new Error('Could not save agent offer')
    // Remember the draft this session created — if the probe below reports
    // 'unreachable'/times out and this function throws, a retry must PATCH
    // this same draft instead of POSTing a new orphaned one.
    if (method === 'POST') setEditOfferId(offerId)

    // GET /api/offers/:id is cached (300s), so the probe flip is read via the
    // uncached, owner-scoped agent-profile endpoint instead.
    const deadline = Date.now() + 10_000
    let probe: CanvasProbeStatus | undefined
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1_000))
      const res = await apiCall(`/api/agent-profiles/${agentProfileId}`)
      if (!res.ok) continue
      const data = await res.json()
      probe = data?.offer?.agentConfigMeta?.canvas?.probeStatus
      if (probe === 'ok' || probe === 'unreachable') break
    }
    if (probe !== 'ok') {
      throw new Error(probe === 'unreachable'
        ? 'The canvas instance could not be reached — your listing was saved as a draft. Check the instance URL and publish again.'
        : 'The canvas health check did not finish in time — your listing was saved as a draft. Try publishing again in a moment.')
    }
    const pubRes = await apiCall(`/api/offers/${offerId}`, { method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }) })
    if (!pubRes.ok) await throwSaveError(pubRes)
  }

  // ADR-339 D4: Publish-step labels adapt to the current offer state —
  // Save & keep online / publish / take offline, mirroring D3's semantics.
  const lastStep = currentStep === STEPS.length - 1
  const primaryLabel = editMode
    ? (editOfferStatus === 'ACTIVE' ? 'Save Changes' : 'Publish Agent')
    : 'Publish Agent'
  const secondaryAction = lastStep
    ? editMode && editOfferStatus === 'ACTIVE'
      ? { label: 'Take Offline', onClick: () => save('DRAFT'), disabled: submitting || !title.trim() }
      : { label: 'Save Draft', onClick: () => save('DRAFT'), disabled: submitting || !title.trim() }
    : undefined

  if (editLoading) {
    return (
      <PageContainer size="wide" spacing="lg">
        <div className="flex items-center justify-center py-16">
          <CircularProgress size={28} />
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer size="wide" spacing="lg" className="px-0.5! md:px-6! py-6!" ref={pageRef}>
      <div className="agent-form-animate">
        <PageHeader
          icon={<Bot size={18} />}
          title={editMode ? 'Edit Agent' : 'Offer an Agent'}
          subtitle={editMode ? 'Update your agent setup — profile, credentials and listing' : 'Set up an AI agent as a bookable listing'}
          onBack={() => navigate(editMode ? AGENT_STACK_PATH : AGENTS_LIST_PATH)}
          backLabel="Back"
        />
      </div>

      {/* Minimal intro line — plain text with an info icon, no card chrome
          (Owner 2026-09-29: the former hero card's background/border/shadow
          felt misplaced for a one-line hint). */}
      <div className="agent-form-animate flex items-start gap-2 mt-1 mb-4">
        <Info size={14} className="mt-[3px] shrink-0" style={{ color: 'var(--color-primary-50)' }} />
        <p className="text-[12.5px] leading-relaxed max-w-[75ch]" style={{ color: 'var(--theme-text-muted)' }}>
          {editMode ? (
            <>Review each step and save. Leaving the API key blank keeps your stored credentials untouched — re-entering them re-seals on this device. Price, description and images can be changed anytime.</>
          ) : (
            <><span className="font-semibold" style={{ color: 'var(--theme-text)' }}>Three steps:</span> describe what your agent can do, connect an LLM provider and set a price, then publish it as a bookable listing. Buyers can book it directly, or apply with it to open bounties.</>
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 items-start">
        {/* ── Left: the wizard (FormStepper owns its own single-column layout) ── */}
        <div className="min-w-0">
          <FormStepper
            steps={STEPS}
            currentStep={currentStep}
            onStepChange={setCurrentStep}
            onContinue={handleContinue}
            onLastStepComplete={() => save('ACTIVE')}
            continueLabel={lastStep ? primaryLabel : 'Next'}
            completedSteps={Array.from(completedSteps)}
            secondaryAction={secondaryAction}
            disabled={submitting}
          >
            {[
              // Step 0 — Profile & Capabilities
              <div key="profile" className="flex flex-col gap-5">
                {error && <Alert severity="error">{error}</Alert>}

                {/* ADR-326 D10.3 (FU-492): same Private/Corporate axis as
                    CreateOfferPage.tsx, minus the agent-irrelevant Catalog
                    dropdown — companyId is a property of the AgentProfile
                    itself, not per-listing (see D10.4 derivation on the
                    Offer side). */}
                <FormSection icon={<BusinessOutlined sx={{ fontSize: 16 }} />} title="Context" description="Offer this agent as yourself, or under your company's brand." animateClassName="">
                  <ToggleButtonGroup
                    value={contextTab}
                    exclusive
                    onChange={(_, value) => { if (value) setContextTab(value) }}
                    size="small"
                    fullWidth
                  >
                    <ToggleButton value="private" sx={{ gap: 1, textTransform: 'none' }}>
                      <PersonOutline sx={{ fontSize: 18 }} /> Private
                    </ToggleButton>
                    <ToggleButton value="corporate" sx={{ gap: 1, textTransform: 'none' }}>
                      <BusinessOutlined sx={{ fontSize: 18 }} /> Corporate
                    </ToggleButton>
                  </ToggleButtonGroup>
                  {contextTab === 'corporate' && !myCompany && (
                    <Alert severity="info">
                      You don't have a company set up yet — this agent will stay private until you{' '}
                      <a href="/sell/company/setup" style={{ color: 'inherit', fontWeight: 600 }}>set one up</a>.
                    </Alert>
                  )}
                  {/* ADR-326 D10.3: make the Corporate binding visible — the
                      company below is the one saveAgentProfile() sends as
                      companyId (server re-validates ownership). */}
                  {contextTab === 'corporate' && myCompany && (
                    <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'var(--theme-text-muted)' }}>
                      <BusinessOutlined sx={{ fontSize: 14 }} />
                      Offered under your company “{myCompany.name}”
                    </Typography>
                  )}
                </FormSection>

                <FormSection icon={<UserCog size={16} />} title="Agent identity" description="A name and description buyers see on the listing." animateClassName="">
                  <TextField
                    label="Agent name *"
                    value={name}
                    onChange={e => { setName(e.target.value); clearFieldError('name') }}
                    fullWidth
                    size="small"
                    inputRef={el => { fieldRefs.current.name = el }}
                    error={!!fieldErrors.name}
                    helperText={fieldErrors.name ?? ' '}
                  />
                  <div className="flex flex-wrap items-center gap-1.5 pt-1" style={{ borderTop: '1px dashed var(--theme-border)' }}>
                    <span className="text-[11px] mr-1" style={{ color: 'var(--theme-text-muted)' }}>Suggestions:</span>
                    {AGENT_NAME_SUGGESTIONS.map(n => (
                      <Chip
                        key={n} size="small" variant="outlined" label={n} icon={<AddIcon fontSize="small" />}
                        onClick={() => { setName(`${n} ${randomNameSuffix()}`); clearFieldError('name') }}
                      />
                    ))}
                  </div>
                  {/* ADR-295 editor — the same AI Assistant + WYSIWYG experience
                      as /offers/new. HTML is stored in AgentProfile.description
                      (unlimited String?); render surfaces use RichText. */}
                  <RichDescriptionEditor
                    value={description}
                    onChange={setDescription}
                    aiContext={{ title: name, offerType: 'AGENT_SETUP' }}
                  />
                </FormSection>

                <FormSection icon={<Layers size={16} />} title="Capabilities" description="Tag what this agent can do — used to match it against bounties and buyer searches." animateClassName="">
                  <div className="flex gap-2">
                    <TextField
                      size="small" placeholder="e.g. code-review, text-generation" fullWidth
                      value={capabilityInput}
                      onChange={e => { setCapabilityInput(e.target.value); clearFieldError('capabilities') }}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCapability() } }}
                      inputRef={el => { fieldRefs.current.capabilities = el }}
                      error={!!fieldErrors.capabilities}
                      helperText={fieldErrors.capabilities ?? ' '}
                    />
                    <IconButton onClick={() => addCapability()} aria-label="Add capability"><AddIcon /></IconButton>
                  </div>
                  {capabilities.length > 0 && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {capabilities.map(c => (
                        <Chip key={c} label={c} onDelete={() => setCapabilities(prev => prev.filter(x => x !== c))} />
                      ))}
                    </Box>
                  )}
                  {!capabilities.includes('orchestration') && (
                    <Tooltip title="Reserved tag (ADR-310): marks this agent as an orchestrator that can route work to other agents already present in a shared workspace chat, instead of doing the work itself.">
                      <Chip
                        variant="outlined" size="small" icon={<AddIcon />} label="+ orchestration"
                        onClick={() => setCapabilities(prev => [...prev, 'orchestration'])}
                      />
                    </Tooltip>
                  )}
                  {availableCapabilitySuggestions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1" style={{ borderTop: '1px dashed var(--theme-border)' }}>
                      <span className="text-[11px] mr-1" style={{ color: 'var(--theme-text-muted)' }}>Suggestions:</span>
                      {availableCapabilitySuggestions.map(c => (
                        <Chip key={c} size="small" variant="outlined" label={c} icon={<AddIcon fontSize="small" />} onClick={() => addCapability(c)} />
                      ))}
                    </div>
                  )}
                </FormSection>

                <FormSection icon={<Package size={16} />} title="Tools (optional)" description="HTTPS APIs your agent may call during a booking. Buyers see the name and description; the address stays encrypted with your configuration." animateClassName="">
                  {tools.map((tool, i) => (
                    <Box key={i} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 2fr auto' }, columnGap: 2, rowGap: 2, alignItems: 'center', pb: 2, borderBottom: '1px dashed var(--theme-border)' }}>
                      <TextField
                        size="small" label="Name" value={tool.name}
                        onChange={e => setTools(prev => prev.map((t, idx) => idx === i ? { ...t, name: e.target.value } : t))}
                      />
                      <TextField
                        size="small" label="Description" fullWidth value={tool.description}
                        onChange={e => setTools(prev => prev.map((t, idx) => idx === i ? { ...t, description: e.target.value } : t))}
                      />
                      <IconButton onClick={() => setTools(prev => prev.filter((_, idx) => idx !== i))} aria-label="Remove tool">
                        <DeleteOutlineIcon />
                      </IconButton>
                      <TextField
                        size="small" label="Allowed address (https://…)" fullWidth value={tool.url}
                        placeholder="https://api.example.com/v1/"
                        helperText="The agent may only call URLs that start with this prefix."
                        sx={{ gridColumn: { md: '1 / 3' } }}
                        onChange={e => setTools(prev => prev.map((t, idx) => idx === i ? { ...t, url: e.target.value } : t))}
                      />
                      <FormControlLabel
                        control={<Switch checked={tool.requiresApproval} onChange={e => setTools(prev => prev.map((t, idx) => idx === i ? { ...t, requiresApproval: e.target.checked } : t))} />}
                        label="Buyer approves each call"
                      />
                    </Box>
                  ))}
                  <IconButton onClick={() => setTools(prev => [...prev, { ...EMPTY_TOOL }])} aria-label="Add tool" size="small" sx={{ alignSelf: 'flex-start' }}>
                    <AddIcon fontSize="small" />
                  </IconButton>
                  {AGENT_TOOL_TEMPLATES.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1" style={{ borderTop: '1px dashed var(--theme-border)' }}>
                      <span className="text-[11px] mr-1" style={{ color: 'var(--theme-text-muted)' }}>Templates:</span>
                      {AGENT_TOOL_TEMPLATES.map(t => {
                        const added = tools.some(tool => tool.name.trim() === t.name)
                        return (
                          <Tooltip key={t.name} title={t.description}>
                            <span>
                              <Chip
                                size="small" variant="outlined" label={t.name} icon={<AddIcon fontSize="small" />}
                                disabled={added}
                                onClick={() => setTools(prev => [...prev, { ...t }])}
                              />
                            </span>
                          </Tooltip>
                        )
                      })}
                    </div>
                  )}
                </FormSection>
              </div>,

              // Step 1 — Configuration & Pricing
              <div key="config" className="flex flex-col gap-5">
                {error && <Alert severity="error">{error}</Alert>}

                <FormSection icon={<KeyRound size={16} />} title="LLM provider & credentials" description="Encrypted on your device before it leaves your browser (NIP-44) — Colabonate never sees it in plaintext. For each booking your key is passed, encrypted, to that booking's workspace and pays the model's token costs; the buyer's up-front funding pays the workspace itself, not your tokens." animateClassName="">
                  {sealState === 'locked' && (
                    <Alert severity="info">
                      This configuration was encrypted on another device. Enter the API key again to change the provider, model, server or tools — otherwise the stored configuration stays unchanged.
                    </Alert>
                  )}

                  {/* ADR-409 D4 (OD-5): reuse the AI-Assistant connection as a
                      prefill. The masked config never carries the key — it is
                      re-entered once below for the NIP-44 seal. */}
                  {aiAssistantConfig && (aiAssistantConfig.provider === 'openai' || aiAssistantConfig.provider === 'local') && (
                    <Box sx={{ p: 2, mb: 1, borderRadius: 1.5, border: '1px dashed var(--theme-border)' }}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {aiAssistantConfig.provider === 'openai' ? 'Your AI Assistant uses a custom OpenAI-compatible provider.' : 'Your AI Assistant uses a local Ollama server.'}
                        </Typography>
                        <Chip
                          size="small" color="primary" variant="outlined" label="Use my AI Assistant connection"
                          onClick={applyAssistantConfig}
                        />
                      </div>
                      <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'var(--theme-text-muted)' }}>
                        {aiAssistantConfig.provider === 'openai'
                          ? `${aiAssistantConfig.model ?? 'model unset'}${aiAssistantConfig.baseUrl ? ` · ${aiAssistantConfig.baseUrl}` : ''}${aiAssistantConfig.hasApiKey ? ' · key stored (not exportable — re-enter it once below)' : ''}`
                          : aiAssistantConfig.baseUrl?.startsWith('https://')
                            ? `${aiAssistantConfig.baseUrl} — prefills the Ollama entry.`
                            : 'The assistant Ollama address is not public-HTTPS, so it cannot serve bookings — expose it via an HTTPS tunnel first (see the guide below).'}
                        {' '}Manage it in <a href="/settings#ai">Settings → AI</a>.
                      </Typography>
                    </Box>
                  )}
                  {aiAssistantConfig && (aiAssistantConfig.provider === 'adapter' || aiAssistantConfig.provider === 'platform') && (
                    <Typography variant="caption" sx={{ display: 'block', mb: 1, color: 'var(--theme-text-muted)' }}>
                      Your AI Assistant runs in {aiAssistantConfig.provider === 'adapter' ? 'CLI-adapter' : 'Colabonate-hosted'} mode — that connection type cannot serve agent workspaces. Pick a provider below (<a href="/settings#ai">Settings → AI</a> explains the modes).
                    </Typography>
                  )}

                  {/* ADR-409 D2/D3: grouped catalog select — the sealed provider
                      stays the executor flavor derived from the entry (FU-470
                      preserved: every entry maps onto openai|anthropic|ollama). */}
                  <Select size="small" value={catalogId} onChange={e => handleCatalogChange(e.target.value)}>
                    {catalogEntriesGrouped().flatMap(g => [
                      <ListSubheader key={g.group}>{g.label}</ListSubheader>,
                      ...g.entries.map(e => (
                        <MenuItem key={e.id} value={e.id}>{e.label}</MenuItem>
                      )),
                    ])}
                  </Select>
                  {catalogEntry.hint && (
                    <Typography variant="caption" sx={{ display: 'block', mt: -0.5, color: 'var(--theme-text-muted)' }}>
                      {catalogEntry.hint}{catalogEntry.docsUrl && <> · <a href={catalogEntry.docsUrl} target="_blank" rel="noreferrer">docs</a></>}
                    </Typography>
                  )}
                  {catalogEntry.group === 'custom' && (
                    <TextField
                      label="Provider label *" size="small" fullWidth
                      placeholder="e.g. My university cluster"
                      helperText="Shown to buyers on the listing — the server address itself stays encrypted."
                      value={customLabel}
                      onChange={e => setCustomLabel(e.target.value.slice(0, 60))}
                    />
                  )}

                  <Autocomplete
                    freeSolo
                    options={liveModels.length > 0 ? liveModels : catalogEntry.modelSuggestions}
                    value={model}
                    onChange={(_, value) => { setModel(value ?? ''); clearFieldError('model') }}
                    onInputChange={(_, value) => { setModel(value); clearFieldError('model') }}
                    renderInput={params => (
                      <TextField
                        {...params} size="small" label="Model *"
                        helperText={fieldErrors.model ?? (liveModels.length > 0 ? 'Live list from your connection test.' : 'The exact model id your provider expects — or run a connection test to load the live list.')}
                        error={!!fieldErrors.model}
                        inputRef={el => { fieldRefs.current.model = el }}
                      />
                    )}
                  />

                  {/* ADR-409 D5 (OD-1): optional one-shot connection test. The
                      key is used once server-side and never stored; skip it if
                      you prefer zero server contact (self-custody opt-out). */}
                  {provider !== 'anthropic' && (
                    <Box className="flex flex-wrap items-center gap-2">
                      <Button
                        size="small" variant="outlined"
                        disabled={testState === 'testing' || !baseUrl.trim() || !effectiveApiKey.trim()}
                        onClick={runConnectionTest}
                      >
                        {testState === 'testing' ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
                        Test connection
                      </Button>
                      {testState !== 'idle' && testMessage && (
                        <Typography
                          variant="caption"
                          sx={{ color: testState === 'ok' ? 'success.main' : testState === 'fail' ? 'error.main' : 'var(--theme-text-muted)' }}
                        >
                          {testMessage}
                        </Typography>
                      )}
                      {testState === 'idle' && (
                        <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)' }}>
                          Optional — your key is used once for the test, never stored. Prefer a spend-capped key.
                        </Typography>
                      )}
                    </Box>
                  )}

                  <TextField
                    label={catalogEntry.baseUrl ? 'Server address (preset — editable for a proxy or router)' : 'Server address (https) *'}
                    placeholder={catalogEntry.baseUrl ? catalogEntry.baseUrl : 'https://your-server.example.com'}
                    helperText={fieldErrors.baseUrl ?? (catalogEntry.group === 'local' || catalogEntry.group === 'custom'
                      ? 'Root form without /v1 — the workspace appends /v1/chat/completions itself.'
                      : 'Leave the preset for the official API; point it at an OpenAI-/Anthropic-compatible router otherwise.')}
                    error={!!fieldErrors.baseUrl}
                    value={baseUrl}
                    onChange={e => { setBaseUrl(e.target.value); clearFieldError('baseUrl'); setTestState('idle') }}
                    inputRef={el => { fieldRefs.current.baseUrl = el }}
                    fullWidth
                    size="small"
                  />
                  {/* ADR-339 D4: edit mode — blank key keeps the stored key.
                      ADR-409 OD-2: a key is required for EVERY flavor (the
                      workspace rejects empty keys; for native Ollama it doubles
                      as the proxy token). */}
                  <TextField
                    label={editMode ? 'API key (leave blank to keep the stored key)' : provider === 'ollama' ? 'API key / proxy token *' : 'API key *'}
                    type="password"
                    value={apiKey}
                    onChange={e => { setApiKey(e.target.value); clearFieldError('apiKey'); setTestState('idle') }}
                    fullWidth
                    size="small"
                    inputRef={el => { fieldRefs.current.apiKey = el }}
                    error={!!fieldErrors.apiKey}
                    helperText={fieldErrors.apiKey ?? (provider === 'ollama' ? 'Required even when your Ollama server ignores it — a proxy token works.' : ' ')}
                  />
                  <TextField label="System prompt" value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} multiline rows={3} fullWidth size="small" />

                  {/* ADR-409 D6 (Phase 3, OD-2): local-runtime guide. */}
                  {catalogEntry.group === 'local' && (
                    <Box sx={{ border: '1px solid var(--theme-border)', borderRadius: 1.5, p: 2 }}>
                      <Button size="small" onClick={() => setLocalGuideOpen(o => !o)}>
                        {localGuideOpen ? 'Hide' : 'How to expose a local model safely'}
                      </Button>
                      <Collapse in={localGuideOpen} timeout="auto" unmountOnExit>
                        <div className="flex flex-col gap-2 mt-2 text-[12.5px] leading-relaxed" style={{ color: 'var(--theme-text-muted)' }}>
                          <p className="m-0">
                            The buyer-funded workspace — not your browser — calls your model, so your server must be reachable from the internet over HTTPS.
                          </p>
                          <p className="m-0">
                            <strong>Default (OD-2):</strong> run the OpenAI-compatible endpoint (<code>/v1/chat/completions</code>) behind a reverse proxy that checks the Bearer token — works uniformly for Ollama, LM Studio (Developer → Start Server, port 1234), vLLM (:8000), llama.cpp, LocalAI and LiteLLM. Enter the proxy URL above and the token as the API key.
                          </p>
                          <p className="m-0">
                            A free HTTPS tunnel: <code>cloudflared tunnel --url http://localhost:11434</code> (documented in LOCAL-STACK.md) or a Tailscale Funnel. Put auth in front — the native Ollama protocol sends no auth header.
                          </p>
                          <p className="m-0">
                            Treat the key as public-ish: prefer a spend-capped provider key or a proxy token you can rotate.
                          </p>
                        </div>
                      </Collapse>
                    </Box>
                  )}
                </FormSection>

                <FormSection icon={<ShieldCheck size={16} />} title="Human oversight" description="Control how much human review is involved before and during a booking." animateClassName="">
                  <FormControlLabel
                    control={<Switch checked={requireHumanApproval} onChange={e => setRequireHumanApproval(e.target.checked)} />}
                    label="Require my approval before each booking starts"
                  />
                  <FormControlLabel
                    control={<Switch checked={humanInLoop} onChange={e => setHumanInLoop(e.target.checked)} />}
                    label="I review the result before the buyer can complete the order"
                  />
                </FormSection>

                <FormSection icon={<Zap size={16} />} title="Pricing & workspace" description="Set what you charge, how long the typical task takes, and how long a completed workspace stays accessible." animateClassName="">
                  <Box>
                    <Typography variant="body2" gutterBottom>Billing model</Typography>
                    <Select size="small" fullWidth value={billingModel} onChange={e => setBillingModel(e.target.value as typeof billingModel)}>
                      {BILLING_MODELS.map(m => (
                        <MenuItem key={m.value} value={m.value} disabled={!m.available}>
                          {m.available ? m.label : (
                            <Tooltip title="Coming soon"><span>{m.label}</span></Tooltip>
                          )}
                        </MenuItem>
                      ))}
                    </Select>
                  </Box>
                  <SatsAmountInput
                    label="Price"
                    valueSats={priceSats}
                    onChangeSats={sats => { setPriceSats(sats); clearFieldError('priceSats') }}
                    required
                    error={!!fieldErrors.priceSats}
                    helperText={fieldErrors.priceSats ?? undefined}
                    inputRef={el => { fieldRefs.current.priceSats = el }}
                  />
                  <TextField
                    label="Estimated typical duration (hours)" type="number" size="small" value={estimatedWorkspaceHours}
                    inputProps={{ min: 0.5, step: 0.5 }}
                    helperText={fieldErrors.estimatedWorkspaceHours ?? 'The buyer pre-pays this duration + 30% buffer to fund the workspace at booking — there is no free starting budget.'}
                    error={!!fieldErrors.estimatedWorkspaceHours}
                    inputRef={el => { fieldRefs.current.estimatedWorkspaceHours = el }}
                    onChange={e => {
                      const v = Number(e.target.value)
                      setEstimatedWorkspaceHours(Number.isFinite(v) && v > 0 ? v : '')
                      clearFieldError('estimatedWorkspaceHours')
                    }}
                    required
                  />
                  <TextField
                    label="Workspace retention (days)" type="number" size="small" value={workspaceTTLDays}
                    onChange={e => setWorkspaceTTLDays(Math.max(1, Number(e.target.value) || 1))}
                  />
                </FormSection>

                {/* ADR-342 D1/D2/D4a: collaboration canvas — a declarative
                    property of the setup, stored in agentConfigMeta.canvas. */}
                <FormSection icon={<Frame size={16} />} title="Collaboration canvas (optional)" description="A shared doop canvas where you, the buyer and the agent design together — opened from the ticket next to the workspace." animateClassName="">
                  <Select
                    size="small" fullWidth value={canvasProvider}
                    onChange={e => {
                      setCanvasProvider(e.target.value as CanvasProvider)
                      setCanvasProbeStatus(null)
                      if (e.target.value !== 'doop-hosted') setAgentInCanvas(false)
                    }}
                  >
                    <MenuItem value="none">No canvas</MenuItem>
                    <MenuItem value="doop-local">Own doop instance (self-hosted)</MenuItem>
                    <MenuItem value="doop-hosted">{canvasHostedAvailable ? 'Colabonate-hosted canvas' : 'Colabonate-hosted canvas (coming soon)'}</MenuItem>
                  </Select>

                  {canvasProvider === 'doop-local' && (
                    <>
                      <TextField
                        label="Instance URL *" size="small" fullWidth
                        placeholder="https://doop.example.com"
                        helperText={fieldErrors.canvasInstanceUrl ?? 'The bare instance origin — no /c/... path. Paste a canvas link and the ID splits into the field below automatically.'}
                        error={!!fieldErrors.canvasInstanceUrl}
                        inputRef={el => { fieldRefs.current.canvasInstanceUrl = el }}
                        value={canvasInstanceUrl}
                        onChange={e => { handleCanvasInstanceUrlChange(e.target.value); clearFieldError('canvasInstanceUrl') }}
                      />
                      <TextField
                        label="Canvas ID (optional)" size="small" fullWidth
                        placeholder="Link a pre-existing canvas on this instance"
                        value={canvasId}
                        onChange={e => setCanvasId(e.target.value)}
                      />
                      <Typography variant="caption" color="text.secondary">
                        Your instance, your users: buyers and collaborators need an account on this instance — there is no Colabonate login for self-hosted canvases. The server health-checks the URL; publishing requires a reachable instance.
                      </Typography>
                      {canvasProbeStatus === 'unreachable' && (
                        <Alert severity="warning">
                          The last health check could not reach this instance. Check the URL and make sure the instance is running — publishing is blocked until the check succeeds.
                        </Alert>
                      )}
                    </>
                  )}

                  {canvasProvider === 'doop-hosted' && (
                    <>
                      {/* ADR-372 D2/D4: transparent pre-purchase fee disclosure —
                          the buyer pays a separate Colabonate service fee at
                          purchase; it is not refundable (infra-cost model). */}
                      <div className="p-3 rounded-lg" style={{ background: 'rgba(99,179,237,0.06)', border: '1px solid rgba(99,179,237,0.20)' }}>
                        <Typography variant="body2" style={{ fontWeight: 600 }}>
                          Colabonate service fee: {HOSTED_CANVAS_FEE_SATS} sats per ticket
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Paid by the buyer at purchase, in addition to your price. Covers the Colabonate-hosted canvas infrastructure and is not refundable.
                        </Typography>
                      </div>
                      <FormControlLabel
                        control={<Switch checked={buyerCanEdit} onChange={e => setBuyerCanEdit(e.target.checked)} />}
                        label="Buyer can collaborate on the canvas"
                      />
                      <Typography variant="caption" color="text.secondary">
                        Applies to new bookings only; existing tickets keep their provisioning snapshot.
                      </Typography>
                      {/* ADR-370 D6 (Phase 2): opt-in — the seller's configured
                          agent also works on the ticket canvas, and the buyer
                          steers it there via task feedback (V1 channel, Owner
                          decision 2). Enabled only once the hosted bridge is
                          live so the buyer-facing promise can't precede the
                          capability. */}
                      <FormControlLabel
                        control={<Switch checked={agentInCanvas} onChange={e => setAgentInCanvas(e.target.checked)} />}
                        label="Agent works on the canvas"
                        disabled={!canvasHostedAvailable}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {canvasHostedAvailable
                          ? 'Your agent (as configured in this setup) collaborates live on the canvas with the buyer after purchase.'
                          : 'Unlocks with the hosted canvas launch.'}
                      </Typography>
                      {!canvasHostedAvailable && (
                        <Alert severity="info">
                          The hosted canvas is coming soon — save the listing as a draft now; publishing unlocks when it launches.
                        </Alert>
                      )}
                    </>
                  )}
                </FormSection>
              </div>,

              // Step 2 — Publish
              <div key="publish" className="flex flex-col gap-5">
                {error && <Alert severity="error">{error}</Alert>}

                <FormSection icon={<Rocket size={16} />} title="Listing details" description="What buyers see on the marketplace before they book your agent." animateClassName="">
                  <TextField
                    label="Listing title *"
                    value={title}
                    onChange={e => { setTitle(e.target.value); clearFieldError('title') }}
                    fullWidth
                    size="small"
                    inputRef={el => { fieldRefs.current.title = el }}
                    error={!!fieldErrors.title}
                    helperText={fieldErrors.title ?? ' '}
                  />
                  <RichDescriptionEditor
                    value={descriptionHtml}
                    onChange={setDescriptionHtml}
                    label="Description"
                    aiContext={{ title, offerType: 'AGENT_SETUP' }}
                  />
                  <Autocomplete
                    options={categories}
                    getOptionLabel={c => c.name}
                    value={categories.find(c => c.slug === categoryCode) ?? null}
                    onChange={(_, value) => { setCategoryCode(value?.slug ?? null); clearFieldError('categoryCode') }}
                    renderInput={params => (
                      <TextField
                        {...params} label="Category *" size="small"
                        error={!!fieldErrors.categoryCode}
                        helperText={fieldErrors.categoryCode ?? ' '}
                        inputRef={el => { fieldRefs.current.categoryCode = el }}
                      />
                    )}
                  />
                  <MultiImageUploadInput values={images} onChange={setImages} />
                </FormSection>
              </div>,
            ]}
          </FormStepper>
        </div>

        {/* ── Right: sticky live preview + how it works + tips (step-aware) ── */}
        <div className="agent-form-animate flex flex-col gap-4 lg:sticky lg:top-6">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] mb-2 ml-1" style={{ color: 'var(--theme-text-muted)' }}>
              Live preview
            </p>
            <AgentPreviewCard step={currentStep} name={name} capabilities={capabilities} priceSats={priceSats} title={title} />
          </div>

          {/* Owner 2026-09-29: the column's sections carry no backgrounds —
              just a hairline border for structure. */}
          <div className="p-4 rounded-2xl" style={{ background: 'transparent', border: '1px solid var(--theme-border)' }}>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] mb-3" style={{ color: 'var(--theme-text-muted)' }}>
              How it works
            </p>
            <div className="flex flex-col gap-3">
              {HOW_IT_WORKS.map((step, i) => (
                <div key={step.title} className="flex items-start gap-3" style={{ opacity: i === currentStep ? 1 : 0.55 }}>
                  <div
                    className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0"
                    style={{ background: i === currentStep ? 'rgba(99,179,237,0.18)' : 'rgba(159,122,234,0.12)', color: i === currentStep ? 'var(--color-primary-50)' : '#9F7AEA' }}
                  >
                    <step.icon size={13} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold" style={{ color: 'var(--theme-text)' }}>{i + 1}. {step.title}</p>
                    <p className="text-[11px] leading-relaxed" style={{ color: 'var(--theme-text-muted)' }}>{step.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            className="p-4 rounded-2xl"
            style={{ background: 'transparent', border: '1px solid var(--theme-border)' }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={14} style={{ color: 'var(--color-primary-50)' }} />
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-primary-50)' }}>Tips</p>
            </div>
            <ul className="flex flex-col gap-1.5 text-[12px] leading-relaxed" style={{ color: 'var(--theme-text-muted)' }}>
              {(STEP_TIPS[currentStep] ?? []).map(tip => <li key={tip}>• {tip}</li>)}
            </ul>
          </div>
        </div>
      </div>
    </PageContainer>
  )
}

/**
 * ADR-339 D4: route wrapper for `/sell/agents/:id/edit` — mounts the SAME
 * wizard as agent creation, prefilled for an existing AgentProfile. The
 * former standalone EditAgentPage.tsx (metadata-only form) is deleted; its
 * "nothing edits the AGENT_SETUP Offer" gap is exactly what the wizard
 * reuse closes.
 */
export function EditAgentWizard() {
  const { id } = useParams<{ id: string }>()
  return <CreateAgentPage editProfileId={id} />
}
