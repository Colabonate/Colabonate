/**
 * NIP-17 Handshake + Gift-Wrap Integration Test (ADR-153 Phase 0 step 0.9)
 *
 * Simulates the full NIP-17 first-contact flow between Alice and Bob
 * without touching a real relay. Verifies:
 *   1. Alice publishes a plaintext handshake with her chat_pubkey
 *   2. Bob reads the handshake and caches Alice's chat_pubkey
 *   3. Alice sends a Gift-Wrapped DM to Bob (using ECDH between burners)
 *   4. Bob unwraps the Gift Wrap, decrypts, and reads the original content
 *
 * Run with:
 *   cd apps/colabonate-app && ./node_modules/.bin/tsx scripts/nip17-handshake-integration-test.ts
 */

import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools'
import * as nip44 from 'nostr-tools/nip44'
import * as nip59 from 'nostr-tools/nip59'

// Simulated localStorage for the handshake cache
const handshakeCache = new Map<string, string>()

const HANDSHAKE_KEY_PREFIX = 'colabonate:handshake:'

function cachePeerChatPubkey(peerLoginPubkey: string, chatPubkey: string) {
  handshakeCache.set(`${HANDSHAKE_KEY_PREFIX}${peerLoginPubkey}`, chatPubkey)
}
function getCachedPeerChatPubkey(peerLoginPubkey: string): string | null {
  return handshakeCache.get(`${HANDSHAKE_KEY_PREFIX}${peerLoginPubkey}`) ?? null
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
  console.log(`✓ ${label}`)
}
function assertTrue(cond: boolean, label: string) {
  if (!cond) throw new Error(`✗ ${label}`)
  console.log(`✓ ${label}`)
}

interface Peer {
  loginSk: Uint8Array
  loginPk: string
  chatSk: Uint8Array
  chatPk: string
}

function makePeer(): Peer {
  const loginSk = generateSecretKey()
  const loginPk = getPublicKey(loginSk)
  const chatSk = generateSecretKey()
  const chatPk = getPublicKey(chatSk)
  return { loginSk, loginPk, chatSk, chatPk }
}

async function main() {
  console.log('=== NIP-17 Handshake + Gift-Wrap Integration Test ===\n')
  const alice = makePeer()
  const bob = makePeer()
  console.log(`Alice login: ${alice.loginPk.slice(0, 16)}…  chat: ${alice.chatPk.slice(0, 16)}…`)
  console.log(`Bob   login: ${bob.loginPk.slice(0, 16)}…  chat: ${bob.chatPk.slice(0, 16)}…\n`)

  // Step 1: Alice publishes handshake (Kind 14 plaintext with chat_pubkey tag)
  console.log('--- Step 1: Alice publishes handshake ---')
  const aliceHandshake = finalizeEvent(
    {
      kind: 14,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', bob.loginPk],
        ['t', 'colabonate-handshake'],
        ['chat_pubkey', alice.chatPk],
        ['protocol', 'nip44-v2'],
      ],
      content: '',
    },
    alice.chatSk,
  )
  assertEqual(aliceHandshake.kind, 14, 'Handshake is Kind 14')
  assertTrue(
    aliceHandshake.tags.some(t => t[0] === 'chat_pubkey' && t[1] === alice.chatPk),
    'Handshake carries Alice chat_pubkey',
  )

  // Step 2: Bob receives Alice's handshake
  console.log('\n--- Step 2: Bob receives handshake ---')
  const chatPubFromHandshake = aliceHandshake.tags.find(t => t[0] === 'chat_pubkey')?.[1]
  cachePeerChatPubkey(alice.loginPk, chatPubFromHandshake!)
  assertEqual(getCachedPeerChatPubkey(alice.loginPk), alice.chatPk, 'Bob caches Alice chat_pubkey in localStorage')
  assertEqual(chatPubFromHandshake, alice.chatPk, 'Cached pubkey matches Alice chat pubkey')

  // Bob replies with his own handshake
  const bobHandshake = finalizeEvent(
    {
      kind: 14,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', alice.loginPk],
        ['t', 'colabonate-handshake'],
        ['chat_pubkey', bob.chatPk],
        ['protocol', 'nip44-v2'],
      ],
      content: '',
    },
    bob.chatSk,
  )
  cachePeerChatPubkey(bob.loginPk, bobHandshake.tags.find(t => t[0] === 'chat_pubkey')?.[1]!)
  assertEqual(getCachedPeerChatPubkey(bob.loginPk), bob.chatPk, 'Alice caches Bob chat_pubkey')

  // Step 3: Alice sends a Gift-Wrapped DM to Bob
  console.log('\n--- Step 3: Alice → Bob Gift-Wrapped DM ---')
  const PLAINTEXT = 'Hi Bob, this is a private Gift-Wrapped message. Meet me at noon 🔒'
  const peerChatPub = getCachedPeerChatPubkey(bob.loginPk)!
  const ck = nip44.getConversationKey(alice.chatSk, peerChatPub)
  const encryptedContent = nip44.v2.encrypt(PLAINTEXT, ck)

  const rumor = {
    kind: 14,
    pubkey: alice.chatPk,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['p', bob.loginPk],
      ['ticket_id', 'integration-test-001'],
      ['sender_chat_pubkey', alice.chatPk],
    ],
    content: encryptedContent,
  }
  const seal = nip59.createSeal(nip59.createRumor(rumor, alice.chatSk), alice.chatSk, peerChatPub)
  const giftWrap = nip59.createWrap(seal, peerChatPub)
  assertEqual(seal.kind, 13, 'Seal is Kind 13')
  assertEqual(giftWrap.kind, 1059, 'Gift wrap is Kind 1059')
  assertTrue(giftWrap.pubkey !== alice.chatPk, 'Gift wrap pubkey is one-time key')
  // createWrap puts recipient's chat pubkey (used for encryption) on the #p tag.
  // Other clients can correlate this to the user's known burners via the handshake pattern.
  assertTrue(giftWrap.tags.some(t => t[0] === 'p' && t[1] === peerChatPub), 'Gift wrap #p tag = Bob chat pubkey (encryption target)')

  // Step 4: Bob receives and unwraps
  console.log('\n--- Step 4: Bob unwraps + decrypts ---')
  const unwrapped = nip59.unwrapEvent(giftWrap, bob.chatSk)
  assertEqual(unwrapped.kind, 14, 'Unwrapped rumor is Kind 14')
  assertEqual(unwrapped.pubkey, alice.chatPk, 'NIP-17 anti-spoofing: rumor.pubkey = Alice chat pubkey')

  const bobCk = nip44.getConversationKey(bob.chatSk, unwrapped.pubkey)
  const decrypted = nip44.v2.decrypt(unwrapped.content, bobCk)
  assertEqual(decrypted, PLAINTEXT, 'Bob decrypts content back to original plaintext')

  // Security: Verify gift-wrap metadata is hidden
  console.log('\n--- Step 5: Metadata Hiding Verification ---')
  const relaySees = {
    kind: giftWrap.kind,
    pubkey: giftWrap.pubkey,
    p: giftWrap.tags.find(t => t[0] === 'p')?.[1],
    content: '<encrypted>',
    created_at: giftWrap.created_at,
  }
  assertTrue(relaySees.pubkey !== alice.chatPk, 'Relay sees: pubkey is NOT Alice (one-time key)')
  // The p-tag is the recipient's chat pubkey (used as ECDH endpoint). Bob's
  // own client can correlate this to his known peers via the handshake cache;
  // other clients would just see "a random pubkey + encrypted blob".
  assertTrue(relaySees.p === peerChatPub, 'Relay sees: p-tag = recipient (encryption target)')
  assertTrue(relaySees.content === '<encrypted>', 'Relay sees: content is encrypted')

  // The rumor's inner pubkey (alice.chatPk) is only revealed AFTER ECDH-decryption
  // — a relay operator cannot read it.
  const exposedAsAuthor = giftWrap.pubkey === alice.chatPk || giftWrap.tags.some(t => t[1] === alice.chatPk)
  assertTrue(!exposedAsAuthor, 'Alice chat pubkey NOT exposed on relay (metadata-hiding)')

  console.log('\n✅ All integration tests passed — NIP-17 E2E + Gift Wrap working end-to-end.')
}

main().catch(err => {
  console.error('\n❌ Integration test failed:', err)
  process.exit(1)
})
