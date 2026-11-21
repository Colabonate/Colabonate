import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { apiCall } from '../../lib/api'
import { CheckCircle, AlertCircle } from 'lucide-react'

export function InviteAccept() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  const pubkey = searchParams.get('pubkey')

  useEffect(() => {
    if (!pubkey) {
      setStatus('error')
      setError('Missing pubkey parameter')
      return
    }

    const acceptInvitation = async () => {
      try {
        const myPubkey = await window.nostr.getPublicKey()

        if (myPubkey.toLowerCase() !== pubkey.toLowerCase()) {
          setStatus('error')
          setError('Your logged-in pubkey does not match the invitation')
          return
        }

        const credentialEvent = {
          kind: 30021,
          pubkey: myPubkey,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['d', `colabonate-foundation-arbitrator-${myPubkey}`],
            ['credential_type', 'arbitrator'],
            ['dao_id', 'colabonate-foundation'],
            ['role', 'ARBITRATOR'],
            ['issued_by', 'colabonate-foundation-admin'],
          ],
          content: JSON.stringify({
            credential_type: 'arbitrator',
            dao_id: 'colabonate-foundation',
            role: 'ARBITRATOR',
            issued_by: 'colabonate-foundation-admin',
            pubkey: myPubkey,
          }),
        }

        const signed = await window.nostr.signEvent(credentialEvent)

        const res = await apiCall(`/api/dao/foundation/members/${pubkey}/accept`, {
          method: 'POST',
          body: JSON.stringify({ signedCredentialEvent: signed }),
        })

        if (res.ok) {
          setStatus('success')
          setTimeout(() => navigate('/council'), 2000)
        } else {
          const data = await res.json()
          setStatus('error')
          setError(data.error || 'Failed to accept invitation')
        }
      } catch (err) {
        console.error('Failed to accept invitation:', err)
        setStatus('error')
        setError('Failed to sign or submit credential event')
      }
    }

    acceptInvitation()
  }, [pubkey, navigate])

  return (
    <PageContainer spacing="md">
      <PageHeader
        title="Accept Invitation"
        subtitle="Join the Colabonate Arbitration Council"
      />

      {status === 'loading' && (
        <div className="flex flex-col items-center p-8">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-[var(--color-accent)] border-t-transparent mb-4" />
          <p className="text-[var(--color-text-secondary)]">Signing your credential…</p>
        </div>
      )}

      {status === 'success' && (
        <div className="flex flex-col items-center p-8 text-center">
          <CheckCircle size={48} className="text-green-600 mb-4" />
          <h2 className="text-lg font-semibold mb-2">Welcome to the Council!</h2>
          <p className="text-[var(--color-text-secondary)] mb-4">
            Your membership is now active. Redirecting…
          </p>
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center p-8 text-center">
          <AlertCircle size={48} className="text-red-600 mb-4" />
          <h2 className="text-lg font-semibold mb-2">Invitation Failed</h2>
          <p className="text-[var(--color-text-secondary)] mb-4">{error}</p>
          <button
            onClick={() => navigate('/council')}
            className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm"
          >
            Back to Council
          </button>
        </div>
      )}
    </PageContainer>
  )
}