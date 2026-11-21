// @col/cashu — NIP-61 Nutzap event (de)serialisation (ADR-187 Phase 3).
//
// NIP-61 is a Nostr-side layer on top of NIP-60: a kind-9321 event that bundles
// a NIP-44-encrypted P2PK-locked Cashu token and a list of `pubkey` tags
// pointing at the recipient(s) (the first tag is the primary recipient).
// Sending a nutzap is therefore the P2P Cashu send + a NIP-44-encrypted event
// that the recipient's wallet subscribes to.
//
// We keep this module small and explicit: build the unsigned kind-9321 event
// template (encrypted content) + parse it back. Signing + publishing is the
// app layer's job (existing NIP-07 / NIP-44 path). Package never holds a key.

import type { Nip44Codec, StoredProof } from './types.js'

export const KIND_NUTZAP = 9321

/** Minimal unsigned-event template the app layer finishes (id/pubkey/sig). */
export interface UnsignedEventTemplate {
  kind: number
  content: string
  tags: string[][]
  created_at: number
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

/** Decoded shape of a kind-9321 event's inner content. */
export interface NutzapContent {
  /** The mint that issued the proofs in the embedded token. */
  mint: string
  /** P2PK-locked unspent proofs (sum == amount the recipient will claim). */
  proofs: StoredProof[]
  /** Optional human-readable memo (not encrypted beyond NIP-44). */
  memo?: string
  /** NUT-22 standard `unit` tag, defaults to "sat". */
  unit?: string
}

/**
 * Build a kind-9321 nutzap event template addressed to one or more npubs.
 *
 * - The recipient list goes in `p` tags (first = primary, NIP-61).
 * - The token is the NIP-44-encrypted JSON of `NutzapContent` (decryptable by
 *   the recipient using ECDH conversation key against the first `p` tag).
 * - The proofs MUST already be P2PK-locked to the recipient's wallet pubkey
 *   (NIP-60 derived key), built by the caller via
 *   `wallet.send(amount, proofs, undefined, { send: { type: 'p2pk', options: { pubkey } } })`.
 */
export async function buildNutzapEvent(opts: {
  recipientPubkeys: string[]
  token: { mintUrl: string; proofs: StoredProof[]; memo?: string }
  codec: Nip44Codec
}): Promise<UnsignedEventTemplate> {
  if (opts.recipientPubkeys.length === 0) {
    throw new Error('Nutzap requires at least one recipient pubkey')
  }
  const content: NutzapContent = {
    mint: opts.token.mintUrl,
    proofs: opts.token.proofs,
    ...(opts.token.memo ? { memo: opts.token.memo } : {}),
    unit: 'sat',
  }
  const encrypted = await opts.codec.encrypt(JSON.stringify(content))
  const tags = opts.recipientPubkeys.map((p) => ['p', p])
  return { kind: KIND_NUTZAP, content: encrypted, tags, created_at: now() }
}

/**
 * Parse a kind-9321 event's encrypted content back into a `NutzapContent`.
 * Throws if the event kind is not 9321, if it has no `p` tag, or if NIP-44
 * decryption fails (wrong key / corrupt payload).
 */
export async function parseNutzapEvent(
  event: { kind: number; content: string; tags: string[][] },
  codec: Nip44Codec,
): Promise<{ recipient: string; content: NutzapContent }> {
  if (event.kind !== KIND_NUTZAP) {
    throw new Error(`Expected kind ${KIND_NUTZAP}, got ${event.kind}`)
  }
  const pTag = event.tags.find((t) => t[0] === 'p')?.[1]
  if (!pTag) throw new Error('Nutzap event missing primary `p` recipient tag')
  const decrypted = await codec.decrypt(event.content)
  const parsed = JSON.parse(decrypted) as NutzapContent
  if (!parsed.mint || !Array.isArray(parsed.proofs)) {
    throw new Error('Nutzap content missing `mint` or `proofs`')
  }
  return { recipient: pTag, content: parsed }
}

/**
 * Build the P2PK secret string for a single-pubkey lock (NUT-14). The secret
 * is the canonical JSON of `{ pubkey }` (cashu-ts `P2PKBuilder.toOptions()`
 * produces the same shape; we avoid the cashu-ts dep here for a pure helper).
 *
 * Pure, no IO.
 */
export function p2pkSecret(pubkey: string): string {
  return JSON.stringify({ pubkey })
}
