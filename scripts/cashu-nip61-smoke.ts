/**
 * ADR-187 Phase 3 nutzap smoke — verify NIP-61 event build/parse round-trip
 * with a locally generated P2PK keypair (no mint, no relays). This is the
 * "unit-style" smoke for the nutzap layer: builds an event with `buildNutzapEvent`,
 * parses it back with `parseNutzapEvent`, and asserts the recipient + content
 * come through unchanged. Proof-locking at the mint is a separate integration
 * step (covered by the cashu-ts test suite) — we only need to prove the NIP-61
 * event wire format is correct here.
 *
 * Run:  npx pnpm exec tsx scripts/cashu-nip61-smoke.ts
 */

import { generateSecretKey, getPublicKey } from 'nostr-tools'
import {
  MintClient,
  buildNutzapEvent,
  parseNutzapEvent,
  p2pkSecret,
  type Nip44Codec,
} from '../packages/cashu-wallet/src/index'
import * as nip44 from 'nostr-tools/nip44'

async function main() {
  // Two local keypairs: sender (publishes) and recipient (decrypts).
  const senderSk = generateSecretKey()
  const senderPk = getPublicKey(senderSk)
  const recipientSk = generateSecretKey()
  const recipientPk = getPublicKey(recipientSk)

  // Real NIP-44 codec keyed to the recipient — what the recipient's wallet
  // would use to decrypt the kind-9321 event they receive.
  const conversationKey = nip44.getConversationKey(recipientSk, senderPk)
  const codec: Nip44Codec = {
    encrypt: (s) => nip44.v2.encrypt(s, conversationKey),
    decrypt: (s) => nip44.v2.decrypt(s, conversationKey),
  }

  console.log(`[nip61-smoke] sender   = ${senderPk}`)
  console.log(`[nip61-smoke] recipient= ${recipientPk}`)

  // Hand-rolled "locked" proof shape — only the secret is P2PK-form, the
  // rest is filler. We're not exercising the mint here, only the event layer.
  const fakeLockedProofs = [
    { id: '009a1f29', amount: 100, secret: p2pkSecret(recipientPk), C: '02' + 'ab'.repeat(32) },
    { id: '009a1f29', amount: 50,  secret: p2pkSecret(recipientPk), C: '03' + 'cd'.repeat(32) },
  ]

  // 1) Build a kind-9321 nutzap event addressed to the recipient.
  const ev = await buildNutzapEvent({
    recipientPubkeys: [recipientPk],
    token: { mintUrl: 'https://testnut.cashu.space', proofs: fakeLockedProofs, memo: 'hi from smoke' },
    codec,
  })
  console.log(`[nip61-smoke] OK  built kind=${ev.kind} tags=${JSON.stringify(ev.tags)}`)

  // 2) Recipient parses it back.
  const parsed = await parseNutzapEvent({ kind: ev.kind, content: ev.content, tags: ev.tags }, codec)
  console.log(`[nip61-smoke] OK  parsed recipient=${parsed.recipient} mint=${parsed.content.mint}`)
  if (parsed.recipient !== recipientPk) throw new Error('recipient mismatch')
  if (parsed.content.mint !== 'https://testnut.cashu.space') throw new Error('mint mismatch')
  if (parsed.content.proofs.length !== 2) throw new Error('proofs length mismatch')
  if (parsed.content.proofs[0].amount !== 100) throw new Error('proofs[0].amount mismatch')
  if (parsed.content.memo !== 'hi from smoke') throw new Error('memo mismatch')
  if (parsed.content.unit !== 'sat') throw new Error('unit mismatch')

  // 3) Cross-check: P2PK secret of each proof matches the recipient pubkey.
  for (const p of parsed.content.proofs) {
    const { pubkey } = JSON.parse(p.secret) as { pubkey: string }
    if (pubkey !== recipientPk) {
      throw new Error(`proof secret does not lock to recipient pubkey: ${pubkey}`)
    }
  }

  // 4) Verify the MintClient.sendP2PK and MintClient.receiveLockedToken
  //    surfaces are exported and have the expected types (no network).
  const client = new MintClient('https://testnut.cashu.space')
  if (typeof client.sendP2PK !== 'function') throw new Error('sendP2PK missing')
  if (typeof client.receiveLockedToken !== 'function') throw new Error('receiveLockedToken missing')

  console.log('[nip61-smoke] done — NIP-61 event build/parse round-trip verified.')
}

main().catch((err) => {
  console.error('[nip61-smoke] FAILED', err)
  process.exit(1)
})
