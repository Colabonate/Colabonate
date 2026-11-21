// ESCROW-COPY (ADR-397): payment wording here assumes Direct-Pay. On escrow activation follow docs/plans/ESCROW-COPY-REACTIVATION.md.
// ADR-319 / FU-428: Bounty detail — public (ADR-303 read-tier pattern), but
// the `applications` array returned by GET /api/agent-tasks/:id is
// viewer-scoped server-side: the bounty's creator sees every application, an
// applying AgentProfile owner sees only their own, everyone else sees none.
// This page renders three roles from that one payload: creator (review +
// select a winner), applicant (see own application status, withdraw/
// confirm), and prospective applicant (pick one of their own AGENT_SETUP
// offers and apply). Renamed from "Task detail" / TaskDetail by ADR-336 —
// see BountyBoard.tsx's file header for the full rename scope note.
//
// Layout mirrors CreateBountyPage.tsx ("Post a Bounty"): accent-glow hero,
// two-column grid (content cards on the left via shared FormSection, sticky
// at-a-glance + how-it-works + tips sidebar on the right), GSAP stagger via
// usePageAnimation/.task-form-animate.
//
// Selecting a winner does not create the Ticket itself (ADR-319 D4 scope cut,
// documented in the ADR) — POST /:id/select returns a `nextStep` the client
// follows through the existing ticket-creation flow (useCreateTicket()). ADR-397
// D3/D4: that body carries the application id, so the ticket charges the agreed
// price and links to the bounty. If ticket creation fails, the poster can retry
// it or revert the selection from the "Winner & payment" section.
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert, Chip, MenuItem, Select, TextField } from '@mui/material'
import {
  Target, Sparkles, Zap, Clock3, Send, Bot, Layers, Handshake, Eye, Pencil,
} from 'lucide-react'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { Seo } from '../../components/Seo'
import { FormSection } from '../../components/FormSection'
import { DetailImageGallery } from '../../components/media/DetailImageGallery'
import { RichText, hasRichTextHtml } from '../../components/offers'
import { SatsAmount } from '../../components/currency/SatsAmount'
import { SatsAmountInput } from '../../components/currency/SatsAmountInput'
import { FiatHint } from '../../components/currency/FiatHint'
import { formatSats } from '../../lib/currency'
import { VerifiedAgentBadge } from '../../components/agents/VerifiedAgentBadge'
import { requireLogin } from '../../lib/auth-guard'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { useCreateTicket } from '../../hooks/useEntityMutations'
import {
  useAgentTask, useCancelAgentTask, useApplyToAgentTask, useUpdateAgentTaskApplication,
  useSelectAgentTaskWinner, useRevertAgentTaskSelection, useMyAgentProfiles, useMyAgentOffers,
  type AgentTaskApplication, type AgentTaskApplicationStatus, type PosterReliability,
} from '../../hooks/useAgentTaskQueries'

const STATUS_COLOR: Record<AgentTaskApplicationStatus, 'default' | 'warning' | 'success' | 'error'> = {
  PENDING: 'default',
  AWAITING_OWNER_APPROVAL: 'warning',
  ACCEPTED: 'success',
  REJECTED: 'error',
  WITHDRAWN: 'default',
}

const BOUNTY_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  OPEN: { bg: 'rgba(72,187,120,0.18)', color: '#48B978' },
  SELECTING: { bg: 'rgba(245,166,35,0.15)', color: 'var(--color-accent-primary)' },
  ASSIGNED: { bg: 'rgba(56,189,248,0.10)', color: 'var(--color-info-primary)' },
  IN_PROGRESS: { bg: 'rgba(159,122,234,0.15)', color: '#9F7AEA' },
  COMPLETED: { bg: 'rgba(72,187,120,0.18)', color: '#48B978' },
  CANCELLED: { bg: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)' },
  EXPIRED: { bg: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)' },
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}

function posterReliabilityLabel(r: PosterReliability | null | undefined): string {
  if (!r || r.decided === 0) return 'New poster — no paid bounties yet'
  const time = r.medianHoursToPay === null ? '' : r.medianHoursToPay < 24
    ? ` · pays in ~${Math.max(1, Math.round(r.medianHoursToPay))} h`
    : ` · pays in ~${Math.round(r.medianHoursToPay / 24)} d`
  return `Paid ${r.paid} of ${r.decided} winners${time}`
}

// ── Small building blocks ──────────────────────────────────────────────

/** Sticky-sidebar "at a glance" card — static sibling of the create page's live preview. */
function BountyGlanceCard({ status, budgetSats, deadline, createdAt, preferredSupervision, posterReliability }: {
  status: string
  budgetSats: number
  deadline: string | null
  createdAt: string
  preferredSupervision: string | null
  posterReliability: PosterReliability | null | undefined
}) {
  const statusStyle = BOUNTY_STATUS_STYLE[status] ?? BOUNTY_STATUS_STYLE.CANCELLED
  return (
    <div
      className="flex flex-col rounded-xl border overflow-hidden"
      style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
    >
      <div className="relative flex items-center justify-center shrink-0" style={{ height: 64, background: 'var(--theme-bg-subtle)' }}>
        <Target size={26} style={{ color: 'var(--theme-text-muted)', opacity: 0.7 }} />
        <span
          className="absolute top-2 right-2 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full"
          style={{ background: statusStyle.bg, color: statusStyle.color }}
        >
          {status}
        </span>
      </div>
      <div className="flex flex-col gap-2.5 p-3.5">
        <span
          className="self-start flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-bold"
          style={{ background: 'rgba(99,179,237,0.10)', color: 'var(--color-primary-50)' }}
        >
          <Zap size={11} />
          {formatSats(budgetSats, { compact: false })}
          <FiatHint sats={budgetSats} className="text-[0.9em] ml-[3px]" />
        </span>
        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
          <Clock3 size={11} />
          {deadline ? `Deadline ${formatDate(deadline)}` : 'No deadline'}
        </div>
        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
          <Send size={11} />
          Posted {formatDate(createdAt)}
        </div>
        {/* ADR-397 D2-C: the poster pays the winner directly, so show how
            reliably they have done that before. */}
        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--theme-text-muted)' }} title="Bounty tickets this poster paid, out of all that were paid or cancelled">
          <Zap size={11} />
          {posterReliabilityLabel(posterReliability)}
        </div>
        {preferredSupervision && (
          <span
            className="self-start px-1.5 py-0.5 rounded text-[10px] font-semibold mt-0.5"
            style={{ background: 'rgba(56,189,248,0.10)', color: 'var(--color-info-primary)', border: '1px solid rgba(56,189,248,0.25)' }}
          >
            {preferredSupervision === 'HUMAN' ? 'Human-in-the-loop only' : 'Fully autonomous only'}
          </span>
        )}
      </div>
    </div>
  )
}

const HOW_IT_WORKS_APPLICANT = [
  { icon: Send, title: 'You post it', text: 'Your bounty goes live on the open board with a budget and required capabilities.' },
  { icon: Bot, title: 'Agents apply', text: 'AgentProfile owners submit applications — manually, or automatically if their agent matches.' },
  { icon: Layers, title: 'You review', text: 'Compare applications: proposed price, ETA, reputation and trust score, all in one view.' },
  { icon: Handshake, title: 'You pick a winner', text: 'Selecting an application rejects the rest and creates a ticket to start payment.' },
]

const HOW_IT_WORKS_CREATOR = [
  { icon: Bot, title: 'Agents apply', text: 'Matching agents submit an application with one of their listings and a proposed price.' },
  { icon: Eye, title: 'You review', text: 'Every application shows price, listing, message and the agent\u2019s verified/reputation signal.' },
  { icon: Handshake, title: 'You pick a winner', text: 'Selecting one rejects the rest and creates the ticket — you then pay the agent’s owner directly over Lightning. Colabonate never holds the reward.' },
]

const TIPS = [
  'Applications are binding once confirmed — review prices carefully.',
  'A higher reputation score (★) means more completed jobs.',
  'Only verified agents carry the Verified badge.',
  'You can withdraw your application anytime before a winner is selected.',
]

const TIPS_CREATOR = [
  'Compare proposed prices against your budget before selecting.',
  'The Verified badge and ★ reputation are the strongest trust signals.',
  'Selecting a winner automatically rejects all other applications.',
  'You can cancel the bounty anytime before selecting a winner.',
]

// ── Page ──────────────────────────────────────────────────────────────

export function BountyDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const pubkey = localStorage.getItem('pubkey') ?? ''

  const pageRef = usePageAnimation([
    { selector: '.task-form-animate', from: { duration: 0.45, y: 18, stagger: 0.08 } },
  ])

  const { data, isLoading } = useAgentTask(id)
  const cancelBounty = useCancelAgentTask()
  const applyToBounty = useApplyToAgentTask()
  const updateApplication = useUpdateAgentTaskApplication()
  const selectWinner = useSelectAgentTaskWinner()
  const createTicket = useCreateTicket()
  const revertSelection = useRevertAgentTaskSelection()

  const [actionError, setActionError] = useState<string | null>(null)
  const [selectingId, setSelectingId] = useState<string | null>(null)

  // Apply form state
  const [agentProfileId, setAgentProfileId] = useState('')
  const [offerId, setOfferId] = useState('')
  const [message, setMessage] = useState('')
  const [proposedPriceSats, setProposedPriceSats] = useState<number | ''>('')

  const bounty = data?.task
  const applications = data?.applications ?? []
  const viewerIsCreator = data?.viewerIsCreator ?? false
  const linkedTicket = data?.ticket ?? null
  const acceptedApplication = applications.find(a => a.status === 'ACCEPTED') ?? null
  const myApplications = viewerIsCreator ? [] : applications

  const { data: myAgentProfiles = [] } = useMyAgentProfiles(Boolean(pubkey) && !viewerIsCreator)
  const { data: myAgentOffers = [] } = useMyAgentOffers(!viewerIsCreator ? pubkey : undefined)
  const eligibleOffers = myAgentOffers.filter(o => o.agentProfileId === agentProfileId && o.status === 'ACTIVE')
  const alreadyAppliedProfileIds = new Set(myApplications.map(a => a.agentProfileId))
  const canApply = myAgentProfiles.some(p => !alreadyAppliedProfileIds.has(p.id))

  if (isLoading) {
    return (
      <PageContainer size="narrow" spacing="lg" className="pt-0!">
        <CircularProgressFallback />
      </PageContainer>
    )
  }

  if (!bounty) {
    return (
      <PageContainer size="narrow" spacing="lg" className="pt-0!">
        <PageHeader title="Bounty not found" onBack={() => navigate('/coop/manage?tab=bounties')} backLabel="Back" />
      </PageContainer>
    )
  }

  async function handleCancel() {
    setActionError(null)
    try {
      await cancelBounty.mutateAsync(bounty!.id)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not cancel bounty')
    }
  }

  async function handleSelect(applicationId: string) {
    setActionError(null)
    setSelectingId(applicationId)
    try {
      const result = await selectWinner.mutateAsync({ taskId: bounty!.id, applicationId })
      await openTicket(result.nextStep.body)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not select winner')
    } finally {
      setSelectingId(null)
    }
  }

  // ADR-397 D3: the body carries the application id — the server charges the
  // agreed price and links the ticket to the bounty. A failure here leaves the
  // bounty ASSIGNED; the "Winner & payment" section offers retry or revert.
  async function openTicket(body: { offerId: string; agentTaskApplicationId: string }) {
    try {
      const ticketRes = await createTicket.mutateAsync(body) as { ticket?: { id?: string } }
      const ticketId = ticketRes?.ticket?.id
      navigate(ticketId ? `/tickets/${ticketId}` : '/tickets')
    } catch (e) {
      const reason = (e instanceof Error ? e.message : 'unknown error').replace(/[.\s]+$/, '')
      setActionError(`The winner is selected, but the ticket could not be created: ${reason}. Retry below, or revert the selection to pick someone else.`)
    }
  }

  async function handleRetryTicket() {
    if (!acceptedApplication) return
    setActionError(null)
    await openTicket({ offerId: acceptedApplication.offerId, agentTaskApplicationId: acceptedApplication.id })
  }

  async function handleRevertSelection() {
    setActionError(null)
    try {
      await revertSelection.mutateAsync(bounty!.id)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not revert the selection')
    }
  }

  async function handleWithdraw(applicationId: string) {
    setActionError(null)
    try {
      await updateApplication.mutateAsync({ taskId: bounty!.id, applicationId, action: 'withdraw' })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not withdraw application')
    }
  }

  async function handleConfirm(applicationId: string) {
    setActionError(null)
    try {
      await updateApplication.mutateAsync({ taskId: bounty!.id, applicationId, action: 'confirm' })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not confirm application')
    }
  }

  async function handleApply() {
    setActionError(null)
    if (!requireLogin(navigate, `/bounties/${bounty!.id}`)) return
    if (!agentProfileId || !offerId) { setActionError('Pick an agent and a listing to apply with.'); return }
    try {
      await applyToBounty.mutateAsync({
        taskId: bounty!.id,
        agentProfileId,
        offerId,
        message: message.trim() || undefined,
        proposedPriceSats: proposedPriceSats || undefined,
      })
      setMessage('')
      setProposedPriceSats('')
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not apply')
    }
  }

  const howItWorks = viewerIsCreator ? HOW_IT_WORKS_CREATOR : HOW_IT_WORKS_APPLICANT
  const tips = viewerIsCreator ? TIPS_CREATOR : TIPS
  // ADR-368 follow-up: WYSIWYG (RichText) descriptions from the editor render
  // through the shared offers RichText component; legacy plain-text rows stay
  // plain paragraphs.
  const descriptionIsRich = hasRichTextHtml(bounty.description ?? '')

  return (
    <PageContainer size="wide" spacing="lg" className="px-0.5! md:px-6! pb-6! pt-0!" ref={pageRef}>
      <Seo title={bounty.title} description={bounty.description.slice(0, 160)} path={`/bounties/${bounty.id}`} />

      <div className="task-form-animate">
        <PageHeader
          icon={<Target size={18} />}
          title={bounty.title}
          subtitle={`${bounty.status} · ${bounty.requiredCapabilities.length} capabilit${bounty.requiredCapabilities.length === 1 ? 'y' : 'ies'} required`}
          onBack={() => navigate('/coop/manage?tab=bounties')}
          backLabel="Back"
        />
      </div>

      {/* ── Image gallery first — mirrors the offer detail page: same shared
          gallery with its default responsive heights, and a plain fallback
          surface when the bounty has no photos (offer-detail pattern,
          ADR-368 follow-up 2026-09-05). */}
      <div className="task-form-animate mb-3 md:mb-4" style={{ borderRadius: 'var(--radius-lg, 12px)', overflow: 'hidden' }}>
        {bounty.images && bounty.images.length > 0 ? (
          <DetailImageGallery images={bounty.images} title={bounty.title} counterIcon={<Target size={12} />} />
        ) : (
          <div
            className="flex items-center justify-center w-full h-[280px] sm:h-[360px]"
            style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', borderRadius: 'var(--radius-lg, 12px)' }}
          >
            <Layers size={48} style={{ color: 'var(--theme-text-muted)', opacity: 0.7 }} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 items-start">
        {/* ── Left: the details ── */}
        <div className="flex flex-col gap-5 min-w-0">
          {actionError && <Alert severity="error" className="task-form-animate">{actionError}</Alert>}

          {/* About — offer-detail pattern: RichText for the WYSIWYG
              description, plain-text fallback for legacy rows. */}
          {bounty.description ? (
            <div className="flex flex-col gap-3 p-5 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
              <h3 className="text-[15px] font-semibold" style={{ color: 'var(--theme-text)' }}>About this bounty</h3>
              {descriptionIsRich ? (
                <RichText value={bounty.description} />
              ) : (
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--theme-text-muted)' }}>{bounty.description}</p>
              )}
            </div>
          ) : null}

          {bounty.acceptanceCriteria && (
            <FormSection title="Acceptance criteria" description="What “done” means for this bounty — the winning agent's brief includes it.">
              <p className="text-[14px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--theme-text)' }}>{bounty.acceptanceCriteria}</p>
            </FormSection>
          )}

          <FormSection title="Budget & timeline" description="The reward for the winning agent — paid directly by the poster when the ticket is paid. Colabonate does not hold it (no escrow yet).">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl p-3" style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
                <p className="text-[11px] mb-1.5" style={{ color: 'var(--theme-text-muted)' }}>Reward</p>
                <SatsAmount sats={bounty.budgetSats} size="lg" />
              </div>
              <div className="rounded-xl p-3" style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
                <p className="text-[11px] mb-1.5" style={{ color: 'var(--theme-text-muted)' }}>Deadline</p>
                <p className="text-[13px] font-semibold" style={{ color: 'var(--theme-text)' }}>
                  {bounty.deadline ? formatDate(bounty.deadline) : 'None'}
                </p>
              </div>
              <div className="rounded-xl p-3" style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
                <p className="text-[11px] mb-1.5" style={{ color: 'var(--theme-text-muted)' }}>Posted</p>
                <p className="text-[13px] font-semibold" style={{ color: 'var(--theme-text)' }}>{formatDate(bounty.createdAt)}</p>
              </div>
            </div>
          </FormSection>

          <FormSection title="Required capabilities" description="Skills an agent needs — applications are matched against these tags.">
            {bounty.requiredCapabilities.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {bounty.requiredCapabilities.map(c => (
                  <Chip key={c} size="small" variant="outlined" label={c} />
                ))}
              </div>
            ) : (
              <p className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }}>Any agent can apply.</p>
            )}
            {bounty.preferredSupervision && (
              <Chip
                size="small"
                variant="outlined"
                label={bounty.preferredSupervision === 'HUMAN' ? 'Human-in-the-loop agents only' : 'Fully autonomous agents only'}
              />
            )}
          </FormSection>

          {(viewerIsCreator || linkedTicket) && ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED'].includes(bounty.status) && (
            <WinnerPaymentSection
              isCreator={viewerIsCreator}
              status={bounty.status}
              winner={acceptedApplication}
              ticket={linkedTicket}
              busy={createTicket.isPending || revertSelection.isPending}
              onOpenTicket={(ticketId) => navigate(`/tickets/${ticketId}`)}
              onRetry={handleRetryTicket}
              onRevert={handleRevertSelection}
            />
          )}

          {viewerIsCreator ? (
            <FormSection
             
              title={`Applications (${applications.length})`}
              description="Compare price, listing and trust signals, then select a winner to start the ticket."
            >
              {applications.length === 0 ? (
                <p className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }}>No applications yet.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {applications.map(app => (
                    <ApplicationRow
                      key={app.id}
                      application={app}
                      onSelect={() => handleSelect(app.id)}
                      selecting={selectingId === app.id}
                      canSelect={app.status === 'PENDING' && ['OPEN', 'SELECTING'].includes(bounty.status)}
                    />
                  ))}
                </div>
              )}
              {['OPEN', 'SELECTING'].includes(bounty.status) && (
                <div className="flex flex-wrap items-center gap-2">
                  {/* ADR-368 follow-up (2026-09-05): creator edit — opens the
                      bounty form in edit mode (?edit=<id>) so stale or wrong
                      job text can be corrected while applications are open. */}
                  <button
                    onClick={() => navigate(`/bounties/new?edit=${bounty.id}`)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold cursor-pointer transition-all duration-150 hover:opacity-90"
                    style={{ background: 'rgba(99,179,237,0.10)', color: 'var(--color-primary-50)', border: '1px solid rgba(99,179,237,0.25)' }}
                  >
                    <Pencil size={13} />
                    Edit bounty
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={cancelBounty.isPending}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold cursor-pointer transition-all duration-150 hover:opacity-90 disabled:opacity-60 disabled:cursor-default"
                    style={{ background: 'rgba(232,69,65,0.10)', color: 'var(--color-primary-50)', border: '1px solid rgba(232,69,65,0.25)' }}
                  >
                    Cancel bounty
                  </button>
                </div>
              )}
            </FormSection>
          ) : (
            <>
              {myApplications.length > 0 && (
                <FormSection
                 
                  title={`Your application${myApplications.length > 1 ? 's' : ''}`}
                  description="Track status here — you can confirm or withdraw while it's pending."
                >
                  <div className="flex flex-col gap-1.5">
                    {myApplications.map(app => (
                      <div key={app.id} className="flex flex-col p-2.5 rounded-xl" style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-[13px] font-semibold truncate min-w-0" style={{ color: 'var(--theme-text)' }}>{app.offer?.title ?? app.offerId}</p>
                          <Chip size="small" label={app.status} color={STATUS_COLOR[app.status]} />
                        </div>
                        {app.status === 'AWAITING_OWNER_APPROVAL' && (
                          <button
                            onClick={() => handleConfirm(app.id)}
                            disabled={updateApplication.isPending}
                            className="mt-2 self-start inline-flex px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer transition-all duration-150 hover:opacity-90 disabled:opacity-60"
                            style={{ background: 'rgba(72,187,120,0.12)', color: '#48B978', border: '1px solid rgba(72,187,120,0.25)' }}
                          >
                            Confirm application
                          </button>
                        )}
                        {['PENDING', 'AWAITING_OWNER_APPROVAL'].includes(app.status) && (
                          <button
                            onClick={() => handleWithdraw(app.id)}
                            disabled={updateApplication.isPending}
                            className="mt-2 inline-flex px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer transition-all duration-150 hover:opacity-90 disabled:opacity-60"
                            style={{ background: 'rgba(232,69,65,0.10)', color: 'var(--color-primary-50)', border: '1px solid rgba(232,69,65,0.25)' }}
                          >
                            Withdraw
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </FormSection>
              )}

              {bounty.status === 'OPEN' && (
                !pubkey ? (
                  <button
                    onClick={() => requireLogin(navigate, `/bounties/${bounty.id}`)}
                    className="task-form-animate inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-[14px] font-semibold cursor-pointer transition-all duration-200 hover:opacity-90 active:scale-[0.99]"
                    style={{ background: 'var(--color-primary-50)', color: 'white' }}
                  >
                    Log in to apply
                  </button>
                ) : myAgentProfiles.length === 0 ? (
                  <Alert severity="info" className="task-form-animate">You need an agent listing to apply. Create one first.</Alert>
                ) : !canApply ? null : (
                  <FormSection
                   
                    title="Apply with your agent"
                    description="Pick one of your AGENT_SETUP listings — optionally add a message and propose a different price."
                    className="task-form-animate"
                  >
                    <div className="flex flex-col gap-2.5">
                      <Select
                        size="small" displayEmpty value={agentProfileId} fullWidth
                        onChange={e => { setAgentProfileId(e.target.value); setOfferId('') }}
                      >
                        <MenuItem value="" disabled>Select an agent profile</MenuItem>
                        {myAgentProfiles.filter(p => !alreadyAppliedProfileIds.has(p.id)).map(p => (
                          <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                        ))}
                      </Select>
                      <Select size="small" displayEmpty value={offerId} onChange={e => setOfferId(e.target.value)} disabled={!agentProfileId} fullWidth>
                        <MenuItem value="" disabled>Select a listing</MenuItem>
                        {eligibleOffers.map(o => (
                          <MenuItem key={o.id} value={o.id}>{o.title}</MenuItem>
                        ))}
                      </Select>
                      {agentProfileId && eligibleOffers.length === 0 && (
                        <Alert severity="warning">This agent has no active AGENT_SETUP listing yet.</Alert>
                      )}
                      <TextField label="Message (optional)" value={message} onChange={e => setMessage(e.target.value)} multiline rows={2} fullWidth size="small" />
                      <SatsAmountInput label="Proposed price (optional — defaults to listing price)" valueSats={proposedPriceSats} onChangeSats={setProposedPriceSats} />
                      <button
                        onClick={handleApply}
                        disabled={applyToBounty.isPending || !agentProfileId || !offerId}
                        className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-[14px] font-semibold cursor-pointer transition-all duration-200 hover:opacity-90 active:scale-[0.99] disabled:opacity-60 disabled:cursor-default self-start"
                        style={{ background: 'var(--color-primary-50)', color: 'white' }}
                      >
                        <Sparkles size={16} />
                        {applyToBounty.isPending ? 'Applying…' : 'Apply'}
                      </button>
                    </div>
                  </FormSection>
                )
              )}
            </>
          )}
        </div>

        {/* ── Right: sticky at-a-glance + how it works + tips ── */}
        <div className="task-form-animate flex flex-col gap-4 lg:sticky lg:top-6">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] mb-2 ml-1" style={{ color: 'var(--theme-text-muted)' }}>
              At a glance
            </p>
            <BountyGlanceCard
              status={bounty.status}
              budgetSats={bounty.budgetSats}
              deadline={bounty.deadline}
              createdAt={bounty.createdAt}
              preferredSupervision={bounty.preferredSupervision}
              posterReliability={bounty.posterReliability}
            />
          </div>

          <div className="p-4 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] mb-3" style={{ color: 'var(--theme-text-muted)' }}>
              How it works
            </p>
            <div className="flex flex-col gap-3">
              {howItWorks.map((step, i) => (
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

          <div className="p-4 rounded-xl" style={{ background: 'var(--theme-surface-secondary)', border: '1px solid var(--theme-border)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={14} style={{ color: 'var(--color-warning-primary)' }} />
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>Tips</p>
            </div>
            <ul className="flex flex-col gap-1.5 text-[12px] leading-relaxed" style={{ color: 'var(--theme-text-muted)' }}>
              {tips.map(tip => <li key={tip}>• {tip}</li>)}
            </ul>
          </div>
        </div>
      </div>
    </PageContainer>
  )
}

/**
 * ADR-397 D3/D4: the selected winner, the agreed price that gets charged, and
 * the linked ticket. While no live ticket exists the poster can retry ticket
 * creation or revert the selection (closes FU-426).
 */
function WinnerPaymentSection({ isCreator, status, winner, ticket, busy, onOpenTicket, onRetry, onRevert }: {
  isCreator: boolean
  status: string
  winner: AgentTaskApplication | null
  ticket: { id: string; status: string } | null
  busy: boolean
  onOpenTicket: (ticketId: string) => void
  onRetry: () => void
  onRevert: () => void
}) {
  const liveTicket = ticket && ticket.status !== 'CANCELLED' ? ticket : null
  const needsTicket = isCreator && !liveTicket && status !== 'COMPLETED'
  const agreedPrice = winner?.proposedPriceSats ?? winner?.offer?.priceSats ?? null

  let statusLine: string
  if (status === 'COMPLETED') statusLine = 'Work delivered and the ticket is completed.'
  else if (liveTicket) statusLine = `Ticket status: ${liveTicket.status}. Payment goes directly to the agent's owner — Colabonate does not hold it.`
  else if (ticket) statusLine = 'The ticket was cancelled. Create a new one, or revert the selection to pick another agent.'
  else statusLine = 'No ticket yet. Create it to pay the winner directly, or revert the selection to pick another agent.'

  return (
    <FormSection title="Winner & payment" description={statusLine} className="task-form-animate">
      {winner && (
        <div className="flex items-center justify-between gap-4 p-4 rounded-xl" style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--theme-text)' }}>
              {winner.agentProfile?.name ?? winner.agentProfileId}
            </p>
            {winner.offer?.title && (
              <p className="text-[13px] mt-1 truncate" style={{ color: 'var(--theme-text-muted)' }}>{winner.offer.title}</p>
            )}
          </div>
          {agreedPrice !== null && (
            <div className="text-right shrink-0">
              <p className="text-[12px] mb-1" style={{ color: 'var(--theme-text-muted)' }}>Agreed price</p>
              <SatsAmount sats={agreedPrice} size="sm" />
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {liveTicket && (
          <button
            onClick={() => onOpenTicket(liveTicket.id)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-semibold cursor-pointer transition-all duration-150 hover:opacity-90"
            style={{ background: 'var(--color-primary-50)', color: 'white' }}
          >
            Open ticket
          </button>
        )}
        {needsTicket && winner && (
          <button
            onClick={onRetry}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-semibold cursor-pointer transition-all duration-150 hover:opacity-90 disabled:opacity-60 disabled:cursor-default"
            style={{ background: 'var(--color-primary-50)', color: 'white' }}
          >
            {ticket ? 'Create a new ticket' : 'Create ticket'}
          </button>
        )}
        {needsTicket && (
          <button
            onClick={onRevert}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-semibold cursor-pointer transition-all duration-150 hover:opacity-90 disabled:opacity-60 disabled:cursor-default"
            style={{ background: 'rgba(232,69,65,0.10)', color: 'var(--color-primary-50)', border: '1px solid rgba(232,69,65,0.25)' }}
          >
            Revert selection
          </button>
        )}
      </div>
    </FormSection>
  )
}

function CircularProgressFallback() {
  return (
    <div className="flex items-center justify-center py-16">
      <span
        className="inline-block w-6 h-6 rounded-full animate-spin"
        style={{ border: '2px solid var(--theme-border)', borderTopColor: 'var(--color-secondary-50)' }}
        aria-label="Loading bounty"
      />
    </div>
  )
}

function ApplicationRow({ application, onSelect, selecting, canSelect }: {
  application: AgentTaskApplication
  onSelect: () => void
  selecting: boolean
  canSelect: boolean
}) {
  return (
    <div className="flex flex-col p-2.5 rounded-xl transition-colors duration-150" style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--theme-text)' }}>
              {application.agentProfile?.name ?? application.agentProfileId}
            </span>
            {/* ADR-315 D3: Verified chip on the applicant row. The bounty owner
                sees this when reviewing applicants — the badge is the cheapest
                trust signal we can show next to reputation/trust scores. */}
            <VerifiedAgentBadge isVerified={application.agentProfile?.isVerified} />
          </div>
          {application.offer?.title && (
            <p className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>{application.offer.title}</p>
          )}
          {application.message && <p className="text-[12px] mt-0.5" style={{ color: 'var(--theme-text)' }}>{application.message}</p>}
        </div>
        <div className="text-right shrink-0">
          <SatsAmount sats={application.proposedPriceSats ?? application.offer?.priceSats ?? 0} size="sm" />
          {application.agentProfile?.reputationScore != null && (
            <p className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
              ★ {application.agentProfile.reputationScore.toFixed(1)}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2">
        <Chip size="small" label={application.status} color={STATUS_COLOR[application.status]} />
        {canSelect && (
          <button
            onClick={onSelect}
            disabled={selecting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:opacity-60 disabled:cursor-default"
            style={{ background: 'var(--color-primary-50)', color: 'white' }}
          >
            {selecting ? 'Selecting…' : 'Select'}
          </button>
        )}
      </div>
    </div>
  )
}
