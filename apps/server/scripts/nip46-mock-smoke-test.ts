/**
 * NIP-46 Mock Bunker Smoke Test (ADR-154, FU-154-D)
 *
 * Verifies the NIP-46 transport round-trip end-to-end over the dev mock relay:
 *   1. Start a local mock bunker (subscribe + respond) holding a test nsec.
 *   2. Connect a BunkerSigner client to it.
 *   3. connect() → get_public_key → sign_event → verify the signature.
 *   4. Assert the signed event's pubkey == bunker pubkey.
 *
 * Requires the dev server running with the in-process mock relay
 * (npx pnpm dev:server → ws://localhost:4001).
 *
 * NOTE: bunker + client use SEPARATE SimplePool instances so they open two
 * WebSocket connections — the dev mock relay does not echo events back to the
 * sender's own connection (real bunkers and clients are separate peers too).
 *
 * Run with:
 *   npx tsx scripts/nip46-mock-smoke-test.ts
 *
 * Exit code 0 = success; non-zero = failure.
 */

import { SimplePool } from 'nostr-tools/pool'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { BunkerSigner } from 'nostr-tools/nip46'
import * as nip44 from 'nostr-tools/nip44'

const RELAY = process.env.NIP46_RELAY || 'ws://localhost:4001'
const NOSTR_CONNECT = 24133
const TIMEOUT_MS = 15000

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('')
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ FAIL: ${msg}`)
    process.exit(1)
  }
  console.log(`✓ ${msg}`)
}

async function main(): Promise<void> {
  console.log(`NIP-46 mock bunker smoke (relay: ${RELAY})`)

  const bunkerPool = new SimplePool()
  const clientPool = new SimplePool()

  // ── Bunker side: a test nsec ──────────────────────────────────────────────
  const bunkerSk = generateSecretKey()
  const bunkerPk = getPublicKey(bunkerSk)
  const secret = bytesToHex(generateSecretKey())
  console.log(`Bunker pubkey: ${bunkerPk}`)

  const bunkerSub = bunkerPool.subscribe(
    [RELAY],
    { kinds: [NOSTR_CONNECT], '#p': [bunkerPk], limit: 0 },
    {
      onevent: async (event) => {
        try {
          console.log(`[bunker] recv kind=${event.kind} from=${event.pubkey.slice(0, 8)}`)
          const convKey = nip44.getConversationKey(bunkerSk, event.pubkey)
          const req = JSON.parse(nip44.decrypt(event.content, convKey)) as {
            id: string
            method: string
            params: string[]
          }
          console.log(`[bunker] req method=${req.method} id=${req.id}`)

          let result = ''
          let error: string | undefined
          try {
            switch (req.method) {
              case 'connect':
                // nostr-tools' BunkerSigner only resolves on a TRUTHY result.
                result = event.pubkey
                break
              case 'ping':
                result = 'pong'
                break
              case 'get_public_key':
                result = bunkerPk
                break
              case 'sign_event': {
                const tmpl = JSON.parse(req.params[0])
                result = JSON.stringify(
                  finalizeEvent(
                    {
                      kind: tmpl.kind,
                      tags: tmpl.tags ?? [],
                      content: tmpl.content ?? '',
                      created_at: tmpl.created_at ?? Math.floor(Date.now() / 1000),
                    },
                    bunkerSk,
                  ),
                )
                break
              }
              default:
                throw new Error(`unsupported method ${req.method}`)
            }
          } catch (e) {
            error = e instanceof Error ? e.message : String(e)
          }

          const payload = JSON.stringify(error ? { id: req.id, error } : { id: req.id, result })
          const response = finalizeEvent(
            {
              kind: NOSTR_CONNECT,
              tags: [['p', event.pubkey]],
              content: nip44.encrypt(payload, convKey),
              created_at: Math.floor(Date.now() / 1000),
            },
            bunkerSk,
          )
          bunkerPool.publish([RELAY], response)
          console.log(`[bunker] sent response for id=${req.id}`)
        } catch {
          // ignore noise
        }
      },
    },
  )

  // Let the bunker subscription establish before the client connects.
  await new Promise((r) => setTimeout(r, 800))

  // ── Client side: BunkerSigner (own pool = own connection) ─────────────────
  const clientSk = generateSecretKey()
  const signer = BunkerSigner.fromBunker(
    clientSk,
    { relays: [RELAY], pubkey: bunkerPk, secret },
    { pool: clientPool },
  )

  const withTimeout = <T>(p: Promise<T>, label: string): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), TIMEOUT_MS)),
    ])

  try {
    await withTimeout(signer.connect(), 'connect()')
    assert(true, 'connect() handshake completed')

    const pk = await withTimeout(signer.getPublicKey(), 'get_public_key()')
    assert(pk === bunkerPk, `get_public_key() returns bunker pubkey (${pk})`)

    const signed = await withTimeout(
      signer.signEvent({
        kind: 1,
        tags: [],
        content: 'hello from nip46 smoke',
        created_at: Math.floor(Date.now() / 1000),
      }),
      'sign_event()',
    )
    assert(verifyEvent(signed), 'sign_event() returns a valid signature')
    assert(signed.pubkey === bunkerPk, 'signed event pubkey == bunker pubkey')

    console.log('\nNIP-46 mock bunker smoke: ALL PASS ✓')
  } finally {
    bunkerSub.close()
    await signer.close()
    bunkerPool.close([RELAY])
    clientPool.close([RELAY])
    process.exit(0)
  }
}

main().catch((err) => {
  console.error('Smoke failed:', err)
  process.exit(1)
})
