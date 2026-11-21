/**
 * NIP-07 Admin Authentication Helper
 *
 * Issues a challenge and signs it via NIP-07 (window.nostr) for admin endpoints.
 * Challenge is valid for 5 minutes; must be consumed within that window.
 */

import { apiCall } from './api'

export interface ChallengeResponse {
  nonce: string
  expiresAt: string
  ttlSeconds: number
}

export interface VerifyResponse {
  ok: boolean
  pubkey: string
  verifiedAt: string
}

export async function fetchAdminChallenge(expectedPubkey?: string): Promise<ChallengeResponse> {
  const response = await apiCall('/api/auth/nostr/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedPubkey }),
  })
  if (!response.ok) {
    throw new Error(`Challenge fetch failed: ${response.status}`)
  }
  return response.json()
}

export async function signAdminRequest(bodyHash: string): Promise<string> {
  const pubkey = await window.nostr.getPublicKey()
  const challengeResponse = await fetchAdminChallenge(pubkey)

  const eventBody = {
    kind: 27235,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['challenge', challengeResponse.nonce]],
    content: bodyHash,
  }

  const signed = await window.nostr.signEvent(eventBody)

  const eventJson = JSON.stringify(signed)
  const base64 = btoa(eventJson)
  return `Nostr ${base64}`
}

export async function verifyAdminChallenge(): Promise<VerifyResponse> {
  const pubkey = await window.nostr.getPublicKey()
  const challengeResponse = await fetchAdminChallenge(pubkey)

  const eventBody = {
    kind: 27235,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['challenge', challengeResponse.nonce]],
    content: '',
  }

  const signed = await window.nostr.signEvent(eventBody)

  const response = await apiCall('/api/auth/nostr/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: signed }),
  })

  if (!response.ok) {
    throw new Error(`Verification failed: ${response.status}`)
  }
  return response.json()
}

export function buildAdminHeaders(body: object): Promise<Record<string, string>> {
  const bodyString = JSON.stringify(body)
  const bodyHash = btoa(bodyString)
  return signAdminRequest(bodyHash).then(authHeader => ({
    'Content-Type': 'application/json',
    Authorization: authHeader,
  }))
}

export async function adminApiCall(
  endpoint: string,
  options: RequestInit = {},
): Promise<Response> {
  const method = options.method || 'POST'
  const body = options.body ? JSON.parse(options.body as string) : {}

  const headers = await buildAdminHeaders(body)

  return apiCall(endpoint, {
    ...options,
    method,
    headers,
  })
}