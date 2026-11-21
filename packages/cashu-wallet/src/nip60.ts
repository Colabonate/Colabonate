// @col/cashu — NIP-60 wallet-state event (de)serialisation (ADR-187).
//
// NIP-60 keeps Cashu wallet state in encrypted Nostr events:
//   kind 17375 — replaceable wallet event: mint list + P2PK wallet privkey
//   kind 7375  — token event: a bucket of unspent proofs for one mint
//   kind 7376  — spending-history event (optional audit trail)
//
// This module only builds the *content* (NIP-44-encrypted) and public tags for
// an unsigned event template, and parses the content back. Signing + publishing
// is the app layer's job (existing NIP-07 path) — the package never holds a key.
// All proofs are stored as JSON with plain number amounts (no Amount class).

import type { CashuWalletState, HistoryEntry, Nip44Codec, StoredProof } from './types.js'

export const KIND_WALLET = 17375
export const KIND_TOKEN = 7375
export const KIND_HISTORY = 7376

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

// — kind 17375: wallet event (mint list + privkey) —

/**
 * Build the kind-17375 wallet event. Content is the NIP-44-encrypted JSON of an
 * array of `["privkey", hex]` / `["mint", url]` entries (per NIP-60).
 */
export async function serializeWalletEvent(
  state: Pick<CashuWalletState, 'mints'>,
  walletPrivkeyHex: string,
  codec: Nip44Codec,
): Promise<UnsignedEventTemplate> {
  const entries: string[][] = [['privkey', walletPrivkeyHex], ...state.mints.map((m) => ['mint', m])]
  const content = await codec.encrypt(JSON.stringify(entries))
  return { kind: KIND_WALLET, content, tags: [], created_at: now() }
}

export async function parseWalletEvent(
  content: string,
  codec: Nip44Codec,
): Promise<{ mints: string[]; walletPrivkeyHex?: string }> {
  const entries = JSON.parse(await codec.decrypt(content)) as string[][]
  const mints: string[] = []
  let walletPrivkeyHex: string | undefined
  for (const [tag, value] of entries) {
    if (tag === 'mint' && value) mints.push(value)
    else if (tag === 'privkey' && value) walletPrivkeyHex = value
  }
  return { mints, walletPrivkeyHex }
}

// — kind 7375: token event (proofs for one mint) —

interface TokenEventContent {
  mint: string
  proofs: StoredProof[]
  /** ids of token events this one supersedes (rolled-over change). */
  del?: string[]
}

export async function serializeTokenEvent(
  mintUrl: string,
  proofs: readonly StoredProof[],
  codec: Nip44Codec,
  opts: { supersedes?: string[] } = {},
): Promise<UnsignedEventTemplate> {
  const payload: TokenEventContent = {
    mint: mintUrl,
    proofs: [...proofs],
    ...(opts.supersedes?.length ? { del: opts.supersedes } : {}),
  }
  const content = await codec.encrypt(JSON.stringify(payload))
  return { kind: KIND_TOKEN, content, tags: [], created_at: now() }
}

export async function parseTokenEvent(
  content: string,
  codec: Nip44Codec,
): Promise<{ mintUrl: string; proofs: StoredProof[]; supersedes: string[] }> {
  const payload = JSON.parse(await codec.decrypt(content)) as TokenEventContent
  return { mintUrl: payload.mint, proofs: payload.proofs ?? [], supersedes: payload.del ?? [] }
}

// — kind 7376: spending history —

export async function serializeHistoryEvent(
  entry: HistoryEntry,
  codec: Nip44Codec,
): Promise<UnsignedEventTemplate> {
  const tags: string[][] = [
    ['direction', entry.direction],
    ['amount', String(entry.amount)],
  ]
  if (entry.memo) tags.push(['memo', entry.memo])
  const content = await codec.encrypt(JSON.stringify(tags))
  return { kind: KIND_HISTORY, content, tags: [], created_at: entry.createdAt }
}

export async function parseHistoryEvent(
  content: string,
  createdAt: number,
  codec: Nip44Codec,
): Promise<HistoryEntry> {
  const tags = JSON.parse(await codec.decrypt(content)) as string[][]
  const get = (k: string) => tags.find((t) => t[0] === k)?.[1]
  return {
    direction: (get('direction') as 'in' | 'out') ?? 'in',
    amount: Number(get('amount') ?? 0),
    createdAt,
    memo: get('memo'),
  }
}
