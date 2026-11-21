/**
 * MeltToLightningModal — eCash → Lightning withdraw (ADR-187 / FU-46).
 *
 * Flow:
 *   1. User pastes a bolt11 invoice and picks the mint to melt from
 *   2. Hook asks the mint for a melt quote (amount + fee_reserve) — no funds
 *      move yet
 *   3. Modal shows the quote: amount paid, fee reserve, total ecash required,
 *      user's available balance at that mint. User confirms.
 *   4. Hook selects proofs >= requiredSats, calls `meltProofsBolt11`, receives
 *      change (if any), persists a new kind-7375 event. Panel re-renders.
 */
import { useMemo, useState } from 'react'
import { ArrowUpToLine, Zap } from 'lucide-react'
import { Modal, ModalContent, ModalActions } from '@ds/ui'
import { Button, CircularProgress } from '@mui/material'
import { useCashu } from '../../../contexts/CashuContext'
import { formatSats } from '../../../lib/currency'
import { FiatHint } from '../../currency/FiatHint'
import type { MeltQuoteInfo } from '../../../hooks/useCashuWallet'

interface Props {
  open: boolean
  onClose: () => void
}

type Phase = 'form' | 'quoted' | 'melting' | 'done' | 'error'

export function MeltToLightningModal({ open, onClose }: Props) {
  const { mints, state, requestMeltQuote, confirmMelt } = useCashu()
  const [mintUrl, setMintUrl] = useState('')
  const [bolt11, setBolt11] = useState('')
  const [phase, setPhase] = useState<Phase>('form')
  const [quote, setQuote] = useState<MeltQuoteInfo | null>(null)
  const [paid, setPaid] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const effectiveMint = mintUrl || mints[0] || ''

  const availableSats = useMemo(() => {
    if (!effectiveMint) return 0
    const b = state.buckets.find((x: { mintUrl: string }) => x.mintUrl === effectiveMint)
    return b ? b.proofs.reduce((s: number, p: { amount: number }) => s + p.amount, 0) : 0
  }, [state, effectiveMint])

  function reset() {
    setMintUrl('')
    setBolt11('')
    setPhase('form')
    setQuote(null)
    setPaid(null)
    setError(null)
  }

  function close() {
    reset()
    onClose()
  }

  async function getQuote() {
    setError(null)
    try {
      const q = await requestMeltQuote(bolt11.trim(), effectiveMint)
      if (availableSats < q.requiredSats) {
        setError(
          `Not enough eCash at this mint: need ${q.requiredSats} sat ` +
            `(amount ${q.amountSats} + fee reserve ${q.feeReserveSats}), ` +
            `have ${availableSats} sat.`,
        )
        return
      }
      setQuote(q)
      setPhase('quoted')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function melt() {
    if (!quote) return
    setError(null)
    setPhase('melting')
    try {
      const res = await confirmMelt(quote)
      setPaid(res.paidSats)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('quoted')
    }
  }

  return (
    <Modal open={open} onClose={close} title="Withdraw to Lightning" size="sm">
      <ModalContent>
        {phase === 'done' && paid !== null ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div
              className="flex items-center justify-center rounded-full"
              style={{ width: 44, height: 44, background: 'rgba(34,197,94,0.12)', color: 'rgb(22,163,74)' }}
            >
              <ArrowUpToLine size={20} />
            </div>
            <div>
              <div className="text-[15px] font-semibold" style={{ color: 'var(--theme-text)' }}>
                {paid.toLocaleString()} sats sent
              </div>
              <div className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }}>
                Lightning invoice paid. Any overpayment came back as ecash change.
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {phase === 'form' && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                    Mint to melt from
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
                    {mints.map((u: string) => {
                      const b = state.buckets.find((x: { mintUrl: string }) => x.mintUrl === u)
                      const bal = b ? b.proofs.reduce((s: number, p: { amount: number }) => s + p.amount, 0) : 0
                      return (
                        <option key={u} value={u}>
                          {u} ({bal.toLocaleString()} sats)
                        </option>
                      )
                    })}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                    Lightning invoice (bolt11)
                  </label>
                  <textarea
                    value={bolt11}
                    onChange={(e) => setBolt11(e.target.value)}
                    placeholder="lnbc…"
                    rows={3}
                    className="rounded-lg p-3 text-[12px] font-mono resize-none outline-none"
                    style={{
                      background: 'var(--theme-bg-subtle)',
                      color: 'var(--theme-text)',
                      border: '1px solid var(--theme-border)',
                    }}
                  />
                  <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
                    Available at this mint: {availableSats.toLocaleString()} sats
                  </span>
                </div>
              </>
            )}

            {phase === 'quoted' && quote && (
              <div
                className="flex flex-col gap-2 p-3 rounded-lg"
                style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
              >
                <div className="flex items-center justify-between text-[12px]">
                  <span style={{ color: 'var(--theme-text-muted)' }}>Amount to pay</span>
                  <span style={{ color: 'var(--theme-text)' }}>
                    {formatSats(quote.amountSats, { compact: false })}{' '}
                    <FiatHint sats={quote.amountSats} className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }} />
                  </span>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span style={{ color: 'var(--theme-text-muted)' }}>Mint fee reserve</span>
                  <span style={{ color: 'var(--theme-text)' }}>{quote.feeReserveSats.toLocaleString()} sats</span>
                </div>
                <div
                  className="flex items-center justify-between text-[13px] font-semibold pt-2"
                  style={{ borderTop: '1px solid var(--theme-border)' }}
                >
                  <span style={{ color: 'var(--theme-text)' }}>Total ecash required</span>
                  <span style={{ color: 'var(--theme-text)' }}>
                    {formatSats(quote.requiredSats, { compact: false })}{' '}
                    <FiatHint sats={quote.requiredSats} className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }} />
                  </span>
                </div>
                <div className="text-[11px] pt-1" style={{ color: 'var(--theme-text-muted)' }}>
                  Any over-payment (vs fee_reserve) is returned to you as fresh ecash proofs.
                </div>
              </div>
            )}

            {(phase === 'melting') && (
              <div className="flex items-center justify-center gap-2 py-4 text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>
                <CircularProgress size={16} />
                <span>Paying Lightning invoice…</span>
              </div>
            )}

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
        {phase === 'form' && (
          <Button
            variant="contained"
            onClick={() => void getQuote()}
            disabled={!bolt11.trim() || !effectiveMint}
            startIcon={<Zap size={16} />}
          >
            Get quote
          </Button>
        )}
        {phase === 'quoted' && (
          <Button
            variant="contained"
            onClick={() => void melt()}
            startIcon={<Zap size={16} />}
          >
            Melt {quote?.amountSats.toLocaleString()} sats
          </Button>
        )}
      </ModalActions>
    </Modal>
  )
}
