import { API_URL } from './api'
import { IDENTITY_SIGNER_STORAGE_KEY } from './nostr-identity'

// Everything that ties this browser to the signed-in account. The device
// signer (`nostr_burner_key`) deliberately stays: it also carries NIP-17 chat
// and workspace access, and the email-less onboarding rotates it itself
// (ADR-401 D7.5).
const SESSION_KEYS = ['authToken', 'pubkey', 'email', 'lnAddress', 'evmAddress', 'notifications', IDENTITY_SIGNER_STORAGE_KEY]

/**
 * Sign out: revoke the session on the server (best effort — a network error
 * must not keep the user signed in locally), then clear the local session.
 * Uses plain fetch, not apiCall, so a 401 on an already-expired token does not
 * trigger apiCall's /login redirect.
 */
export async function logout(): Promise<void> {
  const token = localStorage.getItem('authToken')
  if (token) {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {
      // Offline or server down — the local session is still cleared below.
    }
  }
  for (const key of SESSION_KEYS) localStorage.removeItem(key)
  sessionStorage.removeItem('nostr_profile_synced')
}
