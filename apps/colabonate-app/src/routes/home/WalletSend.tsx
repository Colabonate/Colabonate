import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Typography,
  Button,
  TextField,
  Alert,
  CircularProgress,
} from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
import CloseIcon from '@mui/icons-material/Close'
import ContentPasteIcon from '@mui/icons-material/ContentPaste'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { formatSats } from '../../lib/currency'
import { FiatHint } from '../../components/currency/FiatHint'
import { useWallet } from '../../contexts/WalletContext'

/**
 * BOLT11 amount decoding — the human-readable part encodes an optional
 * amount + multiplier (m/u/n/p) before the bech32 data. Parsed by hand
 * (no `light-bolt11-decoder` dependency — new deps need approval per
 * AGENTS.md §Boundaries) rather than a full bech32 + tagged-field decode,
 * so only the amount is extracted; destination/description are NOT decoded
 * here (the previous version's "destination" field was a hardcoded
 * placeholder, not real data — removed rather than shown inaccurately).
 * Verified against a known example: lnbc2500u1p3... = 2500 * 100 = 250,000 sats.
 */
const BOLT11_MULTIPLIER_TO_SATS: Record<string, number> = {
  m: 100_000,
  u: 100,
  n: 0.1,
  p: 0.0001,
}

function decodeBolt11AmountSats(invoice: string): number | null {
  const match = invoice.match(/^ln(?:bc|tb|bcrt)(\d+)([munp])?1/i)
  if (!match) return null
  const digits = Number(match[1])
  const multiplier = match[2]?.toLowerCase()
  if (!multiplier) return digits * 100_000_000 // whole BTC — vanishingly rare for real invoices
  return Math.round(digits * BOLT11_MULTIPLIER_TO_SATS[multiplier])
}

type InvoiceKind = 'bolt11' | 'lnurl' | null

function classifyInput(value: string): InvoiceKind {
  const v = value.trim().toLowerCase()
  if (v.startsWith('lnbc') || v.startsWith('lntb') || v.startsWith('lnbcrt')) return 'bolt11'
  if (v.startsWith('lnurl')) return 'lnurl'
  return null
}

export function WalletSend() {
  const navigate = useNavigate()
  const { wallet, sendPayment } = useWallet()
  const [invoice, setInvoice] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendResult, setSendResult] = useState<{ paymentHash: string; amountSats: number | null } | null>(null)

  const trimmed = invoice.trim()
  const kind = classifyInput(trimmed)
  const amountSats = kind === 'bolt11' ? decodeBolt11AmountSats(trimmed) : null

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText()
      setInvoice(text)
      setPasteError(null)
    } catch {
      setPasteError('Failed to read clipboard — paste manually instead.')
    }
  }

  async function handleSend() {
    if (kind !== 'bolt11') return
    setSending(true)
    setSendError(null)
    try {
      const result = await sendPayment(trimmed)
      if (result.status === 'FAILED') {
        setSendError('Payment failed. Check the invoice and your balance, then try again.')
        return
      }
      setSendResult({ paymentHash: result.paymentHash, amountSats })
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Payment failed. Please try again.')
    } finally {
      setSending(false)
    }
  }

  if (sendResult) {
    return (
      <PageContainer size="narrow" spacing="lg" className="!mt-0">
        <PageHeader icon={<SendIcon sx={{ fontSize: 24 }} />} title="Send" onBack={() => navigate('/wallet')} />
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 6, textAlign: 'center' }}>
          <Box
            sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 64, height: 64, borderRadius: '50%',
              bgcolor: 'var(--color-status-success-bg)', color: 'var(--color-status-success)',
            }}
          >
            <CheckCircleIcon sx={{ fontSize: 32 }} />
          </Box>
          <Typography component="div" role="heading" aria-level={1} variant="h6" sx={{ color: 'var(--theme-text)' }}>
            Payment sent
          </Typography>
          {sendResult.amountSats !== null && (
            <Typography component="p" variant="body1" sx={{ color: 'var(--theme-text)', fontWeight: 700 }}>
              {formatSats(sendResult.amountSats, { compact: false })}
            </Typography>
          )}
          <Typography component="p" variant="caption" sx={{ color: 'var(--theme-text-muted)', fontFamily: 'monospace' }}>
            {sendResult.paymentHash.slice(0, 24)}…
          </Typography>
          <Button variant="contained" onClick={() => navigate('/wallet')} sx={{ mt: 2 }}>
            Back to Wallet
          </Button>
        </Box>
      </PageContainer>
    )
  }

  return (
    <PageContainer size="narrow" spacing="lg" className="!mt-0">
      <PageHeader
        icon={<SendIcon sx={{ fontSize: 24 }} />}
        title="Send"
        subtitle="Paste a Lightning invoice to pay"
        onBack={() => navigate('/wallet')}
      />

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {!wallet && (
          <Alert severity="info">
            You don&apos;t have a wallet set up yet.{' '}
            <Box component="span" sx={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => navigate('/wallet')}>
              Set one up on the Wallet page
            </Box>{' '}
            before sending a payment.
          </Alert>
        )}

        <Box
          sx={{
            display: 'flex', flexDirection: 'column', gap: 2, p: 2.5, borderRadius: 3,
            border: '1px solid var(--theme-border)', bgcolor: 'var(--theme-surface)',
          }}
        >
          <TextField
            id="invoice-input"
            label="Lightning invoice"
            value={invoice}
            onChange={e => setInvoice(e.target.value)}
            placeholder="lnbc1... or lnurl1..."
            multiline
            minRows={4}
            fullWidth
            error={trimmed.length > 0 && kind === null}
            helperText={trimmed.length > 0 && kind === null ? 'This doesn\'t look like a Lightning invoice or LNURL.' : ' '}
            sx={{ '& textarea': { fontFamily: 'var(--typography-fontfamily-mono)', fontSize: 13 } }}
          />

          {pasteError && <Alert severity="error" onClose={() => setPasteError(null)}>{pasteError}</Alert>}

          <Button
            variant="outlined"
            onClick={() => void handlePaste()}
            startIcon={<ContentPasteIcon sx={{ fontSize: 16 }} />}
            sx={{ alignSelf: 'flex-start' }}
          >
            Paste from clipboard
          </Button>
        </Box>

        {kind === 'bolt11' && (
          <Box
            sx={{
              display: 'flex', flexDirection: 'column', gap: 1.5, p: 2.5, borderRadius: 3,
              border: '1px solid var(--theme-border)', bgcolor: 'var(--theme-surface)',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography component="span" variant="overline" sx={{ color: 'var(--theme-text-muted)' }}>
                Amount
              </Typography>
              <Box sx={{ textAlign: 'right' }}>
                <Typography component="div" variant="body1" sx={{ fontWeight: 700, color: 'var(--theme-text)' }}>
                  {amountSats !== null ? formatSats(amountSats, { compact: false }) : 'Not specified — you\'ll be asked in your wallet'}
                </Typography>
                {amountSats !== null && <FiatHint sats={amountSats} />}
              </Box>
            </Box>
          </Box>
        )}

        {kind === 'lnurl' && (
          <Alert severity="info">
            LNURL payment requests are resolved by your connected wallet when you send — the amount will be
            shown there.
          </Alert>
        )}

        {sendError && <Alert severity="error" onClose={() => setSendError(null)}>{sendError}</Alert>}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Button
            variant="outlined"
            onClick={() => navigate('/wallet')}
            startIcon={<CloseIcon sx={{ fontSize: 16 }} />}
            sx={{ flex: 1 }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleSend()}
            disabled={kind === null || !wallet || sending}
            startIcon={sending ? <CircularProgress size={16} sx={{ color: 'currentColor' }} /> : <SendIcon sx={{ fontSize: 16 }} />}
            sx={{ flex: 2 }}
          >
            {sending ? 'Sending…' : kind === null ? 'Paste invoice to continue' : 'Send Payment'}
          </Button>
        </Box>
      </Box>
    </PageContainer>
  )
}
