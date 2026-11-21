import { randomBytes } from 'crypto'
import { recoverMessageAddress, isAddress } from 'viem'
import {
  buildMetamaskDerivationMessage,
  deriveNostrPubkeyFromMetamaskSignature,
} from '@col/nostr-schema'
import { isValidPubkeyHex } from './nostr-auth.js'

const CHALLENGE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface PendingChallenge {
  nonce: string
  message: string
  expiresAt: number
}

// In-memory challenge store. Sufficient for single-instance deployments;
// multi-instance deployments should move this to Redis (FU-196-D).
const pendingChallenges = new Map<string, PendingChallenge>()

function sweepExpiredChallenges() {
  const now = Date.now()
  for (const [address, challenge] of pendingChallenges) {
    if (challenge.expiresAt <= now) {
      pendingChallenges.delete(address)
    }
  }
}

function consumeChallenge(address: string, nonce: string): boolean {
  const normalized = address.toLowerCase()
  const challenge = pendingChallenges.get(normalized)
  if (!challenge) return false
  pendingChallenges.delete(normalized)
  return challenge.nonce === nonce && challenge.expiresAt > Date.now()
}

export interface MetamaskChallenge {
  nonce: string
  message: string
  expiresAt: string
  ttlSeconds: number
}

export interface MetamaskVerifyInput {
  address: string
  pubkey: string
  derivationMessage: string
  derivationSignature: string
  authMessage: string
  authSignature: string
}

export interface MetamaskVerifyResult {
  pubkey: string
  evmAddress: string
}

/**
 * Build a SIWE-style authentication message for the given address.
 */
function buildAuthMessage(address: string, nonce: string): string {
  const domain = process.env.FRONTEND_URL?.replace(/^https?:\/\//, '') || 'colabonate.local'
  const issuedAt = new Date().toISOString()
  return `${domain} wants you to sign in with your Ethereum account:\n${address}\n\nSign this message to authenticate with Colabonate. This will not cost any gas.\n\nNonce: ${nonce}\nIssued At: ${issuedAt}`
}

/**
 * Issue a new authentication challenge for an EVM address.
 */
export function issueMetamaskChallenge(address: string): MetamaskChallenge {
  if (!isAddress(address, { strict: false })) {
    throw new Error('INVALID_ADDRESS')
  }

  sweepExpiredChallenges()

  const normalized = address.toLowerCase()
  const nonce = randomBytes(16).toString('hex')
  const message = buildAuthMessage(address, nonce)
  const expiresAt = Date.now() + CHALLENGE_TTL_MS

  pendingChallenges.set(normalized, {
    nonce,
    message,
    expiresAt,
  })

  return {
    nonce,
    message,
    expiresAt: new Date(expiresAt).toISOString(),
    ttlSeconds: Math.floor(CHALLENGE_TTL_MS / 1000),
  }
}

/**
 * Verify a MetaMask login attempt.
 *
 * 1. The derivation signature must recover to the claimed address.
 * 2. The provided pubkey must match the pubkey derived from that signature.
 * 3. The auth signature must recover to the claimed address.
 * 4. The auth message nonce must match a pending, unexpired challenge.
 */
export async function verifyMetamaskLogin(input: MetamaskVerifyInput): Promise<MetamaskVerifyResult> {
  const { address, pubkey, derivationMessage, derivationSignature, authMessage, authSignature } = input

  if (!isAddress(address, { strict: false })) {
    throw new Error('INVALID_ADDRESS')
  }
  if (!isValidPubkeyHex(pubkey)) {
    throw new Error('INVALID_PUBKEY')
  }

  // 1) Derivation signature recovers to the address.
  const recoveredFromDerivation = recoverMessageAddress({
    message: derivationMessage,
    signature: derivationSignature as `0x${string}`,
  })
  if ((await recoveredFromDerivation).toLowerCase() !== address.toLowerCase()) {
    throw new Error('DERIVATION_SIGNATURE_MISMATCH')
  }

  // 2) Provided pubkey matches the deterministically derived pubkey.
  const expectedPubkey = deriveNostrPubkeyFromMetamaskSignature(derivationSignature, address)
  if (expectedPubkey.toLowerCase() !== pubkey.toLowerCase()) {
    throw new Error('PUBKEY_DERIVATION_MISMATCH')
  }

  // 3) Auth signature recovers to the address.
  const recoveredFromAuth = await recoverMessageAddress({
    message: authMessage,
    signature: authSignature as `0x${string}`,
  })
  if (recoveredFromAuth.toLowerCase() !== address.toLowerCase()) {
    throw new Error('AUTH_SIGNATURE_MISMATCH')
  }

  // 4) Auth message nonce matches a valid challenge.
  const nonceMatch = authMessage.match(/Nonce: ([a-f0-9]+)/)
  if (!nonceMatch) {
    throw new Error('AUTH_MESSAGE_MISSING_NONCE')
  }
  const nonce = nonceMatch[1]
  if (!consumeChallenge(address, nonce)) {
    throw new Error('CHALLENGE_INVALID_OR_EXPIRED')
  }

  return { pubkey, evmAddress: address.toLowerCase() }
}

export { buildMetamaskDerivationMessage }
