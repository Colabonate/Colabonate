import { useState, useEffect } from 'react'
import { PageContainer } from '@ds/ui'
import { apiCall } from '../../lib/api'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { cn } from '@ds/utils'
import type { NostrEventTemplate } from '../../lib/nostr-ticket'
import Alert from '@mui/material/Alert'
import { FileText, Shield, CheckCircle, Loader2, AlertTriangle } from 'lucide-react'

interface FoundationDao {
  id: string
  name: string
  codexHash: string
  codexVersion: string
  codexUrl: string
  status: string
  nostrEventId: string | null
}

interface DaoMember {
  id: string
  daoId: string
  pubkey: string
  role: string
  status: string
  credentialEventId: string | null
}

export function FoundationBootstrap() {
  const [dao, setDao] = useState<FoundationDao | null>(null)
  const [members, setMembers] = useState<DaoMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState<'dao' | 'credential' | null>(null)
  const [stepError, setStepError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const containerRef = usePageAnimation([
    { selector: '.dashboard-animate', from: { duration: 0.5, stagger: 0.12, y: 24 } },
  ])

  const pubkey = localStorage.getItem('pubkey')

  useEffect(() => {
    if (!pubkey) {
      setError('No pubkey found. Please log in first.')
      setLoading(false)
      return
    }

    Promise.all([
      apiCall('/api/dao/foundation').then(r => r.json()),
      apiCall('/api/dao/foundation/members').then(r => r.json()),
    ])
      .then(([daoData, membersData]) => {
        setDao(daoData.dao)
        setMembers(membersData.members || [])
        const myMember = (membersData.members || []).find((m: DaoMember) => m.pubkey === pubkey)
        if (myMember?.credentialEventId) setDone(true)
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load DAO data'))
      .finally(() => setLoading(false))
  }, [])

  async function publishDaoCreation() {
    setPublishing('dao')
    setStepError(null)
    try {
      const res = await apiCall('/api/dao/foundation')
      const { dao: daoData } = await res.json()
      if (daoData.nostrEventId) {
        setDone(true)
        return
      }

      const template: NostrEventTemplate = {
        kind: 30022,
        pubkey: pubkey!,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', `${daoData.id}-dao-creation`],
          ['sub_type', 'dao_creation'],
          ['dao_id', daoData.id],
          ['codex_hash', daoData.codexHash],
          ['codex_version', daoData.codexVersion],
          ['proposal', daoData.id],
          ['vote', 'yes'],
          ['voting_model', '1p1v'],
        ],
        content: JSON.stringify({
          sub_type: 'dao_creation',
          dao_id: daoData.id,
          name: daoData.name,
          codex_hash: daoData.codexHash,
          codex_version: daoData.codexVersion,
          codex_url: daoData.codexUrl,
          status: daoData.status,
        }),
      }

      const signed = await window.nostr?.signEvent(template)
      if (!signed) {
        setStepError('NIP-07 signing failed or was cancelled.')
        return
      }

      await apiCall('/api/dao/foundation/nostr-event-id', {
        method: 'POST',
        body: JSON.stringify({ nostrEventId: signed.id }),
      })

      setDao(prev => prev ? { ...prev, nostrEventId: signed.id } : null)
      if (daoData.nostrEventId) setDone(true)
    } catch (err) {
      setStepError(err instanceof Error ? err.message : 'Failed to publish DAO creation event')
    } finally {
      setPublishing(null)
    }
  }

  async function publishArbitratorCredential() {
    setPublishing('credential')
    setStepError(null)
    try {
      const myMember = members.find(m => m.pubkey === pubkey)
      if (!myMember || myMember.credentialEventId) {
        setDone(true)
        return
      }

      const myDaoId = myMember.daoId
      const template: NostrEventTemplate = {
        kind: 30021,
        pubkey: pubkey!,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', `${myDaoId}-arbitrator-${pubkey}`],
          ['credential_type', 'arbitrator'],
          ['dao_id', myDaoId],
          ['role', myMember.role],
          ['issued_by', pubkey!],
        ],
        content: JSON.stringify({
          credential_type: 'arbitrator',
          dao_id: myDaoId,
          role: myMember.role,
          issued_by: pubkey,
          pubkey,
        }),
      }

      const signed = await window.nostr?.signEvent(template)
      if (!signed) {
        setStepError('NIP-07 signing failed or was cancelled.')
        return
      }

      await apiCall(`/api/dao/foundation/members/${pubkey}/credential-event-id`, {
        method: 'POST',
        body: JSON.stringify({ nostrEventId: signed.id }),
      })

      setDone(true)
    } catch (err) {
      setStepError(err instanceof Error ? err.message : 'Failed to publish arbitrator credential')
    } finally {
      setPublishing(null)
    }
  }

  if (loading) {
    return (
      <PageContainer size="narrow" spacing="lg">
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mb-4 animate-pulse"
            style={{ background: 'rgba(99,179,237,0.12)' }}
          >
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--color-primary-50)' }} />
          </div>
          <p className="text-[14px]" style={{ color: 'var(--theme-text-muted)' }}>
            Loading foundation data…
          </p>
        </div>
      </PageContainer>
    )
  }

  if (error) {
    return (
      <PageContainer size="narrow" spacing="lg">
        <div
          className="rounded-xl border p-6 text-center"
          style={{
            border: '1px solid var(--color-status-error)',
            background: 'rgba(239,68,68,0.08)',
          }}
        >
          <div
            className="flex items-center justify-center w-12 h-12 rounded-xl mx-auto mb-3"
            style={{ background: 'rgba(239,68,68,0.12)' }}
          >
            <AlertTriangle size={24} style={{ color: 'var(--color-status-error)' }} />
          </div>
          <p className="text-[14px] font-medium" style={{ color: 'var(--color-status-error)' }}>
            {error}
          </p>
        </div>
      </PageContainer>
    )
  }

  const daoCreated = !!dao?.nostrEventId
  const credentialPublished = members.find(m => m.pubkey === pubkey)?.credentialEventId

  if (done || (daoCreated && credentialPublished)) {
    return (
      <PageContainer size="narrow" spacing="lg">
        <div
          className="dashboard-animate rounded-xl border p-8 text-center"
          style={{
            border: '1px solid var(--theme-border)',
            background: 'var(--theme-surface)',
          }}
        >
          <div
            className="flex items-center justify-center w-16 h-16 rounded-full mx-auto mb-4"
            style={{ background: 'rgba(72,187,120,0.12)' }}
          >
            <CheckCircle size={32} style={{ color: 'var(--color-status-success)' }} />
          </div>
          <h2
            className="text-[20px] font-semibold mb-2"
            style={{ color: 'var(--theme-text)' }}
          >
            Arbitration Council Bootstrap Complete
          </h2>
          <p
            className="text-[14px] leading-relaxed"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            The Colabonate Foundation DAO is now operational in bootstrap mode with you as the founding arbitrator.
          </p>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer size="narrow" spacing="lg" ref={containerRef}>
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div
            className="flex items-center justify-center w-10 h-10 rounded-lg"
            style={{ background: 'rgba(99,179,237,0.12)' }}
          >
            <Shield size={20} style={{ color: 'var(--color-primary-50)' }} />
          </div>
          <h1
            className="text-[22px] font-semibold"
            style={{ color: 'var(--theme-text)' }}
          >
            Foundation DAO Bootstrap
          </h1>
        </div>
        <p
          className="text-[14px]"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          Complete these two steps to activate the Colabonate Arbitration Council.
        </p>
      </div>

      <div className="dashboard-animate space-y-4">
        <div
          className="rounded-xl border p-5 transition-all duration-200"
          style={{
            border: daoCreated
              ? '2px solid var(--color-status-success)'
              : '1px solid var(--theme-border)',
            background: 'var(--theme-surface)',
          }}
        >
          <div className="flex items-start gap-4">
            <div
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-colors duration-200',
              )}
              style={{
                background: daoCreated ? 'var(--color-status-success)' : 'var(--theme-surface-secondary)',
                color: daoCreated ? 'white' : 'var(--theme-text-muted)',
              }}
            >
              {daoCreated ? <CheckCircle size={16} /> : '1'}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[15px] font-semibold mb-1" style={{ color: 'var(--theme-text)' }}>
                Publish DAO Creation Event
              </h3>
              <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>
                Sign and publish the Foundation DAO creation event (Kind 30022) to the Nostr relay.
              </p>
              {stepError && publishing === null && (
                <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
                  {stepError}
                </Alert>
              )}
              <button
                onClick={publishDaoCreation}
                disabled={publishing !== null}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg text-white text-sm font-medium transition-all duration-200 disabled:opacity-50 cursor-pointer"
                style={{ background: 'var(--color-accent)' }}
              >
                {publishing === 'dao' ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Publishing…
                  </>
                ) : (
                  <>
                    <FileText size={16} />
                    {daoCreated ? 'Published' : 'Publish DAO Creation Event'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        <div
          className="rounded-xl border p-5 transition-all duration-200"
          style={{
            border: credentialPublished
              ? '2px solid var(--color-status-success)'
              : '1px solid var(--theme-border)',
            background: 'var(--theme-surface)',
            opacity: !daoCreated ? 0.6 : 1,
          }}
        >
          <div className="flex items-start gap-4">
            <div
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-colors duration-200',
              )}
              style={{
                background: credentialPublished ? 'var(--color-status-success)' : 'var(--theme-surface-secondary)',
                color: credentialPublished ? 'white' : 'var(--theme-text-muted)',
              }}
            >
              {credentialPublished ? <CheckCircle size={16} /> : '2'}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[15px] font-semibold mb-1" style={{ color: 'var(--theme-text)' }}>
                Publish Arbitrator Credential
              </h3>
              <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>
                Sign your arbitrator credential (Kind 30021) to establish your authority to issue verdicts.
              </p>
              {stepError && publishing === null && (
                <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
                  {stepError}
                </Alert>
              )}
              <button
                onClick={publishArbitratorCredential}
                disabled={!daoCreated || publishing !== null}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg text-white text-sm font-medium transition-all duration-200 disabled:opacity-50 cursor-pointer"
                style={{ background: 'var(--color-accent)' }}
              >
                {publishing === 'credential' ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Publishing…
                  </>
                ) : (
                  <>
                    <Shield size={16} />
                    {credentialPublished ? 'Published' : 'Publish Arbitrator Credential'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </PageContainer>
  )
}