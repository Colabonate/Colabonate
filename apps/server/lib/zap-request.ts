/**
 * ADR-417 D3: server-side validation of a NIP-57 zap request (Kind 9734) that the
 * buyer's signer produced for a remote offer purchase. The zap request is the
 * only thing the LNURL callback sees, so it must bind exactly this payee, this
 * amount and this listing before the server hands it to an LNURL endpoint.
 */
import { createHash } from 'crypto'
import { verifyEvent } from 'nostr-tools'

export interface ZapExpectation {
  buyerPubkey: string
  payeePubkey: string
  amountMsats: number
  listingAddress: string
}

export type ZapValidation = { ok: true; json: string; id: string } | { ok: false; reason: string }

const ZAP_REQUEST_KIND = 9734
const ALLOWED_TAG_NAMES = new Set(['p', 'amount', 'relays', 'lnurl', 'a', 'client'])
const MAX_CONTENT_LENGTH = 280
const MAX_CLOCK_SKEW_SEC = 600
const MAX_RELAYS = 10
const MAX_RELAY_URL_LENGTH = 200

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArrayTag(tag: unknown): tag is string[] {
  return Array.isArray(tag) && tag.length >= 1 && tag.every((v) => typeof v === 'string')
}

function isRelayUrl(value: string): boolean {
  if (value.length > MAX_RELAY_URL_LENGTH) return false
  try {
    const url = new URL(value)
    return url.protocol === 'wss:' || url.protocol === 'ws:'
  } catch {
    return false
  }
}

/** Returns the tags whose name is `name`. */
function tagsNamed(tags: string[][], name: string): string[][] {
  return tags.filter((t) => t[0] === name)
}

/**
 * Validates a zap request. Never throws; every failure returns a short fixed
 * reason string. The event itself is not logged by this module.
 */
export function validateZapRequest(event: unknown, expect: ZapExpectation, nowSec: number = Math.floor(Date.now() / 1000)): ZapValidation {
  const fail = (reason: string): ZapValidation => ({ ok: false, reason })

  if (!isObject(event)) return fail('zap request is not an object')
  if (typeof event.id !== 'string' || typeof event.pubkey !== 'string' || typeof event.sig !== 'string' || typeof event.content !== 'string') {
    return fail('zap request is malformed')
  }
  if (event.kind !== ZAP_REQUEST_KIND) return fail('zap request has wrong kind')
  if (!Number.isInteger(event.created_at)) return fail('zap request created_at is not an integer')
  const createdAt = event.created_at as number
  if (Math.abs(createdAt - nowSec) > MAX_CLOCK_SKEW_SEC) return fail('zap request timestamp out of range')
  if (!Array.isArray(event.tags) || !event.tags.every(isStringArrayTag)) return fail('zap request tags are malformed')
  const tags = event.tags as string[][]

  if (tags.some((t) => !ALLOWED_TAG_NAMES.has(t[0]))) return fail('zap request has a disallowed tag')
  if (event.content.length > MAX_CONTENT_LENGTH) return fail('zap request content too long')
  if (event.pubkey !== expect.buyerPubkey) return fail('zap request author is not the buyer')

  const pTags = tagsNamed(tags, 'p')
  if (pTags.length !== 1 || pTags[0].length !== 2 || pTags[0][1] !== expect.payeePubkey) {
    return fail('zap request payee mismatch')
  }

  const amountTags = tagsNamed(tags, 'amount')
  if (amountTags.length !== 1 || amountTags[0].length !== 2 || amountTags[0][1] !== String(expect.amountMsats)) {
    return fail('zap request amount mismatch')
  }

  const aTags = tagsNamed(tags, 'a')
  if (aTags.length !== 1 || aTags[0].length !== 2 || aTags[0][1] !== expect.listingAddress) {
    return fail('zap request listing mismatch')
  }

  const relayTags = tagsNamed(tags, 'relays')
  if (relayTags.length !== 1) return fail('zap request relays malformed')
  const relays = relayTags[0].slice(1)
  if (relays.length < 1 || relays.length > MAX_RELAYS || !relays.every(isRelayUrl)) {
    return fail('zap request relays malformed')
  }

  // Verify a fresh plain copy: nostr-tools caches its verdict on the object under
  // a symbol key, and that cache would survive an object spread from a caller.
  const plainEvent = {
    id: event.id,
    pubkey: event.pubkey,
    sig: event.sig,
    kind: ZAP_REQUEST_KIND,
    created_at: createdAt,
    tags,
    content: event.content,
  }
  let signatureOk = false
  try {
    signatureOk = verifyEvent(plainEvent)
  } catch {
    signatureOk = false
  }
  if (!signatureOk) return fail('zap request signature invalid')

  // Only the NIP-01 event fields, in the event's own key order: unsigned extra fields must not
  // ride along into the JSON that is hashed for the invoice and sent to the LNURL provider.
  const signedFields = new Set(['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig'])
  const json = JSON.stringify(
    Object.fromEntries(Object.entries(event).filter(([key]) => signedFields.has(key))),
  )
  return { ok: true, json, id: event.id }
}

/** NIP-57 / LUD-06 description_hash: sha256 of the UTF-8 zap request JSON, hex. */
export function zapDescriptionHash(json: string): string {
  return createHash('sha256').update(json, 'utf8').digest('hex')
}
