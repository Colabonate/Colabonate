import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from '../../contexts/LocaleContext'
import { PageContainer } from '@ds/ui'
import { KPIStrip } from '../../components/kpi/KpiStrip'
import type { KPIItem } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { NotFoundState } from '../../components/NotFoundState'
import { apiCall } from '../../lib/api'
import { formatSats } from '../../lib/currency'
import { FiatHint } from '../../components/currency/FiatHint'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { cn } from '@ds/utils'
import { ThumbsUp, ThumbsDown, Minus, Clock, CheckCircle, XCircle, Vote, MessageSquare, Ban } from 'lucide-react'
import type { Proposal, ProposalType } from './dao-types'
import { CODEX_DEFAULTS, PROPOSAL_TYPE_LABELS } from './dao-types'
import { CodexDiffViewer } from './dao-codex-diff-viewer'
import { useQueryClient } from '@tanstack/react-query'
import { useDaoProposal } from '../../hooks/useEntityQueries'

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  DRAFT: { bg: 'rgba(255,192,57,0.12)', text: 'var(--color-warning-primary)', border: 'var(--color-warning-primary)' },
  COMMENT_PERIOD: { bg: 'rgba(159,122,234,0.12)', text: 'var(--color-secondary-50)', border: 'var(--color-secondary-50)' },
  PASSED: { bg: 'rgba(72,187,120,0.12)', text: 'var(--color-status-success)', border: 'var(--color-status-success)' },
  REJECTED: { bg: 'rgba(245,101,101,0.12)', text: 'var(--color-status-error)', border: 'var(--color-status-error)' },
  ACTIVE: { bg: 'rgba(99,179,237,0.12)', text: 'var(--color-primary-50)', border: 'var(--color-primary-50)' },
  EXECUTED: { bg: 'rgba(72,187,120,0.12)', text: 'var(--color-status-success)', border: 'var(--color-status-success)' },
  CANCELLED: { bg: 'var(--theme-bg-subtle)', text: 'var(--theme-text-muted)', border: 'var(--theme-border)' },
}

function statusStyle(status: string) {
  return STATUS_COLORS[status] ?? { bg: 'var(--theme-bg-subtle)', text: 'var(--theme-text-muted)', border: 'var(--theme-border)' }
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0d 0h 0m'
  const days = Math.floor(ms / 86400000)
  const hours = Math.floor((ms % 86400000) / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  return `${days}d ${hours}h ${minutes}m`
}

export function DaoProposalDetail() {
  const navigate = useNavigate()
  const { id, pid } = useParams<{ id: string; pid: string }>()
  const { formatTime, formatNumber } = useTranslation()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [voting, setVoting] = useState(false)
  const [voted, setVoted] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(interval)
  }, [])

  const { data, isLoading: loading, error: queryError } = useDaoProposal(id || '', pid || '')
  const proposal = data as Proposal | undefined

  const containerRef = usePageAnimation([
    { selector: '.proposal-animate', from: { duration: 0.5, stagger: 0.12, y: 20 } },
  ])

  useEffect(() => {
    if (queryError) {
      setError('Failed to load proposal')
    } else if (!loading && !proposal) {
      setError('Proposal not found')
    } else {
      setError(null)
    }
  }, [queryError, loading, proposal])

  async function castVote(choice: 'FOR' | 'AGAINST' | 'ABSTAIN') {
    if (!id || !pid || voted) return
    setVoting(true)

    try {
      const pubkey = localStorage.getItem('pubkey')
      if (!pubkey) {
        alert('Please sign in with Nostr first')
        return
      }

      const res = await apiCall(`/api/daos/${id}/proposals/${pid}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callerPubkey: pubkey, choice }),
      })
      const data = await res.json()

      if (data.proposal) {
        queryClient.invalidateQueries({ queryKey: ['daoProposal', id, pid] })
        queryClient.invalidateQueries({ queryKey: ['daoProposals', id] })
        setVoted(true)
      } else {
        alert(data.error || 'Failed to cast vote')
      }
    } catch (err) {
      console.error('Failed to cast vote:', err)
      alert('Failed to cast vote')
    } finally {
      setVoting(false)
    }
  }

  async function cancelProposal() {
    if (!id || !pid) return
    if (!confirm('Cancel this proposal? This action cannot be undone.')) return

    try {
      const pubkey = localStorage.getItem('pubkey')
      if (!pubkey) { alert('Please sign in first'); return }

      const res = await apiCall(`/api/daos/${id}/proposals/${pid}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callerPubkey: pubkey }),
      })
      const data = await res.json()
      if (data.proposal) {
        queryClient.invalidateQueries({ queryKey: ['daoProposal', id, pid] })
        queryClient.invalidateQueries({ queryKey: ['daoProposals', id] })
      } else {
        alert(data.error || 'Failed to cancel proposal')
      }
    } catch (err) {
      console.error('Failed to cancel:', err)
      alert('Failed to cancel proposal')
    }
  }

  if (loading) {
    return (
      <PageContainer size="wide" spacing="lg" className="pt-0!">
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div
              className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin mx-auto mb-4"
              style={{ borderColor: 'var(--color-primary-50) var(--color-primary-50) var(--color-primary-50) transparent' }}
            />
            <p style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
              Loading proposal...
            </p>
          </div>
        </div>
      </PageContainer>
    )
  }

  if (error || !proposal) {
    return (
      <NotFoundState
        icon={<Vote size={48} />}
        title="Proposal not found"
        message="This proposal may have been withdrawn, or the link is incorrect."
        detail={pid ? `Proposal ${pid}` : undefined}
        primary={{ label: 'Back to DAO', to: `/dao/${id}` }}
        secondary={{ label: 'Go back', onClick: () => navigate(-1) }}
      />
    )
  }

  const votesFor = proposal.votes.filter(v => v.choice === 'FOR')
  const votesAgainst = proposal.votes.filter(v => v.choice === 'AGAINST')
  const votesAbstain = proposal.votes.filter(v => v.choice === 'ABSTAIN')

  const vpFor = votesFor.reduce((sum, v) => sum + v.votingPower, 0)
  const vpAgainst = votesAgainst.reduce((sum, v) => sum + v.votingPower, 0)
  const vpAbstain = votesAbstain.reduce((sum, v) => sum + v.votingPower, 0)
  const totalVp = vpFor + vpAgainst + vpAbstain

  const votingPeriodEnd = proposal.votingEnd ? new Date(proposal.votingEnd).getTime() : 0
  const timeRemaining = votingPeriodEnd - now
  const isDraft = proposal.status === 'DRAFT'
  const isCommentPeriod = proposal.status === 'COMMENT_PERIOD'
  const isVotingActive = !isDraft && !isCommentPeriod && proposal.status === 'ACTIVE' && timeRemaining > 0

  const commentPeriodEnd = proposal.commentPeriodEnd ? new Date(proposal.commentPeriodEnd).getTime() : 0
  const commentTimeRemaining = commentPeriodEnd - now

  const typeDefaults = CODEX_DEFAULTS[proposal.proposalType as ProposalType] ?? CODEX_DEFAULTS.NORMAL_DECISION
  const typeLabel = PROPOSAL_TYPE_LABELS[proposal.proposalType as ProposalType] ?? proposal.proposalType

  const sc = statusStyle(proposal.status)

  const executionPayload = proposal.executionPayload as Record<string, unknown> | null

  const voteKpis: KPIItem[] = [
    {
      value: votesFor.length,
      label: 'Votes For',
      icon: <ThumbsUp size={14} />,
      heading: 'Voting',
      color: 'var(--color-status-success)',
      tooltip: `${formatNumber(vpFor)} voting power`,
    },
    {
      value: votesAgainst.length,
      label: 'Votes Against',
      icon: <ThumbsDown size={14} />,
      color: 'var(--color-status-error)',
      tooltip: `${formatNumber(vpAgainst)} voting power`,
    },
    {
      value: votesAbstain.length,
      label: 'Abstain',
      icon: <Minus size={14} />,
      tooltip: `${formatNumber(vpAbstain)} voting power`,
    },
  ]

  return (
    <PageContainer size="wide" spacing="lg" className="pt-0!">
      <div ref={containerRef} className="max-w-3xl mx-auto space-y-6">
        <PageHeader
          icon={<Vote size={18} />}
          title={proposal.title}
          subtitle={`Proposal by ${proposal.authorPubkey.slice(0, 12)}...`}
          onBack={() => navigate(`/dao/${id}`)}
        />

        <div className="proposal-animate">
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span
              className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest leading-none"
              style={{
                background: sc.bg,
                color: sc.text,
                fontFamily: 'var(--typography-fontfamily-sans)',
              }}
            >
              {proposal.status}
            </span>
            <span
              className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest leading-none"
              style={{
                background: 'rgba(99,179,237,0.08)',
                color: 'var(--color-primary-50)',
                border: '1px solid rgba(99,179,237,0.2)',
                fontFamily: 'var(--typography-fontfamily-sans)',
              }}
            >
              {typeLabel}
            </span>
            {isVotingActive && timeRemaining > 0 && (
              <span
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest leading-none"
                style={{
                  background: 'rgba(255,192,57,0.12)',
                  color: 'var(--color-warning-primary)',
                  fontFamily: 'var(--typography-fontfamily-sans)',
                }}
              >
                <Clock size={10} />
                {formatCountdown(timeRemaining)}
              </span>
            )}
          </div>

          <div
            className="flex flex-wrap gap-3 p-3 rounded-lg mb-4"
            style={{
              background: 'rgba(99,179,237,0.06)',
              border: '1px solid rgba(99,179,237,0.15)',
            }}
          >
            <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
              Voting: <strong style={{ color: 'var(--theme-text)' }}>{Math.round(typeDefaults.votingPeriodSeconds / 86400)}d</strong>
            </span>
            <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
              Quorum: <strong style={{ color: 'var(--theme-text)' }}>{typeDefaults.quorumPercent}%</strong>
            </span>
            <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
              Majority: <strong style={{ color: 'var(--theme-text)' }}>{typeDefaults.majorityPercent}%</strong>
            </span>
          </div>

          <div
            className="p-6 rounded-xl"
            style={{
              border: '1px solid var(--theme-border)',
              background: 'var(--theme-surface)',
            }}
          >
            <span
              className="text-[14px] leading-relaxed whitespace-pre-wrap"
              style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              {proposal.content}
            </span>
          </div>

          {proposal.proposalType === 'CODEX_AMENDMENT' && executionPayload && (
            <>
              <div
                className="mt-4 p-4 rounded-lg"
                style={{
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-surface-secondary)',
                }}
              >
                <h4
                  className="text-[13px] font-semibold mb-3"
                  style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                >
                  Codex Amendment Details
                </h4>
                <div className="grid grid-cols-2 gap-3 text-[12px]" style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>New Hash</span>
                    <span className="font-mono text-[11px]" style={{ color: 'var(--theme-text)' }}>{String(executionPayload.newCodexHash ?? '').slice(0, 24)}...</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>New Version</span>
                    <span style={{ color: 'var(--theme-text)' }}>{String(executionPayload.newCodexVersion ?? '')}</span>
                  </div>
                  {String(executionPayload.diffSummary ?? '') && (
                    <div className="col-span-2">
                      <span className="block text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>Diff Summary</span>
                      <span style={{ color: 'var(--theme-text)' }}>{String(executionPayload.diffSummary)}</span>
                    </div>
                  )}
                </div>
              </div>
              {proposal.dao?.codexUrl && executionPayload.codexUrl && (
                <CodexDiffViewer
                  codexUrl={proposal.dao.codexUrl}
                  newCodexUrl={String(executionPayload.codexUrl)}
                />
              )}
            </>
          )}

          {proposal.proposalType === 'TREASURY_SPENDING' && executionPayload && (
            <div
              className="mt-4 p-4 rounded-lg"
              style={{
                border: '1px solid var(--theme-border)',
                background: 'var(--theme-surface-secondary)',
              }}
            >
              <h4
                className="text-[13px] font-semibold mb-3"
                style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                Treasury Spending Details
              </h4>
              <div className="grid grid-cols-2 gap-3 text-[12px]" style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}>
                <div>
                  <span className="block text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>Recipient</span>
                  <span className="font-mono text-[11px]" style={{ color: 'var(--theme-text)' }}>{String(executionPayload.recipientPubkey ?? '').slice(0, 20)}...</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>Amount</span>
                  <span style={{ color: 'var(--theme-text)' }}>
                    {formatSats(Number(executionPayload.amountSats ?? 0), { compact: false })}{' '}
                    <FiatHint sats={Number(executionPayload.amountSats ?? 0)} className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }} />
                  </span>
                </div>
                {String(executionPayload.justification ?? '') && (
                  <div className="col-span-2">
                    <span className="block text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>Justification</span>
                    <span style={{ color: 'var(--theme-text)' }}>{String(executionPayload.justification)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {proposal.proposalType === 'SANCTION' && executionPayload && (
            <div
              className="mt-4 p-4 rounded-lg"
              style={{
                border: '1px solid var(--theme-border)',
                background: 'var(--theme-surface-secondary)',
              }}
            >
              <h4
                className="text-[13px] font-semibold mb-3"
                style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                Sanction Details
              </h4>
              <div className="grid grid-cols-2 gap-3 text-[12px]" style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}>
                <div>
                  <span className="block text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>Target</span>
                  <span className="font-mono text-[11px]" style={{ color: 'var(--theme-text)' }}>{String(executionPayload.targetPubkey ?? '').slice(0, 20)}...</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>Level</span>
                  <span style={{ color: 'var(--theme-text)' }}>
                    {Number(executionPayload.sanctionLevel) === 1 ? 'Warning' : Number(executionPayload.sanctionLevel) === 2 ? 'Restriction' : 'Ban'}
                  </span>
                </div>
                {String(executionPayload.reason ?? '') && (
                  <div className="col-span-2">
                    <span className="block text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>Reason</span>
                    <span style={{ color: 'var(--theme-text)' }}>{String(executionPayload.reason)}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <KPIStrip
          items={voteKpis}
          loading={loading}
          skeletonCount={3}
          wrap
          collapsible
          storageKey="kpi-proposal-detail"
          className="proposal-animate"
        />

        {totalVp > 0 && (
          <div className="proposal-animate">
            <div
              className="flex h-3 rounded-full overflow-hidden"
              style={{ background: 'var(--theme-surface-secondary)' }}
            >
              <div
                className="transition-all"
                style={{
                  width: `${(vpFor / totalVp) * 100}%`,
                  background: 'var(--color-status-success)',
                }}
              />
              <div
                className="transition-all"
                style={{
                  width: `${(vpAgainst / totalVp) * 100}%`,
                  background: 'var(--color-status-error)',
                }}
              />
              <div
                className="transition-all"
                style={{
                  width: `${(vpAbstain / totalVp) * 100}%`,
                  background: 'var(--color-neutral-8)',
                }}
              />
            </div>
            <span
              className="text-[11px] mt-1 block"
              style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              {formatNumber(totalVp)} total voting power
            </span>
          </div>
        )}

        {isDraft && (
          <StatusBanner
            icon={<Clock size={18} />}
            message="This proposal is a draft and not yet open for voting."
            variant="warning"
          />
        )}

        {isCommentPeriod && (
          <div className="proposal-animate space-y-4">
            <StatusBanner
              icon={<MessageSquare size={18} />}
              message={`Comment period — voting opens in ${formatCountdown(commentTimeRemaining)}`}
              variant="info"
            />
            <div
              className="p-4 rounded-xl"
              style={{
                border: '1px solid var(--theme-border)',
                background: 'var(--theme-surface)',
              }}
            >
              <h4
                className="text-[13px] font-semibold mb-3"
                style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                Comments
              </h4>
              {proposal.comments && proposal.comments.length > 0 ? (
                <div className="space-y-3">
                  {proposal.comments.map(comment => (
                    <div
                      key={comment.id}
                      className="p-3 rounded-lg"
                      style={{
                        background: 'var(--theme-surface-secondary)',
                        border: '1px solid var(--theme-border)',
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="text-[11px] font-mono font-medium"
                          style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                        >
                          {comment.authorPubkey.slice(0, 12)}...
                        </span>
                        <span
                          className="text-[10px]"
                          style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                        >
                          {formatTime(comment.createdAt)}
                        </span>
                      </div>
                      <p
                        className="text-[12px]"
                        style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                      >
                        {comment.content}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p
                  className="text-[12px] py-4 text-center"
                  style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                >
                  No comments yet. Be the first to comment on this amendment.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="proposal-animate">
          <button
            onClick={() => navigate(`/dao/${id}/proposals/new?draft=${pid}`)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-bold uppercase tracking-widest transition-all duration-200 hover:opacity-90 active:scale-95"
            style={{
              background: 'var(--color-primary-50)',
              color: 'white',
              fontFamily: 'var(--typography-fontfamily-sans)',
              display: isDraft ? 'flex' : 'none',
            }}
          >
            Edit & Publish
          </button>
        </div>

        {isVotingActive && (
          <div
            className="p-6 rounded-xl proposal-animate"
            style={{
              border: '1px solid var(--theme-border)',
              background: 'var(--theme-surface)',
            }}
          >
            <div className="flex items-center gap-3 mb-4">
              <Clock size={16} style={{ color: 'var(--color-primary-50)' }} />
              <span
                className="text-[13px] font-medium"
                style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                Voting ends {formatTime(proposal.votingEnd ?? '')}
              </span>
            </div>

            {voted ? (
              <div
                className="flex items-center gap-3 p-4 rounded-lg"
                style={{
                  background: 'rgba(72,187,120,0.08)',
                  border: '1px solid rgba(72,187,120,0.2)',
                }}
              >
                <CheckCircle size={18} style={{ color: 'var(--color-status-success)' }} />
                <span
                  className="text-[13px]"
                  style={{ color: 'var(--color-status-success)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                >
                  You have already cast your vote on this proposal.
                </span>
              </div>
            ) : (
              <div className="flex gap-3">
                <button
                  onClick={() => castVote('FOR')}
                  disabled={voting}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl',
                    'text-[12px] font-bold uppercase tracking-widest transition-all duration-200',
                    'hover:opacity-90 active:scale-95',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                  style={{
                    background: 'var(--color-status-success)',
                    color: 'white',
                    fontFamily: 'var(--typography-fontfamily-sans)',
                  }}
                >
                  <ThumbsUp size={14} />
                  Vote For
                </button>
                <button
                  onClick={() => castVote('AGAINST')}
                  disabled={voting}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl',
                    'text-[12px] font-bold uppercase tracking-widest transition-all duration-200',
                    'hover:opacity-90 active:scale-95',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                  style={{
                    background: 'var(--color-status-error)',
                    color: 'white',
                    fontFamily: 'var(--typography-fontfamily-sans)',
                  }}
                >
                  <ThumbsDown size={14} />
                  Vote Against
                </button>
                <button
                  onClick={() => castVote('ABSTAIN')}
                  disabled={voting}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl',
                    'text-[12px] font-bold uppercase tracking-widest transition-all duration-200',
                    'hover:opacity-90 active:scale-95',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                  style={{
                    background: 'var(--theme-surface-secondary)',
                    color: 'var(--theme-text)',
                    border: '1px solid var(--theme-border)',
                    fontFamily: 'var(--typography-fontfamily-sans)',
                  }}
                >
                  <Minus size={14} />
                  Abstain
                </button>
              </div>
            )}
          </div>
        )}

        {!isVotingActive && proposal.status === 'ACTIVE' && (
          <StatusBanner
            icon={<Clock size={18} />}
            message="Voting period has ended. This proposal is awaiting resolution."
            variant="warning"
          />
        )}

        {proposal.status === 'PASSED' && (
          <StatusBanner
            icon={<CheckCircle size={18} />}
            message="This proposal has passed and is awaiting execution."
            variant="success"
          />
        )}

        {proposal.status === 'EXECUTED' && (
          <StatusBanner
            icon={<CheckCircle size={18} />}
            message="This proposal has been executed."
            variant="success"
          />
        )}

        {proposal.status === 'REJECTED' && (
          <StatusBanner
            icon={<XCircle size={18} />}
            message="This proposal has been rejected."
            variant="error"
          />
        )}

        {proposal.status === 'CANCELLED' && (
          <StatusBanner
            icon={<Ban size={18} />}
            message="This proposal has been cancelled by the author."
            variant="warning"
          />
        )}

        {(isDraft || isCommentPeriod || (proposal.status === 'ACTIVE' && timeRemaining > 0)) && (
          <div className="proposal-animate">
            <button
              onClick={cancelProposal}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-bold uppercase tracking-widest transition-all duration-200 hover:opacity-90 active:scale-95"
              style={{
                background: 'rgba(245,101,101,0.08)',
                color: 'var(--color-status-error)',
                border: '1px solid rgba(245,101,101,0.2)',
                fontFamily: 'var(--typography-fontfamily-sans)',
              }}
            >
              <Ban size={14} />
              Cancel Proposal
            </button>
          </div>
        )}

        <div className="proposal-animate">
          <h3
            className="text-[15px] font-semibold mb-4"
            style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            Vote History
          </h3>

          {proposal.votes.length === 0 ? (
            <div
              className="flex flex-col items-center py-12 gap-3 rounded-xl"
              style={{
                border: '1px solid var(--theme-border)',
                background: 'var(--theme-surface)',
              }}
            >
              <Vote size={24} style={{ color: 'var(--theme-text-muted)', opacity: 0.3 }} />
              <span
                className="text-[13px]"
                style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                No votes cast yet
              </span>
            </div>
          ) : (
            <div
              className="rounded-xl overflow-hidden"
              style={{
                border: '1px solid var(--theme-border)',
                background: 'var(--theme-surface)',
              }}
            >
              {proposal.votes.map((vote, i) => (
                <div
                  key={vote.id}
                  className={cn(
                    'flex items-center justify-between px-4 py-3',
                    i < proposal.votes.length - 1 && 'border-b',
                  )}
                  style={{ borderBottomColor: 'var(--theme-border)' }}
                >
                  <div className="flex items-center gap-3">
                    {vote.choice === 'FOR' && <ThumbsUp size={14} style={{ color: 'var(--color-status-success)' }} />}
                    {vote.choice === 'AGAINST' && <ThumbsDown size={14} style={{ color: 'var(--color-status-error)' }} />}
                    {vote.choice === 'ABSTAIN' && <Minus size={14} style={{ color: 'var(--theme-text-muted)' }} />}
                    <span
                      className="text-[12px] font-medium"
                      style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                    >
                      {vote.voterPubkey.slice(0, 12)}...
                    </span>
                  </div>
                  <span
                    className="text-[11px]"
                    style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                  >
                    {formatNumber(vote.votingPower)} VP via {vote.strategyUsed}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  )
}

function StatusBanner({ icon, message, variant }: {
  icon: React.ReactNode
  message: string
  variant: 'success' | 'error' | 'warning' | 'info'
}) {
  const colors = {
    success: { bg: 'rgba(72,187,120,0.08)', border: 'rgba(72,187,120,0.2)', text: 'var(--color-status-success)' },
    error: { bg: 'rgba(245,101,101,0.08)', border: 'rgba(245,101,101,0.2)', text: 'var(--color-status-error)' },
    warning: { bg: 'rgba(255,192,57,0.08)', border: 'rgba(255,192,57,0.2)', text: 'var(--color-warning-primary)' },
    info: { bg: 'rgba(159,122,234,0.08)', border: 'rgba(159,122,234,0.2)', text: 'var(--color-secondary-50)' },
  }
  const c = colors[variant]

  return (
    <div
      className="flex items-center gap-3 p-4 rounded-xl"
      style={{ background: c.bg, border: `1px solid ${c.border}` }}
    >
      {icon}
      <span
        className="text-[13px]"
        style={{ color: c.text, fontFamily: 'var(--typography-fontfamily-sans)' }}
      >
        {message}
      </span>
    </div>
  )
}
