/**
 * ReceiveTokenModal — paste a `cashuA…`/`cashuB…` token and claim it (ADR-187).
 * Calls `useCashu().receiveToken`, which swaps the incoming proofs at the mint
 * and persists the new unspent proofs as a kind-7375 event.
 */
import { useState } from 'react'
import { Download } from 'lucide-react'
import { Modal, ModalContent, ModalActions } from '@ds/ui'
import { Button, CircularProgress } from '@mui/material'
import { cn } from '@ds/utils'
import { useCashu } from '../../../contexts/CashuContext'

interface Props {
  open: boolean
  onClose: () => void
}

export function ReceiveTokenModal({ open, onClose }: Props) {
  const { receiveToken } = useCashu()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [claimed, setClaimed] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setToken('')
    setBusy(false)
    setClaimed(null)
    setError(null)
  }

  function close() {
    reset()
    onClose()
  }

  async function claim() {
    setError(null)
    setBusy(true)
    try {
      const sats = await receiveToken(token.trim())
      setClaimed(sats)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title="Receive eCash" size="sm">
      <ModalContent>
        {claimed !== null ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div
              className="flex items-center justify-center rounded-full"
              style={{ width: 44, height: 44, background: 'rgba(34,197,94,0.12)', color: 'rgb(22,163,74)' }}
            >
              <Download size={20} />
            </div>
            <div>
              <div className="text-[15px] font-semibold" style={{ color: 'var(--theme-text)' }}>
                +{claimed.toLocaleString()} sats received
              </div>
              <div className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }}>
                Added to your eCash wallet.
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
              Cashu token
            </label>
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="cashuA… or cashuB…"
              rows={4}
              className={cn('w-full rounded-lg p-3 text-[13px] font-mono resize-none outline-none')}
              style={{
                background: 'var(--theme-bg-subtle)',
                color: 'var(--theme-text)',
                border: '1px solid var(--theme-border)',
              }}
            />
            {error && (
              <div
                className="text-[12px] px-3 py-2 rounded-lg"
                style={{ background: 'rgba(232,69,65,0.10)', color: 'var(--color-primary-50)' }}
              >
                {error}
              </div>
            )}
            <div className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
              The token is redeemed at its mint. Proofs are stored encrypted to your wallet — the server never sees them.
            </div>
          </div>
        )}
      </ModalContent>
      <ModalActions>
        <Button variant="outlined" onClick={close}>
          {claimed !== null ? 'Done' : 'Cancel'}
        </Button>
        {claimed === null && (
          <Button
            variant="contained"
            onClick={claim}
            disabled={busy || token.trim().length === 0}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {busy ? 'Claiming…' : 'Claim'}
          </Button>
        )}
      </ModalActions>
    </Modal>
  )
}
