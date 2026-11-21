/**
 * NWC (NIP-47) Mock Wallet Smoke Test (ADR-208, FU-208-F partial)
 *
 * The unit tests (`services/nwcClient.test.ts`) mock `@getalby/sdk` entirely,
 * so they never exercise the real NIP-47 wire protocol (event kinds, NIP-44
 * envelope, encryption negotiation, request/response correlation, timeouts).
 * This script closes that gap without needing a real Alby wallet: it runs a
 * minimal but protocol-correct NIP-47 wallet-service responder over the dev
 * mock relay, then drives it with the actual `NwcClient` wrapper
 * (`services/nwcClient.ts`) on top of the real `@getalby/sdk` `NWCClient`.
 *
 * Covers: connection-URI round-trip, kind 13194 info-event discovery +
 * encryption negotiation (nip44_v2), kind 23194/23195 request/response
 * correlation, getInfo/getBalance/payInvoice payload shapes, and a
 * reply-timeout path (wallet never responds).
 *
 * Does NOT cover: real Lightning payment execution, a real Alby wallet, or
 * hold-invoice ACCEPTED-state semantics — those need a real wallet (tracked
 * as the remaining part of FU-208-F).
 *
 * Requires the dev server running with the in-process mock relay
 * (npx pnpm dev:server → ws://localhost:4001).
 *
 * Run with:
 *   npx tsx scripts/nwc-mock-wallet-smoke-test.ts
 *
 * Exit code 0 = success; non-zero = failure.
 */

import { SimplePool } from 'nostr-tools/pool'
import { finalizeEvent, generateSecretKey, getPublicKey, type Event as NostrEvent } from 'nostr-tools/pure'
import * as nip44 from 'nostr-tools/nip44'
import { bytesToHex, randomBytes } from '@noble/hashes/utils'
import { NwcClient, parseNwcUri } from '../services/nwcClient.js'

const RELAY = process.env.NWC_MOCK_RELAY || 'ws://localhost:4001'
const NWC_INFO = 13194
const NWC_REQUEST = 23194
const NWC_RESPONSE = 23195

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ FAIL: ${msg}`)
    process.exit(1)
  }
  console.log(`✓ ${msg}`)
}

async function main(): Promise<void> {
  console.log(`NWC mock wallet smoke (relay: ${RELAY})`)

  const walletPool = new SimplePool()

  // ── Wallet side: a mock NIP-47 wallet service ──────────────────────────────
  const walletSk = generateSecretKey()
  const walletPk = getPublicKey(walletSk)
  console.log(`Wallet pubkey: ${walletPk}`)

  // Kind 13194 info event: content = space-separated supported methods,
  // `encryption` tag advertises nip44_v2 so the real SDK negotiates it.
  const infoEvent = finalizeEvent(
    {
      kind: NWC_INFO,
      tags: [['encryption', 'nip44_v2 nip04']],
      content: 'get_info get_balance pay_invoice',
      created_at: Math.floor(Date.now() / 1000),
    },
    walletSk,
  )
  await Promise.any(walletPool.publish([RELAY], infoEvent))
  console.log('[wallet] published kind 13194 info event')

  let respondToNextRequest = true

  const walletSub = walletPool.subscribe(
    [RELAY],
    { kinds: [NWC_REQUEST], '#p': [walletPk], limit: 0 },
    {
      onevent: async (event: NostrEvent) => {
        if (!respondToNextRequest) {
          console.log('[wallet] suppressing response (timeout-path test)')
          return
        }
        try {
          const convKey = nip44.getConversationKey(walletSk, event.pubkey)
          const req = JSON.parse(nip44.decrypt(event.content, convKey)) as {
            method: string
            params: Record<string, unknown>
          }
          console.log(`[wallet] recv method=${req.method}`)

          let result: Record<string, unknown> | undefined
          let error: { code: string; message: string } | undefined
          switch (req.method) {
            case 'get_info':
              result = {
                alias: 'Mock NWC Wallet',
                color: '#000000',
                pubkey: walletPk,
                network: 'regtest',
                block_height: 0,
                block_hash: '0'.repeat(64),
                methods: ['get_info', 'get_balance', 'pay_invoice'],
              }
              break
            case 'get_balance':
              result = { balance: 250_000 } // msat -> 250 sats
              break
            case 'pay_invoice': {
              const invoice = req.params?.invoice
              if (typeof invoice !== 'string' || !invoice.length) {
                error = { code: 'INTERNAL', message: 'missing invoice param' }
                break
              }
              result = { preimage: bytesToHex(randomBytes(32)), fees_paid: 1000 }
              break
            }
            default:
              error = { code: 'NOT_IMPLEMENTED', message: `unsupported method ${req.method}` }
          }

          const payload = JSON.stringify(error ? { result_type: req.method, error } : { result_type: req.method, result })
          const response = finalizeEvent(
            {
              kind: NWC_RESPONSE,
              tags: [
                ['e', event.id],
                ['p', event.pubkey],
              ],
              content: nip44.encrypt(payload, convKey),
              created_at: Math.floor(Date.now() / 1000),
            },
            walletSk,
          )
          await Promise.any(walletPool.publish([RELAY], response))
          console.log(`[wallet] sent response for method=${req.method}`)
        } catch (e) {
          console.error('[wallet] failed to handle request', e)
        }
      },
    },
  )

  // Let the wallet subscription establish before the client connects.
  await new Promise(r => setTimeout(r, 800))

  // ── Client side: the real NwcClient wrapper over the real @getalby/sdk ────
  const clientSk = generateSecretKey()
  const clientSecretHex = bytesToHex(clientSk)
  const uri = `nostr+walletconnect://${walletPk}?relay=${encodeURIComponent(RELAY)}&secret=${clientSecretHex}`

  const parsed = parseNwcUri(uri)
  assert(parsed.walletPubkey === walletPk, 'parseNwcUri extracts the wallet pubkey')
  assert(parsed.relayUrls.includes(RELAY), 'parseNwcUri extracts the relay URL')

  const client = new NwcClient(uri)
  try {
    const info = await client.getInfo()
    assert(info.pubkey === walletPk, `getInfo() returns the wallet pubkey (${info.pubkey})`)
    assert(info.methods.includes('pay_invoice'), 'getInfo() reports pay_invoice capability')

    const balance = await client.getBalance()
    assert(balance.balanceSats === 250, `getBalance() converts msat->sats correctly (${balance.balanceSats})`)

    const payment = await client.payInvoice('lnbcrt1_mock_invoice_for_smoke_test')
    assert(/^[0-9a-f]{64}$/.test(payment.preimage), 'payInvoice() returns a 32-byte hex preimage')
    assert(payment.feesPaidSats === 1, `payInvoice() converts fees msat->sats correctly (${payment.feesPaidSats})`)
  } finally {
    client.close()
  }

  // ── Timeout path: wallet stops responding, client must reject, not hang ───
  respondToNextRequest = false
  const timeoutClient = new NwcClient(uri, { timeoutMs: 2000 })
  try {
    await timeoutClient.getBalance()
    assert(false, 'getBalance() should have rejected when the wallet never responds')
  } catch (e) {
    assert(e instanceof Error, `getBalance() rejects instead of hanging when the wallet is silent (${(e as Error).message})`)
  } finally {
    timeoutClient.close()
  }

  console.log('\nNWC mock wallet smoke: ALL PASS ✓')
  walletSub.close()
  walletPool.close([RELAY])
  process.exit(0)
}

main().catch(err => {
  console.error('Smoke failed:', err)
  process.exit(1)
})
