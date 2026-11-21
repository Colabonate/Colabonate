import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { apiCall } from '../../lib/api'
import { adminApiCall } from '../../lib/nostr-admin-auth'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { cn } from '@ds/utils'
import Alert from '@mui/material/Alert'
import Snackbar from '@mui/material/Snackbar'
import { CheckCircle, Clock, Shield, Users, Settings } from 'lucide-react'

const C = {
  surface: 'var(--theme-surface)',
  bg: 'var(--theme-bg)',
  text: 'var(--theme-text)',
  textMuted: 'var(--theme-text-muted)',
  border: 'var(--theme-border)',
} as const

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <h3
        className="text-[14px] font-semibold uppercase tracking-wide"
        style={{ color: C.textMuted }}
      >
        {title}
      </h3>
      {subtitle && (
        <p className="text-[13px] mt-0.5" style={{ color: C.textMuted }}>
          {subtitle}
        </p>
      )}
    </div>
  )
}

const QUORUM_OPTIONS = [
  { value: 'SINGLE' as const, label: 'Single (1 verdict)', desc: 'Any arbitrator can resolve (bootstrap mode)', icon: Shield },
  { value: 'MAJORITY' as const, label: 'Majority (>50%)', desc: 'More than half of active arbitrators required', icon: Users },
  { value: 'THRESHOLD' as const, label: 'Fixed Threshold (N)', desc: 'Exactly N arbitrators must vote', icon: CheckCircle },
]

export function AdminConfig() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [quorumType, setQuorumType] = useState<'SINGLE' | 'MAJORITY' | 'THRESHOLD'>('SINGLE')
  const [thresholdN, setThresholdN] = useState(1)
  const [coolingOffDays, setCoolingOffDays] = useState(7)
  const [verdictDeadlineHours, setVerdictDeadlineHours] = useState(48)

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  })

  const containerRef = usePageAnimation([
    { selector: '.dashboard-animate', from: { duration: 0.5, stagger: 0.12, y: 24 } },
  ])

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    setLoading(true)
    try {
      const res = await apiCall('/api/dao/foundation/config')
      const data = await res.json()
      if (data.config) {
        setQuorumType(data.config.quorumType)
        setThresholdN(data.config.thresholdN)
        setCoolingOffDays(data.config.coolingOffDays)
        setVerdictDeadlineHours(data.config.verdictDeadlineHours)
      }
    } catch (err) {
      console.error('Failed to load config:', err)
      setError('Failed to load configuration')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await adminApiCall('/api/dao/foundation/config', {
        method: 'PATCH',
        body: JSON.stringify({
          quorumType,
          thresholdN,
          coolingOffDays,
          verdictDeadlineHours,
        }),
      })
      if (res.ok) {
        setSnackbar({ open: true, message: 'Configuration saved successfully', severity: 'success' })
        loadConfig()
      } else {
        const err = await res.json()
        setSnackbar({ open: true, message: err.error || 'Failed to save configuration', severity: 'error' })
      }
    } catch (err) {
      console.error('Failed to save config:', err)
      setSnackbar({ open: true, message: 'Failed to save configuration', severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const SkeletonCard = () => (
    <div
      className="rounded-xl border p-5 animate-pulse"
      style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
    >
      <div className="h-5 w-32 rounded mb-4" style={{ background: 'var(--theme-surface-secondary)' }} />
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 rounded-lg" style={{ background: 'var(--theme-surface-secondary)' }} />
        ))}
      </div>
    </div>
  )

  return (
    <PageContainer size="wide" spacing="lg" ref={containerRef}>
      <PageHeader
        icon={<Settings size={20} />}
        title="Council Configuration"
        subtitle="Manage quorum rules and timing"
        onBack={() => navigate('/council')}
        backLabel="Back to Council"
      />

      <div className="dashboard-animate space-y-6">
        {loading ? (
          <div className="space-y-6">
            <SkeletonCard />
            <SkeletonCard />
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
            <div
              className="rounded-xl border p-5"
              style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
            >
              <SectionHeader
                title="Quorum Model"
                subtitle="Select how many arbitrators must agree before a dispute is resolved"
              />
              <div className="space-y-3">
                {QUORUM_OPTIONS.map(({ value, label, desc, icon: Icon }) => (
                  <label
                    key={value}
                    className={cn(
                      'flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all duration-200',
                    )}
                    style={{
                      border: quorumType === value ? '2px solid var(--color-accent)' : '1px solid var(--theme-border)',
                      background: quorumType === value ? 'rgba(99,179,237,0.06)' : 'transparent',
                    }}
                  >
                    <input
                      type="radio"
                      name="quorumType"
                      value={value}
                      checked={quorumType === value}
                      onChange={() => setQuorumType(value)}
                      className="sr-only"
                    />
                    <div
                      className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0"
                      style={{
                        background: quorumType === value ? 'rgba(99,179,237,0.12)' : 'var(--theme-surface-secondary)',
                      }}
                    >
                      <Icon
                        size={18}
                        style={{ color: quorumType === value ? 'var(--color-primary-50)' : 'var(--theme-text-muted)' }}
                      />
                    </div>
                    <div>
                      <div className="font-medium text-sm" style={{ color: 'var(--theme-text)' }}>{label}</div>
                      <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>{desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {quorumType === 'THRESHOLD' && (
              <div
                className="rounded-xl border p-5 transition-all duration-300"
                style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
              >
                <SectionHeader
                  title="Threshold (N)"
                  subtitle="Number of arbitrators required to reach a verdict"
                />
                <div className="flex items-center gap-4">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={thresholdN}
                    onChange={e => setThresholdN(parseInt(e.target.value) || 1)}
                    className="w-24 px-3 py-2.5 rounded-lg border text-center font-semibold text-sm transition-colors duration-200 focus:outline-none focus:border-[var(--color-accent)]"
                    style={{
                      border: '1px solid var(--theme-border)',
                      background: 'var(--theme-surface-secondary)',
                      color: 'var(--theme-text)',
                    }}
                  />
                  <span className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
                    arbitrators must submit a verdict
                  </span>
                </div>
              </div>
            )}

            <div
              className="rounded-xl border p-5"
              style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
            >
              <SectionHeader
                title="Timing"
                subtitle="Configure timing parameters for the arbitration process"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--theme-text)' }}>
                    <div className="flex items-center gap-2">
                      <Clock size={14} style={{ color: 'var(--theme-text-muted)' }} />
                      Cooling Off (days)
                    </div>
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={coolingOffDays}
                    onChange={e => setCoolingOffDays(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2.5 rounded-lg border text-sm transition-colors duration-200 focus:outline-none focus:border-[var(--color-accent)]"
                    style={{
                      border: '1px solid var(--theme-border)',
                      background: 'var(--theme-surface-secondary)',
                      color: 'var(--theme-text)',
                    }}
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--theme-text-muted)' }}>
                    Wait before escalating to council
                  </p>
                </div>
                <div>
                  <label className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--theme-text)' }}>
                    <div className="flex items-center gap-2">
                      <Clock size={14} style={{ color: 'var(--theme-text-muted)' }} />
                      Verdict Deadline (hours)
                    </div>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={verdictDeadlineHours}
                    onChange={e => setVerdictDeadlineHours(parseInt(e.target.value) || 48)}
                    className="w-full px-3 py-2.5 rounded-lg border text-sm transition-colors duration-200 focus:outline-none focus:border-[var(--color-accent)]"
                    style={{
                      border: '1px solid var(--theme-border)',
                      background: 'var(--theme-surface-secondary)',
                      color: 'var(--theme-text)',
                    }}
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--theme-text-muted)' }}>
                    Time window for arbitrators to vote
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3 rounded-lg text-white font-medium transition-all duration-200 disabled:opacity-50 cursor-pointer"
              style={{ background: 'var(--color-accent)' }}
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <CheckCircle size={18} />
                  Save Configuration
                </>
              )}
            </button>
          </>
        )}
      </div>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snackbar.severity}
          onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
          sx={{ borderRadius: 2 }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </PageContainer>
  )
}