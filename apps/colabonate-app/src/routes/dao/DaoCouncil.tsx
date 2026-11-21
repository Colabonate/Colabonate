import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from '../../contexts/LocaleContext'
import { CodexBanner } from '@ds/ui'
import { KPIStrip } from '../../components/kpi/KpiStrip'
import type { KPIItem } from '@ds/ui'
import { apiCall } from '../../lib/api'
import { formatSats } from '../../lib/currency'
import { FiatHint } from '../../components/currency/FiatHint'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { cn } from '@ds/utils'
import { Gavel, Inbox, Eye, CheckCircle, AlertCircle, History, AlertTriangle, FileText } from 'lucide-react'
import type { Dispute } from '../council/council-types'

type CouncilView = 'active' | 'audit'

export function DaoCouncil() {
  const navigate = useNavigate()
  const { id: daoId } = useParams<{ id: string }>()
  const { formatTime } = useTranslation()
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<CouncilView>('active')

  const containerRef = usePageAnimation([
    { selector: '.council-animate', from: { duration: 0.5, stagger: 0.12, y: 24 } },
  ])

  useEffect(() => {
    setLoading(true)
    apiCall('/api/disputes')
      .then(r => r.json())
      .then(data => setDisputes(data.disputes || []))
      .catch(err => {
        console.error('Failed to fetch disputes:', err)
        setError('Failed to load disputes')
      })
      .finally(() => setLoading(false))
  }, [])

  const queueDisputes = disputes.filter(d => d.status === 'COUNCIL_QUEUE')
  const inReviewDisputes = disputes.filter(d => d.status === 'IN_REVIEW')
  const resolvedDisputes = disputes.filter(d => d.status === 'RESOLVED')

  const recentResolvedCount = useMemo(() => {
    const thirtyDaysAgo = Date.now() - 30 * 86400000
    return resolvedDisputes.filter(d => d.resolvedAt && new Date(d.resolvedAt).getTime() > thirtyDaysAgo).length
  }, [resolvedDisputes])

  const totalSatsInEscrow = useMemo(() => {
    return [...queueDisputes, ...inReviewDisputes].reduce((sum, d) => {
      return sum + (d.ticket.amountSats || d.ticket.offer.priceSats)
    }, 0)
  }, [queueDisputes, inReviewDisputes])

  const kpiItems = useMemo((): KPIItem[] => [
    { value: queueDisputes.length, label: 'Queue', icon: <Inbox size={14} />, color: 'var(--color-status-warning)', heading: 'Disputes' },
    { value: inReviewDisputes.length, label: 'In Review', icon: <Eye size={14} />, color: 'var(--color-primary-50)' },
    { value: recentResolvedCount, label: 'Resolved (30d)', icon: <CheckCircle size={14} />, color: 'var(--color-status-success)' },
    { separator: true, heading: 'Escrow', value: totalSatsInEscrow > 0 ? formatSats(totalSatsInEscrow, { compact: false }) : '—', label: 'Total in Escrow', icon: <AlertCircle size={14} />, color: 'var(--color-accent)' },
  ], [queueDisputes.length, inReviewDisputes.length, recentResolvedCount, totalSatsInEscrow])

  const statusBorderColor = (status: string) => {
    switch (status) {
      case 'COUNCIL_QUEUE': return 'var(--color-status-warning)'
      case 'IN_REVIEW': return 'var(--color-primary-50)'
      case 'RESOLVED': return 'var(--color-status-success)'
      default: return 'var(--theme-border)'
    }
  }

  const DisputeCard = ({ dispute, section }: { dispute: Dispute; section: 'queue' | 'inreview' | 'resolved' }) => (
    <div
      className={cn(
        'rounded-xl border p-4 cursor-pointer',
        'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        section === 'resolved' && 'opacity-75 hover:opacity-100',
      )}
      style={{
        borderLeftWidth: '3px',
        borderLeftColor: statusBorderColor(dispute.status),
        border: '1px solid var(--theme-border)',
        background: 'var(--theme-surface)',
      }}
      onClick={() => navigate(`/dao/${daoId}/council/disputes/${dispute.id}`)}
    >
      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="font-medium text-sm" style={{ color: 'var(--theme-text)' }}>{dispute.ticket.offer.title}</div>
          <div className="text-xs font-mono" style={{ color: 'var(--theme-text-muted)' }}>#{dispute.disputeId.slice(0, 16)}…</div>
        </div>
        <div className="text-right">
          {section !== 'resolved' ? (
            <>
              <div className="text-sm font-semibold" style={{ color: 'var(--color-accent)' }}>
                {formatSats(dispute.ticket.amountSats || dispute.ticket.offer.priceSats, { compact: false })}
              </div>
              <FiatHint sats={dispute.ticket.amountSats || dispute.ticket.offer.priceSats} className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }} />
              <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                {formatTime(new Date(dispute.openedAt), { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
              </div>
            </>
          ) : (
            <>
              <div className={cn('text-sm font-semibold', dispute.outcome === 'RELEASE' ? 'text-green-600' : 'text-blue-600')}>
                {dispute.outcome}
              </div>
              <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                {dispute.resolvedAt ? formatTime(new Date(dispute.resolvedAt), { day: '2-digit', month: 'short' }) : '—'}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="flex gap-4 text-xs" style={{ color: 'var(--theme-text-muted)' }}>
        <span>Buyer: {dispute.ticket.buyerPubkey.slice(0, 8)}…</span>
        <span>Seller: {dispute.ticket.sellerPubkey.slice(0, 8)}…</span>
        {section === 'queue' && <span>Ticket: #{dispute.ticket.id.slice(0, 8)}</span>}
        {section === 'inreview' && (
          <span>
            {dispute.verdicts.filter(v => v.outcome === 'RELEASE').length} R / {dispute.verdicts.filter(v => v.outcome === 'CANCEL').length} C
          </span>
        )}
        {section === 'resolved' && <span>{dispute.verdicts.length} verdict(s)</span>}
      </div>
    </div>
  )

  const SkeletonCard = () => (
    <div className="rounded-xl border p-4 animate-pulse" style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}>
      <div className="flex justify-between items-start mb-2">
        <div className="flex-1">
          <div className="h-4 w-32 rounded mb-2" style={{ background: 'var(--theme-surface-secondary)' }} />
          <div className="h-3 w-24 rounded" style={{ background: 'var(--theme-surface-secondary)' }} />
        </div>
        <div className="text-right">
          <div className="h-4 w-16 rounded mb-1" style={{ background: 'var(--theme-surface-secondary)' }} />
          <div className="h-3 w-20 rounded" style={{ background: 'var(--theme-surface-secondary)' }} />
        </div>
      </div>
      <div className="flex gap-4">
        <div className="h-3 w-20 rounded" style={{ background: 'var(--theme-surface-secondary)' }} />
        <div className="h-3 w-20 rounded" style={{ background: 'var(--theme-surface-secondary)' }} />
      </div>
    </div>
  )

  const dissentCount = (dispute: Dispute) => {
    if (!dispute.outcome) return 0
    const maxR = Math.max(...dispute.verdicts.map(v => v.round), 0)
    const finalRoundVerdicts = dispute.verdicts.filter(v => v.round === maxR)
    return finalRoundVerdicts.filter(v => v.outcome !== dispute.outcome).length
  }

  const maxRound = (dispute: Dispute) => Math.max(...dispute.verdicts.map(v => v.round), 1)

  const renderAuditTable = () => (
    <table className="w-full text-sm">
      <thead className="text-left" style={{ background: 'var(--theme-surface-secondary)' }}>
        <tr>
          <th className="px-4 py-3 font-medium text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>Dispute</th>
          <th className="px-4 py-3 font-medium text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>Ticket</th>
          <th className="px-4 py-3 font-medium text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>Round</th>
          <th className="px-4 py-3 font-medium text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>Outcome</th>
          <th className="px-4 py-3 font-medium text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>Verdicts</th>
          <th className="px-4 py-3 font-medium text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>Dissent</th>
          <th className="px-4 py-3 font-medium text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>Resolved</th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          [1, 2, 3, 4, 5].map(i => (
            <tr key={i} className="border-t" style={{ borderColor: 'var(--theme-border)' }}>
              <td className="px-4 py-3"><div className="h-3 w-24 rounded animate-pulse" style={{ background: 'var(--theme-surface-secondary)' }} /></td>
              <td className="px-4 py-3"><div className="h-3 w-32 rounded animate-pulse" style={{ background: 'var(--theme-surface-secondary)' }} /></td>
              <td className="px-4 py-3"><div className="h-5 w-10 rounded-full animate-pulse" style={{ background: 'var(--theme-surface-secondary)' }} /></td>
              <td className="px-4 py-3"><div className="h-5 w-14 rounded-full animate-pulse" style={{ background: 'var(--theme-surface-secondary)' }} /></td>
              <td className="px-4 py-3 text-center"><div className="h-3 w-6 rounded mx-auto animate-pulse" style={{ background: 'var(--theme-surface-secondary)' }} /></td>
              <td className="px-4 py-3 text-center"><div className="h-3 w-6 rounded mx-auto animate-pulse" style={{ background: 'var(--theme-surface-secondary)' }} /></td>
              <td className="px-4 py-3"><div className="h-3 w-20 rounded animate-pulse" style={{ background: 'var(--theme-surface-secondary)' }} /></td>
            </tr>
          ))
        ) : (
          resolvedDisputes.map(dispute => (
            <tr
              key={dispute.id}
              className="border-t cursor-pointer transition-colors duration-200"
              style={{ borderColor: 'var(--theme-border)' }}
              onClick={() => navigate(`/dao/${daoId}/council/disputes/${dispute.id}`)}
            >
              <td className="px-4 py-3">
                <div className="font-mono text-xs" style={{ color: 'var(--theme-text)' }}>
                  {dispute.disputeId.slice(0, 16)}…
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm truncate max-w-[200px]" style={{ color: 'var(--theme-text)' }}>
                  {dispute.ticket.offer.title}
                </div>
              </td>
              <td className="px-4 py-3">
                {maxRound(dispute) > 1 ? (
                  <div className="flex flex-col gap-1">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: 'rgba(159,122,234,0.15)', color: '#7c3aed' }}>
                      R{maxRound(dispute)}
                    </span>
                    {dispute.appealRequest && (
                      <span className="inline-flex px-1.5 py-0.5 rounded text-xs font-semibold" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--color-status-error)' }}>
                        appealed
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: 'rgba(113,128,150,0.12)', color: 'var(--theme-text-muted)' }}>
                    R1
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                <span
                  className="inline-flex px-2 py-1 rounded-full text-xs font-semibold"
                  style={dispute.outcome === 'RELEASE'
                    ? { background: 'rgba(72,187,120,0.15)', color: '#16a34a' }
                    : { background: 'rgba(59,130,246,0.15)', color: '#2563eb' }
                  }
                >
                  {dispute.outcome}
                </span>
              </td>
              <td className="px-4 py-3 text-center">
                <span className="font-medium" style={{ color: 'var(--theme-text)' }}>{dispute.verdicts.length}</span>
              </td>
              <td className="px-4 py-3 text-center">
                {dissentCount(dispute) > 0 ? (
                  <span className="font-medium flex items-center justify-center gap-1" style={{ color: 'var(--color-status-error)' }}>
                    <AlertTriangle size={12} />
                    {dissentCount(dispute)}
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-1" style={{ color: 'var(--theme-text-muted)' }}>
                    <CheckCircle size={12} />
                    —
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                {dispute.resolvedAt
                  ? formatTime(new Date(dispute.resolvedAt), { day: '2-digit', month: 'short', year: 'numeric' })
                  : '—'}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )

  return (
    <div ref={containerRef} className="council-animate space-y-6">
      <CodexBanner />

      <KPIStrip
        items={kpiItems}
        loading={loading}
        skeletonCount={4}
        wrap
        collapsible
        storageKey="kpi-dao-council"
      />

      <div className="flex gap-2">
        <button
          onClick={() => setView('active')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer',
          )}
          style={{
            background: view === 'active' ? 'var(--color-primary-50)' : 'var(--theme-surface)',
            color: view === 'active' ? 'white' : 'var(--theme-text)',
            border: view === 'active' ? 'none' : '1px solid var(--theme-border)',
          }}
        >
          <Gavel size={14} />
          Active Disputes
        </button>
        <button
          onClick={() => setView('audit')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer',
          )}
          style={{
            background: view === 'audit' ? 'var(--color-primary-50)' : 'var(--theme-surface)',
            color: view === 'audit' ? 'white' : 'var(--theme-text)',
            border: view === 'audit' ? 'none' : '1px solid var(--theme-border)',
          }}
        >
          <History size={14} />
          Audit Log
        </button>
      </div>

      {loading ? (
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : error ? (
        <div
          className="rounded-xl border p-4"
          style={{ border: '1px solid var(--color-status-error)', background: 'rgba(239,68,68,0.08)', color: 'var(--color-status-error)' }}
        >
          {error}
        </div>
      ) : view === 'active' ? (
        <>
          {queueDisputes.length > 0 && (
            <section className="mb-8">
              <h2 className="text-[18px] font-semibold mb-1" style={{ color: 'var(--theme-text)' }}>
                Council Queue ({queueDisputes.length})
              </h2>
              <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>Awaiting first verdict</p>
              <div className="space-y-3">
                {queueDisputes.map(dispute => (
                  <DisputeCard key={dispute.id} dispute={dispute} section="queue" />
                ))}
              </div>
            </section>
          )}

          {inReviewDisputes.length > 0 && (
            <section className="mb-8">
              <h2 className="text-[18px] font-semibold mb-1" style={{ color: 'var(--theme-text)' }}>
                In Review ({inReviewDisputes.length})
              </h2>
              <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>Verdicts submitted, awaiting quorum</p>
              <div className="space-y-3">
                {inReviewDisputes.map(dispute => (
                  <DisputeCard key={dispute.id} dispute={dispute} section="inreview" />
                ))}
              </div>
            </section>
          )}

          {queueDisputes.length === 0 && inReviewDisputes.length === 0 && (
            <section className="mb-8">
              <div
                className="rounded-xl border p-6 text-center"
                style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
              >
                <div className="flex items-center justify-center w-12 h-12 rounded-xl mx-auto mb-3" style={{ background: 'rgba(99,179,237,0.12)' }}>
                  <CheckCircle size={24} style={{ color: 'var(--color-primary-50)' }} />
                </div>
                <p className="text-[14px] font-medium mb-1" style={{ color: 'var(--theme-text)' }}>No disputes pending review</p>
                <p className="text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>All disputes have been resolved. Check the audit log for history.</p>
              </div>
            </section>
          )}

          {resolvedDisputes.length > 0 && (
            <section>
              <h2 className="text-[18px] font-semibold mb-1" style={{ color: 'var(--theme-text)' }}>
                Recently Resolved ({resolvedDisputes.length})
              </h2>
              <div className="space-y-3">
                {resolvedDisputes.slice(0, 5).map(dispute => (
                  <DisputeCard key={dispute.id} dispute={dispute} section="resolved" />
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <div
          className="council-animate rounded-xl border overflow-hidden"
          style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
        >
          {!loading && resolvedDisputes.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center" style={{ background: 'var(--theme-surface)' }}>
              <div className="flex items-center justify-center w-12 h-12 rounded-xl mb-4" style={{ background: 'rgba(99,179,237,0.12)' }}>
                <FileText size={24} style={{ color: 'var(--color-primary-50)' }} />
              </div>
              <p className="text-[14px] font-medium mb-1" style={{ color: 'var(--theme-text)' }}>No resolved disputes yet</p>
              <p className="text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>Resolved disputes will appear here as an audit record for signed-in members; each verdict is also published as a Nostr event for outside verification.</p>
            </div>
          ) : (
            renderAuditTable()
          )}
        </div>
      )}
    </div>
  )
}
