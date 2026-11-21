// @col/cashu — non-custodial Cashu eCash wallet primitives (ADR-187).
//
// Client-side, framework-agnostic. Wraps @cashu/cashu-ts and projects Cashu
// wallet state to/from NIP-60 events. The server never imports this package —
// proofs are held client-side only (ADR-187 invariant).

// Types
export type {
  StoredProof,
  MintBucket,
  CashuWalletState,
  HistoryEntry,
  Nip44Codec,
} from './types.js'

// Proof arithmetic + selection
export { sumProofsSats, selectProofsToSend, groupByMint } from './proofs.js'

// Wallet-state reducer
export {
  normalizeMintUrl,
  createState,
  addMint,
  removeMint,
  addProofs,
  removeProofs,
  balanceByMint,
  totalBalanceSats,
} from './wallet-state.js'

// Token encode/decode
export { encodeToken, decodeToken } from './token.js'
export type { DecodedToken } from './token.js'

// NIP-60 event (de)serialisation
export {
  KIND_WALLET,
  KIND_TOKEN,
  KIND_HISTORY,
  serializeWalletEvent,
  parseWalletEvent,
  serializeTokenEvent,
  parseTokenEvent,
  serializeHistoryEvent,
  parseHistoryEvent,
} from './nip60.js'
export type { UnsignedEventTemplate } from './nip60.js'

// NIP-61 nutzap event (de)serialisation
export {
  KIND_NUTZAP,
  buildNutzapEvent,
  parseNutzapEvent,
  p2pkSecret,
} from './nip61.js'
export type { NutzapContent, UnsignedEventTemplate as Nip61UnsignedEventTemplate } from './nip61.js'

// Mint client (network)
export { MintClient } from './mint.js'
export type { MintQuote, MeltQuote } from './mint.js'
