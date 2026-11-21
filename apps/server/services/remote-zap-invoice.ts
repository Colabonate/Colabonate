/**
 * ADR-417 D3: fetch a bolt11 invoice for a remote offer purchase from the payee's
 * LNURL-pay callback, optionally as a NIP-57 zap (the zap request rides in the
 * `nostr` query parameter and the invoice must commit to its hash). The browser
 * never contacts the LNURL endpoint; this module is the only caller.
 */
import { decodeInvoice } from '@getalby/lightning-tools'
import { readInvoiceDescriptionHash } from '../lib/bolt11-tags.js'
import { checkProviderUrlSyntax } from '../lib/provider-url-safety.js'
import { pinnedFetchJson } from '../lib/pinned-fetch.js'
import { zapDescriptionHash } from '../lib/zap-request.js'

export interface InvoiceDeps {
  /** GET, JSON body, own timeout. */
  fetchJson(url: string): Promise<unknown>
  decodeInvoice(bolt11: string): { satoshi: number; paymentHash: string; expiry?: number; timestamp?: number } | null
  readDescriptionHash(bolt11: string): string | null
}

export interface RemoteInvoice {
  bolt11: string
  paymentHash: string
  verifyUrl?: string
  expiresAt?: Date
}

const FETCH_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 64 * 1024

/** Sync safety check: https only, no userinfo, no private/loopback/literal-IP hosts. */
function isSafePublicHttpsUrl(raw: string): boolean {
  if (!checkProviderUrlSyntax(raw).ok) return false
  try {
    const url = new URL(raw)
    return url.username === '' && url.password === ''
  } catch {
    return false
  }
}

export async function fetchRemoteInvoice(
  input: {
    callback: string
    lnurl: string
    amountSats: number
    metadataHash: string
    /** Present => NIP-57 zap invoice; absent => plain LNURL-pay. */
    zapRequestJson?: string
  },
  deps: InvoiceDeps = createDefaultInvoiceDeps(),
): Promise<RemoteInvoice> {
  if (!isSafePublicHttpsUrl(input.callback)) throw new Error('LNURL callback URL is not allowed')

  const url = new URL(input.callback)
  url.searchParams.delete('amount')
  url.searchParams.delete('nostr')
  url.searchParams.delete('lnurl')
  url.searchParams.set('amount', String(input.amountSats * 1000))
  if (input.zapRequestJson !== undefined) {
    url.searchParams.set('nostr', input.zapRequestJson)
    url.searchParams.set('lnurl', input.lnurl)
  }

  let body: unknown
  try {
    body = await deps.fetchJson(url.toString())
  } catch {
    throw new Error('LNURL callback request failed')
  }
  if (typeof body !== 'object' || body === null) throw new Error('LNURL callback returned no object')
  const response = body as Record<string, unknown>
  if (response.status === 'ERROR') throw new Error('LNURL error')
  if (typeof response.pr !== 'string' || response.pr.length === 0) throw new Error('LNURL callback returned no invoice')
  const pr = response.pr

  let decoded: ReturnType<InvoiceDeps['decodeInvoice']>
  let actualHash: string | null
  try {
    decoded = deps.decodeInvoice(pr)
    actualHash = decoded ? deps.readDescriptionHash(pr) : null
  } catch {
    throw new Error('Invoice could not be decoded')
  }
  if (!decoded) throw new Error('Invoice could not be decoded')
  if (decoded.satoshi !== input.amountSats) throw new Error('Invoice amount mismatch')

  const expectedHash = input.zapRequestJson !== undefined ? zapDescriptionHash(input.zapRequestJson) : input.metadataHash
  if (typeof actualHash !== 'string' || actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error(
      input.zapRequestJson !== undefined ? 'Invoice not bound to zap request' : 'Invoice not bound to LNURL metadata',
    )
  }

  const result: RemoteInvoice = { bolt11: pr, paymentHash: decoded.paymentHash }
  if (typeof response.verify === 'string' && isSafePublicHttpsUrl(response.verify)) {
    result.verifyUrl = response.verify
  }
  if (Number.isFinite(decoded.timestamp) && Number.isFinite(decoded.expiry)) {
    result.expiresAt = new Date(((decoded.timestamp as number) + (decoded.expiry as number)) * 1000)
  }
  return result
}

export function createDefaultInvoiceDeps(): InvoiceDeps {
  return {
    // DNS-aware and pinned: the connection goes to the addresses that passed the private-range
    // check, so a rebinding answer cannot redirect it (FU-1004). No redirects, capped body.
    fetchJson(url: string): Promise<unknown> {
      return pinnedFetchJson(url, { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: MAX_RESPONSE_BYTES })
    },
    decodeInvoice(bolt11: string) {
      const decoded = decodeInvoice(bolt11)
      if (!decoded) return null
      return {
        satoshi: decoded.satoshi,
        paymentHash: decoded.paymentHash,
        timestamp: decoded.timestamp,
        expiry: decoded.expiry,
      }
    },
    readDescriptionHash: readInvoiceDescriptionHash,
  }
}
