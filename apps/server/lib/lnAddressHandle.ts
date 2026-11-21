// ADR-240 D1/D2 — pure helpers for the self-serve `<handle>@<domain>` Lightning
// Address. No I/O here so the rules are unit-testable; the router + resolver in
// routes/lnurlp.ts and services/lnAddressResolver.ts own the network work.

/** Lowercase local-part rules: 3–30 chars, letters/digits plus `. _ -` inside. */
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])$/

/** Handles that would shadow infrastructure or impersonate the platform. */
export const RESERVED_HANDLES = new Set([
  'admin', 'administrator', 'support', 'help', 'api', 'www', 'root', 'info',
  'contact', 'wallet', 'pay', 'payments', 'nostr', 'mcp', 'health', 'status',
  'lnurlp', 'well-known', 'colabonate', 'security', 'abuse', 'postmaster',
  'noreply', 'no-reply', 'mail', 'system',
])

export interface LnurlpLimits {
  /** msat — LNURL minSendable. */
  minSendable: number
  /** msat — LNURL maxSendable. */
  maxSendable: number
}

/**
 * Accepts a bare handle, `@handle`, or a full `handle@domain` and returns the
 * lowercase local part. Never throws; empty input yields ''.
 */
export function normalizeHandle(raw: string | null | undefined): string {
  if (!raw) return ''
  let value = raw.trim().toLowerCase()
  if (value.startsWith('@')) value = value.slice(1)
  const at = value.indexOf('@')
  if (at !== -1) value = value.slice(0, at)
  return value
}

/** Public base URL used to build the LNURL callback (trailing slash trimmed). */
export function readLnurlpBaseUrl(): string {
  return (process.env.LNURLP_BASE_URL || process.env.BASE_URL || 'http://localhost:4001').replace(/\/+$/, '')
}

/** Domain served in `<handle>@<domain>`; defaults to the base URL's host. */
export function readLnurlpDomain(): string {
  if (process.env.LNURLP_DOMAIN) return process.env.LNURLP_DOMAIN
  try {
    return new URL(readLnurlpBaseUrl()).host
  } catch {
    return 'colabonate.app'
  }
}

export type HandleValidation = { ok: true; handle: string } | { ok: false; reason: string }

export function validateHandle(raw: string | null | undefined): HandleValidation {
  const handle = normalizeHandle(raw)
  if (!handle) return { ok: false, reason: 'A handle is required' }
  if (handle.length < 3 || handle.length > 30) {
    return { ok: false, reason: 'The handle must be 3–30 characters long' }
  }
  if (!HANDLE_RE.test(handle)) {
    return {
      ok: false,
      reason: 'Use lowercase letters, digits and . _ - (not at the start or end)',
    }
  }
  if (RESERVED_HANDLES.has(handle)) {
    return { ok: false, reason: 'This handle is reserved' }
  }
  return { ok: true, handle }
}

/** LUD-06/LUD-16 payRequest document served at `/.well-known/lnurlp/<handle>`. */
export interface PayRequestDocument {
  tag: 'payRequest'
  callback: string
  minSendable: number
  maxSendable: number
  metadata: string
  commentAllowed: number
  allowsNostr: false
}

export function buildPayRequest(
  handle: string,
  domain: string,
  baseUrl: string,
  limits: LnurlpLimits,
): PayRequestDocument {
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  const metadata = JSON.stringify([
    ['text/plain', `Pay ${handle} on Colabonate`],
    ['text/identifier', `${handle}@${domain}`],
  ])
  return {
    tag: 'payRequest',
    callback: `${normalizedBase}/.well-known/lnurlp/${handle}/callback`,
    minSendable: limits.minSendable,
    maxSendable: limits.maxSendable,
    metadata,
    commentAllowed: 0,
    allowsNostr: false,
  }
}

export type AmountValidation = { ok: true; sats: number } | { ok: false; reason: string }

/**
 * LNURL callbacks receive `amount` in **millisatoshis**. Our rails (LUD-16 and
 * NWC make_invoice) take whole sats, so sub-sat remainders are floored — a
 * request below 1 sat is rejected rather than rounded up (never mint an invoice
 * larger than the payer asked for).
 */
export function parseCallbackAmount(
  raw: unknown,
  limits: LnurlpLimits,
): AmountValidation {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: false, reason: 'amount is required (millisatoshis)' }
  }
  const msat = Number(raw)
  if (!Number.isFinite(msat) || !Number.isInteger(msat)) {
    return { ok: false, reason: 'amount must be an integer number of millisatoshis' }
  }
  if (msat < limits.minSendable || msat > limits.maxSendable) {
    return {
      ok: false,
      reason: `amount must be between ${limits.minSendable} and ${limits.maxSendable} millisatoshis`,
    }
  }
  const sats = Math.floor(msat / 1000)
  if (sats < 1) return { ok: false, reason: 'amount must be at least 1 satoshi' }
  return { ok: true, sats }
}
