/**
 * ConnectNWCModal — connect a Nostr Wallet Connect (NIP-47) spending wallet
 * (ADR-208). User pastes a `nostr+walletconnect://…` URI; the modal posts to
 * `/api/wallet/nwc/connect`, which proves reachability via getInfo(), stores
 * the URI encrypted at rest, and switches the wallet to non-custodial NWC.
 *
 * The NWC secret is an *ephemeral client key* embedded in the URI — it is NOT
 * the user's Nostr identity key (ADR-141/144). The paired wallet never learns
 * the user's Nostr identity. This is a post-login wallet choice, not a login.
 */
import { useState } from 'react'
import { Zap, Link2, Check } from 'lucide-react'
import { Modal, ModalContent, ModalActions } from '@ds/ui'
import { Button, CircularProgress } from '@mui/material'
import { useWallet } from '../../contexts/WalletContext'
import type { ApiError } from '../../lib/api'

interface Props {
  open: boolean
  onClose: () => void
  onConnected?: () => void
}

type Phase = 'form' | 'connecting' | 'done' | 'error'

export function ConnectNWCModal({ open, onClose, onConnected }: Props) {
  const { connectNWC } = useWallet()
  const [uri, setUri] = useState('')
  const [phase, setPhase] = useState<Phase>('form')
  const [alias, setAlias] = useState<string | null>(null)
  const [balanceSats, setBalanceSats] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setUri('')
    setPhase('form')
    setAlias(null)
    setBalanceSats(null)
    setError(null)
  }

  function close() {
    reset()
    onClose()
  }

  async function connect() {
    setError(null)
    setPhase('connecting')
    try {
      const res = await connectNWC(uri.trim())
      setAlias(res.alias ?? 'Connected')
      setBalanceSats(res.balanceSats ?? null)
      setPhase('done')
      onConnected?.()
    } catch (e) {
      const apiErr = e as ApiError
      setError(apiErr?.data?.message ?? (e instanceof Error ? e.message : String(e)))
      setPhase('form')
    }
  }

  return (
    <Modal open={open} onClose={close} title="Connect Nostr Wallet (NWC)" size="sm">
      <ModalContent>
        {phase === 'done' ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div
              className="flex items-center justify-center rounded-full"
              style={{ width: 44, height: 44, background: 'rgba(34,197,94,0.12)', color: 'rgb(22,163,74)' }}
            >
              <Check size={20} />
            </div>
            <div>
              <div className="text-[15px] font-semibold" style={{ color: 'var(--theme-text)' }}>
                {alias} connected
              </div>
              {balanceSats !== null && (
                <div className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }}>
                  Balance: {balanceSats.toLocaleString()} sats
                </div>
              )}
              <div className="text-[11px] mt-1" style={{ color: 'var(--theme-text-muted)' }}>
                Your wallet will now pay invoices at checkout over Nostr relays.
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                Connection URI
              </label>
              <textarea
                value={uri}
                onChange={e => setUri(e.target.value)}
                placeholder="nostr+walletconnect://…"
                rows={3}
                className="rounded-lg p-3 text-[12px] font-mono resize-none outline-none"
                style={{
                  background: 'var(--theme-bg-subtle)',
                  color: 'var(--theme-text)',
                  border: '1px solid var(--theme-border)',
                }}
              />
              <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
                Get this from your wallet (Alby → Connections / Alby Hub → Apps). Paste the full <code>nostr+walletconnect://</code> link.
              </span>
            </div>

            <div
              className="flex items-start gap-2 p-3 rounded-lg text-[11px]"
              style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)' }}
            >
              <Link2 size={12} className="mt-0.5 shrink-0" />
              <span>
                Least privilege: create the connection with only the scopes you need — <code>pay_invoice</code>, <code>get_balance</code>,
                {' '}<code>get_info</code>. The connection key is separate from your Nostr identity and is stored encrypted.
              </span>
            </div>

            {error && (
              <div
                className="text-[12px] px-3 py-2 rounded-lg"
                style={{ background: 'rgba(232,69,65,0.10)', color: 'var(--color-primary-50)' }}
              >
                {error}
              </div>
            )}
          </div>
        )}
      </ModalContent>
      <ModalActions>
        <Button variant="outlined" onClick={close}>
          {phase === 'done' ? 'Done' : 'Cancel'}
        </Button>
        {phase !== 'done' && (
          <Button
            variant="contained"
            onClick={() => void connect()}
            disabled={!uri.trim() || phase === 'connecting'}
            startIcon={phase === 'connecting' ? <CircularProgress size={14} color="inherit" /> : <Zap size={16} />}
          >
            {phase === 'connecting' ? 'Connecting…' : 'Connect'}
          </Button>
        )}
      </ModalActions>
    </Modal>
  )
}
