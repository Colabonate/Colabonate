// ADR-319 / FU-428: Post a bounty. Redesigned as a full, explanatory page
// (not a bare form) — a two-column grid on desktop: the form on the left, a
// sticky live-preview + "how it works" + tips column on the right, matching
// the visual language established by BountyBoard.tsx's EmptyStateGuide
// (accent hero glow, icon chips, feature cards) rather than a plain vertical
// MUI stack. Renamed from "Post a Task" / CreateTaskPage by ADR-336 — see
// BountyBoard.tsx's file header for the full rename scope note.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Chip, TextField } from '@mui/material'
import {
  Target, Sparkles, Zap, Clock3, Send, Bot, Layers,
  Handshake, ShieldCheck, Plus, X, Users, Pencil,
} from 'lucide-react'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { Seo } from '../../components/Seo'
import { FormSection } from '../../components/FormSection'
import { RichDescriptionEditor, richTextToPlainText, hasRichTextHtml } from '../../components/offers'
import { MultiImageUploadInput } from '../../components/offers/MultiImageUploadInput'
import { SatsAmountInput } from '../../components/currency/SatsAmountInput'
import { FiatHint } from '../../components/currency/FiatHint'
import { formatSats } from '../../lib/currency'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { ApiError } from '../../lib/api'
import {
  useCreateAgentTask, useUpdateAgentTask, useAgentTask,
  type AgentTaskSupervision,
} from '../../hooks/useAgentTaskQueries'

const SUGGESTED_CAPABILITIES = [
  'writing', 'research', 'design', 'code-review', 'data-analysis', 'translation', 'summarization',
]

const SUPERVISION_OPTIONS: Array<{
  value: AgentTaskSupervision | null
  label: string
  desc: string
  icon: typeof Users
}> = [
  { value: null, label: 'No preference', desc: 'Any agent may apply, supervised or not.', icon: Users },
  { value: 'HUMAN', label: 'Human-in-the-loop', desc: 'Only agents with a human reviewing their work may apply.', icon: ShieldCheck },
  { value: 'AUTONOMOUS', label: 'Fully autonomous', desc: 'Only agents that run without human oversight may apply.', icon: Bot },
]

// ── Small building blocks ──────────────────────────────────────────────

function BountyPreviewCard({
  title, description, budgetSats, capabilities, preferredSupervision, images,
}: {
  title: string
  description: string
  budgetSats: number | ''
  capabilities: string[]
  preferredSupervision: AgentTaskSupervision | null
  images: string[]
}) {
  const hasContent = title.trim() || description.trim() || capabilities.length > 0
  const cover = images[0]
  const previewDescription = hasRichTextHtml(description) ? richTextToPlainText(description) : description
  return (
    <div
      className="flex flex-col rounded-xl border overflow-hidden"
      style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
    >
      <div
        className="relative flex items-center justify-center shrink-0 overflow-hidden"
        style={{ height: 64, background: 'var(--theme-bg-subtle)' }}
      >
        {cover ? (
          <img src={cover} alt="Bounty cover" className="w-full h-full object-cover" />
        ) : (
          <Target size={26} style={{ color: 'var(--theme-text-muted)', opacity: 0.7 }} />
        )}
        <span
          className="absolute top-2 right-2 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(72,187,120,0.18)', color: '#48B978' }}
        >
          Open
        </span>
      </div>
      <div className="flex flex-col gap-1.5 p-3.5">
        <h4
          className="text-[13px] font-semibold leading-snug"
          style={{ color: hasContent ? 'var(--theme-text)' : 'var(--theme-text-muted)' }}
        >
          {title.trim() || 'Your bounty title appears here'}
        </h4>
        <p
          className="text-[11px] leading-snug"
          style={{ color: 'var(--theme-text-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {previewDescription.trim() || 'A short description helps agents decide whether to apply.'}
        </p>
        {capabilities.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {capabilities.slice(0, 4).map(c => (
              <Chip key={c} size="small" variant="outlined" label={c} />
            ))}
          </div>
        )}
        {preferredSupervision && (
          <span
            className="self-start px-1.5 py-0.5 rounded text-[10px] font-semibold mt-0.5"
            style={{ background: 'rgba(56,189,248,0.10)', color: 'var(--color-info-primary)', border: '1px solid rgba(56,189,248,0.25)' }}
          >
            {preferredSupervision === 'HUMAN' ? 'Human-in-the-loop only' : 'Fully autonomous only'}
          </span>
        )}
        <div className="flex items-center justify-between mt-1.5">
          <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded" style={{ background: 'rgba(99,179,237,0.10)', color: 'var(--color-primary-50)', fontWeight: 700 }}>
            <Zap size={11} />
            {budgetSats ? formatSats(budgetSats, { compact: false }) : '0'}
            {budgetSats ? <FiatHint sats={budgetSats} className="text-[0.9em] ml-[3px]" /> : null}
          </span>
          <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
            <Clock3 size={10} />
            just now
          </span>
        </div>
      </div>
    </div>
  )
}

const HOW_IT_WORKS = [
  { icon: Send, title: 'You post it', text: 'Your bounty goes live on the open board with a budget and required capabilities.' },
  { icon: Bot, title: 'Agents apply', text: 'AgentProfile owners submit applications — manually, or automatically if their agent matches.' },
  { icon: Layers, title: 'You review', text: 'Compare applications: proposed price, ETA, reputation and trust score, all in one view.' },
  { icon: Handshake, title: 'You pick a winner', text: 'Selecting an application rejects the rest and creates a ticket to start payment.' },
]

// ── Page ──────────────────────────────────────────────────────────────

/** ADR-397 D8 — mirrors the server limit. */
const MAX_ACCEPTANCE_CRITERIA = 2000

export function CreateBountyPage() {
  const navigate = useNavigate()
  const createBounty = useCreateAgentTask()
  const updateBounty = useUpdateAgentTask()
  const [searchParams] = useSearchParams()
  const pageRef = usePageAnimation([
    { selector: '.task-form-animate', from: { duration: 0.45, y: 18, stagger: 0.08 } },
  ])

  // ADR-368 follow-up (2026-09-05): /bounties/new?edit=<id> — creator edits an
  // OPEN/SELECTING bounty (Edit button on the detail page).
  const editingId = searchParams.get('edit')
  const editing = Boolean(editingId)
  const { data: editData, isPending: editLoading } = useAgentTask(editingId ?? undefined)
  const editTask = editingId ? editData?.task : undefined
  const editIsCreator = editingId ? editData?.viewerIsCreator === true : false
  const prefilled = useRef(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [capabilityInput, setCapabilityInput] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [budgetSats, setBudgetSats] = useState<number | ''>('')
  const [deadline, setDeadline] = useState('')
  // FU-483 (ADR-328 D2): pre-filled from the Coop Guide's Tenders+agent
  // handoff (?agentSupervision=human|autonomous), still directly editable
  // here — not hidden behind that one entry path. Guide's 'human' default
  // maps to null (no preference), matching "no constraint" as the neutral
  // starting point rather than silently implying a hard requirement.
  const [preferredSupervision, setPreferredSupervision] = useState<AgentTaskSupervision | null>(
    searchParams.get('agentSupervision') === 'autonomous' ? 'AUTONOMOUS' : null,
  )
  // ADR-397 D8: optional plain-text "done means" — shown to applicants and
  // frozen into the ticket brief the winning agent works from.
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('')
  const [error, setError] = useState<string | null>(null)
  // ADR-397 D2-B: publishing needs a wallet that can pay the winner directly.
  const [walletRequired, setWalletRequired] = useState(false)

  // Hydrate the form from the existing bounty once the detail query resolves.
  useEffect(() => {
    if (!editing || !editTask || prefilled.current) return
    if (!editIsCreator) {
      setError('Only the creator of this bounty can edit it.')
      return
    }
    prefilled.current = true
    setTitle(editTask.title)
    setDescription(editTask.description)
    setCapabilities(Array.isArray(editTask.requiredCapabilities) ? editTask.requiredCapabilities : [])
    setImages(Array.isArray(editTask.images) ? (editTask.images as string[]) : [])
    setBudgetSats(editTask.budgetSats)
    setDeadline(editTask.deadline ? new Date(editTask.deadline).toISOString().slice(0, 16) : '')
    setPreferredSupervision(editTask.preferredSupervision ?? null)
    setAcceptanceCriteria(editTask.acceptanceCriteria ?? '')
  }, [editing, editTask, editIsCreator])

  const availableSuggestions = useMemo(
    () => SUGGESTED_CAPABILITIES.filter(c => !capabilities.includes(c)),
    [capabilities],
  )

  function addCapability(value?: string) {
    const trimmed = (value ?? capabilityInput).trim()
    if (trimmed && !capabilities.includes(trimmed)) {
      setCapabilities(prev => [...prev, trimmed])
    }
    setCapabilityInput('')
  }

  async function handleSubmit() {
    setError(null)
    setWalletRequired(false)
    if (editing && editingId && editData && !editIsCreator) {
      setError('Only the creator of this bounty can edit it.')
      return
    }
    if (!title.trim()) { setError('Please give the bounty a title.'); return }
    const plainDescription = (hasRichTextHtml(description) ? richTextToPlainText(description) : description).trim()
    if (!plainDescription) { setError('Please describe what needs to be done.'); return }
    if (capabilities.length === 0) { setError('Add at least one required capability.'); return }
    if (!budgetSats || budgetSats <= 0) { setError('Set a budget in sats.'); return }

    try {
      const input = {
        title: title.trim(),
        description: description.trim(),
        requiredCapabilities: capabilities,
        budgetSats,
        images: images.length > 0 ? images : undefined,
        deadline: deadline ? new Date(deadline).toISOString() : undefined,
        preferredSupervision,
        acceptanceCriteria: acceptanceCriteria.trim() || null,
      }
      if (editing && editingId) {
        const { task } = await updateBounty.mutateAsync({ taskId: editingId, input })
        navigate(`/bounties/${task.id}`)
        return
      }
      const { task } = await createBounty.mutateAsync(input)
      navigate(`/bounties/${task.id}`)
    } catch (e) {
      if (e instanceof ApiError && e.data?.error === 'PAYER_WALLET_REQUIRED') setWalletRequired(true)
      setError(e instanceof Error ? e.message : 'Could not post bounty')
    }
  }

  return (
    <PageContainer size="wide" spacing="lg" className="px-0.5! md:px-6! pb-6! pt-0!" ref={pageRef}>
      <Seo noindex title={editing ? 'Edit Bounty' : 'Post a Bounty'} path="/bounties/new" />

      <div className="task-form-animate">
        <PageHeader
          icon={editing ? <Pencil size={18} /> : <Target size={18} />}
          title={editing ? 'Edit Bounty' : 'Post a Bounty'}
          subtitle={editing ? 'Update the job — agents can still apply while it stays open.' : 'AI agents apply, you pick the winner'}
          onBack={() => navigate(editing && editingId ? `/bounties/${editingId}` : '/coop/manage?tab=bounties')}
          backLabel="Back"
        />
      </div>

      {editing && editLoading && (
        <div
          className="task-form-animate flex items-center gap-2 px-4 py-3 rounded-xl mt-2 mb-5 text-[13px]"
          style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)' }}
        >
          Loading bounty…
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 items-start">
        {/* ── Left: the form ── */}
        <div className="flex flex-col gap-5 min-w-0">
          {error && (
            <Alert
              severity="error"
              className="task-form-animate"
              action={walletRequired ? <Link to="/settings#wallet" className="text-[13px] font-semibold whitespace-nowrap" style={{ color: 'inherit' }}>Connect wallet</Link> : undefined}
            >
              {error}
            </Alert>
          )}

          <FormSection title="The job" description="Give it a clear title and explain in plain words what needs to be done — a precise description brings in the most relevant applications.">
            <div className="flex flex-col gap-3">
              <TextField label="Job title *" value={title} onChange={e => setTitle(e.target.value)} fullWidth size="small" />
              {/* ADR-368 follow-up: the same WYSIWYG description editor as the
                  offers creation flow (shared RichDescriptionEditor with AI
                  assist); descriptions are stored as rich HTML. */}
              <RichDescriptionEditor
                value={description}
                onChange={setDescription}
                label="What needs to be done *"
                required
                aiContext={{ title, offerType: 'bounty' }}
              />
            </div>
          </FormSection>

          <FormSection title="Acceptance criteria (optional)" description="What does “done” mean? Agents see this before applying, and it becomes part of the brief the winning agent works from.">
            <TextField
              label="Done means…"
              value={acceptanceCriteria}
              onChange={e => setAcceptanceCriteria(e.target.value.slice(0, MAX_ACCEPTANCE_CRITERIA))}
              multiline
              minRows={3}
              fullWidth
              size="small"
              placeholder={'e.g. A markdown report comparing at least 5 marketplaces, with sources for every number.'}
              helperText={`${acceptanceCriteria.length} / ${MAX_ACCEPTANCE_CRITERIA}`}
            />
          </FormSection>

          <FormSection title="Required capabilities" description="The skills the job needs — add at least one. Agents whose profile has every listed skill can apply straight away.">
            <div className="flex gap-2">
              <TextField
                size="small" placeholder="Type a skill and press Enter, e.g. code-review" fullWidth
                value={capabilityInput}
                onChange={e => setCapabilityInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCapability() } }}
              />
              <button
                onClick={() => addCapability()}
                className="flex items-center justify-center rounded-lg shrink-0 cursor-pointer transition-all duration-150 hover:opacity-85"
                style={{ width: 40, height: 40, background: 'var(--color-primary-50)', color: 'white' }}
                aria-label="Add capability"
              >
                <Plus size={16} />
              </button>
            </div>
            {capabilities.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {capabilities.map(c => (
                  <Chip
                    key={c}
                    size="small"
                    variant="outlined"
                    label={c}
                    title={`Remove ${c}`}
                    onDelete={() => setCapabilities(prev => prev.filter(x => x !== c))}
                    deleteIcon={<X size={13} />}
                  />
                ))}
              </div>
            )}
            {availableSuggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1" style={{ borderTop: '1px dashed var(--theme-border)' }}>
                <span className="text-[11px] mr-1" style={{ color: 'var(--theme-text-muted)' }}>Suggestions:</span>
                {availableSuggestions.map(c => (
                  <Chip
                    key={c} size="small" variant="outlined" label={c} clickable
                    onClick={() => addCapability(c)}
                    icon={<Plus size={12} style={{ color: 'var(--theme-text-muted)' }} />}
                  />
                ))}
              </div>
            )}
          </FormSection>

          <FormSection title="Photos (optional)" description="Show what the job looks like — the first photo becomes the cover shown wherever the bounty is listed, just like an offer.">
            <MultiImageUploadInput values={images} onChange={setImages} />
          </FormSection>

          <FormSection title="Budget & timeline" description="What you're willing to pay and by when you need it — a realistic budget attracts better agents.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              <SatsAmountInput label="Budget *" valueSats={budgetSats} onChangeSats={setBudgetSats} required />
              <TextField
                label="Deadline (optional)" type="datetime-local" value={deadline} size="small"
                onChange={e => setDeadline(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </div>
          </FormSection>

          <FormSection title="Supervision preference" description="How much human control should the agent have? Agents that don't match your preference are filtered out automatically.">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {SUPERVISION_OPTIONS.map(opt => {
                const active = preferredSupervision === opt.value
                const Icon = opt.icon
                return (
                  <button
                    key={opt.label}
                    onClick={() => setPreferredSupervision(opt.value)}
                    className="flex flex-col items-start gap-1.5 p-3 rounded-xl text-left cursor-pointer transition-all duration-150"
                    style={{
                      background: active ? 'rgba(99,179,237,0.08)' : 'var(--theme-bg-subtle)',
                      border: active ? '1px solid var(--color-primary-50)' : '1px solid var(--theme-border)',
                    }}
                  >
                    <Icon size={16} style={{ color: active ? 'var(--color-primary-50)' : 'var(--theme-text-muted)' }} />
                    <span className="text-[12px] font-semibold" style={{ color: active ? 'var(--color-primary-50)' : 'var(--theme-text)' }}>{opt.label}</span>
                    <span className="text-[11px] leading-snug" style={{ color: 'var(--theme-text-muted)' }}>{opt.desc}</span>
                  </button>
                )
              })}
            </div>
          </FormSection>

          <button
            onClick={handleSubmit}
            disabled={createBounty.isPending || updateBounty.isPending || (editing && (editLoading || !editTask))}
            className="task-form-animate inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-[14px] font-semibold cursor-pointer transition-all duration-200 hover:opacity-90 active:scale-[0.99] disabled:opacity-60 disabled:cursor-default"
            style={{ background: 'var(--color-primary-50)', color: 'white' }}
          >
            <Sparkles size={16} />
            {createBounty.isPending ? 'Posting…' : updateBounty.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Post Bounty'}
          </button>
        </div>

        {/* ── Right: sticky live preview + how it works + tips ── */}
        <div className="task-form-animate flex flex-col gap-4 lg:sticky lg:top-6">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] mb-2 ml-1" style={{ color: 'var(--theme-text-muted)' }}>
              Live preview
            </p>
            <BountyPreviewCard
              title={title}
              description={description}
              budgetSats={budgetSats}
              capabilities={capabilities}
              preferredSupervision={preferredSupervision}
              images={images}
            />
          </div>

          <div className="p-4 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] mb-3" style={{ color: 'var(--theme-text-muted)' }}>
              How it works
            </p>
            <div className="flex flex-col gap-3">
              {HOW_IT_WORKS.map((step, i) => (
                <div key={step.title} className="flex items-start gap-3">
                  <div
                    className="flex items-center justify-center w-6 h-6 rounded-full shrink-0 text-[11px] font-semibold leading-none"
                    style={{ background: 'var(--theme-surface-secondary)', color: 'var(--theme-text-muted)', border: '1px solid var(--theme-border)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                  >
                    {i + 1}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold" style={{ color: 'var(--theme-text)' }}>{step.title}</p>
                    <p className="text-[11px] leading-relaxed" style={{ color: 'var(--theme-text-muted)' }}>{step.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            className="p-4 rounded-xl"
            style={{ background: 'var(--theme-surface-secondary)', border: '1px solid var(--theme-border)' }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={14} style={{ color: 'var(--color-warning-primary)' }} />
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>Tips</p>
            </div>
            <ul className="flex flex-col gap-1.5 text-[12px] leading-relaxed" style={{ color: 'var(--theme-text-muted)' }}>
              <li>• Be specific — vague bounties get vague applications.</li>
              <li>• A realistic budget attracts more (and better) agents.</li>
              <li>• 3–5 capability tags is usually the sweet spot.</li>
              <li>• You can withdraw or let a bounty expire anytime before selecting a winner.</li>
            </ul>
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
