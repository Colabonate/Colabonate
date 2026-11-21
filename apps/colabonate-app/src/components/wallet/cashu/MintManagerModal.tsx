/**
 * MintManagerModal — add/remove trusted mints (ADR-187 D2). Mints live in the
 * kind-17375 wallet event (NIP-60); add/remove republishes that event. A mint
 * with an existing balance cannot be removed (spend/melt it first).
 */
import { useState } from 'react'
import { Plus, Trash2, AlertTriangle } from 'lucide-react'
import { Modal, ModalContent, ModalActions } from '@ds/ui'
import { Button, CircularProgress } from '@mui/material'
import { cn } from '@ds/utils'
import { useCashu } from '../../../contexts/CashuContext'

interface Props {
  open: boolean
  onClose: () => void
}

export function MintManagerModal({ open, onClose }: Props) {
  const { mints, state, addMint, removeMint } = useCashu()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function balanceFor(mintUrl: string): number {
    return state.buckets.find((b) => b.mintUrl === mintUrl)?.proofs.reduce((s, p) => s + p.amount, 0) ?? 0
  }

  async function add() {
    setError(null)
    if (!url.trim()) return
    setBusy(true)
    try {
      await addMint(url.trim())
      setUrl('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove(mintUrl: string) {
    setError(null)
    setBusy(true)
    try {
      await removeMint(mintUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Manage mints" size="sm">
      <ModalContent>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
              Add mint URL
            </label>
            <div className="flex gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mint.example"
                className={cn('flex-1 rounded-lg outline-none text-[13px]')}
                style={{
                  height: 40,
                  padding: '0 12px',
                  background: 'var(--theme-bg-subtle)',
                  color: 'var(--theme-text)',
                  border: '1px solid var(--theme-border)',
                }}
              />
              <Button
                variant="contained"
                onClick={add}
                disabled={busy || url.trim().length === 0}
                startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <Plus size={16} />}
                sx={{ minWidth: 'auto', whiteSpace: 'nowrap' }}
              >
                Add
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
              Trusted mints
            </span>
            {mints.length === 0 ? (
              <div className="text-[13px] py-2" style={{ color: 'var(--theme-text-muted)' }}>
                No mints yet.
              </div>
            ) : (
              mints.map((mintUrl) => {
                const bal = balanceFor(mintUrl)
                const hasBalance = bal > 0
                return (
                  <div
                    key={mintUrl}
                    className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg"
                    style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="text-[12px] font-mono truncate" style={{ color: 'var(--theme-text)' }}>
                        {mintUrl}
                      </span>
                      <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
                        {bal.toLocaleString()} sats
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => (hasBalance ? null : remove(mintUrl))}
                      disabled={hasBalance || busy}
                      title={hasBalance ? 'Spend the balance first' : 'Remove mint'}
                      className={cn(
                        'flex items-center justify-center rounded-lg transition-all duration-150 shrink-0',
                        hasBalance ? 'opacity-40 cursor-not-allowed' : 'hover:bg-[var(--theme-surface-secondary)] cursor-pointer',
                      )}
                      style={{ width: 30, height: 30, border: '1px solid var(--theme-border)', color: hasBalance ? 'var(--theme-text-muted)' : 'var(--color-primary-50)' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )
              })
            )}
          </div>

          {error && (
            <div className="text-[12px] px-3 py-2 rounded-lg" style={{ background: 'rgba(232,69,65,0.10)', color: 'var(--color-primary-50)' }}>
              {error}
            </div>
          )}

          <div
            className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-[11px]"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.20)', color: 'rgb(180,120,10)' }}
          >
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              External mints hold the sats backing your eCash. A mint can become insolvent — Colabonate does not guarantee eCash balances.
            </span>
          </div>
        </div>
      </ModalContent>
      <ModalActions>
        <Button variant="outlined" onClick={onClose}>
          Done
        </Button>
      </ModalActions>
    </Modal>
  )
}
