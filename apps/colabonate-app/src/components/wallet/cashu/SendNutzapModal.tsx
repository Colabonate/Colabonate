/**
 * SendNutzapModal — NIP-61 nutzap send (ADR-187 Phase 3).
 *
 * Sends ecash to a Nostr pubkey (npubs in the form `npub1…` are accepted; the
 * modal decodes to the raw 32-byte hex). The hook splits proofs at a mint and
 * locks the resulting token to the recipient's wallet P2PK pubkey, then
 * publishes a kind-9321 event.
 *
 * Default mint: first mint with sufficient balance. The recipient's wallet
 * pubkey falls back to their Nostr identity pubkey (worst-case, but still
 * secure — only the holder of the privkey can swap the locked proofs).
 */
import { useMemo, useState } from 'react'
import { Zap, Send } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { Modal, ModalContent, ModalActions } from '@ds/ui'
import { Button, CircularProgress } from '@mui/material'
import { useCashu } from '../../../contexts/CashuContext'
import { FiatHint } from '../../currency/FiatHint'

interface Props {
  open: boolean
  onClose: () => void
}

type Phase = 'form' | 'sending' | 'done' | 'error'

function tryDecodeNpub(value: string): string | null {
  const v = value.trim()
  if (!v) return null
  if (/^[0-9a-f]{64}$/i.test(v)) return v.toLowerCase()
  if (v.startsWith('npub1')) {
    try {
      const decoded = nip19.decode(v)
      if (decoded.type === 'npub') return decoded.data
    } catch {
      return null
    }
  }
  return null
}

export function SendNutzapModal({ open, onClose }: Props) {
  const { mints, state, sendNutzap } = useCashu()
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [phase, setPhase] = useState<Phase>('form')
  const [sent, setSent] = useState<{ sats: number; eventId: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recipientPubkey = useMemo(() => tryDecodeNpub(recipient), [recipient])
  const amountNum = Number(amount)

  const maxSats = useMemo(() => {
    return state.buckets.reduce(
      (acc, b) => acc + b.proofs.reduce((s, p) => s + p.amount, 0),
      0,
    )
  }, [state])

  function reset() {
    setRecipient('')
    setAmount('')
    setMemo('')
    setPhase('form')
    setSent(null)
    setError(null)
  }

  function close() {
    reset()
    onClose()
  }

  async function send() {
    if (!recipientPubkey) {
      setError('Enter a valid npub1… or 64-char hex pubkey')
      return
    }
    setError(null)
    setPhase('sending')
    try {
      const res = await sendNutzap({ recipientNpub: recipientPubkey, amountSats: amountNum, memo: memo || undefined })
      setSent({ sats: res.sentSats, eventId: res.eventId })
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('form')
    }
  }

  return (
    <Modal open={open} onClose={close} title="Send nutzap" size="sm">
      <ModalContent>
        {phase === 'done' && sent ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div
              className="flex items-center justify-center rounded-full"
              style={{ width: 44, height: 44, background: 'rgba(34,197,94,0.12)', color: 'rgb(22,163,74)' }}
            >
              <Zap size={20} />
            </div>
            <div>
              <div className="text-[15px] font-semibold" style={{ color: 'var(--theme-text)' }}>
                +{sent.sats.toLocaleString()} sats nutzapped
              </div>
              <div className="text-[12px] font-mono break-all" style={{ color: 'var(--theme-text-muted)' }}>
                {sent.eventId}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                Recipient (npub or hex)
              </label>
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="npub1…"
                className="rounded-lg outline-none text-[13px] font-mono"
                style={{
                  height: 40,
                  padding: '0 12px',
                  background: 'var(--theme-bg-subtle)',
                  color: 'var(--theme-text)',
                  border: '1px solid var(--theme-border)',
                }}
              />
              {recipient && !recipientPubkey && (
                <span className="text-[11px]" style={{ color: 'var(--color-primary-50)' }}>
                  Not a valid npub or 64-char hex pubkey
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                Amount (sats)
              </label>
              <input
                type="number"
                min={1}
                max={maxSats}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="rounded-lg outline-none text-[13px]"
                style={{
                  height: 40,
                  padding: '0 12px',
                  background: 'var(--theme-bg-subtle)',
                  color: 'var(--theme-text)',
                  border: '1px solid var(--theme-border)',
                }}
              />
              <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
                Total eCash across {mints.length} mint{mints.length === 1 ? '' : 's'}: {maxSats.toLocaleString()} sats
              </span>
              {Number(amount) > 0 && (
                <FiatHint sats={Number(amount)} className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }} />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                Memo (optional)
              </label>
              <input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="thanks!"
                className="rounded-lg outline-none text-[13px]"
                style={{
                  height: 40,
                  padding: '0 12px',
                  background: 'var(--theme-bg-subtle)',
                  color: 'var(--theme-text)',
                  border: '1px solid var(--theme-border)',
                }}
              />
            </div>
            {error && (
              <div
                className="text-[12px] px-3 py-2 rounded-lg"
                style={{ background: 'rgba(232,69,65,0.10)', color: 'var(--color-primary-50)' }}
              >
                {error}
              </div>
            )}
            <div className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
              The recipient must be subscribed to kind-9321 nutzaps and hold the wallet key for the locked token. Falls back to the recipient&apos;s Nostr identity key when no NIP-60 wallet event is known.
            </div>
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
            onClick={send}
            disabled={phase === 'sending' || !recipientPubkey || amountNum <= 0 || maxSats < amountNum}
            startIcon={phase === 'sending' ? <CircularProgress size={16} color="inherit" /> : <Send size={16} />}
          >
            {phase === 'sending' ? 'Nutzapping…' : 'Nutzap'}
          </Button>
        )}
      </ModalActions>
    </Modal>
  )
}
