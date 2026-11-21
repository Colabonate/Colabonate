import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { apiCall } from '../../lib/api'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { Shield, FileText, Copy, Check, ExternalLink } from 'lucide-react'
import { Button } from '@mui/material'
import { NotFoundState } from '../../components/NotFoundState'

interface AmendmentEntry {
  id: string
  title: string
  status: string
  date: string
  payload: Record<string, unknown> | null
}

interface CodexSettingsData {
  id: string
  name: string
  codexHash: string
  codexVersion: string
  codexUrl: string
  updatedAt: string
  lastAmendmentDate: string | null
  amendmentHistory: AmendmentEntry[]
}

export function DaoCodexSettings() {
  const navigate = useNavigate()
  const { id: daoId = 'colabonate-foundation' } = useParams<{ id: string }>()
  const [settings, setSettings] = useState<CodexSettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedHash, setCopiedHash] = useState(false)

  const containerRef = usePageAnimation([
    { selector: '.codex-animate', from: { duration: 0.5, stagger: 0.12, y: 20 } },
  ])

  useEffect(() => {
    async function loadSettings() {
      setLoading(true)
      setError(null)
      try {
        const res = await apiCall(`/api/daos/${daoId}/codex-settings`)
        if (!res.ok) {
          setError('Failed to load codex settings')
          return
        }
        const data = await res.json()
        setSettings(data.codexSettings)
      } catch (err) {
        console.error('Failed to load codex settings:', err)
        setError('Failed to load codex settings')
      } finally {
        setLoading(false)
      }
    }
    loadSettings()
  }, [daoId])

  function copyHash() {
    if (!settings) return
    navigator.clipboard.writeText(settings.codexHash)
    setCopiedHash(true)
    setTimeout(() => setCopiedHash(false), 2000)
  }

  if (loading) {
    return (
      <PageContainer size="wide" spacing="lg" className="pt-0!">
        <div className="max-w-2xl mx-auto">
          <PageHeader
            icon={<Shield size={18} />}
            title="Codex Settings"
            subtitle="Loading..."
            onBack={() => navigate(`/dao/${daoId}`)}
          />
        </div>
      </PageContainer>
    )
  }

  if (error || !settings) {
    return (
      <NotFoundState
        icon={<Shield size={48} />}
        title="Codex settings unavailable"
        message="The codex settings for this DAO could not be loaded. The DAO may not exist or the server is unreachable."
        detail={daoId ? `DAO ${daoId}` : undefined}
        primary={{ label: 'Back to DAO', to: `/dao/${daoId}` }}
        secondary={{ label: 'Go back', onClick: () => navigate(-1) }}
      />
    )
  }

  return (
    <PageContainer size="wide" spacing="lg" className="pt-0!">
      <div ref={containerRef} className="max-w-2xl mx-auto space-y-6">
        <PageHeader
          icon={<Shield size={18} />}
          title="Codex Settings"
          subtitle={`Constitutional settings for ${settings.name}`}
          onBack={() => navigate(`/dao/${daoId}`)}
        />

        <div
          className="p-6 rounded-xl codex-animate"
          style={{
            border: '1px solid var(--theme-border)',
            background: 'var(--theme-surface)',
          }}
        >
          <h3
            className="text-[15px] font-semibold mb-4"
            style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            Current Codex
          </h3>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  Codex Hash (SHA-256)
                </span>
                <span className="font-mono text-[13px] break-all" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  {settings.codexHash.slice(0, 32)}...
                </span>
              </div>
              <button
                onClick={copyHash}
                className="p-2 rounded-lg transition-colors shrink-0"
                style={{ background: 'var(--theme-surface-secondary)', border: '1px solid var(--theme-border)' }}
              >
                {copiedHash ? <Check size={14} style={{ color: 'var(--color-status-success)' }} /> : <Copy size={14} style={{ color: 'var(--theme-text-muted)' }} />}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  Version
                </span>
                <span className="text-[13px]" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  {settings.codexVersion}
                </span>
              </div>
              <div>
                <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  Last Amendment
                </span>
                <span className="text-[13px]" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  {settings.lastAmendmentDate ? new Date(settings.lastAmendmentDate).toLocaleDateString() : 'Never'}
                </span>
              </div>
            </div>

            <div>
              <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                Codex Document
              </span>
              <Link
                to={settings.codexUrl.startsWith('/') ? settings.codexUrl : `/about/codex`}
                className="text-[13px] underline"
                style={{ color: 'var(--color-primary-50)', fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                View Codex Document
              </Link>
            </div>
          </div>
        </div>

        <div className="codex-animate">
          <Button
            variant="contained"
            onClick={() => navigate(`/dao/${daoId}/proposals/new?type=CODEX_AMENDMENT`)}
            fullWidth
            sx={{
              py: 1.5,
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              fontFamily: 'var(--typography-fontfamily-sans)',
              backgroundColor: 'var(--color-primary-50)',
              color: 'white',
              '&:hover': { backgroundColor: 'var(--color-primary-50)', opacity: 0.9 },
              '&:active': { transform: 'scale(0.98)' },
            }}
          >
            Propose Amendment
          </Button>
        </div>

        <div
          className="codex-animate"
          style={{
            border: '1px solid var(--theme-border)',
            borderRadius: '12px',
            background: 'var(--theme-surface)',
            overflow: 'hidden',
          }}
        >
          <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--theme-border)' }}>
            <h3
              className="text-[15px] font-semibold"
              style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              Amendment History
            </h3>
          </div>

          {settings.amendmentHistory.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <FileText size={24} style={{ color: 'var(--theme-text-muted)', opacity: 0.3, margin: '0 auto 8px' }} />
              <p className="text-[13px] font-medium mb-1" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                No amendments yet
              </p>
              <p className="text-[12px]" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                The codex has not been amended since its creation. Any changes require a governance vote.
              </p>
            </div>
          ) : (
            <div>
              {settings.amendmentHistory.map((amendment, i) => (
                <div
                  key={amendment.id}
                  className="px-6 py-4"
                  style={{
                    borderBottom: i < settings.amendmentHistory.length - 1 ? '1px solid var(--theme-border)' : undefined,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/dao/${daoId}/proposals/${amendment.id}`}
                        className="text-[13px] font-medium block hover:underline truncate"
                        style={{ color: 'var(--color-primary-50)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                      >
                        {amendment.title}
                      </Link>
                      <span
                        className="text-[11px]"
                        style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                      >
                        {new Date(amendment.date).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {amendment.payload && String(amendment.payload.codexUrl ?? '') && (
                        <a
                          href={String(amendment.payload.codexUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors hover:opacity-80"
                          style={{
                            background: 'rgba(99,179,237,0.08)',
                            color: 'var(--color-primary-50)',
                            fontFamily: 'var(--typography-fontfamily-sans)',
                          }}
                        >
                          <ExternalLink size={10} />
                          Diff
                        </a>
                      )}
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
                        style={{
                          background: amendment.status === 'EXECUTED' ? 'rgba(72,187,120,0.12)' : 'rgba(99,179,237,0.12)',
                          color: amendment.status === 'EXECUTED' ? 'var(--color-status-success)' : 'var(--color-primary-50)',
                          fontFamily: 'var(--typography-fontfamily-sans)',
                        }}
                      >
                        {amendment.status}
                      </span>
                    </div>
                  </div>
                  {amendment.payload && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-[10px] font-mono" style={{ color: 'var(--theme-text-muted)' }}>
                        {String(amendment.payload.newCodexHash ?? '').slice(0, 16)}…
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>→</span>
                      <span className="text-[10px] font-mono" style={{ color: 'var(--theme-text)' }}>
                        v{String(amendment.payload.newCodexVersion ?? '')}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  )
}
