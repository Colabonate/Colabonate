import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, Collapse, Paper, TextField, Typography } from '@mui/material'
import { CheckCircle, CircleDot, Coins, Copy, CreditCard, Zap } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useQueryClient } from '@tanstack/react-query'
import { decodeToken } from '@col/cashu'
import { apiCall, ApiError } from '../../lib/api'
import { usePayment } from '../../hooks/usePayment'
import { useBetaMode } from '../../hooks/useBetaMode'
import { useCashu } from '../../contexts/CashuContext'
import { useNotification } from '../../context/NotificationContext'
import { confirmDirectPayment, shouldSelfConfirmDirectPayment } from '../../lib/direct-pay'
import { canDispatchHoldInvoice } from '../../lib/payment-dispatch'
import { getMintTrust } from '../../lib/cashu'
import { signAndPublishFromTemplate } from '../../lib/nostr-ticket'
import { formatSats } from '../../lib/currency'
import {
  PAYMENT_PHASE_LABEL,
  PAYMENT_RAIL_LABEL,
  clearPendingCashuToken,
  deriveTicketPaymentView,
  meltMintCandidates,
  readPendingCashuToken,
  writePendingCashuToken,
  type TicketPaymentPhase,
} from '../../lib/ticket-payment'
import type { Ticket } from '../../types/api'

interface TicketPaymentCardProps {
  ticket: Ticket
  isBuyer: boolean
  isSeller: boolean
}

const PHASE_COLOR: Record<TicketPaymentPhase, { bg: string; fg: string }> = {
  awaiting: { bg: 'rgba(255,192,57,0.12)', fg: 'var(--color-status-warning)' },
  'token-sent': { bg: 'rgba(99,179,237,0.12)', fg: 'var(--color-primary-50)' },
  paid: { bg: 'rgba(72,187,120,0.12)', fg: 'var(--color-status-success)' },
  cancelled: { bg: 'var(--theme-bg-subtle)', fg: 'var(--theme-text-muted)' },
  'fee-pending': { bg: 'rgba(159,122,234,0.15)', fg: 'var(--color-secondary-50)' },
}

const POLL_MS = Number(import.meta.env.VITE_PAYMENT_POLL_MS) || 5000

/**
 * ADR-399 D4: one payment card for every rail. Shows the rail, one status and
 * the action that fits it: Lightning (QR, wallet, eCash melt, preimage),
 * Cashu (token delivery / redeem), demo wallet and legacy escrow invoices.
 */
export function TicketPaymentCard({ ticket, isBuyer, isSeller }: TicketPaymentCardProps) {
  const queryClient = useQueryClient()
  const { payInvoice, pollUntilPaid, wallet } = usePayment()
  const { isBeta } = useBetaMode()
  const cashu = useCashu()
  const { showSnackbar } = useNotification()

  const [paidLocally, setPaidLocally] = useState(false)
  const [busy, setBusy] = useState<null | 'wallet' | 'ecash' | 'cashu' | 'redeem' | 'confirm' | 'demo'>(null)
  const [copied, setCopied] = useState(false)
  const [showPreimage, setShowPreimage] = useState(false)
  const [preimageInput, setPreimageInput] = useState('')
  const [preimageError, setPreimageError] = useState<string | null>(null)
  const [pendingToken, setPendingToken] = useState<string | null>(() => readPendingCashuToken(ticket.id))
  const [cashuError, setCashuError] = useState<string | null>(null)

  const view = deriveTicketPaymentView(ticket, paidLocally)
  const amount = ticket.amountSats ?? ticket.offer?.priceSats ?? 0
  const isEscrow = view?.rail === 'ESCROW'
  // 'fee-pending' keeps polling: the ticket only flips to PAID once the
  // hosted-canvas fee is confirmed, and the poll is what refreshes the card.
  const awaiting =
    view?.phase === 'awaiting' || view?.phase === 'token-sent' || view?.phase === 'fee-pending'

  const refreshTicket = () => queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] })

  // Poll the payment status while the ticket waits on any rail. For LN the
  // server also checks the seller's wallet on this request (ADR-399 D2).
  useEffect(() => {
    if (!awaiting || (!isBuyer && !isSeller)) return
    let stopped = false
    const poll = async () => {
      try {
        const res = await apiCall(`/api/tickets/${ticket.id}/payment-status`)
        const data = (await res.json()) as { paid?: boolean; cashuTokenSentAt?: string | null }
        if (stopped) return
        if (data.paid) {
          setPaidLocally(true)
          void queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] })
        } else if (data.cashuTokenSentAt && !ticket.cashuTokenSentAt) {
          void queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] })
        }
      } catch {
        /* silent: the next tick retries */
      }
    }
    void poll()
    const interval = setInterval(poll, POLL_MS)
    return () => {
      stopped = true
      clearInterval(interval)
    }
  }, [awaiting, isBuyer, isSeller, ticket.id, ticket.cashuTokenSentAt, queryClient])

  const decodedSellerToken = useMemo(() => {
    if (!ticket.cashuToken) return null
    try {
      const d = decodeToken(ticket.cashuToken)
      return { mintUrl: d.mintUrl, sats: d.proofs.reduce((s, p) => s + p.amount, 0) }
    } catch {
      return null
    }
  }, [ticket.cashuToken])

  const meltCandidates = useMemo(
    () => (cashu.enabled && cashu.status === 'ready' ? meltMintCandidates(cashu.state.buckets, amount) : []),
    [cashu.enabled, cashu.status, cashu.state.buckets, amount],
  )

  if (!view) return null

  function markPaid(message: string) {
    setPaidLocally(true)
    showSnackbar(message, 'success')
    void refreshTicket()
  }

  function errorMessage(e: unknown, fallback: string): string {
    if (e instanceof ApiError) return (e.data?.message as string) ?? e.message ?? fallback
    return e instanceof Error ? e.message : fallback
  }

  // ── Lightning ────────────────────────────────────────────────────────────
  async function payWithWallet() {
    if (!ticket.lightningInvoice || !ticket.paymentHash) return
    setBusy('wallet')
    try {
      const result = await payInvoice({ invoice: ticket.lightningInvoice, paymentHash: ticket.paymentHash, escrow: isEscrow })
      if (!result.ok) {
        if (result.mode === 'MANUAL') {
          setShowPreimage(true)
          showSnackbar('No connected Lightning wallet. Scan the QR code with any wallet; the payment is picked up here.', 'warning')
        } else {
          showSnackbar(result.error || 'Payment failed', 'error')
        }
        return
      }
      // A direct-pay invoice belongs to the seller: self-confirm with the
      // preimage the wallet returned. Without one the server check (ADR-399
      // D2) or the escrow poll picks the payment up.
      if (result.preimage && shouldSelfConfirmDirectPayment({ isBeta, isEscrow, preimage: result.preimage })) {
        try {
          await confirmDirectPayment(ticket.id, result.preimage)
          markPaid('Payment received!')
        } catch (e) {
          showSnackbar(errorMessage(e, 'Payment sent. Confirmation is still pending.'), 'warning')
        }
        return
      }
      if (await pollUntilPaid(ticket.paymentHash)) {
        markPaid('Payment received!')
        return
      }
      showSnackbar('Payment sent. Confirmation is taking longer than expected; this page updates automatically.', 'info')
    } catch {
      showSnackbar('Error processing payment.', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function payWithEcash() {
    if (!ticket.lightningInvoice) return
    setBusy('ecash')
    try {
      let lastError = 'No mint holds enough eCash to cover this invoice and its fee reserve.'
      for (const candidate of meltCandidates) {
        const quote = await cashu.requestMeltQuote(ticket.lightningInvoice, candidate.mintUrl)
        if (quote.requiredSats > candidate.balanceSats) {
          lastError = `Not enough eCash at ${candidate.mintUrl}: need ${quote.requiredSats} sats including the fee reserve.`
          continue
        }
        const result = await cashu.confirmMelt(quote)
        if (result.preimage) {
          try {
            await confirmDirectPayment(ticket.id, result.preimage)
            markPaid('Paid with eCash!')
            return
          } catch {
            /* fall through to the server-side check */
          }
        }
        showSnackbar('Paid with eCash. Waiting for the seller wallet to confirm.', 'info')
        return
      }
      showSnackbar(lastError, 'error')
    } catch (e) {
      showSnackbar(errorMessage(e, 'eCash payment failed'), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function submitPreimage() {
    const preimage = preimageInput.trim()
    if (!preimage) return
    setBusy('confirm')
    setPreimageError(null)
    try {
      await confirmDirectPayment(ticket.id, preimage)
      setPreimageInput('')
      markPaid('Payment confirmed!')
    } catch (e) {
      setPreimageError(errorMessage(e, 'Confirmation failed'))
    } finally {
      setBusy(null)
    }
  }

  function copyInvoice() {
    if (!ticket.lightningInvoice) return
    void navigator.clipboard.writeText(ticket.lightningInvoice)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Cashu ────────────────────────────────────────────────────────────────
  async function deliverToken(token: string) {
    try {
      await apiCall(`/api/tickets/${ticket.id}/cashu-token`, { method: 'POST', body: JSON.stringify({ token }) })
      clearPendingCashuToken(ticket.id)
      setPendingToken(null)
      showSnackbar('Cashu payment delivered to the seller.', 'success')
      void refreshTicket()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Another tab or device already delivered a token for this ticket.
        setCashuError('A Cashu payment was already delivered for this ticket. The token below was not sent. Keep it: it is locked to the seller.')
        void refreshTicket()
        return
      }
      setCashuError(errorMessage(e, 'Delivery failed. Your token is kept on this device, try again.'))
    }
  }

  async function payWithCashu() {
    if (!ticket.cashuSellerPubkey || !ticket.cashuMintUrl || !amount) return
    setBusy('cashu')
    setCashuError(null)
    try {
      // Re-read first: a token delivered from another tab must never be paid twice.
      const fresh = await apiCall(`/api/tickets/${ticket.id}`)
      const data = (await fresh.json()) as { ticket?: Ticket }
      if (data.ticket?.cashuTokenSentAt) {
        void refreshTicket()
        return
      }
      const token = await cashu.sendP2PKForCheckout(ticket.cashuSellerPubkey, ticket.cashuMintUrl, amount)
      writePendingCashuToken(ticket.id, token)
      setPendingToken(token)
      await deliverToken(token)
    } catch (e) {
      setCashuError(errorMessage(e, 'Failed to create the Cashu token'))
    } finally {
      setBusy(null)
    }
  }

  async function retryDelivery() {
    if (!pendingToken) return
    setBusy('cashu')
    setCashuError(null)
    try {
      await deliverToken(pendingToken)
    } finally {
      setBusy(null)
    }
  }

  async function confirmCashuReceived(message: string) {
    const res = await apiCall(`/api/tickets/${ticket.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'PAID' }) })
    const data = await res.json()
    if (data.nostrEventTemplate) {
      signAndPublishFromTemplate(data.nostrEventTemplate).catch(() => {})
    }
    markPaid(message)
  }

  async function redeemAndConfirm() {
    if (!ticket.cashuToken) return
    setBusy('redeem')
    setCashuError(null)
    try {
      const claimed = await cashu.receiveLockedToken(ticket.cashuToken)
      if (claimed < amount) {
        setCashuError(`Redeemed ${claimed} sats, but the order is ${amount} sats. Confirm manually only if you accept the difference.`)
        return
      }
      await confirmCashuReceived(`Redeemed ${claimed} sats, payment confirmed.`)
    } catch (e) {
      setCashuError(`${errorMessage(e, 'Redeem failed')}. If you already redeemed this token, confirm the payment manually.`)
    } finally {
      setBusy(null)
    }
  }

  async function manualCashuConfirm() {
    setBusy('confirm')
    try {
      await confirmCashuReceived('Payment confirmed.')
    } catch (e) {
      showSnackbar(errorMessage(e, 'Error confirming payment.'), 'error')
    } finally {
      setBusy(null)
    }
  }

  // ── Demo ─────────────────────────────────────────────────────────────────
  async function payDemo() {
    if (!ticket.paymentHash) return
    setBusy('demo')
    try {
      const result = await payInvoice({ invoice: '', paymentHash: ticket.paymentHash })
      if (!result.ok) {
        showSnackbar(result.error || 'Payment failed', 'error')
        return
      }
      if (await pollUntilPaid(ticket.paymentHash)) markPaid('Demo payment confirmed!')
      else showSnackbar('Payment sent. Confirmation is taking longer than expected.', 'info')
    } catch {
      showSnackbar('Error processing payment.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const phaseColor = PHASE_COLOR[view.phase]
  const cashuReady = cashu.enabled && Boolean(cashu.walletPubkey)
  const mintTrust = ticket.cashuMintUrl ? getMintTrust(ticket.cashuMintUrl) : null
  const buyerCanPay = isBuyer && view.canPay

  return (
    <Box sx={{ mt: 3 }} data-testid="ticket-payment-card">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5, flexWrap: 'wrap' }}>
        <Box
          sx={{
            width: 36, height: 36, borderRadius: '8px', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(99,179,237,0.12)',
          }}
        >
          {view.rail === 'CASHU' ? <Coins size={16} style={{ color: 'var(--color-primary-50)' }} /> : <CreditCard size={16} style={{ color: 'var(--color-primary-50)' }} />}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600}>Payment</Typography>
          <Typography variant="caption" color="text.secondary">
            {PAYMENT_RAIL_LABEL[view.rail]} · {formatSats(amount, { compact: false })}
          </Typography>
        </Box>
        <Chip
          size="small"
          icon={<CircleDot size={8} />}
          label={PAYMENT_PHASE_LABEL[view.phase]}
          sx={{
            height: 22, fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase',
            background: phaseColor.bg, color: phaseColor.fg, border: 'none',
            '& .MuiChip-icon': { color: phaseColor.fg },
          }}
        />
      </Box>

      {view.phase === 'paid' && (
        <Alert severity="success" icon={<CheckCircle size={16} />} sx={{ borderRadius: 1.5 }}>
          <Typography variant="body2" fontWeight={600}>Payment received</Typography>
        </Alert>
      )}

      {/* ADR-372 D7.3: the price is paid, the platform fee is the open leg. The
          settled seller invoice must not be offered for payment again. */}
      {view.phase === 'fee-pending' && (
        <Alert severity="info" icon={<CircleDot size={16} />} sx={{ borderRadius: 1.5 }}>
          <Typography variant="body2" fontWeight={600}>
            {isBuyer
              ? 'Price paid — the Colabonate service fee is still open'
              : 'Price received — the Colabonate service fee is still open'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {isBuyer
              ? `Pay the ${formatSats(ticket.platformFee?.amountSats ?? 0, { compact: false })} service fee below to complete the purchase and unlock the canvas.`
              : 'The buyer still has to pay the Colabonate service fee. The trade unlocks as soon as it is confirmed.'}
          </Typography>
        </Alert>
      )}

      {/* ── Lightning (direct-pay or legacy escrow invoice) ── */}
      {(view.rail === 'LN' || view.rail === 'ESCROW') && ticket.lightningInvoice && view.phase === 'awaiting' && (
        <Box sx={{ display: 'flex', gap: 2.5, alignItems: 'flex-start', flexDirection: { xs: 'column', md: 'row' } }}>
          <Box
            sx={{
              flexShrink: 0, width: { xs: 180, md: 132 }, height: { xs: 180, md: 132 }, alignSelf: { xs: 'center', md: 'flex-start' },
              borderRadius: 1.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider',
              display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'white',
            }}
          >
            <QRCodeSVG value={ticket.lightningInvoice} size={180} level="M" style={{ width: '100%', height: '100%', display: 'block' }} />
          </Box>

          <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
            <Paper variant="outlined" sx={{ p: 1.5, mb: 2, background: 'var(--theme-bg-subtle)', borderRadius: 1 }}>
              <Typography
                variant="caption"
                fontFamily="monospace"
                sx={{ wordBreak: 'break-all', display: 'block', lineHeight: 1.6, color: 'text.secondary', fontSize: '0.66rem' }}
              >
                {ticket.lightningInvoice}
              </Typography>
            </Paper>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Copy size={12} />}
                onClick={copyInvoice}
                sx={{ fontSize: '0.72rem', textTransform: 'none', ...(copied && { borderColor: 'var(--color-status-success)', color: 'var(--color-status-success)' }) }}
              >
                {copied ? 'Copied!' : 'Copy invoice'}
              </Button>

              {buyerCanPay && (isBeta || !isEscrow || canDispatchHoldInvoice(wallet)) && (
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<Zap size={12} />}
                  onClick={payWithWallet}
                  disabled={busy !== null}
                  sx={{ fontSize: '0.72rem', textTransform: 'none' }}
                >
                  {busy === 'wallet' ? 'Paying…' : isBeta ? 'Pay with demo wallet' : 'Pay with wallet'}
                </Button>
              )}

              {buyerCanPay && !isEscrow && !isBeta && meltCandidates.length > 0 && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<Coins size={12} />}
                  onClick={payWithEcash}
                  disabled={busy !== null}
                  sx={{ fontSize: '0.72rem', textTransform: 'none' }}
                >
                  {busy === 'ecash' ? 'Paying…' : 'Pay with eCash balance'}
                </Button>
              )}
            </Box>

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5, lineHeight: 1.6 }}>
              {isEscrow
                ? canDispatchHoldInvoice(wallet)
                  ? 'Your wallet pays the escrow invoice; confirmation is polled automatically.'
                  : 'Pay this escrow invoice from your Lightning wallet app using the QR code or the invoice above.'
                : isSeller
                  ? view.autoDetect
                    ? 'Waiting for the buyer. The payment is confirmed automatically as soon as your wallet receives it.'
                    : 'Waiting for the buyer. They confirm the payment with the preimage their wallet shows.'
                  : view.autoDetect
                    ? 'Paying from another wallet? Scan the QR code; this page updates automatically once the payment settles.'
                    : 'Paying from another wallet? Scan the QR code, then paste the payment preimage your wallet shows below.'}
            </Typography>

            {buyerCanPay && !isEscrow && !isBeta && (
              <Box sx={{ mt: 1.5 }}>
                {view.autoDetect && !showPreimage && (
                  <Button size="small" variant="text" onClick={() => setShowPreimage(true)} sx={{ fontSize: '0.72rem', textTransform: 'none', px: 0 }}>
                    Enter payment preimage manually
                  </Button>
                )}
                <Collapse in={!view.autoDetect || showPreimage}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mt: 0.5 }}>
                    <TextField
                      size="small"
                      fullWidth
                      placeholder="Payment preimage (hex)"
                      value={preimageInput}
                      onChange={(e) => setPreimageInput(e.target.value)}
                      error={Boolean(preimageError)}
                      helperText={preimageError ?? undefined}
                      sx={{ '& input': { fontFamily: 'monospace', fontSize: '0.72rem' } }}
                    />
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={busy !== null || preimageInput.trim().length === 0}
                      onClick={submitPreimage}
                      sx={{ fontSize: '0.72rem', textTransform: 'none', flexShrink: 0 }}
                    >
                      {busy === 'confirm' ? 'Confirming…' : 'Confirm payment'}
                    </Button>
                  </Box>
                </Collapse>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* ── Cashu eCash ── */}
      {view.rail === 'CASHU' && (view.phase === 'awaiting' || view.phase === 'token-sent') && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {ticket.cashuMintUrl && (
            <Alert severity={mintTrust === 'vetted' ? 'success' : mintTrust === 'test' ? 'warning' : 'info'} sx={{ py: 0.5 }}>
              <Typography variant="caption">
                {mintTrust === 'vetted'
                  ? 'Seller uses a Colabonate-recommended mint.'
                  : mintTrust === 'test'
                    ? 'Seller uses a public TEST mint: this token has no real value.'
                    : `Mint: ${ticket.cashuMintUrl}: unvetted third party (Colabonate does not vouch for it).`}
              </Typography>
            </Alert>
          )}

          {cashuError && (
            <Alert severity="error" sx={{ py: 0.5 }}>
              <Typography variant="caption">{cashuError}</Typography>
            </Alert>
          )}

          {/* Buyer */}
          {isBuyer && view.phase === 'token-sent' && (
            <Alert severity="info" sx={{ py: 0.75 }}>
              <Typography variant="caption">
                Your Cashu token was delivered to the seller
                {ticket.cashuTokenSentAt ? ` on ${new Date(ticket.cashuTokenSentAt).toLocaleString()}` : ''}. The order is
                confirmed once they redeem it.
              </Typography>
            </Alert>
          )}
          {isBuyer && view.phase === 'awaiting' && pendingToken && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Alert severity="warning" sx={{ py: 0.5 }}>
                <Typography variant="caption">
                  Your token is created but not delivered yet. Deliver it, do not pay again.
                </Typography>
              </Alert>
              <TokenBox token={pendingToken} />
              <Button fullWidth variant="contained" startIcon={<Zap size={16} />} onClick={retryDelivery} disabled={busy !== null} sx={{ textTransform: 'none', fontWeight: 600, py: 1.25 }}>
                {busy === 'cashu' ? 'Delivering…' : 'Deliver token to seller'}
              </Button>
            </Box>
          )}
          {isBuyer && view.phase === 'awaiting' && !pendingToken && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Button fullWidth variant="contained" startIcon={<Zap size={16} />} onClick={payWithCashu} disabled={busy !== null || !cashuReady} sx={{ textTransform: 'none', fontWeight: 600, py: 1.25 }}>
                {busy === 'cashu' ? 'Paying…' : `Pay ${formatSats(amount, { compact: false })} with Cashu`}
              </Button>
              {!cashuReady && (
                <Typography variant="caption" color="text.secondary">
                  Enable the eCash wallet in Settings → Wallet to pay this order.
                </Typography>
              )}
            </Box>
          )}

          {/* Seller */}
          {isSeller && view.phase === 'token-sent' && ticket.cashuToken && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Alert severity={decodedSellerToken && decodedSellerToken.sats >= amount ? 'info' : 'warning'} sx={{ py: 0.75 }}>
                <Typography variant="caption">
                  {decodedSellerToken
                    ? `The buyer sent a ${decodedSellerToken.sats}-sat token${decodedSellerToken.mintUrl !== ticket.cashuMintUrl ? ` from ${decodedSellerToken.mintUrl} (not your mint)` : ''}. Redeem it into your wallet to confirm the order.`
                    : 'The buyer sent a token that could not be read. Redeem it or confirm manually after checking it.'}
                </Typography>
              </Alert>
              <Button fullWidth variant="contained" color="success" startIcon={<Coins size={16} />} onClick={redeemAndConfirm} disabled={busy !== null || !cashuReady} sx={{ textTransform: 'none', fontWeight: 600, py: 1.25 }}>
                {busy === 'redeem' ? 'Redeeming…' : 'Redeem & confirm'}
              </Button>
              {!cashuReady && (
                <Typography variant="caption" color="text.secondary">
                  Enable the eCash wallet in Settings → Wallet to redeem this token.
                </Typography>
              )}
              <TokenBox token={ticket.cashuToken} />
            </Box>
          )}
          {isSeller && view.phase === 'awaiting' && (
            <Typography variant="caption" color="text.secondary">
              Waiting for the buyer's Cashu token. It appears here and you are notified as soon as it is sent.
            </Typography>
          )}
          {isSeller && (
            <Button fullWidth variant="text" onClick={manualCashuConfirm} disabled={busy !== null} sx={{ textTransform: 'none', fontSize: '0.78rem' }}>
              {busy === 'confirm' ? 'Confirming…' : 'I received the payment another way: confirm manually'}
            </Button>
          )}
        </Box>
      )}

      {/* ── Demo wallet (beta) ── */}
      {view.rail === 'DEMO' && view.phase === 'awaiting' && (
        buyerCanPay ? (
          <Button fullWidth variant="contained" color="success" startIcon={<Zap size={16} />} onClick={payDemo} disabled={busy !== null} sx={{ textTransform: 'none', fontWeight: 600, py: 1.25 }}>
            {busy === 'demo' ? 'Paying…' : 'Pay with demo wallet'}
          </Button>
        ) : (
          <Typography variant="caption" color="text.secondary">Waiting for the buyer's demo payment.</Typography>
        )
      )}
    </Box>
  )
}

function TokenBox({ token }: { token: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
      <Typography
        variant="caption"
        fontFamily="monospace"
        sx={{ wordBreak: 'break-all', display: 'block', lineHeight: 1.6, color: 'text.secondary', fontSize: '0.66rem', mb: 1, maxHeight: 96, overflow: 'auto' }}
      >
        {token}
      </Typography>
      <Button
        size="small"
        variant="outlined"
        startIcon={<Copy size={12} />}
        onClick={() => {
          void navigator.clipboard.writeText(token)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
        sx={{ fontSize: '0.72rem', textTransform: 'none' }}
      >
        {copied ? 'Copied!' : 'Copy token'}
      </Button>
    </Paper>
  )
}
