// ESCROW-COPY (ADR-397): payment wording here assumes Direct-Pay. On escrow activation follow docs/plans/ESCROW-COPY-REACTIVATION.md.
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  Zap, Shield, Package, Briefcase, MapPin, Check, AlertCircle, Loader2,
  ShoppingCart, Trash2, Minus, Plus, ArrowRight, Clock, Store, Eye, EyeOff, Wallet, Frame, Bot,
} from 'lucide-react'
import { PageContainer, FormStepper } from '@ds/ui'
import { getOfferTypeLabel } from '@ds/utils'
import { PageHeader } from '../../components/PageHeader'
import { useTranslation } from '../../contexts/LocaleContext'
import { FiatHint } from '../../components/currency/FiatHint'
import { useCart } from '../../context/CartContext'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { usePayment } from '../../hooks/usePayment'
import { useWallet } from '../../contexts/WalletContext'
import { canDispatchHoldInvoice } from '../../lib/payment-dispatch'
import { checkAffordability, isInsufficientFundsError, shortfallMessage, type AffordabilityCheck } from '../../lib/payment-affordability'
import { confirmDirectPayment, shouldSelfConfirmDirectPayment } from '../../lib/direct-pay'
import { apiCall, ApiError } from '../../lib/api'
import { requireLogin } from '../../lib/auth-guard'
import { useCashu } from '../../contexts/CashuContext'
import { getMintTrust } from '../../lib/cashu'
import { HOSTED_CANVAS_FEE_SATS } from '../../lib/agentConfig'
import { TICKET_ERROR_CODES } from '../../types/server-codes'
import type { DeliveryAddress, Ticket } from '../../types/api'

interface SellerInfo {
  pubkey: string
  name: string
  lnAddress?: string
  logoUrl?: string
  reputationScore?: number
  reviewCount?: number
  deliveryTimeDays?: number
  deliveryCostSats?: number
  deliveryNotes?: string
}

interface OrderDetails {
  items: ReturnType<typeof useCart>['items']
  sellers: Map<string, SellerInfo>
}

interface ItemOrderResult {
  offerId: string
  title: string
  success: boolean
  error?: string
  // Present only on success — lets step3 offer "Pay with Wallet" immediately
  // instead of sending the buyer to the ticket page for the first payment.
  ticketId?: string
  invoice?: string
  paymentHash?: string
  amountSats?: number
  useEscrow?: boolean
  // ADR-253: which non-escrow direct-pay rail this ticket resolved to. 'LN'
  // renders the existing invoice/pay-with-wallet flow unchanged; 'CASHU' has
  // no invoice at all — see the Cashu-pay card in step3.
  directPayRail?: string
  cashuMintUrl?: string
  cashuSellerPubkey?: string
  // ADR-372 D3: the SEPARATE hosted-canvas fee invoice (doop-hosted AGENT_SETUP
  // only). Present when the ticket carries a fee; the buyer pays this second
  // leg (DEMO: one-click confirm; LN: pay the platform's own invoice).
  feeRail?: string
  feeInvoice?: string | null
  feePaymentHash?: string | null
  feeSats?: number | null
}

type TicketPayState = 'idle' | 'paying' | 'paid' | 'error'

const EMPTY_ADDRESS: DeliveryAddress = {
  fullName: '', street: '', zipCode: '', city: '',
  country: 'Germany', phone: '',
}

const CHECKOUT_STEPS = [
  { id: 0, label: 'Cart', description: 'Review your items' },
  { id: 1, label: 'Delivery', description: 'Shipping address' },
  { id: 2, label: 'Payment', description: 'Review & pay' },
  { id: 3, label: 'Confirm', description: 'Order placed' },
]

function CartItemRow({ item }: { item: ReturnType<typeof useCart>['items'][number] }) {
  const { updateQuantity, removeItem } = useCart()
  const navigate = useNavigate()
  const { formatNumber } = useTranslation()
  const isService = item.offerType === 'SERVICE'

  return (
    <div
      className="flex gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.99]"
      style={{
        background: 'var(--theme-surface)',
        border: '1px solid var(--theme-border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)',
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,0.10)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)' }}
      onClick={() => navigate(`/buy/product/${item.offerId}`)}
    >
      <div className="self-stretch shrink-0 overflow-hidden rounded-lg flex items-center justify-center" style={{ width: 72, background: 'var(--theme-bg-subtle)' }}>
        {item.image
          ? <img src={item.image} alt={item.title} className="object-cover w-full h-full" />
          : <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--theme-text-muted)', lineHeight: 1 }}>{item.title.charAt(0).toUpperCase()}</span>}
      </div>
      <div className="flex flex-col flex-1 min-w-0 py-0.5">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm uppercase leading-none" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', backgroundColor: isService ? 'rgba(159,122,234,0.20)' : 'rgba(72,187,120,0.20)', color: isService ? 'var(--color-secondary-50)' : 'var(--color-status-success)', border: isService ? '1px solid rgba(159,122,234,0.35)' : '1px solid rgba(72,187,120,0.35)' }}>
            {isService ? <Briefcase size={9} /> : item.offerType === 'AGENT_SETUP' ? <Bot size={9} /> : <Package size={9} />}
            {getOfferTypeLabel(item.offerType)}
          </span>
          {/* ADR-370 D6 (Phase 2): cart-step canvas disclosure (G1). */}
          {item.canvasProvider && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm leading-none uppercase" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', background: 'rgba(159,122,234,0.12)', color: '#9F7AEA', border: '1px solid rgba(159,122,234,0.30)' }} title={item.canvasProvider === 'doop-hosted' ? 'Colabonate-hosted collaboration canvas included' : "Collaboration canvas on the seller's own instance included"}>
              <Frame size={9} />
              {item.canvasProvider === 'doop-hosted'
                ? (item.canvasAgentInCanvas ? 'Canvas + Agent work' : 'Canvas')
                : 'Canvas'}
            </span>
          )}
          {/* ADR-372 D2: hosted-canvas fee disclosure (hosted only). */}
          {item.canvasProvider === 'doop-hosted' && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm leading-none uppercase" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', background: 'rgba(99,179,237,0.10)', color: 'var(--color-primary-50)', border: '1px solid rgba(99,179,237,0.25)' }} title={`Colabonate service fee ${HOSTED_CANVAS_FEE_SATS} sats, paid at purchase — not refundable`}>
              <Zap size={9} />
              Fee {HOSTED_CANVAS_FEE_SATS} sats
            </span>
          )}
          {item.category && <span className="truncate" style={{ fontSize: 10, fontWeight: 600, color: 'var(--theme-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.category}</span>}
        </div>
        <div className="mb-1 truncate" style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4, color: 'var(--theme-text)' }}>{item.title}</div>
        {item.variantLabel && (
          <div className="mb-1.5 flex items-center gap-1">
            <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold" style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-secondary)', border: '1px solid var(--theme-border)' }}>
              {item.variantLabel}
            </span>
          </div>
        )}
        {item.company?.name && <div className="flex items-center gap-1 mb-2"><Store size={10} style={{ color: 'var(--theme-text-muted)' }} /><span style={{ fontSize: 11, color: 'var(--theme-text-muted)' }}>{item.company.name}</span></div>}
        {!isService && (item.deliveryTimeDays || item.deliveryCostSats) && (
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {item.deliveryTimeDays && <span className="flex items-center gap-0.5" style={{ fontSize: 10, color: 'var(--theme-text-muted)' }}><Clock size={10} />{item.deliveryTimeDays} {item.deliveryTimeDays === 1 ? 'Day' : 'Days'}</span>}
            {item.deliveryCostSats && <span className="flex items-center gap-0.5" style={{ fontSize: 10, color: 'var(--theme-text-muted)' }}><Zap size={10} style={{ color: 'var(--color-primary-50)' }} />{item.deliveryCostSats} sats shipping</span>}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 mt-auto">
          <div className="flex items-center gap-1">
            <button onClick={(e) => { e.stopPropagation(); updateQuantity(item.offerId, item.quantity - 1) }} className="flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150 hover:opacity-80" style={{ width: 28, height: 28, background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)' }}><Minus size={12} /></button>
            <span style={{ width: 32, textAlign: 'center', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--theme-text)' }}>{item.quantity}</span>
            <button onClick={(e) => { e.stopPropagation(); updateQuantity(item.offerId, item.quantity + 1) }} className="flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150 hover:opacity-80" style={{ width: 28, height: 28, background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)' }}><Plus size={12} /></button>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1" style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(99,179,237,0.10)', fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-primary-50)', whiteSpace: 'nowrap' }}><Zap size={13} />{formatNumber(item.priceSats * item.quantity)}<FiatHint sats={item.priceSats * item.quantity} className="text-[0.9em] ml-[3px]" /></div>
            <button onClick={(e) => { e.stopPropagation(); removeItem(item.offerId) }} className="flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150 hover:opacity-80" style={{ width: 28, height: 28, background: 'var(--color-status-error-bg)', border: '1px solid var(--color-status-error)', color: 'var(--color-status-error)' }}><Trash2 size={13} /></button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function BuyCartFlow() {
  const navigate = useNavigate()
  const { formatNumber } = useTranslation()
  const { items, itemCount, totalSats, deliveryAddress, setDeliveryAddress, clearCart, removeItem, removedRemoteItems, dismissRemovedRemoteItems } = useCart()
  const [currentStep, setCurrentStep] = useState(0)
  const [status, setStatus] = useState<'idle' | 'processing' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [walletRequired, setWalletRequired] = useState(false)
  const [orderPlaced, setOrderPlaced] = useState(false)
  const [orderDetails, setOrderDetails] = useState<OrderDetails | null>(null)
  const [failedOrderItems, setFailedOrderItems] = useState<ItemOrderResult[]>([])
  const [fetchingSellers, setFetchingSellers] = useState(false)
  const pageRef = usePageAnimation([{ selector: '.page-animate', from: { duration: 0.5, y: 20 } }])

  // Pay-at-checkout (step3 "Order successful!") — placedTickets carries the
  // invoice/paymentHash the server already returned from POST /api/tickets,
  // so "Pay with Wallet" works immediately without a trip to the ticket page.
  const { payInvoice, pollUntilPaid, isBeta, wallet } = usePayment()
  const { refreshBalance } = useWallet()
  const cashuWallet = useCashu()
  const [placedTickets, setPlacedTickets] = useState<ItemOrderResult[]>([])
  const [payState, setPayState] = useState<Record<string, TicketPayState>>({})
  const [payErrors, setPayErrors] = useState<Record<string, string>>({})
  const [payingAll, setPayingAll] = useState(false)
  // ADR-253: Cashu-rail tickets have no invoice to poll — sending the token
  // is a one-shot client-side action, completion is a seller self-report
  // (PATCH /api/tickets/:id from the seller's own ticket view), not visible
  // to this component.
  const [cashuState, setCashuState] = useState<Record<string, 'idle' | 'sending' | 'sent' | 'error'>>({})
  const [cashuTokens, setCashuTokens] = useState<Record<string, string>>({})
  const [cashuErrors, setCashuErrors] = useState<Record<string, string>>({})

  const [deliveryForm, setDeliveryForm] = useState<DeliveryAddress>(deliveryAddress ?? EMPTY_ADDRESS)
  const [touched, setTouched] = useState(false)
  const [errors, setErrors] = useState<Record<string, boolean>>({})

  // ADR-183 Phase 2: per-offer tier selection (offerId → tier).
  // Defaults to Tier 0 (public) for every item. Only items whose offer
  // allows tier > 0 in `allowedVisibility` get a selector rendered.
  const [selectedTiers, setSelectedTiers] = useState<Record<string, number>>({})

  const allServiceOnly = items.length > 0 && items.every(i => i.offerType === 'SERVICE')

  // ADR-183 Phase 2: a missing/null `allowedVisibility` on the CartItem is
  // treated as [0] (Tier 0 / public only), matching the schema default and the
  // server's fallback at tickets.ts:74-76. This handles persisted carts that
  // predate Phase 2.
  const effectiveAllowedTiers = (item: typeof items[number]): number[] =>
    Array.isArray(item.allowedVisibility) && item.allowedVisibility.length > 0
      ? item.allowedVisibility.filter((t): t is number => typeof t === 'number')
      : [0]

  // The tier selector panel only renders when at least one item actually
  // permits tier > 0. Tier-0-only carts are unaffected (no UI change).
  const hasTierOptions = items.some(i => effectiveAllowedTiers(i).some(t => t > 0))

  // Per-item tier; locked to 0 if the offer does not advertise a higher tier.
  const tierFor = (offerId: string, item: typeof items[number]): number => {
    const allowed = effectiveAllowedTiers(item)
    const selected = selectedTiers[offerId] ?? 0
    return allowed.includes(selected) ? selected : 0
  }

  const validateDelivery = (): boolean => {
    const required: (keyof DeliveryAddress)[] = ['fullName', 'street', 'zipCode', 'city', 'country']
    const newErrors: Record<string, boolean> = {}
    for (const field of required) newErrors[field] = !deliveryForm[field]?.trim()
    setErrors(newErrors)
    setTouched(true)
    return !Object.values(newErrors).some(Boolean)
  }

  const updateField = (field: keyof DeliveryAddress) => (value: string) => {
    setDeliveryForm(prev => ({ ...prev, [field]: value }))
    if (touched) setErrors(prev => ({ ...prev, [field]: !value.trim() }))
  }

  const handlePlaceOrder = async () => {
    const pubkey = localStorage.getItem('pubkey')
    if (!pubkey) { requireLogin(navigate, '/buy/cart'); return }

    if (status === 'processing') return

    setStatus('processing')
    setErrorMsg(null)
    setWalletRequired(false)
    setFailedOrderItems([])

    // Idempotent: returns 200 with alreadyExists if wallet exists; creates one otherwise.
    // Needed for sessions established before the Nostr-login wallet bootstrap was added.
    try {
      await apiCall('/api/wallet/create', { method: 'POST', body: JSON.stringify({ pubkey }) })
    } catch (err) {
      console.warn('[BuyCartFlow] Wallet bootstrap failed (non-fatal):', err)
    }

    const results: ItemOrderResult[] = []
    // ADR-394 FU-840: one random key groups this checkout's tickets server-side
    // (GET /api/tickets?checkoutId=…), so a partial failure is visible as an
    // order with fewer tickets than cart lines.
    const checkoutId = crypto.randomUUID()

    for (const item of items) {
      try {
        let freshAllowedVisibility: number[] | null | undefined
        let isRemoteOffer = false
        try {
          const offerRes = await apiCall(`/api/offers/${item.offerId}`)
          const offerData = await offerRes.json()
          if (offerData.offer) {
            // ADR-415: remote offers cannot be ordered through Colabonate.
            if (offerData.offer.source === 'REMOTE') isRemoteOffer = true
            // ADR-183 Phase 2: prefer the freshest allowedVisibility from the
            // offer fetch. Falls back to the cart-stored value (which can be
            // missing for carts that predate Phase 2) and finally to null/[0].
            if (Array.isArray(offerData.offer.allowedVisibility)) {
              freshAllowedVisibility = offerData.offer.allowedVisibility
            }
          }
        } catch (err) { console.warn(`Failed to fetch offer ${item.offerId}:`, err) }

        if (isRemoteOffer) {
          results.push({
            offerId: item.offerId,
            title: item.title,
            success: false,
            error: 'This item comes from another Nostr marketplace and cannot be ordered through Colabonate.',
          })
          continue
        }

        const effectiveItem = freshAllowedVisibility !== undefined
          ? { ...item, allowedVisibility: freshAllowedVisibility }
          : item
        const ticketPayload: Record<string, unknown> = {
          offerId: item.offerId,
          // ADR-394: the server computes amountSats = offer.priceSats × quantity
          // + the offer's shipping (FU-842) — delivery terms are never sent.
          quantity: item.quantity,
          checkoutId,
          visibility: tierFor(item.offerId, effectiveItem),
          variantLabel: item.variantLabel || undefined,
        }
        if ((item.offerType === 'ITEM' || item.offerType === 'PRODUCT') && deliveryAddress) {
          ticketPayload.deliveryAddress = deliveryAddress
        }
        const ticketRes = await apiCall('/api/tickets', { method: 'POST', body: JSON.stringify(ticketPayload) })
        const ticketData = await ticketRes.json()
        results.push({
          offerId: item.offerId,
          title: item.title,
          success: true,
          ticketId: ticketData.ticket?.id,
          invoice: ticketData.invoice,
          paymentHash: ticketData.paymentHash,
          amountSats: ticketData.amountSats,
          // ADR-394: trust the server's actual rail decision, not the offer's
          // (possibly stale) useEscrow flag — on a production host the server
          // forces Direct-Pay even for an offer row that still carries
          // useEscrow=true, so the escrow UI must follow the created ticket.
          useEscrow: Boolean(ticketData.ticket?.escrowEnabled),
          directPayRail: ticketData.ticket?.directPayRail ?? undefined,
          cashuMintUrl: ticketData.ticket?.cashuMintUrl ?? undefined,
          cashuSellerPubkey: ticketData.ticket?.cashuSellerPubkey ?? undefined,
          // ADR-372 D3: hosted-canvas fee leg (doop-hosted only).
          feeRail: ticketData.feeRail ?? undefined,
          feeInvoice: ticketData.feeInvoice ?? null,
          feePaymentHash: ticketData.feePaymentHash ?? null,
          feeSats: ticketData.feeSats ?? null,
        })
      } catch (err) {
        const isWalletRequired = err instanceof ApiError && err.data?.code === TICKET_ERROR_CODES.WALLET_REQUIRED
        const isSellerUnconfigured = err instanceof ApiError && err.data?.code === TICKET_ERROR_CODES.SELLER_PAYMENT_NOT_CONFIGURED
        // FU-655: launch-phase cap — branch on the code (ADR-179), show the cap.
        const isAboveLaunchCap = err instanceof ApiError && err.data?.code === TICKET_ERROR_CODES.TX_ABOVE_LAUNCH_CAP
        const errorMsg = isWalletRequired
          ? 'Your account has no wallet yet. Please create one in Wallet, or connect via Lightning, then try again.'
          : isSellerUnconfigured
            ? (err.data?.message as string | undefined) ?? 'This seller has not set up a payment method yet.'
            : isAboveLaunchCap
              ? `This item is above the launch-phase limit of ${Number(err.data?.capSats ?? 0).toLocaleString()} sats per transaction and cannot be ordered yet.`
              : (err instanceof Error ? err.message : 'Order failed')
        console.error(`Ticket creation failed for ${item.offerId}:`, errorMsg)
        results.push({ offerId: item.offerId, title: item.title, success: false, error: errorMsg })
        if (isWalletRequired) setWalletRequired(true)
      }
    }

    console.log('Order results:', { results, items: items.length })
    const failed = results.filter(r => !r.success)
    const succeeded = results.filter(r => r.success)
    console.log('Failed:', failed.length, 'Succeeded:', succeeded.length)
    setPlacedTickets(succeeded)

    if (failed.length > 0 && succeeded.length === 0) {
      setStatus('error')
      setErrorMsg(failed[0].error || `${failed.length} ${failed.length === 1 ? 'item' : 'items'} failed.`)
      return
    }

    if (succeeded.length > 0 && failed.length > 0) {
      const succeededItems = items.filter(item => succeeded.some(s => s.offerId === item.offerId))

      setFailedOrderItems(failed)
      succeededItems.forEach(item => removeItem(item.offerId))

      const sellersMap = new Map<string, SellerInfo>()
      for (const item of succeededItems) {
        sellersMap.set(item.sellerPubkey, {
          pubkey: item.sellerPubkey,
          name: item.company?.name ?? `Seller ${item.sellerPubkey.slice(0, 8)}...`,
          lnAddress: undefined,
          logoUrl: item.company?.logoUrl,
          reputationScore: undefined,
          reviewCount: undefined,
        })
      }

      setOrderDetails({ items: succeededItems, sellers: sellersMap })
      setOrderPlaced(true)
      setCurrentStep(3)

      setTimeout(async () => {
        setFetchingSellers(true)
        const uniquePubkeys = [...new Set(succeededItems.map(i => i.sellerPubkey))]
        try {
          const sellerResults = await Promise.all(
            uniquePubkeys.map(async (pubkey) => {
              try {
                const res = await apiCall(`/api/identity/${pubkey}`)
                const data = await res.json()
                return { pubkey, lnAddress: data.nip05, reputationScore: data.reputationScore, reviewCount: data.reviewCount }
              } catch {
                return { pubkey, lnAddress: undefined, reputationScore: undefined, reviewCount: undefined }
              }
            })
          )
          const updatedMap = new Map<string, SellerInfo>()
          for (const item of succeededItems) {
            if (!updatedMap.has(item.sellerPubkey)) {
              const identity = sellerResults.find(s => s.pubkey === item.sellerPubkey)
              updatedMap.set(item.sellerPubkey, {
                pubkey: item.sellerPubkey,
                name: item.company?.name ?? `Seller ${item.sellerPubkey.slice(0, 8)}...`,
                lnAddress: identity?.lnAddress ?? updatedMap.get(item.sellerPubkey)?.lnAddress,
                logoUrl: item.company?.logoUrl,
                reputationScore: identity?.reputationScore,
                reviewCount: identity?.reviewCount,
              })
            }
          }
          setOrderDetails({ items: succeededItems, sellers: updatedMap })
        } catch (err) {
          console.warn('Failed to fetch seller identities:', err)
        }
        setFetchingSellers(false)
      }, 0)
      return
    }

    if (succeeded.length === items.length && items.length > 0) {
      const sellersMap = new Map<string, SellerInfo>()
      for (const item of items) {
        sellersMap.set(item.sellerPubkey, {
          pubkey: item.sellerPubkey,
          name: item.company?.name ?? `Seller ${item.sellerPubkey.slice(0, 8)}...`,
          lnAddress: undefined,
          logoUrl: item.company?.logoUrl,
          reputationScore: undefined,
          reviewCount: undefined,
        })
      }

      setOrderDetails({ items, sellers: sellersMap })
      setOrderPlaced(true)
      clearCart()
      setCurrentStep(3)

      setTimeout(async () => {
        setFetchingSellers(true)
        const uniquePubkeys = [...new Set(items.map(i => i.sellerPubkey))]
        try {
          const sellerResults = await Promise.all(
            uniquePubkeys.map(async (pubkey) => {
              try {
                const res = await apiCall(`/api/identity/${pubkey}`)
                const data = await res.json()
                return { pubkey, lnAddress: data.nip05, reputationScore: data.reputationScore, reviewCount: data.reviewCount }
              } catch {
                return { pubkey, lnAddress: undefined, reputationScore: undefined, reviewCount: undefined }
              }
            })
          )
          const updatedMap = new Map<string, SellerInfo>()
          for (const item of items) {
            if (!updatedMap.has(item.sellerPubkey)) {
              const identity = sellerResults.find(s => s.pubkey === item.sellerPubkey)
              updatedMap.set(item.sellerPubkey, {
                pubkey: item.sellerPubkey,
                name: item.company?.name ?? `Seller ${item.sellerPubkey.slice(0, 8)}...`,
                lnAddress: identity?.lnAddress ?? updatedMap.get(item.sellerPubkey)?.lnAddress,
                logoUrl: item.company?.logoUrl,
                reputationScore: identity?.reputationScore,
                reviewCount: identity?.reviewCount,
              })
            }
          }
          setOrderDetails({ items, sellers: updatedMap })
        } catch (err) {
          console.warn('Failed to fetch seller identities:', err)
        }
        setFetchingSellers(false)
      }, 0)
    }
  }

  // A ticket can be paid inline (button) vs. only out-of-band (QR on the
  // ticket page): beta demo-pay accepts any invoice; a normal (non-escrow)
  // invoice can be paid by any connected wallet; a hold-invoice (ADR-184
  // escrow) phase-1 payment can be dispatched programmatically via NWC,
  // WebLN, or the custodial platform wallet (ADR-209 / FU-209-A). Alby OAuth
  // still requires the manual QR/copy flow.
  function isAutoPayable(ticket: ItemOrderResult): boolean {
    // ADR-253: Cashu-rail tickets have no invoice at all — never eligible for
    // the LN "Pay with Wallet" / "Pay All" flow, regardless of beta mode.
    if (ticket.directPayRail === 'CASHU') return false
    if (isBeta) return true
    if (!ticket.useEscrow) return true
    return canDispatchHoldInvoice(wallet)
  }

  /**
   * ADR-372 D7.3: the seller leg of a hosted-canvas purchase can already be
   * settled while the platform fee is still open — the fee leg failed and the
   * buyer retries. Paying the settled seller invoice again only makes the
   * wallet answer "invoice already paid"; the retry must go to the open leg.
   */
  async function isSellerLegSettled(ticketId: string): Promise<boolean> {
    try {
      const res = await apiCall(`/api/tickets/${ticketId}`)
      if (!res.ok) return false
      const data = (await res.json()) as { ticket?: Ticket }
      return Boolean(data.ticket?.preimage || data.ticket?.platformFee?.sellerLegConfirmedAt)
    } catch {
      return false
    }
  }

  /**
   * ADR-413 D3: the platform can only prove that the wallet cannot cover a
   * payment when it knows the balance itself (server-synced rails). Then the
   * buyer learns the exact shortfall BEFORE the price is paid — otherwise the
   * price leaves the wallet and only the second (fee) leg fails, which is the
   * dead end this ADR closes.
   */
  async function affordabilityFor(ticket: ItemOrderResult): Promise<{ order: AffordabilityCheck; fee: AffordabilityCheck }> {
    // Refresh first so the balance is current (Alby OAuth / custodial rails
    // are synced by GET /api/wallet; a stale value must not block a payment).
    let active = wallet
    try {
      active = (await refreshBalance()) ?? wallet
    } catch {
      /* keep the cached balance */
    }
    return {
      order: checkAffordability(active, (ticket.amountSats ?? 0) + (ticket.feeSats ?? 0)),
      fee: checkAffordability(active, ticket.feeSats ?? 0),
    }
  }

  /**
   * ADR-413 D3: the advisory variant of the affordability check — it uses the
   * balance the client already knows (no extra request), so it can be stale.
   * A proven shortfall is still enforced in handlePayTicket with a fresh read.
   */
  function walletShortfallHint(ticket: ItemOrderResult): string | null {
    const check = checkAffordability(wallet, (ticket.amountSats ?? 0) + (ticket.feeSats ?? 0))
    if (!check.known || check.sufficient) return null
    return `Your wallet holds ${formatNumber(check.balanceSats)} sats — this order needs ${formatNumber(check.requiredSats)} sats. Top up in Settings → Wallet.`
  }

  async function handlePayTicket(ticket: ItemOrderResult) {
    // ADR-255 D2: a DEMO-rail ticket has no real invoice by design (only a
    // synthetic paymentHash) — usePayment()'s isBeta branch pays by hash
    // alone and never inspects `invoice`, so only paymentHash is required here.
    if (!ticket.ticketId || !ticket.paymentHash) return
    if (ticket.directPayRail !== 'DEMO' && !ticket.invoice) return
    const id = ticket.ticketId
    setPayState(s => ({ ...s, [id]: 'paying' }))
    setPayErrors(e => { const next = { ...e }; delete next[id]; return next })
    try {
      // 0. Can the wallet cover price + platform fee at all? A proven
      //    shortfall stops here — the buyer tops up first instead of paying
      //    the price and getting stuck on the fee leg.
      const { order: orderAffordability, fee: feeAffordability } = await affordabilityFor(ticket)
      if (orderAffordability.known && !orderAffordability.sufficient && orderAffordability.fresh) {
        setPayErrors(e => ({ ...e, [id]: shortfallMessage(orderAffordability, 'This order') }))
        setPayState(s => ({ ...s, [id]: 'error' }))
        return
      }
      // 1. Seller leg (price) — unchanged Direct-Pay flow. Skipped when the
      //    seller invoice is already settled (retry after a failed fee leg).
      const sellerLegSettled = !ticket.useEscrow && (await isSellerLegSettled(id))
      if (!sellerLegSettled) {
        const result = await payInvoice({ invoice: ticket.invoice ?? '', paymentHash: ticket.paymentHash, escrow: ticket.useEscrow })
        if (!result.ok) {
          const reason = result.error || 'Payment failed'
          setPayErrors(e => ({
            ...e,
            [id]: isInsufficientFundsError(reason) ? shortfallMessage(orderAffordability, 'The price') : reason,
          }))
          setPayState(s => ({ ...s, [id]: 'error' }))
          return
        }

        // ADR-253: a non-escrow direct-pay invoice belongs to the SELLER — the
        // platform never held it, so polling can never observe it. Self-confirm
        // with the preimage the wallet returned (NWC / WebLN / Alby OAuth).
        const paidPreimage = result.preimage
        if (paidPreimage && shouldSelfConfirmDirectPayment({ isBeta, isEscrow: Boolean(ticket.useEscrow), preimage: paidPreimage })) {
          try {
            await confirmDirectPayment(ticket.ticketId, paidPreimage)
          } catch (err) {
            setPayErrors(e => ({
              ...e,
              [id]: err instanceof ApiError
                ? ((err.data?.message as string) ?? 'Paid, but confirmation failed — open the ticket and paste the preimage.')
                : 'Paid, but confirmation failed — open the ticket and paste the preimage.',
            }))
            setPayState(s => ({ ...s, [id]: 'error' }))
            return
          }
        } else {
          const paid = await pollUntilPaid(ticket.paymentHash)
          if (!paid) {
            // Honest, not a failure: a dispatched hold-invoice phase-1 payment settles
            // later (tracked on the ticket page), a normal invoice may just be slow.
            setPayErrors(e => ({ ...e, [id]: 'Sent — confirmation is taking longer than expected. Check the ticket for status.' }))
            setPayState(s => ({ ...s, [id]: 'error' }))
            return
          }
        }
      }
      // 2. Fee leg (doop-hosted only) — same click, so a hosted-canvas purchase
      //    resolves price + fee + ticket PAID (workspace/canvas access) in one
      //    flow instead of two separate payments (ADR-372 D3).
      if (ticket.feeSats) {
        const fee = await payCanvasFee(ticket)
        if (!fee.ok) {
          const reason = fee.error || 'Fee payment failed'
          const detail = isInsufficientFundsError(reason) ? shortfallMessage(feeAffordability, 'The service fee') : reason
          setPayErrors(e => ({
            ...e,
            [id]: sellerLegSettled ? `The price is paid — only the service fee is open. ${detail}` : detail,
          }))
          setPayState(s => ({ ...s, [id]: 'error' }))
          return
        }
      }
      setPayState(s => ({ ...s, [id]: 'paid' }))
    } catch (err) {
      setPayErrors(e => ({ ...e, [id]: err instanceof Error ? err.message : 'Payment failed' }))
      setPayState(s => ({ ...s, [id]: 'error' }))
    }
  }

  async function handlePayAll() {
    setPayingAll(true)
    for (const ticket of placedTickets) {
      if (!ticket.ticketId || payState[ticket.ticketId] === 'paid' || !isAutoPayable(ticket)) continue
      await handlePayTicket(ticket)
    }
    setPayingAll(false)
  }

  async function handleSendCashu(ticket: ItemOrderResult) {
    if (!ticket.ticketId || !ticket.cashuSellerPubkey || !ticket.cashuMintUrl || !ticket.amountSats) return
    const id = ticket.ticketId
    setCashuState(s => ({ ...s, [id]: 'sending' }))
    setCashuErrors(e => { const next = { ...e }; delete next[id]; return next })
    try {
      const token = await cashuWallet.sendP2PKForCheckout(ticket.cashuSellerPubkey, ticket.cashuMintUrl, ticket.amountSats)
      setCashuTokens(t => ({ ...t, [id]: token }))
      setCashuState(s => ({ ...s, [id]: 'sent' }))
    } catch (err) {
      setCashuErrors(e => ({ ...e, [id]: err instanceof Error ? err.message : 'Failed to create Cashu token' }))
      setCashuState(s => ({ ...s, [id]: 'error' }))
    }
  }

  // ADR-372 D3/D7.2: pay the hosted-canvas fee (the second leg of a doop-hosted
  // purchase) as part of the SAME click as the seller leg. DEMO rail confirms
  // preimage-free (the server debits the demo wallet and flips the ticket PAID);
  // LN rail pays the platform's own invoice and self-confirms with the preimage
  // the wallet returns.
  async function payCanvasFee(ticket: ItemOrderResult): Promise<{ ok: boolean; error?: string }> {
    const id = ticket.ticketId
    if (!id || !ticket.feeSats) return { ok: true }

    if (ticket.feeRail === 'DEMO') {
      const res = await apiCall(`/api/tickets/${id}/confirm-canvas-fee`, { method: 'POST', body: JSON.stringify({}) })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        return { ok: false, error: data.error || data.message || 'Fee payment failed' }
      }
      return { ok: true }
    }

    if (!ticket.feeInvoice || !ticket.feePaymentHash) {
      return { ok: false, error: 'Fee invoice missing' }
    }
    const result = await payInvoice({ invoice: ticket.feeInvoice, paymentHash: ticket.feePaymentHash })
    if (!result.ok) {
      return { ok: false, error: result.error || 'Fee payment failed' }
    }
    // Self-confirm with the preimage (WebLN/NWC expose it). Without one (MANUAL
    // rail), the fee confirmation continues on the ticket page.
    if (result.preimage) {
      const confirm = await apiCall(`/api/tickets/${id}/confirm-canvas-fee`, {
        method: 'POST',
        body: JSON.stringify({ preimage: result.preimage }),
      })
      if (!confirm.ok) {
        const data = await confirm.json().catch(() => ({}))
        return { ok: false, error: data.error || data.message || 'Fee confirmation failed' }
      }
    }
    return { ok: true }
  }

  function step0() {
    // ADR-415: notice for items the provider removed because they are remote.
    const removedRemoteNotice = removedRemoteItems.length > 0 ? (() => {
      const n = removedRemoteItems.length
      return (
        <div role="status" className="flex flex-col gap-3 p-4 rounded-xl w-full" style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--theme-text)', lineHeight: 1.5 }}>
            {`${n} item${n === 1 ? '' : 's'} ${n === 1 ? 'was' : 'were'} removed from your basket because ${n === 1 ? 'it comes' : 'they come'} from other Nostr marketplaces and cannot be ordered through Colabonate.`}
          </span>
          <ul className="flex flex-col gap-2">
            {removedRemoteItems.map(item => (
              <li key={item.offerId}>
                <Link to={`/buy/product/${item.offerId}`} style={{ color: 'var(--color-primary-50)', fontSize: 12, fontWeight: 600 }}>
                  {item.title} (view at the merchant)
                </Link>
              </li>
            ))}
          </ul>
          <div>
            <button type="button" onClick={dismissRemovedRemoteItems} className="px-3 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer transition-all duration-150 hover:opacity-80" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}>
              Dismiss
            </button>
          </div>
        </div>
      )
    })() : null

    if (items.length === 0) {
      return (
        <>
        {removedRemoteNotice}
        <div className="flex flex-col items-center py-16 gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'var(--theme-bg-subtle)' }}>
            <ShoppingCart size={28} style={{ color: 'var(--theme-text-muted)' }} />
          </div>
          <span className="text-[15px] font-semibold" style={{ color: 'var(--theme-text)' }}>Your cart is empty</span>
          <p className="text-[13px] text-center max-w-xs" style={{ color: 'var(--theme-text-muted)' }}>Browse offers and add items to your cart.</p>
          <Link to="/buy" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 hover:opacity-90 cursor-pointer no-underline" style={{ background: 'var(--color-primary-50)', color: 'white' }}>To Marketplace</Link>
        </div>
        </>
      )
    }

    const uniqueSellers = [...new Map(items.map(i => [i.sellerPubkey, { pubkey: i.sellerPubkey, name: i.company?.name ?? `Seller ${i.sellerPubkey.slice(0, 8)}...`, count: 0 }])).values()]
    uniqueSellers.forEach(seller => {
      seller.count = items.filter(i => i.sellerPubkey === seller.pubkey).length
    })
    const hasMultipleSellers = uniqueSellers.length > 1

    const itemsBySeller = new Map<string, typeof items>()
    for (const item of items) {
      if (!itemsBySeller.has(item.sellerPubkey)) {
        itemsBySeller.set(item.sellerPubkey, [])
      }
      itemsBySeller.get(item.sellerPubkey)!.push(item)
    }

    return (
      <div className="flex flex-col gap-4">
        {removedRemoteNotice}
        <div className="flex items-center mb-1">
          <button onClick={clearCart} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold uppercase tracking-widest cursor-pointer transition-all duration-150 hover:opacity-80" style={{ background: 'var(--color-status-error-bg)', color: 'var(--color-status-error)', border: '1px solid var(--color-status-error)' }}>
            <Trash2 size={12} />Remove all
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {uniqueSellers.map(seller => (
            <div key={seller.pubkey} className="flex flex-col gap-2">
              {hasMultipleSellers && (
                <div className="flex items-center gap-2 px-1">
                  <Store size={12} style={{ color: 'var(--theme-text-muted)' }} />
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--theme-text-muted)' }}>{seller.name}</span>
                  <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)', opacity: 0.7 }}>({seller.count} {seller.count === 1 ? 'item' : 'items'})</span>
                </div>
              )}
              {itemsBySeller.get(seller.pubkey)!.map(item => <CartItemRow key={item.offerId} item={item} />)}
            </div>
          ))}
        </div>
      </div>
    )
  }

  function step1() {
    return (
      <div className="flex flex-col gap-4">
        <div className="p-5 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)' }}>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--theme-text-muted)' }}>First and last name</label>
              <input className="w-full px-3 py-2 rounded-lg text-[13px]" style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }} placeholder="John Doe" value={deliveryForm.fullName} onChange={e => updateField('fullName')(e.target.value)} />
              {touched && errors.fullName && <span className="text-[11px] text-[var(--color-status-error)] mt-1 block">Required</span>}
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--theme-text-muted)' }}>Street and house number</label>
              <input className="w-full px-3 py-2 rounded-lg text-[13px]" style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }} placeholder="Main Street 42" value={deliveryForm.street} onChange={e => updateField('street')(e.target.value)} />
              {touched && errors.street && <span className="text-[11px] text-[var(--color-status-error)] mt-1 block">Required</span>}
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--theme-text-muted)' }}>ZIP Code</label>
                <input className="w-full px-3 py-2 rounded-lg text-[13px]" style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }} placeholder="10115" value={deliveryForm.zipCode} onChange={e => updateField('zipCode')(e.target.value)} />
                {touched && errors.zipCode && <span className="text-[11px] text-[var(--color-status-error)] mt-1 block">Required</span>}
              </div>
              <div className="flex-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--theme-text-muted)' }}>City</label>
                <input className="w-full px-3 py-2 rounded-lg text-[13px]" style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }} placeholder="Berlin" value={deliveryForm.city} onChange={e => updateField('city')(e.target.value)} />
                {touched && errors.city && <span className="text-[11px] text-[var(--color-status-error)] mt-1 block">Required</span>}
              </div>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--theme-text-muted)' }}>Country</label>
              <input className="w-full px-3 py-2 rounded-lg text-[13px]" style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }} placeholder="Germany" value={deliveryForm.country} onChange={e => updateField('country')(e.target.value)} />
              {touched && errors.country && <span className="text-[11px] text-[var(--color-status-error)] mt-1 block">Required</span>}
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--theme-text-muted)' }}>Phone (optional)</label>
              <input className="w-full px-3 py-2 rounded-lg text-[13px]" style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }} placeholder="+49 123 456789" value={deliveryForm.phone ?? ''} onChange={e => setDeliveryForm(prev => ({ ...prev, phone: e.target.value }))} />
            </div>
          </div>
          {touched && Object.values(errors).some(Boolean) && (
            <div className="flex items-start gap-2 mt-3 p-3 rounded-lg" style={{ background: 'var(--color-status-error-bg)', border: '1px solid var(--color-status-error)' }}>
              <AlertCircle size={14} style={{ color: 'var(--color-status-error)', marginTop: 2, flexShrink: 0 }} />
              <span className="text-[12px]" style={{ color: 'var(--color-status-error)', lineHeight: 1.5 }}>Please fill in all required fields.</span>
            </div>
          )}
        </div>
        {allServiceOnly && (
          <button onClick={() => { setDeliveryAddress(null); setCurrentStep(2) }} className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-[13px] font-medium transition-all duration-200 hover:opacity-90 cursor-pointer" style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}>
            <Check size={14} />Skip delivery address (services only)
          </button>
        )}
      </div>
    )
  }

  function step2() {
    const displayItems = orderPlaced ? [] : items

    const uniqueSellers = [...new Map(displayItems.map(i => [i.sellerPubkey, { pubkey: i.sellerPubkey, name: i.company?.name ?? `Seller ${i.sellerPubkey.slice(0, 8)}...`, count: 0 }])).values()]
    uniqueSellers.forEach(seller => {
      seller.count = displayItems.filter(i => i.sellerPubkey === seller.pubkey).length
    })
    const hasMultipleSellers = uniqueSellers.length > 1

    const itemsBySeller = new Map<string, typeof displayItems>()
    for (const item of displayItems) {
      if (!itemsBySeller.has(item.sellerPubkey)) {
        itemsBySeller.set(item.sellerPubkey, [])
      }
      itemsBySeller.get(item.sellerPubkey)!.push(item)
    }

    return (
      <div className="flex flex-col gap-4">
        {displayItems.length > 0 && (
        <div className="flex flex-col gap-3 mb-4">
          {uniqueSellers.map(seller => (
            <div key={seller.pubkey} className="flex flex-col gap-2">
              {hasMultipleSellers && (
                <div className="flex items-center gap-2 px-1">
                  <Store size={12} style={{ color: 'var(--theme-text-muted)' }} />
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--theme-text-muted)' }}>{seller.name}</span>
                </div>
              )}
              {itemsBySeller.get(seller.pubkey)!.map(item => {
                const isService = item.offerType === 'SERVICE'
                return (
                  <div key={item.offerId} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)' }}>
                    <div className="self-stretch shrink-0 overflow-hidden rounded-lg flex items-center justify-center" style={{ width: 52, height: 52, background: 'var(--theme-bg-subtle)' }}>
                      {item.image ? <img src={item.image} alt={item.title} className="object-cover w-full h-full" /> : isService ? <Briefcase size={18} style={{ color: 'var(--color-secondary-50)' }} /> : item.offerType === 'AGENT_SETUP' ? <Bot size={18} style={{ color: 'var(--theme-text-muted)' }} /> : <Package size={18} style={{ color: 'var(--color-status-success)' }} />}
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm uppercase leading-none" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', backgroundColor: isService ? 'rgba(159,122,234,0.20)' : item.offerType === 'AGENT_SETUP' ? 'rgba(159,122,234,0.12)' : 'rgba(72,187,120,0.20)', color: isService ? 'var(--color-secondary-50)' : item.offerType === 'AGENT_SETUP' ? '#9F7AEA' : 'var(--color-status-success)', border: isService ? '1px solid rgba(159,122,234,0.35)' : item.offerType === 'AGENT_SETUP' ? '1px solid rgba(159,122,234,0.30)' : '1px solid rgba(72,187,120,0.35)' }}>{item.offerType === 'AGENT_SETUP' ? 'Agent setup' : isService ? 'Service' : 'Product'}</span>
                        {/* ADR-370 D6 (Phase 2): review-step canvas disclosure (G1). */}
                        {item.canvasProvider && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm uppercase leading-none" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', background: 'rgba(159,122,234,0.10)', color: '#9F7AEA', border: '1px solid rgba(159,122,234,0.25)' }} title={item.canvasProvider === 'doop-hosted' ? 'Colabonate-hosted collaboration canvas included' : "Collaboration canvas on the seller's own instance included"}>
                            <Frame size={9} />
                            {item.canvasProvider === 'doop-hosted' && item.canvasAgentInCanvas ? 'Canvas + Agent work' : 'Canvas'}
                          </span>
                        )}
                        {/* ADR-372 D2: hosted-canvas fee disclosure (hosted only). */}
                        {item.canvasProvider === 'doop-hosted' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm uppercase leading-none" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', background: 'rgba(99,179,237,0.10)', color: 'var(--color-primary-50)', border: '1px solid rgba(99,179,237,0.25)' }} title={`Colabonate service fee ${HOSTED_CANVAS_FEE_SATS} sats, paid at purchase — not refundable`}>
                            <Zap size={9} />
                            Fee {HOSTED_CANVAS_FEE_SATS} sats
                          </span>
                        )}
                        <span className="truncate" style={{ fontSize: 12, fontWeight: 500, color: 'var(--theme-text)' }}>{item.title}</span>
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--theme-text-muted)' }}>Qty: {item.quantity}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0" style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(99,179,237,0.10)', fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-primary-50)', whiteSpace: 'nowrap' }}><Zap size={13} />{formatNumber(item.priceSats * item.quantity)}<FiatHint sats={item.priceSats * item.quantity} className="text-[0.9em] ml-[3px]" /></div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        )}

        {deliveryAddress && (
          <div className="p-4 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)' }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5"><MapPin size={14} style={{ color: 'var(--color-primary-50)' }} /><span style={{ fontSize: 12, fontWeight: 600, color: 'var(--theme-text)' }}>Delivery Address</span></div>
              <button onClick={() => setCurrentStep(1)} className="text-[11px] font-medium cursor-pointer transition-all duration-150 hover:opacity-80" style={{ background: 'none', border: 'none', color: 'var(--color-primary-50)', padding: '2px 6px' }}>Change</button>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--theme-text-muted)' }}>{deliveryAddress.fullName}<br />{deliveryAddress.street}<br />{deliveryAddress.zipCode} {deliveryAddress.city}, {deliveryAddress.country}{deliveryAddress.phone && <><br />Tel: {deliveryAddress.phone}</>}</div>
          </div>
        )}

        {hasTierOptions && (
          <div className="p-4 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)' }}>
            <div className="flex items-center gap-1.5 mb-1">
              <Eye size={14} style={{ color: 'var(--color-primary-50)' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--theme-text)' }}>Transaction Visibility</span>
            </div>
            <p style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--theme-text-muted)', marginBottom: 10 }}>
              Some sellers offer a semi-private option. The trade is still settled on the Lightning Network; only the on-Nostr announcement changes.
            </p>
            <div className="flex flex-col gap-3">
              {displayItems.flatMap(item => {
                const allowed = effectiveAllowedTiers(item)
                if (!allowed.some(t => t > 0)) return []
                const selected = tierFor(item.offerId, item)
                const allowTier1 = allowed.includes(1)
                return [
                  <div key={`tier-${item.offerId}`} className="flex flex-col gap-2">
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--theme-text-muted)' }}>{item.title}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedTiers(prev => ({ ...prev, [item.offerId]: 0 }))}
                        className="flex-1 flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-all duration-150 text-left"
                        style={{
                          background: selected === 0 ? 'rgba(99,179,237,0.10)' : 'var(--theme-bg-subtle)',
                          border: selected === 0 ? '1px solid var(--color-primary-50)' : '1px solid var(--theme-border)',
                        }}
                      >
                        <Eye size={14} style={{ color: selected === 0 ? 'var(--color-primary-50)' : 'var(--theme-text-muted)', flexShrink: 0 }} />
                        <div className="flex flex-col min-w-0">
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--theme-text)' }}>Public</span>
                          <span style={{ fontSize: 10, color: 'var(--theme-text-muted)', lineHeight: 1.4 }}>Settlement event published with offer details.</span>
                        </div>
                      </button>
                      {allowTier1 && (
                        <button
                          type="button"
                          onClick={() => setSelectedTiers(prev => ({ ...prev, [item.offerId]: 1 }))}
                          className="flex-1 flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-all duration-150 text-left"
                          style={{
                            background: selected === 1 ? 'rgba(159,122,234,0.10)' : 'var(--theme-bg-subtle)',
                            border: selected === 1 ? '1px solid var(--color-secondary-50)' : '1px solid var(--theme-border)',
                          }}
                        >
                          <EyeOff size={14} style={{ color: selected === 1 ? 'var(--color-secondary-50)' : 'var(--theme-text-muted)', flexShrink: 0 }} />
                          <div className="flex flex-col min-w-0">
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--theme-text)' }}>Semi-private</span>
                            <span style={{ fontSize: 10, color: 'var(--theme-text-muted)', lineHeight: 1.4 }}>Only a commitment hash is published; details stay private.</span>
                          </div>
                        </button>
                      )}
                    </div>
                  </div>,
                ]
              })}
            </div>
          </div>
        )}

        <div className="p-4 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--theme-text)', display: 'block', marginBottom: 10 }}>Payment Method</span>
          <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'rgba(99,179,237,0.06)', border: '1px solid rgba(99,179,237,0.20)' }}>
            <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 40, height: 40, background: 'rgba(247,147,26,0.12)' }}><Zap size={20} style={{ color: '#F7931A' }} /></div>
            <div className="flex flex-col flex-1 min-w-0">
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--theme-text)' }}>Bitcoin Lightning</span>
              <span style={{ fontSize: 11, color: 'var(--theme-text-muted)' }}>Payment via Lightning Network</span>
            </div>
            <Check size={16} style={{ color: 'var(--color-status-success)', flexShrink: 0 }} />
          </div>
        </div>

        {status === 'error' && walletRequired && (
          <div className="flex items-start gap-2 p-3 rounded-xl" style={{ background: 'var(--color-status-warning-bg)', border: '1px solid var(--color-status-warning)' }}>
            <Wallet size={14} style={{ color: 'var(--color-status-warning)', marginTop: 2, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: 'var(--theme-text)', lineHeight: 1.5 }}>
              {errorMsg}{' '}
              <Link to="/wallet" style={{ color: 'var(--color-primary-50)', fontWeight: 600, textDecoration: 'underline' }}>
                Go to Wallet →
              </Link>
            </span>
          </div>
        )}

        {status === 'error' && errorMsg && !walletRequired && (
          <div className="flex items-start gap-2 p-3 rounded-xl" style={{ background: 'var(--color-status-error-bg)', border: '1px solid var(--color-status-error)' }}>
            <AlertCircle size={14} style={{ color: 'var(--color-status-error)', marginTop: 2, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: 'var(--color-status-error)', lineHeight: 1.5 }}>{errorMsg}</span>
          </div>
        )}

        <div className="p-4 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)' }}>
          <span style={{ fontSize: 12, color: 'var(--theme-text-muted)' }}>Total ({items.length} {items.length === 1 ? 'item' : 'items'})</span>
          <div className="flex items-center justify-between mb-3 mt-1">
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--theme-text)' }}>Total</span>
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-1"><Zap size={18} style={{ color: 'var(--color-primary-50)' }} /><span style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-primary-50)' }}>{formatNumber(totalSats)}</span><span style={{ fontSize: 12, color: 'var(--theme-text-muted)' }}>sats</span></div>
              <FiatHint sats={totalSats} className="text-[13px]" style={{ color: 'var(--theme-text-muted)' }} />
            </div>
          </div>
          <button onClick={handlePlaceOrder} disabled={status === 'processing'} className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-[14px] font-semibold transition-all duration-200 cursor-pointer" style={{ background: status === 'processing' ? 'var(--theme-bg-subtle)' : 'var(--color-primary-50)', color: status === 'processing' ? 'var(--theme-text-muted)' : 'white', border: 'none', opacity: status === 'processing' ? 0.7 : 1 }}>
            {status === 'processing' ? <><Loader2 size={16} className="animate-spin" />Processing...</> : 'Place Order'}
          </button>
        </div>
      </div>
    )
  }

  function step3() {
    if (fetchingSellers) {
      return (
        <div className="flex flex-col items-center py-16 gap-4">
          <Loader2 size={32} className="animate-spin" style={{ color: 'var(--color-primary-50)' }} />
          <span className="text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>Preparing order details...</span>
        </div>
      )
    }

    if (!orderDetails) {
      return (
        <div className="flex flex-col items-center py-16 gap-4">
          <span className="text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>Loading...</span>
        </div>
      )
    }

    const { items, sellers } = orderDetails
    const uniqueSellers = [...sellers.values()]

    return (
      <div className="flex flex-col items-center text-center" style={{ maxWidth: 480, margin: '0 auto', paddingTop: 32, paddingBottom: 32 }}>
        <div className="flex items-center justify-center rounded-full mb-6" style={{ width: 80, height: 80, background: 'rgba(72,187,120,0.12)' }}>
          <Check size={44} style={{ color: 'var(--color-status-success)' }} />
        </div>

        {(() => {
          const allPaid = placedTickets.length > 0 && placedTickets.every(t =>
            t.ticketId && payState[t.ticketId] === 'paid')
          return (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--theme-text)', marginBottom: 8, marginTop: 0 }}>
                {allPaid ? 'Order placed & paid!' : 'Order successful!'}
              </h2>
              <p style={{ fontSize: 13, color: 'var(--theme-text-muted)', marginBottom: 24, maxWidth: 380, lineHeight: 1.6 }}>
                {allPaid
                  ? 'Your order has been placed and paid. You will receive a notification once the seller responds.'
                  : 'Your order has been placed. You will receive a notification once the seller responds.'}
              </p>
            </>
          )
        })()}

        <div className="flex flex-col gap-3 w-full mb-6">
          {uniqueSellers.map(seller => (
            <div key={seller.pubkey} className="w-full p-4 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)' }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--theme-bg-subtle)' }}>
                  {seller.logoUrl
                    ? <img src={seller.logoUrl} alt={seller.name} className="w-full h-full rounded-full object-cover" />
                    : <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--theme-text-muted)' }}>{seller.name.charAt(0).toUpperCase()}</span>
                  }
                </div>
                <div className="flex flex-col flex-1 text-left min-w-0">
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--theme-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{seller.name}</span>
                  {seller.lnAddress && <span style={{ fontSize: 11, color: 'var(--theme-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{seller.lnAddress}</span>}
                </div>
                {seller.reputationScore !== undefined && (
                  <div className="flex items-center gap-1 px-2 py-1 rounded-full shrink-0" style={{ background: 'rgba(72,187,120,0.10)', fontSize: 11, fontWeight: 600, color: 'var(--color-status-success)' }}>
                    ★ {seller.reputationScore}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                {items.filter(i => i.sellerPubkey === seller.pubkey).map(item => (
                  <div key={item.offerId} className="flex flex-col gap-1.5 p-2 rounded-lg" style={{ background: 'var(--theme-bg-subtle)' }}>
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--theme-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>{item.title}</span>
                      <span style={{ fontSize: 11, color: 'var(--theme-text-muted)', flexShrink: 0 }}>x{item.quantity}</span>
                    </div>
                    {((item.deliveryTimeDays || item.deliveryCostSats || item.deliveryNotes) && item.offerType !== 'SERVICE') && (
                      <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
                        {item.deliveryTimeDays && (
                          <span className="flex items-center gap-0.5"><Clock size={10} />{item.deliveryTimeDays} {item.deliveryTimeDays === 1 ? 'Day' : 'Days'}</span>
                        )}
                        {item.deliveryCostSats && (
                          <span className="flex items-center gap-0.5"><Zap size={10} style={{ color: 'var(--color-primary-50)' }} />{item.deliveryCostSats} sats shipping</span>
                        )}
                        {item.deliveryNotes && (
                          <span style={{ fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.deliveryNotes}</span>
                        )}
                      </div>
                    )}
                    {item.offerType === 'SERVICE' && item.deliveryNotes && (
                      <div className="text-[10px]" style={{ color: 'var(--theme-text-muted)', fontStyle: 'italic' }}>{item.deliveryNotes}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {placedTickets.some(t => t.useEscrow) && (
          <div className="flex items-start gap-2 p-3 rounded-xl w-full mb-6" style={{ background: 'rgba(72,187,120,0.08)', border: '1px solid rgba(72,187,120,0.20)' }}>
            <Shield size={16} style={{ color: 'var(--color-status-success)', marginTop: 2, flexShrink: 0 }} />
            <div style={{ textAlign: 'left' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--theme-text)', display: 'block', marginBottom: 4 }}>Escrow protection active</span>
              <span style={{ fontSize: 11, lineHeight: 1.7, color: 'var(--theme-text-muted)' }}>Your payment is protected by the escrow system. The seller only receives the funds after your confirmation.</span>
            </div>
          </div>
        )}
        {failedOrderItems.length > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-xl w-full mb-4" style={{ background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.30)' }}>
            <AlertCircle size={16} style={{ color: '#D97706', marginTop: 2, flexShrink: 0 }} />
            <div style={{ textAlign: 'left' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--theme-text)', display: 'block', marginBottom: 4 }}>Couldn't be ordered</span>
              <div className="flex flex-col gap-1">
                {failedOrderItems.map(item => (
                  <div key={item.offerId} className="flex items-center gap-2" style={{ fontSize: 11, color: 'var(--theme-text-muted)' }}>
                    <span style={{ fontWeight: 500, color: 'var(--theme-text)' }}>{item.title}</span>
                    <span>— {item.error}</span>
                  </div>
                ))}
              </div>
              <span style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--theme-text-muted)', marginTop: 6, display: 'block' }}>These items are still in your cart.</span>
            </div>
          </div>
        )}
        {placedTickets.length > 0 && (() => {
          const payableCount = placedTickets.filter(t => t.ticketId && isAutoPayable(t) && payState[t.ticketId] !== 'paid').length
          return (
            <div className="flex flex-col gap-2 w-full mb-6">
              <div className="flex items-center justify-between gap-2">
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--theme-text)' }}>Pay for your order</span>
                {payableCount > 1 && (
                  <button
                    onClick={handlePayAll}
                    disabled={payingAll}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer transition-all duration-150 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: 'var(--color-primary-50)', color: 'white', fontSize: 12, fontWeight: 600, border: 'none' }}
                  >
                    {payingAll ? <Loader2 size={13} className="animate-spin" /> : <Wallet size={13} />}
                    {payingAll ? 'Paying…' : 'Pay All with Wallet'}
                  </button>
                )}
              </div>
              {placedTickets.map(ticket => {
                const id = ticket.ticketId
                const state: TicketPayState = (id && payState[id]) || 'idle'
                const isCashu = ticket.directPayRail === 'CASHU'
                const cState = (id && cashuState[id]) || 'idle'
                const cToken = id ? cashuTokens[id] : undefined
                // ADR-372: a doop-hosted purchase is price + fee, paid in ONE
                // click — the card shows the combined total.
                const totalSats = (ticket.amountSats ?? 0) + (ticket.feeSats ?? 0)

                if (isCashu) {
                  return (
                    <div
                      key={id ?? ticket.offerId}
                      className="flex flex-col gap-2 p-3 rounded-xl"
                      style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex flex-col text-left min-w-0">
                          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--theme-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ticket.title}</span>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="flex items-center gap-0.5" style={{ fontSize: 11, color: 'var(--color-primary-50)', fontWeight: 600 }}>
                              <Zap size={11} />{formatNumber(ticket.amountSats ?? 0)}
                            </span>
                            <FiatHint sats={ticket.amountSats ?? 0} className="text-[11px]" />
                            <span className="px-1.5 py-0.5 rounded-sm uppercase" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', background: 'rgba(159,122,234,0.15)', color: 'var(--color-secondary-50)' }}>
                              Cashu
                            </span>
                          </div>
                          {/* FU-39: disclose mint trust level before the buyer spends, not after. */}
                          {cState !== 'sent' && ticket.cashuMintUrl && (
                            <span style={{ fontSize: 9, color: getMintTrust(ticket.cashuMintUrl) === 'unvetted' || getMintTrust(ticket.cashuMintUrl) === 'test' ? 'var(--color-status-warning)' : 'var(--theme-text-muted)', marginTop: 2 }}>
                              {getMintTrust(ticket.cashuMintUrl) === 'vetted'
                                ? 'Seller uses a Colabonate-recommended mint (mint.minibits.cash).'
                                : getMintTrust(ticket.cashuMintUrl) === 'test'
                                  ? 'Seller uses a public TEST mint — this token has no real value.'
                                  : `Mint: ${ticket.cashuMintUrl} — unvetted third party (Colabonate does not vouch for it).`}
                            </span>
                          )}
                          {cState === 'error' && id && cashuErrors[id] && (
                            <span style={{ fontSize: 10, color: 'var(--color-status-error, #E85345)', marginTop: 2 }}>{cashuErrors[id]}</span>
                          )}
                        </div>
                        {cState === 'sent' ? (
                          <span className="flex items-center gap-1 shrink-0" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-status-success)' }}>
                            <Check size={14} />Token created
                          </span>
                        ) : (
                          <button
                            onClick={() => handleSendCashu(ticket)}
                            disabled={cState === 'sending' || !cashuWallet.walletPubkey}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer transition-all duration-150 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                            style={{ background: 'var(--theme-bg-subtle)', color: 'var(--color-secondary-50)', border: '1px solid color-mix(in srgb, var(--color-secondary-50) 40%, transparent)', fontSize: 12, fontWeight: 600 }}
                          >
                            {cState === 'sending' ? <Loader2 size={13} className="animate-spin" /> : <Wallet size={13} />}
                            {cState === 'sending' ? 'Creating…' : cState === 'error' ? 'Retry' : 'Pay with Cashu'}
                          </button>
                        )}
                      </div>
                      {cToken && (
                        <div className="flex flex-col gap-1.5 p-2.5 rounded-lg" style={{ background: 'var(--theme-bg-subtle)' }}>
                          <span style={{ fontSize: 10, color: 'var(--theme-text-muted)' }}>
                            Send this token to the seller — the order completes once they confirm receipt.
                          </span>
                          <div className="flex items-center gap-2">
                            <span
                              className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
                              style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--theme-text)' }}
                            >
                              {cToken}
                            </span>
                            <button
                              onClick={() => void navigator.clipboard.writeText(cToken)}
                              className="shrink-0 px-2 py-1 rounded-md cursor-pointer"
                              style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-primary-50)', background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                }

                return (
                  <div
                    key={id ?? ticket.offerId}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl"
                    style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
                  >
                    <div className="flex flex-col text-left min-w-0">
                      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--theme-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ticket.title}</span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="flex items-center gap-0.5" style={{ fontSize: 11, color: 'var(--color-primary-50)', fontWeight: 600 }}>
                          <Zap size={11} />{formatNumber(totalSats)}
                        </span>
                        <FiatHint sats={totalSats} className="text-[11px]" />
                        {ticket.feeSats ? (
                          <span className="px-1.5 py-0.5 rounded-sm uppercase" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', background: 'rgba(99,179,237,0.15)', color: 'var(--color-primary-50)' }}>
                            incl. fee {HOSTED_CANVAS_FEE_SATS} sats
                          </span>
                        ) : null}
                        {ticket.useEscrow && (
                          <span className="px-1.5 py-0.5 rounded-sm uppercase" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', background: 'rgba(72,187,120,0.15)', color: 'var(--color-status-success)' }}>
                            Escrow · 25%
                          </span>
                        )}
                      </div>
                      {ticket.feeSats ? (
                        <span style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--theme-text-muted)', marginTop: 2 }}>
                          Two wallet payments: {formatNumber(ticket.amountSats ?? 0)} sats to the seller plus a {formatNumber(ticket.feeSats)} sats
                          Colabonate hosted-canvas service fee (not refundable).
                        </span>
                      ) : null}
                      {walletShortfallHint(ticket) ? (
                        <span style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--color-status-warning, #FFC039)', marginTop: 2 }}>
                          {walletShortfallHint(ticket)}
                        </span>
                      ) : null}
                      {state === 'error' && id && payErrors[id] && (
                        <span style={{ fontSize: 10, color: 'var(--color-status-error, #E85345)', marginTop: 2 }}>{payErrors[id]}</span>
                      )}
                    </div>

                    {state === 'paid' ? (
                      <Link
                        to={`/tickets/${id}`}
                        className="flex items-center gap-1 shrink-0 no-underline"
                        style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-status-success)' }}
                      >
                        <Check size={14} />Paid · View ticket<ArrowRight size={12} />
                      </Link>
                    ) : id && isAutoPayable(ticket) ? (
                      <button
                        onClick={() => handlePayTicket(ticket)}
                        disabled={state === 'paying' || payingAll}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer transition-all duration-150 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                        style={{ background: 'var(--theme-bg-subtle)', color: 'var(--color-primary-50)', border: '1px solid color-mix(in srgb, var(--color-primary-50) 40%, transparent)', fontSize: 12, fontWeight: 600 }}
                      >
                        {state === 'paying' ? <Loader2 size={13} className="animate-spin" /> : <Wallet size={13} />}
                        {state === 'paying' ? 'Paying…' : state === 'error' ? 'Retry' : 'Pay now'}
                      </button>
                    ) : id ? (
                      <Link
                        to={`/tickets/${id}`}
                        className="flex items-center gap-1 shrink-0 no-underline"
                        style={{ fontSize: 11, fontWeight: 600, color: 'var(--theme-text-muted)' }}
                      >
                        Pay manually<ArrowRight size={12} />
                      </Link>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )
        })()}
        <div className="flex flex-col gap-2 w-full mb-8">
          <Link to="/buy/orders" className="flex items-center justify-center gap-2 py-3 rounded-lg text-[14px] font-semibold transition-all duration-200 hover:opacity-90 cursor-pointer no-underline" style={{ background: 'var(--color-primary-50)', color: 'white' }}>My Orders<ArrowRight size={16} /></Link>
          <Link to="/buy" className="flex items-center justify-center gap-2 py-3 rounded-lg text-[13px] font-medium transition-all duration-200 hover:opacity-90 cursor-pointer no-underline" style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}><Package size={14} />Continue shopping</Link>
        </div>
        <div className="w-full flex flex-col gap-2">
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--theme-text)', marginBottom: 4, display: 'block' }}>What happens next?</span>
          {[
            { icon: Clock, title: 'Seller confirms', desc: 'The seller will review and confirm your order.' },
            { icon: Package, title: 'Delivery / Fulfillment', desc: 'The seller provides the service or ships the product.' },
            { icon: Zap, title: 'Payment released', desc: 'After your confirmation, the payment is released to the seller.' },
          ].map((step, i) => (
            <div key={step.title} className="flex items-start gap-3 p-3 rounded-xl transition-all duration-200 hover:-translate-y-0.5" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)' }}>
              <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 30, height: 30, background: 'rgba(99,179,237,0.12)', color: 'var(--color-primary-50)', fontSize: 11, fontWeight: 700 }}>{i + 1}</div>
              <div className="flex flex-col flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5"><step.icon size={14} style={{ color: 'var(--color-primary-50)' }} /><span style={{ fontSize: 13, fontWeight: 600, color: 'var(--theme-text)' }}>{step.title}</span></div>
                <span style={{ fontSize: 11, lineHeight: 1.7, color: 'var(--theme-text-muted)' }}>{step.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <PageContainer size="wide" spacing="lg" className="page-animate" ref={pageRef}>
      <PageHeader
        icon={<ShoppingCart size={18} />}
        title="Checkout"
        subtitle={currentStep < 3 ? `${itemCount} ${itemCount === 1 ? 'item' : 'items'} in your cart` : 'Order complete'}
        onBack={currentStep === 0 ? () => navigate('/buy') : currentStep === 3 ? () => navigate('/buy') : () => setCurrentStep(c => c - 1)}
        backLabel={currentStep === 0 || currentStep === 3 ? 'Continue shopping' : 'Back'}
      />
      <FormStepper
        steps={CHECKOUT_STEPS}
        currentStep={currentStep}
        onStepChange={setCurrentStep}
        onContinue={(step) => {
          if (step === 0) return items.length > 0
          if (step === 1) {
            if (allServiceOnly) return true
            return validateDelivery()
          }
          return true
        }}
        onLastStepComplete={() => {}}
        continueLabel="Next"
        backLabel="Back"
        disabled={items.length === 0 || currentStep === 2}
        hideFooter={currentStep === 3}
      >
        {step0()}
        {step1()}
        {step2()}
        {step3()}
      </FormStepper>
    </PageContainer>
  )
}
