// ADR-228 D4 — AlbyOauthProvider: a PaymentProvider backed by a user's Alby
// OAuth access token.
//
// Endpoint verification (FU-228-A, completed 2026-07-11): all URLs verified
// against the official @getalby/sdk@8.0.3 (node_modules/@getalby/sdk/dist/esm/oauth.js)
// which is the authoritative client for the same OAuth2 API surface. Live-probed
// each endpoint against api.getalby.com (401 = exists, needs auth; 404 = does not exist).
//
//   POST /oauth/token          — SDK OAuth2User.refreshAccessToken() / requestAccessToken()
//   GET  /balance              — SDK Client.accountBalance()
//   POST /invoices             — SDK Client.createInvoice(), body: { amount (sats), description? }
//   GET  /invoices/:hash       — SDK Client.getInvoice()
//   GET  /invoices/incoming    — SDK Client.incomingInvoices()
//   GET  /invoices/outgoing    — SDK Client.outgoingInvoices()  (NOT /payments — that 404s)
//   POST /payments/bolt11      — SDK Client.sendPayment(), body: { invoice }
//
// Token URL is api.getalby.com/oauth/token (the SDK uses BASE_URL + /oauth/token where
// BASE_URL = "https://api.getalby.com"). The previous getalby.com/oauth/token was a
// host typo — getalby.com serves the marketing/consent UI; only api.getalby.com is the
// OAuth2 token endpoint. auth-alby.ts:10 already used the correct host.
//
// Required OAuth2 scopes (SDK OAuth2Scopes type):
//   account:read invoices:create invoices:read transactions:read balance:read payments:send
// These match ADR-228 D1's scope set. No additional scopes are needed for any endpoint.
import type { PrismaClient } from '@prisma/client'
import type { PaymentProvider, Invoice, PaymentResult, WalletBalance, Transaction } from '@col/payments'
import { encryptAlbyToken, decryptAlbyToken } from './albyTokenCrypto.js'

const ALBY_API_BASE = 'https://api.getalby.com'
const ALBY_TOKEN_URL = 'https://api.getalby.com/oauth/token'

export class AlbyOauthNotSupportedError extends Error {
  constructor(method: string) {
    super(`not_supported_by_alby_oauth: ${method}`)
    this.name = 'AlbyOauthNotSupportedError'
  }
}

async function albyFetch(path: string, accessToken: string, init?: RequestInit): Promise<Response> {
  return fetch(`${ALBY_API_BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  })
}

// D4: satisfies PaymentProvider so the wallet-routes layer can treat an
// ALBY_OAUTH wallet like any other provider — except createHoldInvoice,
// settleHoldInvoice, cancelHoldInvoice, which Alby's OAuth API does not
// expose. Callers (escrow routes) must reject ALBY_OAUTH wallets before
// reaching this class — see routes/escrow.ts.
export class AlbyOauthProvider implements PaymentProvider {
  constructor(private accessToken: string) {}

  async createInvoice(amountSats: number, memo: string, _webhookUrl?: string): Promise<Invoice> {
    const res = await albyFetch('/invoices', this.accessToken, {
      method: 'POST',
      body: JSON.stringify({ amount: amountSats, description: memo }),
    })
    if (!res.ok) throw new Error(`Alby createInvoice failed: ${res.status} ${await res.text()}`)
    const json = (await res.json()) as { payment_request: string; payment_hash: string; expires_at?: string }
    return {
      bolt11: json.payment_request,
      paymentHash: json.payment_hash,
      amountSats,
      expiresAt: json.expires_at ? new Date(json.expires_at) : new Date(Date.now() + 3600_000),
    }
  }

  async createHoldInvoice(): Promise<Invoice> {
    throw new AlbyOauthNotSupportedError('createHoldInvoice')
  }

  async settleHoldInvoice(): Promise<void> {
    throw new AlbyOauthNotSupportedError('settleHoldInvoice')
  }

  async cancelHoldInvoice(): Promise<void> {
    throw new AlbyOauthNotSupportedError('cancelHoldInvoice')
  }

  async payInvoice(bolt11: string): Promise<PaymentResult> {
    const res = await albyFetch('/payments/bolt11', this.accessToken, {
      method: 'POST',
      body: JSON.stringify({ invoice: bolt11 }),
    })
    if (!res.ok) return { paymentHash: '', status: 'FAILED' }
    const json = (await res.json()) as { payment_hash: string; payment_preimage?: string; fee?: number }
    return {
      paymentHash: json.payment_hash,
      status: 'SUCCESS',
      feeSats: json.fee,
      // ADR-253: Alby's /payments/bolt11 returns the preimage — surface it so a
      // buyer can self-confirm a direct-pay ticket (parity with NWC/WebLN).
      preimage: json.payment_preimage,
    }
  }

  async getPaymentStatus(paymentHash: string): Promise<PaymentResult> {
    const res = await albyFetch(`/invoices/${paymentHash}`, this.accessToken)
    if (!res.ok) return { paymentHash, status: 'PENDING' }
    const json = (await res.json()) as { settled?: boolean; fee?: number }
    return { paymentHash, status: json.settled ? 'SUCCESS' : 'PENDING', feeSats: json.fee }
  }

  async getBalance(): Promise<WalletBalance> {
    const res = await albyFetch('/balance', this.accessToken)
    if (!res.ok) throw new Error(`Alby getBalance failed: ${res.status} ${await res.text()}`)
    const json = (await res.json()) as { balance: number; unit: string }
    // Alby's /balance returns sats directly when unit === 'sat'; msat conversion
    // is defensive in case the account is denominated differently.
    const sats = json.unit === 'msat' ? Math.round(json.balance / 1000) : json.balance
    return { confirmedSats: sats, unconfirmedSats: 0, pendingSats: 0 }
  }

  async getTransactions(limit: number, offset: number): Promise<Transaction[]> {
    // FU-228-A fix: Alby's API uses /invoices/incoming and /invoices/outgoing
    // (verified against @getalby/sdk@8.0.3 Client.incomingInvoices/outgoingInvoices).
    // The previous /payments endpoint returned 404 (it does not exist).
    // Pagination: SDK GetInvoicesRequestParams uses items + page (1-based).
    const page = Math.floor(offset / limit) + 1
    const [incomingRes, outgoingRes] = await Promise.all([
      albyFetch(`/invoices/incoming?items=${limit}&page=${page}`, this.accessToken),
      albyFetch(`/invoices/outgoing?items=${limit}&page=${page}`, this.accessToken),
    ])
    const incoming = incomingRes.ok ? ((await incomingRes.json()) as any[]) : []
    const outgoing = outgoingRes.ok ? ((await outgoingRes.json()) as any[]) : []
    const mapped: Transaction[] = [
      ...incoming.map((tx): Transaction => ({
        id: tx.payment_hash,
        paymentHash: tx.payment_hash,
        amountSats: tx.amount,
        type: 'INCOMING',
        status: tx.settled ? 'COMPLETED' : 'PENDING',
        memo: tx.memo,
        createdAt: new Date(tx.created_at ?? Date.now()),
      })),
      ...outgoing.map((tx): Transaction => ({
        id: tx.payment_hash,
        paymentHash: tx.payment_hash,
        amountSats: tx.amount,
        type: 'OUTGOING',
        status: tx.settled ? 'COMPLETED' : 'PENDING',
        memo: tx.memo,
        createdAt: new Date(tx.settled_at ?? tx.created_at ?? Date.now()),
      })),
    ]
    return mapped.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit)
  }
}

export class AlbyOauthTokenMissingError extends Error {
  constructor() {
    super('ALBY_OAUTH_TOKEN_MISSING')
    this.name = 'AlbyOauthTokenMissingError'
  }
}

// D4 lifetime invariant: construct fresh per request from the user's
// decrypted, possibly-refreshed token. No singleton, no static cache.
export async function createAlbyOauthProviderForUser(
  prisma: PrismaClient,
  userId: string
): Promise<AlbyOauthProvider> {
  const row = await prisma.albyOauthToken.findUnique({ where: { userId } })
  if (!row || row.revokedAt) throw new AlbyOauthTokenMissingError()

  let accessToken = decryptAlbyToken(row.encryptedAccess)

  const needsRefresh = row.expiresAt !== null && row.expiresAt.getTime() < Date.now() + 60_000
  if (needsRefresh && row.encryptedRefresh) {
    const refreshToken = decryptAlbyToken(row.encryptedRefresh)
    const clientId = process.env.ALBY_CLIENT_ID
    const clientSecret = process.env.ALBY_CLIENT_SECRET
    if (!clientId || !clientSecret) throw new Error('ALBY_CLIENT_ID/ALBY_CLIENT_SECRET required to refresh')

    const res = await fetch(ALBY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }).toString(),
    })
    if (!res.ok) throw new Error(`Alby token refresh failed: ${res.status}`)
    const json = (await res.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
    }
    accessToken = json.access_token
    const newExpiresAt = json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null
    await prisma.albyOauthToken.update({
      where: { userId },
      data: {
        encryptedAccess: encryptAlbyToken(json.access_token),
        accessTokenLast4: json.access_token.slice(-4),
        ...(json.refresh_token
          ? { encryptedRefresh: encryptAlbyToken(json.refresh_token), refreshTokenLast4: json.refresh_token.slice(-4) }
          : {}),
        expiresAt: newExpiresAt,
        lastRefreshedAt: new Date(),
      },
    })
  }

  await prisma.albyOauthToken.update({ where: { userId }, data: { lastUsedAt: new Date() } }).catch(() => {})

  return new AlbyOauthProvider(accessToken)
}
