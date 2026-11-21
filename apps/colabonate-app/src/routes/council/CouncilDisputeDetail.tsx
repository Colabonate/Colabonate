import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from '../../contexts/LocaleContext'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { NotFoundState } from '../../components/NotFoundState'
import { apiCall } from '../../lib/api'
import { formatSats } from '../../lib/currency'
import { FiatHint } from '../../components/currency/FiatHint'
import { CodexBanner } from '@ds/ui'
import { cn } from '@ds/utils'
import { Gavel, CheckCircle, XCircle, ShieldCheck, AlertTriangle } from 'lucide-react'
import type { Dispute, DisclosureSummary } from './council-types'
import { useDispute } from '../../hooks/useEntityQueries'
import { useQueryClient } from '@tanstack/react-query'
import { signAndPublishFromTemplate } from '../../lib/nostr-ticket'
import { useNotification } from '../../context/NotificationContext'

export function CouncilDisputeDetail() {
  // Route param is `:did` (see App.tsx: 'council/disputes/:did'), not `:id` —
  // aliased here so the rest of this file's `id` references stay unchanged.
  const { did: id } = useParams<{ did: string }>()
  const navigate = useNavigate()
  const { formatTime } = useTranslation()
  
  const { data, isLoading, error: queryError } = useDispute(id || '')
  const dispute = (data as { dispute?: Dispute } | undefined)?.dispute as Dispute | undefined
  const queryClient = useQueryClient()
  const { showSnackbar } = useNotification()

  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [reasoning, setReasoning] = useState('')
  const [forfeitInfo, setForfeitInfo] = useState<{ party: string; automaticOutcome: string } | null>(null)

  useEffect(() => {
    if (queryError) {
      setError('Failed to load dispute')
    } else if (!isLoading && !dispute && id) {
      setError('Dispute not found')
    } else {
      setError(null)
    }
  }, [queryError, dispute, isLoading, id])

  const disclosureSummary: DisclosureSummary | undefined = (data as { disclosureSummary?: DisclosureSummary } | undefined)?.disclosureSummary
  const isTier1 = (dispute?.ticket as { visibility?: number } | undefined)?.visibility != null && ((dispute as Dispute).ticket as { visibility: number }).visibility >= 1

  useEffect(() => {
    if (!isTier1 || !id || !dispute) return
    const pubkey = localStorage.getItem('pubkey')
    if (!pubkey) return
    apiCall(`/api/disputes/${id}/check-forfeit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callerPubkey: pubkey }),
    })
      .then(r => r.json())
      .then(data => { if (data.forfeit) setForfeitInfo(data.forfeit) })
      .catch(() => {})
  }, [id, isTier1, dispute])

  const handleVerdict = async (outcome: 'RELEASE' | 'CANCEL') => {
    if (!dispute || !id) return
    const pubkey = localStorage.getItem('pubkey')
    if (!pubkey) {
      alert('Please log in to issue a verdict')
      return
    }

    setSubmitting(true)
    try {
      const response = await apiCall(`/api/disputes/${id}/verdict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callerPubkey: pubkey, outcome, reasoning }),
      })
      const data = await response.json()
      if (data.success) {
        // Publish the verdict as a public, decentralized Kind 30022 Nostr
        // event (server builds it in data.nostrEventTemplate) — this is
        // what makes the DAO's ruling independently verifiable off any
        // Colabonate server, not just a DB row. Client-side signing per
        // ADR-141 (no server private key involved).
        if (data.nostrEventTemplate) {
          const publishResult = await signAndPublishFromTemplate(data.nostrEventTemplate)
          if (!publishResult) {
            showSnackbar('Verdict recorded, but publishing it to Nostr for public verification failed (signing was rejected or unavailable). The verdict itself is still valid.', 'warning')
          } else if (!publishResult.relayReached) {
            showSnackbar('Verdict recorded and signed, but no relay confirmed receiving it — public verifiability may be delayed.', 'warning')
          } else {
            showSnackbar('Verdict recorded and published for public, decentralized verification.', 'success')
          }
        }
        queryClient.invalidateQueries({ queryKey: ['dispute', id] })
        queryClient.invalidateQueries({ queryKey: ['disputes'] })
        navigate(`/dao/${dispute.daoId}/council`)
      } else {
        alert(data.error || 'Failed to issue verdict')
      }
    } catch (err) {
      console.error('Failed to issue verdict:', err)
      alert('Failed to issue verdict')
    } finally {
      setSubmitting(false)
    }
  }

  const getQuorumProgress = () => {
    if (!dispute) return { current: 0, required: 1, label: '1 of 1' }
    const current = dispute.verdicts.length
    let required = 1

    if (dispute.quorumTypeSnapshot === 'MAJORITY') {
      const activeCount = dispute.verdicts.length + 1
      required = Math.floor(activeCount / 2) + 1
    } else if (dispute.thresholdNSnapshot) {
      required = dispute.thresholdNSnapshot
    }

    return {
      current,
      required,
      label: `${current} of ${required} verdicts`,
    }
  }

  const canSubmitVerdict = () => {
    if (!dispute) return false
    if (!['COUNCIL_QUEUE', 'IN_REVIEW', 'APPEALED'].includes(dispute.status)) return false
    const pubkey = localStorage.getItem('pubkey')
    if (!pubkey) return false
    if (dispute.verdicts.some(v => v.arbitratorPubkey === pubkey)) return false
    if (dispute.status === 'APPEALED') {
      const round1Voters = dispute.verdicts.filter(v => v.round === 1).map(v => v.arbitratorPubkey)
      if (round1Voters.includes(pubkey)) return false
    }
    return true
  }

  if (isLoading) {
    return (
      <PageContainer size="wide" spacing="md">
        <div className="flex justify-center p-8">
          <div className="text-[var(--color-text-secondary)]">Loading dispute…</div>
        </div>
      </PageContainer>
    )
  }

  if (error || !dispute) {
    return (
      <NotFoundState
        icon={<Gavel size={48} />}
        title="Dispute not found"
        message="This dispute may have been resolved and archived, or the link is incorrect."
        primary={{ label: 'Back to DAOs', to: '/dao' }}
        secondary={{ label: 'Go back', onClick: () => navigate(-1) }}
      />
    )
  }

  const quorum = getQuorumProgress()
  const statusColor = (status: string) => {
    switch (status) {
      case 'OPEN': return 'text-[var(--color-accent)]'
      case 'COUNCIL_QUEUE': return 'text-yellow-600'
      case 'IN_REVIEW': return 'text-orange-600'
      case 'RESOLVED_PENDING': return 'text-purple-600'
      case 'APPEALED': return 'text-purple-700'
      case 'RESOLVED': return 'text-green-600'
      case 'WITHDRAWN': return 'text-gray-500'
      default: return 'text-[var(--color-text-secondary)]'
    }
  }

  const isRound2 = dispute.status === 'APPEALED'
  const round1Verdicts = dispute.verdicts.filter(v => v.round === 1)
  const round2Verdicts = dispute.verdicts.filter(v => v.round === 2)

  return (
    <PageContainer size="wide" spacing="md">
      <PageHeader
        icon={<Gavel size={20} />}
        title="Dispute Review"
        subtitle={
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs">#{dispute.disputeId.slice(0, 16)}…</span>
            {isRound2 && (
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700 border border-purple-300">
                Round 2 — Appeal
              </span>
            )}
          </div>
        }
        onBack={() => navigate(`/dao/${dispute.daoId}/council`)}
        backLabel="Back to Council"
      />

      <CodexBanner className="mb-6" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-primary)] p-5 mb-6">
            <h2 className="text-base font-semibold mb-4">Dispute Details</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Status</span>
                <span className={cn('font-medium', statusColor(dispute.status))}>
                  {dispute.status}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Amount</span>
                <span className="font-medium">
                  {formatSats(dispute.ticket.amountSats || dispute.ticket.offer.priceSats, { compact: false })}{' '}
                  <FiatHint sats={dispute.ticket.amountSats || dispute.ticket.offer.priceSats} className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }} />
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Opened</span>
                <span className="font-medium">
                  {formatTime(new Date(dispute.openedAt), { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
              </div>
              {dispute.escalatedAt && (
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-secondary)]">Escalated</span>
                  <span className="font-medium">
                    {formatTime(new Date(dispute.escalatedAt), { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                  </span>
                </div>
              )}
              {dispute.resolvedAt && (
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-secondary)]">Resolved</span>
                  <span className="font-medium">
                    {formatTime(new Date(dispute.resolvedAt), { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-primary)] p-5 mb-6">
            <h2 className="text-base font-semibold mb-4">Ticket</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Title</span>
                <span className="font-medium">{dispute.ticket.offer.title}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Buyer</span>
                <span className="font-mono text-xs">{dispute.ticket.buyerPubkey.slice(0, 12)}…</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Seller</span>
                <span className="font-mono text-xs">{dispute.ticket.sellerPubkey.slice(0, 12)}…</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Ticket Status</span>
                <span className="font-medium">{dispute.ticket.status}</span>
              </div>
              {dispute.ticket.disputeReason && (
                <div>
                  <div className="text-[var(--color-text-secondary)] mb-1">Dispute Reason</div>
                  <div className="p-3 rounded-lg bg-[var(--color-surface-secondary)] text-sm">
                    {dispute.ticket.disputeReason}
                  </div>
                </div>
              )}
            </div>
          </section>

          {isTier1 && (
            <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-primary)] p-5 mb-6">
              <div className="flex items-center gap-2 mb-4">
                <ShieldCheck size={16} className="text-[var(--color-accent)]" />
                <h2 className="text-base font-semibold">Payload Disclosure (Tier 1)</h2>
              </div>
              <div className="space-y-3 text-sm">
                {disclosureSummary?.deadline && (
                  <div className="flex justify-between">
                    <span className="text-[var(--color-text-secondary)]">Disclosure Deadline</span>
                    <span className={cn(
                      'font-medium',
                      disclosureSummary.deadlineExpired ? 'text-red-600' : 'text-[var(--color-text-primary)]'
                    )}>
                      {formatTime(new Date(disclosureSummary.deadline), { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                      {disclosureSummary.deadlineExpired && ' (expired)'}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-secondary)]">Buyer Disclosed</span>
                  <span className={cn('font-medium', disclosureSummary?.buyerDisclosed ? 'text-green-600' : 'text-red-500')}>
                    {disclosureSummary?.buyerDisclosed ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-secondary)]">Seller Disclosed</span>
                  <span className={cn('font-medium', disclosureSummary?.sellerDisclosed ? 'text-green-600' : 'text-red-500')}>
                    {disclosureSummary?.sellerDisclosed ? 'Yes' : 'No'}
                  </span>
                </div>
                {dispute.disclosures.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {dispute.disclosures.map(d => (
                      <div key={d.id} className="p-2 rounded-lg bg-[var(--color-surface-secondary)] flex items-center gap-2">
                        {d.commitmentVerified
                          ? <CheckCircle size={14} className="text-green-600 shrink-0" />
                          : <AlertTriangle size={14} className="text-yellow-500 shrink-0" />
                        }
                        <span className="font-mono text-xs">{d.disclosedByPubkey.slice(0, 12)}…</span>
                        <span className="text-xs text-[var(--color-text-secondary)]">({d.method})</span>
                        <span className={cn(
                          'text-xs font-medium ml-auto',
                          d.commitmentVerified ? 'text-green-600' : 'text-yellow-600'
                        )}>
                          {d.commitmentVerified ? 'verified' : 'unverified'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {forfeitInfo && (
                  <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200">
                    <div className="flex items-center gap-2 text-red-700 text-sm font-medium">
                      <AlertTriangle size={14} />
                      Non-disclosure forfeit: {forfeitInfo.party}
                    </div>
                    <p className="text-xs text-red-600 mt-1">
                      Automatic outcome: <strong>{forfeitInfo.automaticOutcome}</strong>
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}

          {dispute.verdicts.length > 0 && (
            <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-primary)] p-5 mb-6">
              <h2 className="text-base font-semibold mb-4">
                Verdicts ({dispute.verdicts.length})
                {['COUNCIL_QUEUE', 'IN_REVIEW', 'APPEALED'].includes(dispute.status) && (
                  <span className="ml-2 text-sm font-normal text-[var(--color-text-secondary)]">
                    — {quorum.label}
                  </span>
                )}
              </h2>

              {isRound2 && round1Verdicts.length > 0 && (
                <div className="mb-4">
                  <div className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-2">
                    Round 1 — Finalized
                  </div>
                  <div className="space-y-2">
                    {round1Verdicts.map(verdict => (
                      <div key={verdict.id} className="p-3 rounded-lg bg-[var(--color-surface-secondary)] opacity-75">
                        <div className="flex justify-between items-start mb-1">
                          <span className={cn(
                            'font-medium text-sm',
                            verdict.outcome === 'RELEASE' ? 'text-green-600' : 'text-blue-600'
                          )}>
                            {verdict.outcome}
                          </span>
                          <span className="text-xs text-[var(--color-text-secondary)]">
                            {formatTime(new Date(verdict.createdAt), { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                          </span>
                        </div>
                        <div className="text-xs font-mono text-[var(--color-text-secondary)]">
                          {verdict.arbitratorPubkey.slice(0, 12)}…
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {isRound2 && round2Verdicts.length > 0 && (
                  <div className="text-xs font-semibold text-purple-600 uppercase tracking-wide mb-2">
                    Round 2 — Active
                  </div>
                )}
                {(isRound2 ? round2Verdicts : dispute.verdicts).map(verdict => (
                  <div key={verdict.id} className={cn(
                    'p-3 rounded-lg bg-[var(--color-surface-secondary)]',
                    isRound2 ? 'border border-purple-200' : ''
                  )}>
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'font-medium text-sm',
                          verdict.outcome === 'RELEASE' ? 'text-green-600' : 'text-blue-600'
                        )}>
                          {verdict.outcome}
                        </span>
                        {verdict.round === 2 && (
                          <span className="inline-flex px-1.5 py-0.5 rounded text-xs font-bold bg-purple-100 text-purple-700">R2</span>
                        )}
                      </div>
                      <span className="text-xs text-[var(--color-text-secondary)]">
                        {formatTime(new Date(verdict.createdAt), { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-[var(--color-text-secondary)] mb-2">
                      {verdict.arbitratorPubkey.slice(0, 12)}…
                    </div>
                    {verdict.reasoning && (
                      <p className="text-sm">{verdict.reasoning}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div>
          {canSubmitVerdict() ? (
            <section className="rounded-xl border border-[var(--color-accent)] bg-[var(--color-surface-primary)] p-5 sticky top-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold">Issue Verdict</h2>
                <a
                  href="/docs/protocols/governance/arbitration-rubric.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[var(--color-accent)] hover:underline flex items-center gap-1"
                >
                  📖 Arbitration Rubric
                </a>
              </div>
              <div className="mb-3 flex items-center gap-2 p-3 rounded-lg bg-[var(--color-surface-secondary)]">
                <div className="flex gap-1">
                  {Array.from({ length: quorum.required }).map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        'w-3 h-3 rounded-full',
                        i < quorum.current ? 'bg-[var(--color-accent)]' : 'border border-[var(--color-border-subtle)]'
                      )}
                    />
                  ))}
                </div>
                <span className="text-sm text-[var(--color-text-secondary)]">{quorum.label}</span>
              </div>
              <p className="text-sm text-[var(--color-text-secondary)] mb-4">
                {isRound2
                  ? 'Round 2 — Issue your verdict as a new arbitrator (Round-1 voters are excluded).'
                  : isTier1 && !disclosureSummary?.buyerDisclosed && !disclosureSummary?.sellerDisclosed
                    ? 'Awaiting payload disclosure from both parties. Non-disclosure after the deadline results in automatic forfeit.'
                    : 'As an arbitrator, review the evidence and issue a binding verdict.'}
              </p>

              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">Reasoning (optional)</label>
                <textarea
                  className="w-full p-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] text-sm resize-none"
                  rows={4}
                  placeholder="Explain the reasoning behind your verdict…"
                  value={reasoning}
                  onChange={e => setReasoning(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => handleVerdict('RELEASE')}
                  disabled={submitting}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-green-500 bg-green-50 hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <CheckCircle className="text-green-600" size={32} />
                  <span className="font-semibold text-green-700">RELEASE</span>
                  <span className="text-xs text-green-600 text-center">Funds to seller</span>
                </button>

                <button
                  onClick={() => handleVerdict('CANCEL')}
                  disabled={submitting}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-blue-500 bg-blue-50 hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <XCircle className="text-blue-600" size={32} />
                  <span className="font-semibold text-blue-700">CANCEL</span>
                  <span className="text-xs text-blue-600 text-center">Refund to buyer</span>
                </button>
              </div>

              {submitting && (
                <p className="text-center text-sm text-[var(--color-text-secondary)] mt-4">
                  Submitting verdict…
                </p>
              )}
            </section>
          ) : dispute.status === 'RESOLVED' ? (
            <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] p-5">
              <h2 className="text-base font-semibold mb-4">Case Closed</h2>
              <p className="text-sm text-[var(--color-text-secondary)] mb-2">
                This dispute has been resolved with a <strong>{dispute.outcome}</strong> verdict.
              </p>
              {dispute.resolvedAt && (
                <p className="text-xs text-[var(--color-text-secondary)]">
                  {formatTime(new Date(dispute.resolvedAt), { day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
              )}
            </section>
          ) : dispute.status === 'RESOLVED_PENDING' ? (
            <section className="rounded-xl border border-purple-300 bg-purple-50 p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex px-2 py-1 rounded-full text-xs font-bold bg-purple-200 text-purple-800">Appeal Window Open</span>
              </div>
              <h2 className="text-base font-semibold mb-2">Awaiting Appeal Decision</h2>
              <p className="text-sm text-[var(--color-text-secondary)]">
                The verdict has been issued. If no appeal is filed within the window, this case will be finalized automatically.
              </p>
            </section>
          ) : (
            <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] p-5">
              <h2 className="text-base font-semibold mb-4">Not Accepting Verdicts</h2>
              <p className="text-sm text-[var(--color-text-secondary)]">
                This dispute is not currently accepting verdicts.
              </p>
            </section>
          )}
        </div>
      </div>
    </PageContainer>
  )
}
