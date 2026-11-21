import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from '../../contexts/LocaleContext'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { apiCall } from '../../lib/api'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { History, CheckCircle, AlertTriangle, FileText } from 'lucide-react'
import type { Dispute } from './council-types'

export function CouncilAudit() {
  const navigate = useNavigate()
  // Mounted at /dao/:id/council/audit (App.tsx) — see CouncilDashboard.tsx's
  // identical fix note (2026-09-18).
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
    apiCall('/api/disputes?status=RESOLVED')
      .then(r => r.json())
      .then(data => setDisputes(data.disputes || []))
      .catch(err => {
        console.error('Failed to fetch resolved disputes:', err)
        setError('Failed to load audit data')
      })
      .finally(() => setLoading(false))
  }, [])

  const dissentCount = (dispute: Dispute) => {
    if (!dispute.outcome) return 0
    const maxR = Math.max(...dispute.verdicts.map(v => v.round), 0)
    const finalRoundVerdicts = dispute.verdicts.filter(v => v.round === maxR)
    return finalRoundVerdicts.filter(v => v.outcome !== dispute.outcome).length
  }

  const maxRound = (dispute: Dispute) => {
    return Math.max(...dispute.verdicts.map(v => v.round), 1)
  }

  const SkeletonRow = () => (
    <tr className="border-t border-[var(--theme-border)]">
      <td className="px-4 py-3"><div className="h-3 w-24 rounded animate-pulse" style={{ background: 'var(--theme-surface-secondary)' }} /></td>
      <td className="px-4 py-3"><div className="h-3 w-32 rounded animate-pulse" style={{ background: 'var(--theme-surface-secondary)' }} /></td>
      <td className="px-4 py-3"><div className="h-5 w-10 rounded-full animate-pulse" style={{ background: 'var(--theme-surface-secondary)' }} /></td>
      <td className="px-4 py-3"><div className="h-5 w-14 rounded-full animate-pulse" style={{ background: 'var(--theme-surface-secondary)' }} /></td>
      <td className="px-4 py-3 text-center"><div className="h-3 w-6 rounded mx-auto animate-pulse" style={{ background: 'var(--theme-surface-secondary)' }} /></td>
      <td className="px-4 py-3 text-center"><div className="h-3 w-6 rounded mx-auto animate-pulse" style={{ background: 'var(--theme-surface-secondary)' }} /></td>
      <td className="px-4 py-3"><div className="h-3 w-20 rounded animate-pulse" style={{ background: 'var(--theme-surface-secondary)' }} /></td>
    </tr>
  )

  const renderTable = () => (
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
          [1, 2, 3, 4, 5].map(i => <SkeletonRow key={i} />)
        ) : (
          disputes.map(dispute => (
            <tr
              key={dispute.id}
              className="border-t cursor-pointer transition-colors duration-200 hover:bg-[var(--theme-surface-secondary)]"
              style={{ borderColor: 'var(--theme-border)' }}
              onClick={() => navigate(`/dao/${dispute.daoId}/council/disputes/${dispute.id}`)}
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
                    <span
                      className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold"
                      style={{ background: 'rgba(159,122,234,0.15)', color: '#7c3aed' }}
                    >
                      R{maxRound(dispute)}
                    </span>
                    {dispute.appealRequest && (
                      <span
                        className="inline-flex px-1.5 py-0.5 rounded text-xs font-semibold"
                        style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--color-status-error)' }}
                      >
                        appealed
                      </span>
                    )}
                  </div>
                ) : (
                  <span
                    className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium"
                    style={{ background: 'rgba(113,128,150,0.12)', color: 'var(--theme-text-muted)' }}
                  >
                    R1
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                <span
                  className="inline-flex px-2 py-1 rounded-full text-xs font-semibold"
                  style={
                    dispute.outcome === 'RELEASE'
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
    <PageContainer size="wide" spacing="lg" ref={containerRef}>
      <PageHeader
        icon={<History size={20} />}
        title="Council Audit Log"
        subtitle={`Record of ${disputes.length} resolved dispute${disputes.length !== 1 ? 's' : ''} — visible to signed-in members; each resolved verdict is also published as a Nostr event for verification outside Colabonate`}
        onBack={() => navigate(`/dao/${daoId}/council`)}
        backLabel="Back to Council"
      />

      <div
        className="dashboard-animate rounded-xl border overflow-hidden"
        style={{
          border: '1px solid var(--theme-border)',
          background: 'var(--theme-surface)',
        }}
      >
        {loading ? (
          renderTable()
        ) : error ? (
          <div
            className="p-6 text-center"
            style={{ color: 'var(--color-status-error)' }}
          >
            {error}
          </div>
        ) : disputes.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center p-12 text-center"
            style={{ background: 'var(--theme-surface)' }}
          >
            <div
              className="flex items-center justify-center w-12 h-12 rounded-xl mb-4"
              style={{ background: 'rgba(99,179,237,0.12)' }}
            >
              <FileText size={24} style={{ color: 'var(--color-primary-50)' }} />
            </div>
            <p className="text-[14px] font-medium mb-1" style={{ color: 'var(--theme-text)' }}>
              No resolved disputes yet
            </p>
            <p className="text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>
              Resolved disputes will appear here as a public audit record.
            </p>
          </div>
        ) : (
          renderTable()
        )}
      </div>
    </PageContainer>
  )
}
