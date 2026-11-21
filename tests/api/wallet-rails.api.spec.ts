import { test, expect } from '@playwright/test'
import { demoSession, DEMO_LOGIN_SKIP_REASON } from '../e2e/fixtures/roles.js'

// ADR-377 D1: contract-level smoke (no page.* interaction) — tagged @api.
//
// Wallet-rail coverage against the REAL beta server (BETA_MODE=true,
// PAYMENT_PROVIDER=mock): the custodial provider send path, the non-custodial
// connect/activation flow, the Cashu receive preference (seller rail), the NWC
// kill switch, and NWC URI validation. Rail-internal logic is covered by
// apps/server/routes/walletRails.test.ts + lnAddressResolver.test.ts.

const SERVER_BASE_URL = process.env.PLAYWRIGHT_SERVER_URL || 'http://localhost:4001'

async function call(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  const res = await fetch(`${SERVER_BASE_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  })
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, any> }
}

function freshPubkey(prefix: string) {
  const uniq = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  return `${prefix}${uniq}`.padEnd(64, '0').slice(0, 64)
}

test.describe('@api Wallet payment rails', () => {
  test('custodial provider rail settles a platform invoice (mock provider)', async () => {
    const pubkey = freshPubkey('e2erail')
    const login = await demoSession(pubkey)
    test.skip(!login, DEMO_LOGIN_SKIP_REASON)

    const wallet = await call('/api/wallet/create', { method: 'POST', body: { pubkey }, token: login!.token })
    expect(wallet.status).toBe(200)
    expect(wallet.data.wallet?.provider).toBe('DEMO') // beta rail, mode CUSTODIAL

    const invoice = await call('/api/lightning/invoice', {
      method: 'POST',
      body: { amountSats: 1000, description: 'e2e rail send' },
    })
    expect(invoice.status).toBe(200)
    expect(invoice.data.invoice).toBeTruthy()

    const sent = await call('/api/wallet/payments/send', {
      method: 'POST',
      body: { bolt11: invoice.data.invoice },
      token: login!.token,
    })
    expect(sent.status).toBe(200)
    expect(sent.data).toMatchObject({ success: true, status: 'SUCCESS' })
    expect(sent.data.paymentHash).toBe(invoice.data.paymentHash)
  })

  test('WebLN connect activates a non-custodial wallet', async () => {
    const pubkey = freshPubkey('e2ewebln')
    const login = await demoSession(pubkey)
    test.skip(!login, DEMO_LOGIN_SKIP_REASON)

    const connected = await call('/api/wallet/connect', {
      method: 'POST',
      body: { provider: 'WEBLN' },
      token: login!.token,
    })
    expect(connected.status).toBe(200)
    expect(connected.data.wallet).toMatchObject({ provider: 'WEBLN', mode: 'NON_CUSTODIAL' })

    const state = await call('/api/wallet', { token: login!.token })
    expect(state.data.wallet).toMatchObject({ provider: 'WEBLN', mode: 'NON_CUSTODIAL' })
  })

  test('Cashu receive preference is stored as a usable seller rail', async () => {
    const pubkey = freshPubkey('e2ecashu')
    const login = await demoSession(pubkey)
    test.skip(!login, DEMO_LOGIN_SKIP_REASON)

    const npub = freshPubkey('npub1')
    const mintUrl = 'https://mint.e2e.example'

    const saved = await call('/api/wallet/cashu/receive-preference', {
      method: 'POST',
      body: { pubkey: npub, mintUrl },
      token: login!.token,
    })
    expect(saved.status).toBe(200)

    const state = await call('/api/wallet', { token: login!.token })
    const cashu = (state.data.wallets as Array<Record<string, unknown>>).find(w => w.provider === 'CASHU')
    expect(cashu).toBeTruthy()

    const removed = await call('/api/wallet/cashu/receive-preference', {
      method: 'DELETE',
      token: login!.token,
    })
    expect(removed.status).toBe(200)
    const after = await call('/api/wallet', { token: login!.token })
    expect((after.data.wallets as Array<Record<string, unknown>>).some(w => w.provider === 'CASHU')).toBe(false)
  })

  test('NWC rail is safely disabled / rejects a malformed connection', async () => {
    const pubkey = freshPubkey('e2enwc')
    const login = await demoSession(pubkey)
    test.skip(!login, DEMO_LOGIN_SKIP_REASON)

    // Kill switch: the e2e/prod-style server runs without NWC_ENABLED.
    const pay = await call('/api/wallet/nwc/pay', {
      method: 'POST',
      body: { bolt11: 'lnbc1notarealinvoice' },
      token: login!.token,
    })
    expect(pay.status).toBe(503)
    expect(pay.data.error).toBe('NWC_NOT_ENABLED')

    // A malformed URI must never be persisted as a connection.
    const connect = await call('/api/wallet/nwc/connect', {
      method: 'POST',
      body: { nwcUri: 'definitely-not-an-nwc-uri' },
      token: login!.token,
    })
    expect([400, 422, 503]).toContain(connect.status)

    const state = await call('/api/wallet/ln-address', { token: login!.token })
    expect(state.data.nwcConnected).toBe(false)
  })
})
