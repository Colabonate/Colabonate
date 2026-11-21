import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from '../../contexts/LocaleContext'
import { PageContainer, CodexBanner } from '@ds/ui'
import { KPIStrip } from '../../components/kpi/KpiStrip'
import type { KPIItem } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { apiCall } from '../../lib/api'
import { formatSats } from '../../lib/currency'
import { FiatHint } from '../../components/currency/FiatHint'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { cn } from '@ds/utils'
import { Gavel, Inbox, Eye, CheckCircle, AlertCircle } from 'lucide-react'
import type { Dispute } from './council-types'

export function CouncilDashboard() {
  const navigate = useNavigate()
  // Mounted at /dao/:id/council (App.tsx) — every internal link here needs
  // this prefix. Previously all hardcoded to a flat /council/* tree that was
  // never registered as a route (found 2026-09-18 while verifying the DAO
  // dispute-resolution flow end-to-end).
  const { id: daoId } = useParams<{ id: string }>()
  const { formatTime } = useTranslation()
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const containerRef = usePageAnimation([
    { selector: '.dashboard-animate', from: { duration: 0.5, stagger: 0.12, y: 24 } },
  ])

  useEffect(() => {
    setLoading(true)
    apiCall('/api/disputes')
      .then(r => r.json())
      .then(data => {
        setDisputes(data.disputes || [])
      })
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
    {
      value: queueDisputes.length,
      label: 'Queue',
      icon: <Inbox size={14} />,
      color: 'var(--color-status-warning)',
      heading: 'Disputes',
    },
    {
      value: inReviewDisputes.length,
      label: 'In Review',
      icon: <Eye size={14} />,
      color: 'var(--color-primary-50)',
    },
    {
      value: recentResolvedCount,
      label: 'Resolved (30d)',
      icon: <CheckCircle size={14} />,
      color: 'var(--color-status-success)',
    },
    {
      separator: true,
      heading: 'Escrow',
      value: totalSatsInEscrow > 0 ? formatSats(totalSatsInEscrow, { compact: false }) : '—',
      label: 'Total in Escrow',
      icon: <AlertCircle size={14} />,
      color: 'var(--color-accent)',
    },
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
        'rounded-xl border bg-[var(--theme-surface)] p-4 cursor-pointer',
        'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        section === 'resolved' && 'opacity-75 hover:opacity-100'
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
          <div className="text-xs font-mono" style={{ color: 'var(--theme-text-muted)' }}>
            #{dispute.disputeId.slice(0, 16)}…
          </div>
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
              <div className={cn(
                'text-sm font-semibold',
                dispute.outcome === 'RELEASE' ? 'text-green-600' : 'text-blue-600'
              )}>
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
        {section === 'resolved' && (
          <span>{dispute.verdicts.length} verdict(s)</span>
        )}
      </div>
    </div>
  )

  const SkeletonCard = () => (
    <div
      className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4 animate-pulse"
    >
      <div className="flex justify-between items-start mb-2">
        <div className="flex-1">
          <div className="h-4 w-32 rounded bg-[var(--theme-surface-secondary)] mb-2" />
          <div className="h-3 w-24 rounded bg-[var(--theme-surface-secondary)]" />
        </div>
        <div className="text-right">
          <div className="h-4 w-16 rounded bg-[var(--theme-surface-secondary)] mb-1" />
          <div className="h-3 w-20 rounded bg-[var(--theme-surface-secondary)]" />
        </div>
      </div>
      <div className="flex gap-4">
        <div className="h-3 w-20 rounded bg-[var(--theme-surface-secondary)]" />
        <div className="h-3 w-20 rounded bg-[var(--theme-surface-secondary)]" />
      </div>
    </div>
  )

  return (
    <PageContainer size="wide" spacing="lg" ref={containerRef}>
      <PageHeader
        icon={<Gavel size={20} />}
        title="Arbitration Council"
        subtitle="Review and resolve disputes"
        onBack={() => navigate(`/dao/${daoId}`)}
        actions={
          <div className="flex gap-3">
            <button
              onClick={() => navigate(`/dao/${daoId}/council/audit`)}
              className="px-3 py-1.5 rounded-lg border text-sm transition-all duration-200 hover:opacity-80 cursor-pointer"
              style={{
                borderColor: 'var(--theme-border)',
                background: 'var(--theme-surface)',
                color: 'var(--theme-text)',
              }}
            >
              Audit Log
            </button>
            <button
              onClick={() => navigate(`/dao/${daoId}/admin/members`)}
              className="px-3 py-1.5 rounded-lg border text-sm transition-all duration-200 hover:opacity-80 cursor-pointer"
              style={{
                borderColor: 'var(--theme-border)',
                background: 'var(--theme-surface)',
                color: 'var(--theme-text)',
              }}
            >
              Members
            </button>
            <button
              onClick={() => navigate(`/dao/${daoId}/admin/config`)}
              className="px-3 py-1.5 rounded-lg border text-sm transition-all duration-200 hover:opacity-80 cursor-pointer"
              style={{
                borderColor: 'var(--theme-border)',
                background: 'var(--theme-surface)',
                color: 'var(--theme-text)',
              }}
            >
              Config
            </button>
          </div>
        }
      />

      <CodexBanner className="mb-6" />

      <div className="dashboard-animate space-y-6">
        <KPIStrip
          items={kpiItems}
          loading={loading}
          skeletonCount={4}
          wrap
          collapsible
          storageKey="kpi-council-dashboard"
        />

        {loading ? (
          <div className="space-y-4">
            <div>
              <div className="h-5 w-32 rounded bg-[var(--theme-surface-secondary)] mb-1 animate-pulse" />
              <div className="h-4 w-48 rounded bg-[var(--theme-surface-secondary)] mb-4 animate-pulse" />
              <div className="space-y-3">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            </div>
          </div>
        ) : error ? (
          <div
            className="rounded-xl border p-4"
            style={{
              border: '1px solid var(--color-status-error)',
              background: 'rgba(239,68,68,0.08)',
              color: 'var(--color-status-error)',
            }}
          >
            {error}
          </div>
        ) : (
          <>
            {queueDisputes.length > 0 && (
              <section className="mb-8">
                <h2 className="text-[18px] font-semibold mb-1" style={{ color: 'var(--theme-text)' }}>
                  Council Queue ({queueDisputes.length})
                </h2>
                <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>
                  Awaiting first verdict
                </p>
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
                <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>
                  Verdicts submitted, awaiting quorum
                </p>
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
                  style={{
                    border: '1px solid var(--theme-border)',
                    background: 'var(--theme-surface)',
                  }}
                >
                  <div
                    className="flex items-center justify-center w-12 h-12 rounded-xl mx-auto mb-3"
                    style={{ background: 'rgba(99,179,237,0.12)' }}
                  >
                    <CheckCircle size={24} style={{ color: 'var(--color-primary-50)' }} />
                  </div>
                  <p className="text-[14px] font-medium mb-1" style={{ color: 'var(--theme-text)' }}>
                    No disputes pending review
                  </p>
                  <p className="text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>
                    All disputes have been resolved. Check the audit log for history.
                  </p>
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
        )}
      </div>
    </PageContainer>
  )
}
