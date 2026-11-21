/**
 * SendTokenModal — spend `amount` sats from one mint and emit a token to hand
 * over (ADR-187). Calls `useCashu().sendToken`, which splits the proofs at the
 * mint, encodes the `send` set, and persists the change.
 */
import { useMemo, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { Modal, ModalContent, ModalActions } from '@ds/ui'
import { Button, CircularProgress } from '@mui/material'
import { cn } from '@ds/utils'
import { useCashu } from '../../../contexts/CashuContext'
import { FiatHint } from '../../currency/FiatHint'

interface Props {
  open: boolean
  onClose: () => void
}

export function SendTokenModal({ open, onClose }: Props) {
  const { sendToken, state } = useCashu()
  const mints = state.buckets.filter((b) => b.proofs.length > 0)

  const [mintUrl, setMintUrl] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveMint = mintUrl || mints[0]?.mintUrl || ''

  const maxSats = useMemo(() => {
    const b = mints.find((x) => x.mintUrl === effectiveMint)
    return b ? b.proofs.reduce((s, p) => s + p.amount, 0) : 0
  }, [mints, effectiveMint])

  function reset() {
    setMintUrl('')
    setAmount('')
    setBusy(false)
    setToken(null)
    setCopied(false)
    setError(null)
  }

  function close() {
    reset()
    onClose()
  }

  async function send() {
    setError(null)
    setBusy(true)
    try {
      const res = await sendToken(Number(amount), effectiveMint)
      setToken(res.token)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function copyToken() {
    if (!token) return
    await navigator.clipboard.writeText(token)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Modal open={open} onClose={close} title="Send eCash" size="sm">
      <ModalContent>
        {token ? (
          <div className="flex flex-col gap-3">
            <div className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }}>
              Share this token with the recipient. Anyone holding it can claim the funds.
            </div>
            <textarea
              readOnly
              value={token}
              rows={4}
              className="w-full rounded-lg p-3 text-[12px] font-mono resize-none outline-none"
              style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {mints.length === 0 ? (
              <div className="text-[13px] py-4 text-center" style={{ color: 'var(--theme-text-muted)' }}>
                No eCash balance to send. Receive a token first.
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                    Mint
                  </label>
                  <select
                    value={effectiveMint}
                    onChange={(e) => setMintUrl(e.target.value)}
                    className="rounded-lg outline-none cursor-pointer text-[13px]"
                    style={{
                      height: 40,
                      padding: '0 10px',
                      background: 'var(--theme-bg-subtle)',
                      color: 'var(--theme-text)',
                      border: '1px solid var(--theme-border)',
                    }}
                  >
                    {mints.map((b) => {
                      const bal = b.proofs.reduce((s, p) => s + p.amount, 0)
                      return (
                        <option key={b.mintUrl} value={b.mintUrl}>
                          {b.mintUrl} ({bal.toLocaleString()} sats)
                        </option>
                      )
                    })}
                  </select>
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
                    className={cn('rounded-lg outline-none text-[13px]')}
                    style={{
                      height: 40,
                      padding: '0 12px',
                      background: 'var(--theme-bg-subtle)',
                      color: 'var(--theme-text)',
                      border: '1px solid var(--theme-border)',
                    }}
                  />
                  <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
                    Available: {maxSats.toLocaleString()} sats
                  </span>
                  {Number(amount) > 0 && (
                    <FiatHint sats={Number(amount)} className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }} />
                  )}
                </div>
                {error && (
                  <div
                    className="text-[12px] px-3 py-2 rounded-lg"
                    style={{ background: 'rgba(232,69,65,0.10)', color: 'var(--color-primary-50)' }}
                  >
                    {error}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </ModalContent>
      <ModalActions>
        <Button variant="outlined" onClick={close}>
          {token ? 'Done' : 'Cancel'}
        </Button>
        {token ? (
          <Button variant="contained" onClick={copyToken} startIcon={copied ? <Check size={16} /> : <Copy size={16} />}>
            {copied ? 'Copied' : 'Copy token'}
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={send}
            disabled={busy || mints.length === 0 || Number(amount) <= 0}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {busy ? 'Sending…' : 'Send'}
          </Button>
        )}
      </ModalActions>
    </Modal>
  )
}
