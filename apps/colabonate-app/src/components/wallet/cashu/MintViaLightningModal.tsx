/**
 * MintViaLightningModal — Lightning → eCash top-up (ADR-187 / FU-46).
 *
 * Flow:
 *   1. User picks amount + mint, clicks "Generate invoice"
 *   2. Hook asks the mint for a mint quote (a bolt11 our existing rail pays)
 *   3. Modal shows the bolt11 + payment options:
 *        - WebLN (`window.webln.sendPayment`) when the user has a browser LN
 *          extension installed (Alby/Amber etc.)
 *        - The connected custodial `Wallet` (LNBits/Lightspark) via the
 *          existing WalletContext.sendPayment
 *        - Copy invoice → pay externally
 *   4. After payment, the hook polls the mint until it confirms PAID, calls
 *      `mintProofsBolt11`, and persists a new kind-7375 event. The panel
 *      re-renders the new balance.
 */
import { useState } from 'react'
import { Zap, Copy, Check, ArrowDownToLine, ExternalLink } from 'lucide-react'
import { Modal, ModalContent, ModalActions } from '@ds/ui'
import { Button, CircularProgress } from '@mui/material'
import { FiatHint } from '../../currency/FiatHint'
import { useCashu } from '../../../contexts/CashuContext'
import type { MintQuoteInfo } from '../../../hooks/useCashuWallet'
import { useWallet } from '../../../contexts/WalletContext'

interface Props {
  open: boolean
  onClose: () => void
}

type Phase = 'form' | 'quoted' | 'minting' | 'done' | 'error'

function truncateInvoice(bolt11: string): string {
  if (bolt11.length <= 32) return bolt11
  return `${bolt11.slice(0, 18)}…${bolt11.slice(-10)}`
}

export function MintViaLightningModal({ open, onClose }: Props) {
  const { mints, requestMint, mintProofs } = useCashu()
  const { wallet, sendPayment } = useWallet()

  const [mintUrl, setMintUrl] = useState('')
  const [amount, setAmount] = useState('')
  const [phase, setPhase] = useState<Phase>('form')
  const [quote, setQuote] = useState<MintQuoteInfo | null>(null)
  const [minted, setMinted] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const effectiveMint = mintUrl || mints[0] || ''
  const amountNum = Number(amount)

  const canPayWithWallet = !!wallet && wallet.status === 'ACTIVE'
  const canPayWithWebLN = typeof window !== 'undefined' && !!(window as unknown as { webln?: unknown }).webln

  function reset() {
    setMintUrl('')
    setAmount('')
    setPhase('form')
    setQuote(null)
    setMinted(null)
    setError(null)
    setCopied(false)
  }

  function close() {
    reset()
    onClose()
  }

  async function generateQuote() {
    setError(null)
    try {
      const q = await requestMint(amountNum, effectiveMint)
      setQuote(q)
      setPhase('quoted')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function copyInvoice() {
    if (!quote) return
    await navigator.clipboard.writeText(quote.bolt11)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function payAndMint(pay: (bolt11: string) => Promise<void>) {
    if (!quote) return
    setError(null)
    setPhase('minting')
    try {
      const sats = await mintProofs(quote, pay)
      setMinted(sats)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('quoted')
    }
  }

  async function payWithWebLN() {
    await payAndMint(async (bolt11) => {
      const w = (window as unknown as { webln: { enable(): Promise<void>; sendPayment(i: string): Promise<unknown> } }).webln
      await w.enable()
      await w.sendPayment(bolt11)
    })
  }

  async function payWithWallet() {
    await payAndMint(async (bolt11) => {
      await sendPayment(bolt11)
    })
  }

  return (
    <Modal open={open} onClose={close} title="Top up eCash" size="sm">
      <ModalContent>
        {phase === 'done' && minted !== null ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div
              className="flex items-center justify-center rounded-full"
              style={{ width: 44, height: 44, background: 'rgba(34,197,94,0.12)', color: 'rgb(22,163,74)' }}
            >
              <ArrowDownToLine size={20} />
            </div>
            <div>
              <div className="text-[15px] font-semibold" style={{ color: 'var(--theme-text)' }}>
                +{minted.toLocaleString()} sats minted
              </div>
              <div className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }}>
                Added to your eCash balance at {effectiveMint}.
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {phase === 'form' && (
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
                    {mints.map((u: string) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                    Amount (sats)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 1000"
                    className="rounded-lg outline-none text-[13px]"
                    style={{
                      height: 40,
                      padding: '0 12px',
                      background: 'var(--theme-bg-subtle)',
                      color: 'var(--theme-text)',
                      border: '1px solid var(--theme-border)',
                    }}
                  />
                  {Number(amount) > 0 && (
                    <FiatHint sats={Number(amount)} className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }} />
                  )}
                </div>
                <div className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
                  The mint issues a Lightning invoice for the requested amount. After the invoice is paid the mint issues fresh ecash proofs that are added to your wallet.
                </div>
              </>
            )}

            {(phase === 'quoted' || phase === 'minting') && quote && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                    Lightning invoice ({quote.amountSats.toLocaleString()} sats)
                  </label>
                  <div
                    className="rounded-lg p-3 text-[12px] font-mono break-all"
                    style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
                  >
                    {truncateInvoice(quote.bolt11)}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {canPayWithWebLN && (
                    <Button
                      variant="contained"
                      onClick={() => void payWithWebLN()}
                      disabled={phase === 'minting'}
                      startIcon={phase === 'minting' ? <CircularProgress size={14} color="inherit" /> : <Zap size={14} />}
                    >
                      {phase === 'minting' ? 'Minting…' : 'Pay with WebLN'}
                    </Button>
                  )}
                  {canPayWithWallet && (
                    <Button
                      variant={canPayWithWebLN ? 'outlined' : 'contained'}
                      onClick={() => void payWithWallet()}
                      disabled={phase === 'minting'}
                      startIcon={phase === 'minting' ? <CircularProgress size={14} color="inherit" /> : <Zap size={14} />}
                    >
                      {phase === 'minting' ? 'Minting…' : 'Pay with Wallet'}
                    </Button>
                  )}
                  <Button
                    variant="outlined"
                    onClick={() => void copyInvoice()}
                    startIcon={copied ? <Check size={14} /> : <Copy size={14} />}
                  >
                    {copied ? 'Copied' : 'Copy invoice'}
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={() => window.open(`lightning:${quote.bolt11}`, '_self')}
                    startIcon={<ExternalLink size={14} />}
                  >
                    Open in wallet
                  </Button>
                </div>
                <div className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
                  After the invoice is paid, this window will mint the ecash proofs automatically. If you paid externally (copy / open-in-wallet) click <em>Pay with Wallet</em> again — it polls the mint and mints as soon as payment lands.
                </div>
              </>
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
            onClick={() => void generateQuote()}
            disabled={amountNum <= 0 || !effectiveMint}
            startIcon={<Zap size={16} />}
          >
            Generate invoice
          </Button>
        )}
      </ModalActions>
    </Modal>
  )
}
