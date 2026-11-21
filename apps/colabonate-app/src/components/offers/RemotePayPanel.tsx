import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { nip19 } from 'nostr-tools'
import { useRemotePayee } from '../../hooks/useRemoteOrders'
import { usePayment } from '../../hooks/usePayment'
import { useCashuOptional } from '../../contexts/CashuContext'
import { runRemotePayment, type PayFlowResult } from '../../lib/remote-pay-flow'
import {
  confirmRemoteOrder,
  createRemoteOrder,
  fetchRemoteOrder,
  remoteOrderErrorMessage,
  requestRemoteInvoice,
  type RemoteOrderView,
  type RemotePayee,
  type RemoteQuote,
} from '../../lib/remote-orders-api'
import { signZapRequest } from '../../lib/zap-request'
import { meltRemoteInvoice } from '../../lib/remote-ecash'
import { meltMintCandidates } from '../../lib/ticket-payment'
import { requireLogin } from '../../lib/auth-guard'
import { RemoteDeliveryForm } from './RemoteDeliveryForm'
import type { DeliveryDeps } from '../../lib/remote-delivery'
import { createDefaultDeliveryDeps } from '../../lib/remote-delivery-deps'
import {
  hasNoticeBeenSent,
  markNoticeSent,
  sendOrderNotice,
  shouldAutoSendNotice,
} from '../../lib/remote-order-notice'

type Phase = 'idle' | 'working' | 'manual' | 'paid' | 'error'
type NoticeStatus = 'idle' | 'sending' | 'sent' | 'no-inbox' | 'failed'

interface ManualState {
  order: RemoteOrderView
  bolt11: string
  reason: 'wallet-unavailable' | 'wallet-failed' | 'no-preimage'
  detail?: string
}

const POLL_INTERVAL_MS = 5_000
const EXPIRED_MESSAGE = 'This payment window has expired. Start again to get a new amount.'

const primaryButtonClass =
  'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full text-sm font-semibold bg-[var(--color-primary-50)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed'

const secondaryLinkClass = 'inline-flex items-center gap-2 text-sm font-semibold underline-offset-4 hover:underline'
const secondaryLinkStyle = { color: 'var(--color-primary-50)' }
const NEW_TAB_ATTRS = { target: '_blank', rel: 'noopener noreferrer' } as const

function basisLine(quote: RemoteQuote): string | null {
  const cur = quote.priceCurrency?.toUpperCase() ?? ''
  switch (quote.basis) {
    case 'sats':
      return 'Price as listed by the seller.'
    case 'exact-btc':
      return 'Converted exactly from the BTC price.'
    case 'rate':
      return `Estimate from the ${cur} price (${quote.priceAmount} ${cur}) at today's rate. The amount is fixed for 10 minutes after you continue.`
    case 'stablecoin-as-usd':
      return `Estimate: ${cur} is treated as USD at today's rate. The amount is fixed for 10 minutes after you continue.`
    default:
      return null
  }
}

function payeeLine(payee: RemotePayee): string {
  const name = payee.name ? ` ${payee.name}` : ''
  if (payee.role === 'seller') {
    return `You pay the seller${name} at ${payee.lud16}.`
  }
  return `The seller is not named in this listing. You pay the publishing account${name} at ${payee.lud16}.`
}

/** ADR-417 / FU-1011: only offered when the payee is the listing's named seller. */
function NoticeOptIn({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 text-sm" style={{ color: 'var(--theme-text-muted)' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid="remote-notice-optin"
        className="mt-1"
      />
      <span>
        After the payment, send the seller an encrypted order notice (order reference, amount, listing and your Nostr identity, no address). You can still send your delivery details afterwards.
      </span>
    </label>
  )
}

function npubOf(pubkey: string): string | null {
  try {
    return nip19.npubEncode(pubkey)
  } catch {
    return null
  }
}

function safeHttpsUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

export function RemotePayPanel({
  offerId,
  formatNumber,
  originUrl,
  listingAddress,
  noticeDeps,
}: {
  offerId: string
  formatNumber: (n: number) => string
  /** The listing's own page on the merchant's site, shown after payment as a contact route. */
  originUrl?: string | null
  /** NIP-33 address of the listing (30402:<author>:<d>), named in the delivery message. */
  listingAddress?: string
  /** Injectable for tests; defaults to the browser relay pool and the device key. */
  noticeDeps?: DeliveryDeps
}) {
  const navigate = useNavigate()
  const { payInvoice, isBeta } = usePayment()
  const payeeQuery = useRemotePayee(offerId)
  const cashu = useCashuOptional()

  const [phase, setPhase] = useState<Phase>('idle')
  const [manual, setManual] = useState<ManualState | null>(null)
  const [paidOrder, setPaidOrder] = useState<RemoteOrderView | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [preimage, setPreimage] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [copied, setCopied] = useState(false)
  const [ecashBusy, setEcashBusy] = useState(false)
  // Once a melt went out the invoice may be paid: never offer a second payment for it.
  const [ecashSent, setEcashSent] = useState(false)

  const manualOrderId = phase === 'manual' && manual ? manual.order.id : null

  // ADR-417 / FU-1011: order notice to a named seller, once per order, only while this browser
  // sees the payment. All four ways of reaching PAID end in setPaidOrder + phase 'paid'.
  const [noticeOptIn, setNoticeOptIn] = useState(true)
  const [noticeStatus, setNoticeStatus] = useState<NoticeStatus>('idle')
  const noticeAttempted = useRef<Set<string>>(new Set())

  const sendNotice = async (order: RemoteOrderView): Promise<void> => {
    setNoticeStatus('sending')
    let status: NoticeStatus
    try {
      const result = await sendOrderNotice(noticeDeps ?? createDefaultDeliveryDeps(), {
        orderId: order.id,
        amountSats: order.amountSats,
        payeeLud16: order.payee.lud16,
        listingAddress: listingAddress ?? order.offerId,
        buyerPubkey: localStorage.getItem('pubkey') ?? '',
        sellerPubkey: order.payee.pubkey,
      })
      status = result.kind === 'sent' ? 'sent' : result.kind === 'no-inbox' ? 'no-inbox' : 'failed'
    } catch {
      status = 'failed'
    }
    if (status === 'sent') markNoticeSent(order.id)
    setNoticeStatus(status)
  }

  useEffect(() => {
    if (phase !== 'paid' || !paidOrder) return
    if (noticeAttempted.current.has(paidOrder.id)) return
    const alreadySent = hasNoticeBeenSent(paidOrder.id)
    noticeAttempted.current.add(paidOrder.id)
    if (alreadySent) {
      setNoticeStatus('sent')
      return
    }
    if (!shouldAutoSendNotice({ payeeRole: paidOrder.payee.role, optIn: noticeOptIn, alreadySent })) return
    void sendNotice(paidOrder)
    // sendNotice only closes over props that are stable for the order; the guard above makes this run once per order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paidOrder])

  // Poll the order while the invoice is shown and the wallet did not pay.
  useEffect(() => {
    if (!manualOrderId) return
    let cancelled = false
    const timer = setInterval(async () => {
      try {
        const { order } = await fetchRemoteOrder(manualOrderId)
        if (cancelled) return
        if (order.status === 'PAID') {
          setPaidOrder(order)
          setPhase('paid')
        } else if (order.status === 'EXPIRED' || order.status === 'FAILED') {
          setMessage(EXPIRED_MESSAGE)
          setPhase('error')
        }
      } catch {
        // Transient failure: keep polling.
      }
    }, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [manualOrderId])

  const meltAmountSats = manual ? manual.order.amountSats : 0
  const meltCandidates = useMemo(
    () =>
      cashu && cashu.enabled && cashu.status === 'ready' && meltAmountSats > 0
        ? meltMintCandidates(cashu.state.buckets, meltAmountSats)
        : [],
    [cashu, meltAmountSats],
  )

  const payee = payeeQuery.data?.payee
  const quote = payeeQuery.data?.quote

  if (payeeQuery.isLoading) {
    return (
      <div
        className="flex flex-col gap-4 rounded-xl border p-5 md:p-6"
        style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-surface)' }}
      >
        <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
          Checking how this seller can be paid…
        </p>
      </div>
    )
  }

  if (payeeQuery.isError || !payeeQuery.data?.orderable || !payee || !quote) {
    return null
  }

  const onPay = async () => {
    if (!localStorage.getItem('pubkey')) {
      requireLogin(navigate, window.location.pathname)
      return
    }
    setMessage(null)
    setPhase('working')
    let result: PayFlowResult
    try {
      result = await runRemotePayment(
        {
          createOrder: createRemoteOrder,
          signZap: signZapRequest,
          requestInvoice: requestRemoteInvoice,
          payInvoice,
          confirm: confirmRemoteOrder,
          errorMessage: remoteOrderErrorMessage,
        },
        { offerId },
      )
    } catch (err) {
      // The flow is documented never to throw; if it does, do not leave the button stuck.
      result = { kind: 'error', stage: 'order', message: remoteOrderErrorMessage(err) }
    }
    if (result.kind === 'paid') {
      setPaidOrder(result.order)
      setPhase('paid')
    } else if (result.kind === 'manual') {
      setManual({
        order: result.order,
        bolt11: result.bolt11,
        reason: result.reason,
        ...(result.detail !== undefined ? { detail: result.detail } : {}),
      })
      setPhase('manual')
    } else {
      setMessage(result.message)
      setPhase('error')
    }
  }

  const onConfirm = async () => {
    if (!manual) return
    setConfirming(true)
    setMessage(null)
    try {
      const { order } = await confirmRemoteOrder(manual.order.id, preimage.trim())
      setPreimage('')
      if (order.status === 'PAID') {
        setPaidOrder(order)
        setPhase('paid')
      }
    } catch (err) {
      setMessage(remoteOrderErrorMessage(err))
    } finally {
      setConfirming(false)
    }
  }

  const onEcash = async () => {
    if (!manual || !cashu || ecashBusy || ecashSent) return
    setEcashBusy(true)
    setMessage(null)
    const result = await meltRemoteInvoice(cashu, {
      bolt11: manual.bolt11,
      candidates: meltCandidates,
      errorMessage: remoteOrderErrorMessage,
    })
    if (!result.ok) {
      setMessage(result.message)
      setEcashBusy(false)
      return
    }
    setEcashSent(true)
    if (result.preimage) {
      try {
        const { order } = await confirmRemoteOrder(manual.order.id, result.preimage)
        if (order.status === 'PAID') {
          setPaidOrder(order)
          setPhase('paid')
        }
      } catch {
        // The payment went out; the polling below confirms it through the provider.
        setMessage('Paid with eCash. Waiting for the confirmation.')
      }
    } else {
      setMessage('Paid with eCash. Waiting for the confirmation.')
    }
    setEcashBusy(false)
  }

  const onCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const cardStyle = { borderColor: 'var(--theme-border)', background: 'var(--theme-surface)' }
  const cardClass = 'flex flex-col gap-4 rounded-xl border p-5 md:p-6'

  if (phase === 'paid' && paidOrder) {
    const npub = npubOf(paidOrder.payee.pubkey)
    const listingUrl = safeHttpsUrl(originUrl)
    let links: ReactNode = null
    if (npub || listingUrl) {
      links = (
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {listingUrl && (
            <a href={listingUrl} {...NEW_TAB_ATTRS} className={secondaryLinkClass} style={secondaryLinkStyle}>
              Open the listing page
            </a>
          )}
          {npub && (
            <>
          <a href={`nostr:${npub}`} {...NEW_TAB_ATTRS} className={secondaryLinkClass} style={secondaryLinkStyle}>
            Message the seller on Nostr
          </a>
          <a href={`https://njump.me/${npub}`} {...NEW_TAB_ATTRS} className={secondaryLinkClass} style={secondaryLinkStyle}>
            Open the seller's profile
          </a>
            </>
          )}
        </div>
      )
    }
    return (
      <div data-testid="remote-pay-panel" className={cardClass} style={cardStyle}>
        <h3>Payment sent</h3>
        <p className="text-sm" style={{ color: 'var(--theme-text)' }}>
          {`You paid ${formatNumber(paidOrder.amountSats)} sats to ${paidOrder.payee.lud16}. Order reference: ${paidOrder.id.slice(0, 8)}.`}
        </p>
        <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
          Contact the seller to arrange delivery. Colabonate does not hold or protect this payment.
        </p>
        {paidOrder.payee.role === 'seller' && (
          <div className="flex flex-col gap-2" data-testid="remote-notice-status">
            {noticeStatus === 'sending' && (
              <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
                Sending the order notice to the seller…
              </p>
            )}
            {noticeStatus === 'sent' && (
              <p className="text-sm" style={{ color: 'var(--theme-text)' }}>
                The seller was sent an encrypted order notice. It may take a while until they read it.
              </p>
            )}
            {noticeStatus === 'no-inbox' && (
              <p className="text-sm" role="alert" style={{ color: 'var(--theme-text)' }}>
                This seller has not published a Nostr inbox, so no order notice could be delivered. Use the contact links below.
              </p>
            )}
            {noticeStatus === 'failed' && (
              <p className="text-sm" role="alert" style={{ color: 'var(--theme-text)' }}>
                The order notice could not be sent.
              </p>
            )}
            {(noticeStatus === 'idle' || noticeStatus === 'failed') && (
              <div>
                <button type="button" onClick={() => void sendNotice(paidOrder)} className={primaryButtonClass}>
                  {noticeStatus === 'failed' ? 'Send order notice again' : 'Send order notice to the seller'}
                </button>
              </div>
            )}
          </div>
        )}
        <RemoteDeliveryForm
          orderId={paidOrder.id}
          amountSats={paidOrder.amountSats}
          payeeLud16={paidOrder.payee.lud16}
          sellerPubkey={paidOrder.payee.pubkey}
          listingAddress={listingAddress ?? paidOrder.offerId}
          buyerPubkey={localStorage.getItem('pubkey') ?? ''}
        />
        {links}
      </div>
    )
  }

  if (phase === 'manual' && manual) {
    return (
      <div data-testid="remote-pay-panel" className={cardClass} style={cardStyle}>
        <h3>Pay the seller with Lightning</h3>
        <p className="text-sm" style={{ color: 'var(--theme-text)' }}>
          Pay this invoice with any Lightning wallet.
        </p>
        {manual.reason === 'wallet-failed' && manual.detail && (
          <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
            {manual.detail}
          </p>
        )}
        <div className="flex flex-col items-center gap-2" data-testid="remote-pay-qr">
          <div className="rounded-xl overflow-hidden" style={{ width: 220, height: 220 }}>
            <QRCodeSVG
              value={`lightning:${manual.bolt11.toUpperCase()}`}
              size={196}
              level="M"
              style={{ width: '100%', height: '100%', display: 'block' }}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <code
            className="block break-all rounded-lg border p-3 text-sm font-mono"
            style={{ borderColor: 'var(--theme-border-subtle)', color: 'var(--theme-text)', background: 'var(--theme-bg-subtle)' }}
          >
            {manual.bolt11}
          </code>
          <div>
            <button type="button" onClick={() => onCopy(manual.bolt11)} className={primaryButtonClass}>
              {copied ? 'Copied' : 'Copy invoice'}
            </button>
          </div>
        </div>
        {meltCandidates.length > 0 && !ecashSent && !isBeta && (
          <div>
            <button type="button" onClick={onEcash} disabled={ecashBusy} className={primaryButtonClass}>
              {ecashBusy ? 'Paying…' : 'Pay with eCash balance'}
            </button>
          </div>
        )}
        <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
          Waiting for payment…
        </p>
        {manual.order.payee.role === 'seller' && <NoticeOptIn checked={noticeOptIn} onChange={setNoticeOptIn} />}
        <div className="flex flex-col gap-2">
          <label htmlFor="remote-pay-preimage" className="text-sm font-medium" style={{ color: 'var(--theme-text)' }}>
            Paste your payment preimage (optional)
          </label>
          <div className="flex flex-wrap gap-3">
            <input
              id="remote-pay-preimage"
              type="text"
              value={preimage}
              onChange={(e) => setPreimage(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="flex-1 min-w-0 rounded-lg border px-3 py-2 text-sm font-mono"
              style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text)', background: 'var(--theme-bg)' }}
            />
            <button
              type="button"
              onClick={onConfirm}
              disabled={confirming || preimage.trim() === ''}
              className={primaryButtonClass}
            >
              Confirm
            </button>
          </div>
        </div>
        {message && (
          <p className="text-sm" role="alert" style={{ color: 'var(--theme-text)' }}>
            {message}
          </p>
        )}
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div data-testid="remote-pay-panel" className={cardClass} style={cardStyle}>
        <h3>Pay the seller with Lightning</h3>
        <p className="text-sm" role="alert" style={{ color: 'var(--theme-text)' }}>
          {message}
        </p>
        <div>
          <button
            type="button"
            onClick={() => {
              setMessage(null)
              setManual(null)
              setPhase('idle')
            }}
            className={primaryButtonClass}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  const amountLabel = `${formatNumber(quote.amountSats)} sats`
  const basis = basisLine(quote)
  const isWorking = phase === 'working'

  return (
    <div data-testid="remote-pay-panel" className={cardClass} style={cardStyle}>
      <h3>Pay the seller with Lightning</h3>
      <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
        {payeeLine(payee)}
      </p>

      <div className="flex flex-col gap-2">
        <span className="text-2xl font-bold" style={{ color: 'var(--theme-text)' }}>
          {amountLabel}
        </span>
        {basis && (
          <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
            {basis}
          </p>
        )}
      </div>

      <ul className="text-sm list-disc pl-5 flex flex-col gap-2" style={{ color: 'var(--theme-text-muted)' }}>
        <li>The seller is an independent third party, not Colabonate.</li>
        <li>Colabonate does not hold this payment and offers no buyer protection or dispute process for it.</li>
        <li>Delivery is arranged with the seller after you pay.</li>
        <li>A Lightning payment cannot be reversed.</li>
        {payee.zap && <li>Your payment is published on Nostr as a zap that references this listing.</li>}
      </ul>

      {payee.role === 'seller' && <NoticeOptIn checked={noticeOptIn} onChange={setNoticeOptIn} />}

      <div className="flex flex-col gap-2">
        <div>
          <button
            type="button"
            onClick={onPay}
            disabled={isBeta || isWorking}
            className={primaryButtonClass}
          >
            {isWorking ? 'Paying…' : `Pay ${amountLabel}`}
          </button>
        </div>
        {isBeta && (
          <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
            Remote purchases need a real wallet and are not available in demo mode.
          </p>
        )}
      </div>
    </div>
  )
}
