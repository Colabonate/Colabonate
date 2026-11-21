import { useCallback, useMemo, useState } from 'react'
import { Zap } from 'lucide-react'
import { Button, CircularProgress } from '@mui/material'

import { Modal, ModalContent } from '@ds/ui'
import { useTranslation } from '../../contexts/LocaleContext'

interface TierDef {
  id: string
  amount: number
  label: string
  buttonColor: string
  buttonBorder: string
  buttonBg: string
  buttonHoverBg: string
}

const TIERS: TierDef[] = [
  {
    id: 'rare',
    amount: 2100,
    label: 'RARE',
    buttonColor: '#3b82f6',
    buttonBorder: 'rgba(59,130,246,0.40)',
    buttonBg: 'rgba(59,130,246,0.10)',
    buttonHoverBg: 'rgba(59,130,246,0.18)',
  },
  {
    id: 'epic',
    amount: 21000,
    label: 'EPIC',
    buttonColor: '#a855f7',
    buttonBorder: 'rgba(168,85,247,0.40)',
    buttonBg: 'rgba(168,85,247,0.10)',
    buttonHoverBg: 'rgba(168,85,247,0.18)',
  },
  {
    id: 'legendary',
    amount: 210000,
    label: 'LEGEND',
    buttonColor: '#f59e0b',
    buttonBorder: 'rgba(245,158,11,0.40)',
    buttonBg: 'rgba(245,158,11,0.10)',
    buttonHoverBg: 'rgba(245,158,11,0.18)',
  },
]

function tierColorFor(amount: number): TierDef | null {
  if (amount >= 210000) return TIERS[2]
  if (amount >= 21000) return TIERS[1]
  if (amount >= 2100) return TIERS[0]
  return null
}

const TIERS_XS = {
  minWidth: 36,
  height: 28,
  fontSize: 10,
  fontWeight: 800,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.04em',
  borderRadius: '8px',
  px: 1.5,
}

interface Props {
  open: boolean
  onClose: () => void
  sendTip: (amountSats: number) => Promise<void>
  sending: boolean
  pendingAmount: number | null
  /** False without a connected wallet — the tip cannot be paid (ADR-247). */
  available: boolean
}

export function CustomTipModal({ open, onClose, sendTip, sending, pendingAmount, available }: Props) {
  const { formatNumber } = useTranslation()
  const [amount, setAmount] = useState('')

  const numeric = useMemo(() => {
    const v = Number(amount)
    return Number.isFinite(v) && v > 0 ? v : 0
  }, [amount])

  const matchedTier = useMemo(() => tierColorFor(numeric), [numeric])
  const isValid = numeric > 0
  const accentColor = matchedTier?.buttonColor ?? 'var(--theme-text-muted)'
  const accentBg = matchedTier?.buttonBg ?? 'var(--theme-bg-subtle)'
  const accentBorder = matchedTier?.buttonBorder ?? 'var(--theme-border)'

  const handleTierClick = useCallback((amt: number) => {
    if (!available) return
    sendTip(amt)
  }, [available, sendTip])

  const handleSend = useCallback(() => {
    if (!isValid || sending || !available) return
    sendTip(numeric)
    setAmount('')
    onClose()
  }, [available, isValid, sending, numeric, sendTip, onClose])

  const handleClose = useCallback(() => {
    setAmount('')
    onClose()
  }, [onClose])

  return (
    <Modal open={open} onClose={handleClose} title="Support Colabonate" size="sm">
      <ModalContent>
        <div className="flex flex-col gap-4">
          <p className="text-[13px] m-0" style={{ color: 'var(--theme-text-muted)' }}>
            Zap the project with your connected wallet. Pick a tier or enter a custom amount.
          </p>

          {!available && (
            <p className="text-[12px] m-0" style={{ color: 'var(--color-status-warning)' }}>
              Connect a wallet first — tips are paid directly from your own Lightning wallet.
            </p>
          )}

          <div className="flex items-center gap-2">
            {TIERS.map(tier => (
              <Button
                key={tier.id}
                variant="outlined"
                disabled={sending || !available}
                onClick={() => handleTierClick(tier.amount)}
                sx={{
                  ...TIERS_XS,
                  flex: 1,
                  color: tier.buttonColor,
                  borderColor: tier.buttonBorder,
                  backgroundColor: tier.buttonBg,
                  '&:hover': {
                    backgroundColor: tier.buttonHoverBg,
                    borderColor: tier.buttonColor,
                  },
                  '&.Mui-disabled': {
                    borderColor: tier.buttonBorder,
                    backgroundColor: tier.buttonBg,
                    color: tier.buttonColor,
                    opacity: 0.5,
                  },
                }}
              >
                {pendingAmount === tier.amount
                  ? <CircularProgress size={10} color="inherit" />
                  : formatNumber(tier.amount)}
              </Button>
            ))}
          </div>

          <div
            className="flex flex-col gap-3 rounded-xl p-4 transition-all duration-300"
            style={{
              background: accentBg,
              border: `1px solid ${accentBorder}`,
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accentColor }}>
                {matchedTier ? `${matchedTier.label} TIER` : 'Custom amount'}
              </span>
              {matchedTier && <Zap size={14} className="fill-current" style={{ color: accentColor }} />}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSend()
                  if (e.key === 'Escape') handleClose()
                }}
                placeholder="Enter sats"
                autoFocus
                className="flex-1 h-10 rounded-lg text-[15px] font-semibold px-3 outline-none transition-all duration-200"
                style={{
                  background: 'var(--theme-bg)',
                  border: `1.5px solid ${accentBorder}`,
                  color: accentColor,
                  caretColor: accentColor,
                }}
              />
              <span className="text-[12px] font-semibold shrink-0" style={{ color: accentColor }}>
                sats
              </span>
            </div>

            <div className="flex items-center gap-3">
              {TIERS.map(tier => (
                <span
                  key={tier.id}
                  className="text-[9px] uppercase tracking-wider transition-opacity duration-200"
                  style={{ color: tier.buttonColor, opacity: numeric >= tier.amount ? 1 : 0.35 }}
                >
                  {tier.label} {formatNumber(tier.amount)}+
                </span>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outlined"
              onClick={handleClose}
              sx={{
                fontWeight: 600,
                borderRadius: '8px',
                color: 'var(--theme-text-muted)',
                borderColor: 'var(--theme-border)',
                '&:hover': {
                  borderColor: 'var(--theme-text-muted)',
                },
              }}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              disabled={!isValid || sending || !available}
              onClick={handleSend}
              startIcon={sending ? <CircularProgress size={14} color="inherit" /> : <Zap size={14} />}
              sx={{
                fontWeight: 700,
                borderRadius: '8px',
                backgroundColor: accentColor,
                color: accentColor === '#f59e0b' ? '#1a1a1a' : '#fff',
                '&:hover': {
                  backgroundColor: accentColor,
                  opacity: 0.85,
                },
                '&.Mui-disabled': {
                  backgroundColor: accentBg,
                  color: accentColor,
                  opacity: 0.5,
                },
              }}
            >
              Support {isValid ? `${formatNumber(numeric)} sats` : ''}
            </Button>
          </div>

          {sending && (
            <div className="flex items-center justify-center gap-2 -mt-2">
              <CircularProgress size={14} style={{ color: accentColor }} />
              <span className="text-[11px] font-semibold" style={{ color: accentColor }}>
                Sending...
              </span>
            </div>
          )}
        </div>
      </ModalContent>
    </Modal>
  )
}
