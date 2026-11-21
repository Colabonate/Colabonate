/**
 * ADR-314 minimal chat slice: client-side buyer-action signing for the
 * Workspace canister's `post_message` (FU-434 Slice C).
 *
 * The canister verifies `sha256(message)` schnorr-signed against
 * `Workspace.canisterBuyerPubkey` (see `sig.rs::verify_buyer_action` in
 * packages/icp-workspace-canister). This is NOT a Nostr event signature —
 * it's a raw BIP-340 signature over a custom domain-tagged string — so a
 * NIP-07 browser extension (which only signs full Nostr events) cannot
 * produce it. We sign with the local burner key instead (`getPrivkeyBytes()`,
 * the same "chat identity" key ADR-153/NIP-17 already established as this
 * app's mechanism for keys that must be raw-signable client-side, decoupled
 * from the NIP-07/bunker-controlled login pubkey).
 *
 * This means: a workspace only supports chat if it was deployed with
 * `canisterBuyerPubkey` set to this device's burner pubkey (the default
 * whenever `useCreateOrGetWorkspace` creates it — see useWorkspaceQueries.ts).
 * A workspace created without that (e.g. via the ADR-311 smoke's own raw
 * keypair, or before this slice shipped) cannot retroactively gain chat —
 * `canisterBuyerPubkey` is baked into the deployed canister workspace.
 */

import { schnorr } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha2'
import { getPublicKey } from 'nostr-tools'
import { getPrivkeyBytes } from './nostr-identity'

const DOMAIN = 'colabonate-workspace-v1'

// Monotonic per-tab counter: the canister's replay guard requires each
// buyer action's timestamp to strictly exceed the workspace's last one.
// Date.now() alone has millisecond resolution, so two sends inside the same
// millisecond would collide — this guarantees strict increase regardless.
let lastTimestampNs = 0n

function nextTimestampNs(): bigint {
  const now = BigInt(Date.now()) * 1_000_000n
  lastTimestampNs = now > lastTimestampNs ? now : lastTimestampNs + 1n
  return lastTimestampNs
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** The pubkey this device's chat signatures will carry (hex, x-only). */
export function getWorkspaceSignerPubkey(): string {
  return getPublicKey(getPrivkeyBytes())
}

export interface SignedWorkspaceAction {
  timestamp: string // decimal nanoseconds, as required by the /messages route
  signature: string // 128-char hex (64-byte schnorr signature)
}

// Mirrors the canister's message format exactly:
// `{domain}:{action}:{canisterWorkspaceId}:{timestamp}:{param}:{param}...`
function signAction(action: string, canisterWorkspaceId: string, params: string[]): SignedWorkspaceAction {
  const timestamp = nextTimestampNs()
  const message = `${DOMAIN}:${action}:${canisterWorkspaceId}:${timestamp}${params.map(p => `:${p}`).join('')}`
  const signature = schnorr.sign(sha256(new TextEncoder().encode(message)), getPrivkeyBytes())
  return { timestamp: timestamp.toString(), signature: bytesToHex(signature) }
}

/** Signs a `post_message` chat send — ready to POST to /api/workspaces/:id/messages. */
export function signChatMessage(canisterWorkspaceId: string, content: string): SignedWorkspaceAction & { content: string } {
  return { content, ...signAction('post_message', canisterWorkspaceId, [content]) }
}
