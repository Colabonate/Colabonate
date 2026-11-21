import { useState } from 'react'
import {
  DELIVERY_MAX_LENGTH,
  buildDeliveryMessage,
  sendDeliveryMessage,
  validateDeliveryDetails,
  type DeliveryDeps,
  type DeliveryMessageInput,
} from '../../lib/remote-delivery'
import { createDefaultDeliveryDeps } from '../../lib/remote-delivery-deps'

type Status = 'idle' | 'sending' | 'sent' | 'no-inbox' | 'failed'

const primaryButtonClass =
  'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full text-sm font-semibold bg-[var(--color-primary-50)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed'
const secondaryButtonClass =
  'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full text-sm font-semibold border hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed'

/**
 * ADR-417 / FU-1000: delivery details for a paid remote order. A Lightning payment carries no
 * address, so the buyer sends it themselves, end-to-end encrypted to the seller's Nostr inbox
 * (NIP-17), or copies the text and uses the listing page. Nothing is sent without a click.
 */
export function RemoteDeliveryForm({
  orderId,
  amountSats,
  payeeLud16,
  sellerPubkey,
  listingAddress,
  buyerPubkey,
  deps,
}: {
  orderId: string
  amountSats: number
  payeeLud16: string
  sellerPubkey: string
  listingAddress: string
  buyerPubkey: string
  /** Injectable for tests; defaults to the browser relay pool and the device key. */
  deps?: DeliveryDeps
}) {
  const [details, setDetails] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [relayCount, setRelayCount] = useState(0)
  const [copied, setCopied] = useState(false)

  const valid = validateDeliveryDetails(details)
  const busy = status === 'sending'

  const messageInput = (): DeliveryMessageInput => ({
    orderId,
    amountSats,
    payeeLud16,
    listingAddress,
    details,
    buyerPubkey,
  })

  const onSend = async () => {
    if (!valid || busy) return
    setStatus('sending')
    const result = await sendDeliveryMessage(deps ?? createDefaultDeliveryDeps(), {
      ...messageInput(),
      sellerPubkey,
    })
    if (result.kind === 'sent') {
      setRelayCount(result.relayCount)
      setStatus('sent')
    } else if (result.kind === 'no-inbox') {
      setStatus('no-inbox')
    } else {
      setStatus('failed')
    }
  }

  const onCopy = async () => {
    if (!valid) return
    try {
      await navigator.clipboard.writeText(buildDeliveryMessage(messageInput()))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  if (status === 'sent') {
    return (
      <div data-testid="remote-delivery-form" className="flex flex-col gap-2">
        <h4>Delivery details sent</h4>
        <p className="text-sm" style={{ color: 'var(--theme-text)' }}>
          {`Your message was handed to ${relayCount} relay${relayCount === 1 ? '' : 's'} of the seller's Nostr inbox. It is encrypted, so only the seller can read it. The seller may take a while to open it; use the contact links as well if you need an answer soon.`}
        </p>
      </div>
    )
  }

  return (
    <div data-testid="remote-delivery-form" className="flex flex-col gap-3">
      <h4>Send your delivery details</h4>
      <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
        A Lightning payment does not carry your address. Write your name, address and a way to reach you (email, phone or Telegram). Only the seller can read the message: it is encrypted to their Nostr key.
      </p>
      <label htmlFor="remote-delivery-details" className="text-sm font-medium" style={{ color: 'var(--theme-text)' }}>
        Delivery details for the seller
      </label>
      <textarea
        id="remote-delivery-details"
        value={details}
        onChange={(e) => {
          setDetails(e.target.value.slice(0, DELIVERY_MAX_LENGTH))
          setCopied(false)
          if (status !== 'sending') setStatus('idle')
        }}
        rows={5}
        maxLength={DELIVERY_MAX_LENGTH}
        autoComplete="off"
        className="w-full rounded-lg border px-3 py-2 text-sm"
        style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text)', background: 'var(--theme-bg)' }}
      />
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onSend} disabled={!valid || busy} className={primaryButtonClass}>
          {busy ? 'Sending…' : 'Send privately to the seller'}
        </button>
        <button
          type="button"
          onClick={onCopy}
          disabled={!valid}
          className={secondaryButtonClass}
          style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
        >
          {copied ? 'Copied' : 'Copy message instead'}
        </button>
      </div>
      {status === 'no-inbox' && (
        <p className="text-sm" role="alert" style={{ color: 'var(--theme-text)' }}>
          This seller has not published a Nostr inbox, so a private message cannot be delivered. Copy the message and send it through the listing page or the seller's profile.
        </p>
      )}
      {status === 'failed' && (
        <p className="text-sm" role="alert" style={{ color: 'var(--theme-text)' }}>
          The message could not be sent. Check your connection and try again, or copy it instead.
        </p>
      )}
    </div>
  )
}
