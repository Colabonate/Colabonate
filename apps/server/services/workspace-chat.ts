// ADR-314 minimal chat slice: request-shape validation for
// `POST /api/workspaces/:id/messages`. The server never verifies the
// schnorr signature itself — the canister's `post_message` does, per its
// `sig.rs::verify_buyer_action` (FU-434 Slice C) — this only rejects
// malformed input before spending a canister call on it.
//
// Pure — unit-tested without a replica.

export const MAX_CHAT_MESSAGE_LENGTH = 4000

export interface ChatMessageInput {
  content: string
  timestamp: bigint
  signature: Uint8Array
}

export type ChatMessageValidation =
  | { ok: true; value: ChatMessageInput }
  | { ok: false; message: string }

const HEX64_RE = /^[0-9a-f]{64}$/i
const HEX128_RE = /^[0-9a-f]{128}$/i
const DIGITS_RE = /^[0-9]+$/

// Validates the raw HTTP body for a buyer-signed chat message. `content` is
// passed through byte-for-byte (never trimmed/altered) — the canister
// re-derives the signed message from the exact string it receives, so any
// server-side mutation would break signature verification.
export function validateChatMessageInput(body: unknown): ChatMessageValidation {
  if (!body || typeof body !== 'object') {
    return { ok: false, message: 'body must be an object' }
  }
  const { content, timestamp, signature } = body as Record<string, unknown>

  if (typeof content !== 'string' || content.trim().length === 0) {
    return { ok: false, message: 'content is required' }
  }
  if (content.length > MAX_CHAT_MESSAGE_LENGTH) {
    return { ok: false, message: `content exceeds ${MAX_CHAT_MESSAGE_LENGTH} characters` }
  }
  if (typeof timestamp !== 'string' || !DIGITS_RE.test(timestamp)) {
    return { ok: false, message: 'timestamp must be a numeric string (nanoseconds)' }
  }
  let timestampBig: bigint
  try {
    timestampBig = BigInt(timestamp)
  } catch {
    return { ok: false, message: 'timestamp must be a numeric string (nanoseconds)' }
  }
  if (typeof signature !== 'string' || !HEX128_RE.test(signature)) {
    return { ok: false, message: 'signature must be a 128-char hex string (64-byte schnorr signature)' }
  }

  return {
    ok: true,
    value: { content, timestamp: timestampBig, signature: Buffer.from(signature, 'hex') },
  }
}

// Validates the optional `signerPubkey` on `POST /api/workspaces` — the
// pubkey stored as `Workspace.canisterBuyerPubkey`. Undefined is valid (the
// route falls back to the caller's login pubkey, unchanged legacy behavior).
export function validateSignerPubkey(value: unknown): { ok: true; value: string | undefined } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: undefined }
  if (typeof value !== 'string' || !HEX64_RE.test(value)) {
    return { ok: false, message: 'signerPubkey must be a 64-char hex pubkey' }
  }
  return { ok: true, value }
}
