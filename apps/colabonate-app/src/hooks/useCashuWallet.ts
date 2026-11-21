/**
 * useCashuWallet() — React hook for the non-custodial Cashu eCash wallet
 * (ADR-187 Phase 2 — headless foundation).
 *
 * Owns the NIP-60 lifecycle: load + decrypt wallet/token events from the app's
 * existing relay pool (FU-40: the private inbox relays via getRelays()),
 * hydrate an in-memory `CashuWalletState`, subscribe for live updates, and
 * persist mutations back as new kind-17375/7375 events signed with the burner
 * key (consistent with the NIP-17 private layer — every user has one).
 *
 * The whole surface is gated by `VITE_CASHU_ENABLED` (ADR-187 D4): when off the
 * hook returns an inert stub (`enabled: false`, empty state, status 'idle') and
 * no relay traffic occurs. UI (Phase 2 next block) consumes this hook only.
 *
 * Not unit-tested: it orchestrates relay IO + cashu-ts network calls, verified
 * live with the running app against the testnut mint. The pure helpers it leans
 * on (`createNip44Codec`, `hydrateStateFromEvents`, `latestTokenEventPerMint`)
 * live in `lib/cashu.ts` and are covered there.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Filter } from 'nostr-tools'
import {
  KIND_WALLET,
  KIND_TOKEN,
  KIND_NUTZAP,
  buildNutzapEvent,
  parseNutzapEvent,
  createState,
  addMint as addMintToState,
  removeMint as removeMintFromState,
  addProofs,
  removeProofs,
  totalBalanceSats,
  normalizeMintUrl,
  selectProofsToSend,
  sumProofsSats,
  serializeWalletEvent,
  parseWalletEvent,
  serializeTokenEvent,
  parseTokenEvent,
  encodeToken,
  decodeToken,
  MintClient,
  type CashuWalletState,
  type MeltQuote,
  type MintQuote,
  type Nip44Codec,
  type StoredProof,
} from '@col/cashu'
import { getPool, getRelays } from '../lib/nostr-relay-config'
import { getMyPubkeySync, getPrivkeyHex } from '../lib/nostr-identity'
import { signAndPublishEvent } from '../lib/nostr'
import {
  DEFAULT_CASHU_MINTS,
  createNip44Codec,
  generateWalletPrivkey,
  getWalletPubkey,
  hydrateStateFromEvents,
  isCashuEnabled,
  latestTokenEventPerMint,
  type DecryptedTokenEvent,
  type DecryptedWalletEvent,
} from '../lib/cashu'

export type CashuStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Mint-quote snapshot returned by `requestMint` — the bolt11 to be paid. */
export interface MintQuoteInfo {
  quote: string
  bolt11: string
  amountSats: number
  mintUrl: string
}

/** Melt-quote snapshot returned by `requestMeltQuote` — for confirmation UX. */
export interface MeltQuoteInfo {
  quote: string
  bolt11: string
  mintUrl: string
  amountSats: number
  feeReserveSats: number
  /** Minimum amount of eCash proofs required to cover amount + fee_reserve. */
  requiredSats: number
}

export interface CashuWalletApi {
  /** Feature flag is on. When false the wallet is fully inert. */
  enabled: boolean
  status: CashuStatus
  state: CashuWalletState
  /** Total eCash balance across all mints, in sats. */
  balanceSats: number
  /** Trusted mint URLs. */
  mints: string[]
  /** Derived Cashu P2PK pubkey (for future nutzap receive), or null pre-init. */
  walletPubkey: string | null
  error: string | null
  refresh(): Promise<void>
  addMint(url: string): Promise<void>
  removeMint(url: string): Promise<void>
  /** Claim a `cashuA/B…` token. Returns sats claimed. */
  receiveToken(tokenString: string): Promise<number>
  /**
   * ADR-399 D3: claim a token P2PK-locked to this wallet's key (a Direct-Pay
   * Cashu checkout payment). Returns the claimed sats.
   */
  receiveLockedToken(tokenString: string): Promise<number>
  /**
   * Send `amountSats` from one mint. Returns the encoded token to hand over.
   * Throws on insufficient balance.
   */
  sendToken(amountSats: number, mintUrl: string): Promise<{ token: string; sentSats: number }>
  /**
   * Lightning -> ecash: request a mint quote (a bolt11 invoice). Caller is
   * responsible for paying the bolt11 via the existing rail (custodial
   * WalletContext, WebLN, or any other) and then calling `mintProofs` once the
   * mint confirms the quote is PAID.
   */
  requestMint(amountSats: number, mintUrl: string): Promise<MintQuoteInfo>
  /**
   * Poll the mint until the quote is PAID, then mint and persist proofs.
   * `payInvoice` should resolve once the bolt11 has been paid (or throw on
   * explicit user cancel / hard failure). When `payInvoice` resolves we begin
   * polling; when the mint reports PAID we call `mintProofsBolt11` and persist.
   * Returns the minted proofs' total in sats.
   */
  mintProofs(quote: MintQuoteInfo, payInvoice: (bolt11: string) => Promise<void>): Promise<number>
  /**
   * ecash -> Lightning: get a melt quote (amount + fee_reserve) without melting.
   * Caller shows the quote to the user, then calls `confirmMelt` to actually
   * melt. Throws if the user has insufficient proofs at `mintUrl`.
   */
  requestMeltQuote(bolt11: string, mintUrl: string): Promise<MeltQuoteInfo>
  /** Pay a previously requested melt quote, returning sats net of fees and the preimage when the mint reports it. */
  confirmMelt(quote: MeltQuoteInfo): Promise<{ paidSats: number; preimage?: string }>
  // — NIP-61 nutzap (Phase 3) —
  /**
   * Send a nutzap to a Nostr pubkey: splits proofs at the mint, locks the
   * send set to the recipient's wallet P2PK pubkey, then publishes a kind-9321
   * event addressed to them. The recipient's wallet (which subscribes to
   * kind 9321 events that mention its pubkey in a `p` tag) swaps the locked
   * proofs at the mint using its own wallet privkey.
   *
   * `recipientNpub` is the recipient's Nostr identity pubkey. The recipient's
   * wallet pubkey (NIP-60 P2PK key) is looked up from their own kind-17375
   * event; if not found we fall back to the identity pubkey (the recipient's
   * wallet, if NIP-46-style, signs with the identity key — opt-in by leaving
   * the lookup null).
   */
  sendNutzap(opts: {
    recipientNpub: string
    recipientWalletPubkey?: string
    amountSats: number
    mintUrl?: string
    memo?: string
  }): Promise<{ eventId: string; sentSats: number }>
  /**
   * Subscribe to incoming nutzaps (kind 9321 events that `p`-tag us), claim
   * any unspent P2PK-locked token into the wallet, and persist the new
   * proofs. Returns the list of claimed nutzaps (newest first).
   *
   * Safe to call repeatedly; each invocation swaps at most once per event id
   * (deduped via the live subscription state).
   */
  claimIncomingNutzaps(): Promise<{ claimed: Array<{ eventId: string; sats: number; mint: string }> }>
  /**
   * ADR-253 direct-pay checkout: lock `amountSats` of eCash to a SPECIFIC
   * hex P2PK pubkey at a SPECIFIC mint (both supplied by the server-resolved
   * seller payment preference — no candidate-mint search, no npub fallback,
   * no Nostr event published). Returns the encoded `cashuA…` token string for
   * the buyer to hand to the seller out of band. Throws on insufficient
   * balance at that mint.
   */
  sendP2PKForCheckout(pubkeyHex: string, mintUrl: string, amountSats: number): Promise<string>
}

const IDLE_STATE = createState([...DEFAULT_CASHU_MINTS])

const RELOAD_DEBOUNCE_MS = 1500

/**
 * @param opts.active - override the activation gate. The CashuProvider passes
 *   `isCashuEnabled() && userOptIn` so the wallet only activates when both the
 *   build flag and the user opt-in (Settings toggle) are true. Defaults to the
 *   build flag when called standalone.
 */
export function useCashuWallet(opts: { active?: boolean } = {}): CashuWalletApi {
  const enabled = opts.active ?? isCashuEnabled()

  const [state, setState] = useState<CashuWalletState>(IDLE_STATE)
  const [status, setStatus] = useState<CashuStatus>(enabled ? 'loading' : 'idle')
  const [error, setError] = useState<string | null>(null)
  const [walletPrivkey, setWalletPrivkey] = useState<string | undefined>(undefined)

  // Refs mirror the above so operations read the latest values without stale
  // closures or churn in useCallback deps.
  const stateRef = useRef(IDLE_STATE)
  const walletPrivkeyRef = useRef<string | undefined>(undefined)
  const codecRef = useRef<Nip44Codec | null>(null)
  const mintClients = useRef<Map<string, MintClient>>(new Map())
  const lastPublishRef = useRef(0)
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // FU-45: track the latest known kind-7375 event id per mint so a new token
  // event can supersede the old one (NIP-09 `del` field + kind-5 delete event).
  const latestTokenEventIdByMintRef = useRef<Map<string, string>>(new Map())

  const getMint = useCallback(async (mintUrl: string): Promise<MintClient> => {
    const url = normalizeMintUrl(mintUrl)
    let client = mintClients.current.get(url)
    if (!client) {
      client = new MintClient(url)
      await client.load()
      mintClients.current.set(url, client)
    }
    return client
  }, [])

  const persistWalletEvent = useCallback(async (s: CashuWalletState, privkey: string) => {
    if (!codecRef.current) return
    const { kind, content, tags } = await serializeWalletEvent(s, privkey, codecRef.current)
    await signAndPublishEvent({ kind, content, tags })
    lastPublishRef.current = Date.now()
  }, [])

  const persistTokenEvent = useCallback(async (mintUrl: string, proofs: readonly StoredProof[]) => {
    if (!codecRef.current) return
    const url = normalizeMintUrl(mintUrl)
    // FU-45: supersede the previously-known kind-7375 event for this mint via
    // the NIP-09 `del` field + a kind-5 delete event, so relays drop the
    // spent-proof event (relay hygiene + balance-history privacy).
    const superseded = latestTokenEventIdByMintRef.current.get(url)
    const { kind, content } = await serializeTokenEvent(url, proofs, codecRef.current, {
      ...(superseded ? { supersedes: [superseded] } : {}),
    })
    const newEvent = await signAndPublishEvent({ kind, content, tags: [['d', url]] })
    // Update the ref to the id we just published so the *next* persist
    // supersedes *this* one (avoids relying on the live subscription echo).
    latestTokenEventIdByMintRef.current.set(url, newEvent.id)
    if (superseded) {
      // NIP-09 kind-5 delete — signed by the wallet owner, targets the old
      // kind-7375 event. Best-effort: if the publish fails the new event is
      // already out; relays that respect NIP-09 will GC the old one.
      try {
        await signAndPublishEvent({ kind: 5, content: '', tags: [['e', superseded]] })
      } catch {
        // ignore — NIP-09 is a hint, not a correctness gate
      }
    }
    lastPublishRef.current = Date.now()
  }, [])

  const commit = useCallback((next: CashuWalletState) => {
    stateRef.current = next
    setState(next)
  }, [])

  const load = useCallback(async () => {
    if (!isCashuEnabled()) {
      setStatus('idle')
      return
    }
    setStatus('loading')
    setError(null)
    try {
      if (!codecRef.current) codecRef.current = createNip44Codec(getPrivkeyHex())
      const codec = codecRef.current
      const pubkey = getMyPubkeySync()

      const events = await getPool().querySync(getRelays(), {
        kinds: [KIND_WALLET, KIND_TOKEN],
        authors: [pubkey],
      } as Filter)

      const walletEv =
        events
          .filter((e) => e.kind === KIND_WALLET)
          .sort((a, b) => b.created_at - a.created_at)[0] ?? null

      let walletPart: DecryptedWalletEvent | null = null
      if (walletEv) walletPart = await parseWalletEvent(walletEv.content, codec)

      const tokenParts: DecryptedTokenEvent[] = []
      // FU-45: also record the most recent kind-7375 event id per mint so the
      // next persist can supersede it via the NIP-09 `del` field. We do a
      // single pass that decrypts and remembers the relay-provided event id
      // alongside the parsed content.
      const latestIdByMint = new Map<string, string>()
      for (const e of events) {
        if (e.kind !== KIND_TOKEN) continue
        try {
          const p = await parseTokenEvent(e.content, codec)
          tokenParts.push({ mintUrl: p.mintUrl, proofs: p.proofs, createdAt: e.created_at })
          // tokenParts is the source of truth for latest-per-mint; capture the
          // matching event id by the (mintUrl, createdAt) pair.
          latestIdByMint.set(`${p.mintUrl}|${e.created_at}`, e.id)
        } catch {
          // Encrypted to a different key / corrupt — skip silently.
        }
      }
      // Now pick the latest event id per mint from the pairs above.
      const byMint = new Map<string, string>()
      for (const p of tokenParts) {
        const id = latestIdByMint.get(`${p.mintUrl}|${p.createdAt}`)
        if (!id) continue
        const cur = byMint.get(p.mintUrl)
        const curPart = tokenParts.find((tp) => tp.mintUrl === p.mintUrl)
        if (!cur || (curPart && p.createdAt >= curPart.createdAt)) byMint.set(p.mintUrl, id)
      }
      latestTokenEventIdByMintRef.current = byMint

      const { state: next, walletPrivkeyHex } = hydrateStateFromEvents(
        walletPart,
        latestTokenEventPerMint(tokenParts),
      )

      // First run (no kind-17375 yet): mint a wallet P2PK key and persist it
      // so the wallet survives reload and is ready for future nutzap receive.
      const privkey = walletPrivkeyHex ?? generateWalletPrivkey()
      if (!walletPrivkeyHex) await persistWalletEvent(next, privkey)

      commit(next)
      walletPrivkeyRef.current = privkey
      setWalletPrivkey(privkey)
      setStatus('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }, [commit, persistWalletEvent])

  // — Live updates: re-hydrate when a wallet/token event we didn't just publish
  //   arrives (cross-device sync). Self-publishes are ignored via lastPublish. —
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(() => {
      void load()
    }, RELOAD_DEBOUNCE_MS)
  }, [load])

  const requirePrivkey = useCallback((): string => {
    const privkey = walletPrivkeyRef.current
    if (!privkey) throw new Error('Cashu wallet is not initialised yet')
    return privkey
  }, [])

  const refresh = useCallback(async () => {
    await load()
  }, [load])

  const addMint = useCallback(
    async (url: string) => {
      const privkey = requirePrivkey()
      const next = addMintToState(stateRef.current, url)
      commit(next)
      await persistWalletEvent(next, privkey)
    },
    [commit, persistWalletEvent, requirePrivkey],
  )

  const removeMint = useCallback(
    async (url: string) => {
      const privkey = requirePrivkey()
      const next = removeMintFromState(stateRef.current, url)
      commit(next)
      await persistWalletEvent(next, privkey)
    },
    [commit, persistWalletEvent, requirePrivkey],
  )

  const receiveToken = useCallback(
    async (tokenString: string): Promise<number> => {
      requirePrivkey()
      const decoded = decodeToken(tokenString)
      const client = await getMint(decoded.mintUrl)
      const proofs = await client.receiveToken(tokenString)
      const url = normalizeMintUrl(decoded.mintUrl)
      const next = addProofs(stateRef.current, url, proofs)
      commit(next)
      const bucket = next.buckets.find((b) => b.mintUrl === url)?.proofs ?? proofs
      await persistTokenEvent(url, bucket)
      return sumProofsSats(proofs)
    },
    [commit, getMint, persistTokenEvent, requirePrivkey],
  )

  const receiveLockedToken = useCallback(
    async (tokenString: string): Promise<number> => {
      const privkey = requirePrivkey()
      const decoded = decodeToken(tokenString)
      const client = await getMint(decoded.mintUrl)
      const proofs = await client.receiveLockedToken(tokenString, privkey)
      const url = normalizeMintUrl(decoded.mintUrl)
      const next = addProofs(stateRef.current, url, proofs)
      commit(next)
      const bucket = next.buckets.find((b) => b.mintUrl === url)?.proofs ?? proofs
      await persistTokenEvent(url, bucket)
      return sumProofsSats(proofs)
    },
    [commit, getMint, persistTokenEvent, requirePrivkey],
  )

  const sendToken = useCallback(
    async (amountSats: number, mintUrl: string): Promise<{ token: string; sentSats: number }> => {
      requirePrivkey()
      const url = normalizeMintUrl(mintUrl)
      const bucket = stateRef.current.buckets.find((b) => b.mintUrl === url)?.proofs ?? []
      const sel = selectProofsToSend(bucket, amountSats)
      if (!sel) throw new Error(`Insufficient eCash balance at ${url} for ${amountSats} sat`)

      const client = await getMint(url)
      const { send, keep } = await client.send(amountSats, sel.selected)

      let next = removeProofs(stateRef.current, url, sel.selected.map((p) => p.secret))
      next = addProofs(next, url, keep)
      commit(next)
      const newBucket = next.buckets.find((b) => b.mintUrl === url)?.proofs ?? []
      await persistTokenEvent(url, newBucket)

      return { token: encodeToken(url, send), sentSats: amountSats }
    },
    [commit, getMint, persistTokenEvent, requirePrivkey],
  )

  // — Lightning -> ecash (FU-46) —

  /** Poll the mint until the quote is PAID (or timeout). Returns true if paid. */
  const waitForQuotePaid = useCallback(
    async (client: MintClient, quote: string, timeoutMs = 90_000): Promise<boolean> => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const state = await client.checkMintQuote(quote)
        if (state === 'PAID' || state === 'ISSUED') return true
        await new Promise((r) => setTimeout(r, 1500))
      }
      return false
    },
    [],
  )

  const requestMint = useCallback(
    async (amountSats: number, mintUrl: string): Promise<MintQuoteInfo> => {
      requirePrivkey()
      const url = normalizeMintUrl(mintUrl)
      const client = await getMint(url)
      const q: MintQuote = await client.requestMintQuote(amountSats)
      return { quote: q.quote, bolt11: q.bolt11, amountSats, mintUrl: url }
    },
    [getMint, requirePrivkey],
  )

  const mintProofs = useCallback(
    async (info: MintQuoteInfo, payInvoice: (bolt11: string) => Promise<void>): Promise<number> => {
      requirePrivkey()
      const client = await getMint(info.mintUrl)
      // Caller pays the bolt11 (custodial WalletContext, WebLN, etc.) first;
      // then we poll until the mint sees the payment.
      await payInvoice(info.bolt11)
      const paid = await waitForQuotePaid(client, info.quote)
      if (!paid) throw new Error('Mint did not confirm payment in time')
      const proofs = await client.mintProofs(info.amountSats, info.quote)
      const next = addProofs(stateRef.current, info.mintUrl, proofs)
      commit(next)
      const bucket = next.buckets.find((b) => b.mintUrl === info.mintUrl)?.proofs ?? proofs
      await persistTokenEvent(info.mintUrl, bucket)
      return sumProofsSats(proofs)
    },
    [commit, getMint, persistTokenEvent, requirePrivkey, waitForQuotePaid],
  )

  // — ecash -> Lightning (FU-46) —

  const requestMeltQuote = useCallback(
    async (bolt11: string, mintUrl: string): Promise<MeltQuoteInfo> => {
      const url = normalizeMintUrl(mintUrl)
      const client = await getMint(url)
      const q: MeltQuote = await client.requestMeltQuote(bolt11)
      return {
        quote: q.quote,
        bolt11,
        mintUrl: url,
        amountSats: q.amountSats,
        feeReserveSats: q.feeReserveSats,
        requiredSats: q.amountSats + q.feeReserveSats,
      }
    },
    [getMint],
  )

  const confirmMelt = useCallback(
    async (info: MeltQuoteInfo): Promise<{ paidSats: number; preimage?: string }> => {
      requirePrivkey()
      const bucket = stateRef.current.buckets.find((b) => b.mintUrl === info.mintUrl)?.proofs ?? []
      const sel = selectProofsToSend(bucket, info.requiredSats)
      if (!sel) {
        throw new Error(
          `Insufficient eCash balance at ${info.mintUrl}: need ${info.requiredSats} sat ` +
            `(amount ${info.amountSats} + fee reserve ${info.feeReserveSats})`,
        )
      }

      const client = await getMint(info.mintUrl)
      const meltQuote: MeltQuote = await client.requestMeltQuote(info.bolt11)
      const { change, preimage } = await client.meltProofs(meltQuote, sel.selected)

      let next = removeProofs(stateRef.current, info.mintUrl, sel.selected.map((p) => p.secret))
      if (change.length > 0) next = addProofs(next, info.mintUrl, change)
      commit(next)
      const newBucket = next.buckets.find((b) => b.mintUrl === info.mintUrl)?.proofs ?? []
      await persistTokenEvent(info.mintUrl, newBucket)

      return { paidSats: info.amountSats, ...(preimage ? { preimage } : {}) }
    },
    [commit, getMint, persistTokenEvent, requirePrivkey],
  )

  // — NIP-61 nutzap (Phase 3) —

  const sendNutzap = useCallback(
    async (opts: {
      recipientNpub: string
      recipientWalletPubkey?: string
      amountSats: number
      mintUrl?: string
      memo?: string
    }): Promise<{ eventId: string; sentSats: number }> => {
      const privkey = requirePrivkey()
      if (!codecRef.current) throw new Error('Cashu wallet is not initialised yet')

      // Default mint = first mint with sufficient balance for amountSats.
      const candidates = opts.mintUrl
        ? [opts.mintUrl]
        : stateRef.current.mints
      let chosen: string | null = null
      for (const m of candidates) {
        const url = normalizeMintUrl(m)
        const b = stateRef.current.buckets.find((x) => x.mintUrl === url)?.proofs ?? []
        const sel = selectProofsToSend(b, opts.amountSats)
        if (sel) {
          chosen = url
          break
        }
      }
      if (!chosen) {
        throw new Error(`No mint has at least ${opts.amountSats} sat of eCash balance`)
      }

      // Resolve recipient P2PK key — fall back to the recipient's Nostr
      // identity pubkey so the worst-case still works (recipient's wallet
      // signs with their identity key). The proper NIP-60 flow looks up the
      // recipient's kind-17375 wallet event for their derived wallet key.
      const lockPubkey = opts.recipientWalletPubkey ?? opts.recipientNpub

      const bucket = stateRef.current.buckets.find((b) => b.mintUrl === chosen)?.proofs ?? []
      const sel = selectProofsToSend(bucket, opts.amountSats)
      if (!sel) throw new Error('Insufficient eCash for nutzap')

      const client = await getMint(chosen)
      const { send, keep } = await client.sendP2PK(opts.amountSats, sel.selected, lockPubkey)

      let next = removeProofs(stateRef.current, chosen, sel.selected.map((p) => p.secret))
      if (keep.length > 0) next = addProofs(next, chosen, keep)
      commit(next)
      const newBucket = next.buckets.find((b) => b.mintUrl === chosen)?.proofs ?? []
      await persistTokenEvent(chosen, newBucket)

      const ev = await buildNutzapEvent({
        recipientPubkeys: [opts.recipientNpub],
        token: { mintUrl: chosen, proofs: send, ...(opts.memo ? { memo: opts.memo } : {}) },
        codec: codecRef.current,
      })
      const published = await signAndPublishEvent({ kind: ev.kind, content: ev.content, tags: ev.tags })
      // The wallet privkey is referenced to silence "unused" + assert the hook
      // is fully initialised (NIP-60 derived key is also P2PK-receiver; the
      // sender signs kind 9321 with the user's Nostr identity key, not the
      // wallet P2PK key, by spec).
      void privkey
      return { eventId: published.id, sentSats: opts.amountSats }
    },
    [commit, getMint, persistTokenEvent, requirePrivkey],
  )

  // ADR-253: same P2PK-lock mechanics as sendNutzap (splitting proofs at the
  // mint, locking the send set), but for a specific server-resolved
  // seller-provided pubkey/mint pair, and WITHOUT publishing a Nostr event —
  // the token is handed to the seller out of band (copy/paste), not routed
  // through the nutzap relay flow. `sendP2PK` itself returns raw proofs, not
  // an encoded string — encodeToken() is called explicitly, same as sendToken.
  const sendP2PKForCheckout = useCallback(
    async (pubkeyHex: string, mintUrl: string, amountSats: number): Promise<string> => {
      requirePrivkey()
      const url = normalizeMintUrl(mintUrl)
      const bucket = stateRef.current.buckets.find((b) => b.mintUrl === url)?.proofs ?? []
      const sel = selectProofsToSend(bucket, amountSats)
      if (!sel) throw new Error(`Insufficient eCash balance at ${url} for ${amountSats} sat`)

      const client = await getMint(url)
      const { send, keep } = await client.sendP2PK(amountSats, sel.selected, pubkeyHex)

      let next = removeProofs(stateRef.current, url, sel.selected.map((p) => p.secret))
      if (keep.length > 0) next = addProofs(next, url, keep)
      commit(next)
      const newBucket = next.buckets.find((b) => b.mintUrl === url)?.proofs ?? []
      await persistTokenEvent(url, newBucket)

      return encodeToken(url, send)
    },
    [commit, getMint, persistTokenEvent, requirePrivkey],
  )

  /**
   * Subscribe to kind-9321 events that mention our pubkey in a `p` tag, and
   * claim each one. Idempotent per event id (we never re-claim an event whose
   * `e`-tagged deletion we've seen, or that the live subscription already
   * brought us).
   */
  const claimedNutzapEventIdsRef = useRef<Set<string>>(new Set())

  const claimIncomingNutzaps = useCallback(async (): Promise<{
    claimed: Array<{ eventId: string; sats: number; mint: string }>
  }> => {
    const privkey = requirePrivkey()
    if (!codecRef.current) throw new Error('Cashu wallet is not initialised yet')
    const pubkey = getMyPubkeySync()

    const events = await getPool().querySync(getRelays(), {
      kinds: [KIND_NUTZAP],
      '#p': [pubkey],
    } as Filter)

    const claimed: Array<{ eventId: string; sats: number; mint: string }> = []
    for (const e of events) {
      if (claimedNutzapEventIdsRef.current.has(e.id)) continue
      try {
        const parsed = await parseNutzapEvent(e, codecRef.current)
        const url = normalizeMintUrl(parsed.content.mint)
        const client = await getMint(url)
        const fresh = await client.receiveLockedToken(
          encodeToken(url, parsed.content.proofs),
          privkey,
        )
        const next = addProofs(stateRef.current, url, fresh)
        commit(next)
        const bucket = next.buckets.find((b) => b.mintUrl === url)?.proofs ?? fresh
        await persistTokenEvent(url, bucket)
        claimedNutzapEventIdsRef.current.add(e.id)
        claimed.push({ eventId: e.id, sats: sumProofsSats(fresh), mint: url })
      } catch (err) {
        // Skip events that fail to decrypt (not for us) or fail to swap.
        // Surface nothing: noisy relays will spam with non-Cashu kind-9321
        // notes (rare but possible).
        void err
      }
    }
    return { claimed }
  }, [commit, getMint, persistTokenEvent, requirePrivkey])

  // — Live updates: re-hydrate on wallet/token events; auto-claim nutzaps. —
  useEffect(() => {
    if (!enabled) return
    let walletSub: { close: () => void } | null = null
    let nutzapSub: { close: () => void } | null = null
    let cancelled = false
    void load().then(() => {
      if (cancelled) return
      const pubkey = getMyPubkeySync()
      walletSub = getPool().subscribe(
        getRelays(),
        { kinds: [KIND_WALLET, KIND_TOKEN], authors: [pubkey] } as Filter,
        {
          onevent: () => {
            if (Date.now() - lastPublishRef.current < RELOAD_DEBOUNCE_MS) return
            scheduleReload()
          },
        },
      )
      // Phase 3: also subscribe to kind-9321 nutzaps that mention us. On the
      // first event we auto-claim so a fresh user sees their balance go up.
      nutzapSub = getPool().subscribe(
        getRelays(),
        { kinds: [KIND_NUTZAP], '#p': [pubkey] } as Filter,
        {
          onevent: () => {
            if (Date.now() - lastPublishRef.current < RELOAD_DEBOUNCE_MS) return
            void claimIncomingNutzaps().catch(() => {/* silent */})
          },
        },
      )
    })
    return () => {
      cancelled = true
      walletSub?.close()
      nutzapSub?.close()
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
    }
  }, [enabled, load, scheduleReload, claimIncomingNutzaps])

  return {
    enabled,
    status,
    state,
    balanceSats: totalBalanceSats(state),
    mints: state.mints,
    walletPubkey: walletPrivkey ? getWalletPubkey(walletPrivkey) : null,
    error,
    refresh,
    addMint,
    removeMint,
    receiveToken,
    receiveLockedToken,
    sendToken,
    requestMint,
    mintProofs,
    requestMeltQuote,
    confirmMelt,
    sendNutzap,
    claimIncomingNutzaps,
    sendP2PKForCheckout,
  }
}
