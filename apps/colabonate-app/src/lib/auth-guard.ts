// ADR-303 D10 — action-level gating on the public read tier.
// Browsing is anonymous; mutations ask for login at the moment of intent and
// carry the originating location as `returnTo` so the login flow can send the
// user back. Client guards are UX only — server-side auth stays the boundary.

import type { NavigateFunction } from 'react-router-dom'

/**
 * Same-origin redirect targets only: must start with `/` but not `//`
 * (protocol-relative URLs would escape the origin). Mirrors the server-side
 * validation in `/api/auth/email/send`.
 */
function isValidReturnTo(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
}

/**
 * Returns true when a session exists (localStorage `pubkey`). Otherwise
 * navigates to /login with `state.returnTo` and returns false — the caller
 * must abort the mutating action.
 */
export function requireLogin(navigate: NavigateFunction, returnTo: string): boolean {
  if (localStorage.getItem('pubkey')) return true
  navigate('/login', { state: { returnTo } })
  return false
}

/**
 * Resolves the validated returnTo from router state OR the `?next=` query param
 * (the latter covers the loader-level `requireAuth` redirect and the
 * round-trip-from-mail-client email magic-link path).
 *
 * Precedence: router state takes priority when present (avoids the user being
 * redirected by a stale `next` they never asked for). Falls back to URL query,
 * then `/`.
 */
export function getValidatedReturnTo(state: unknown, search?: string): string {
  const fromState = (state as { returnTo?: unknown } | null | undefined)?.returnTo
  if (isValidReturnTo(fromState)) return fromState
  if (search) {
    const fromQuery = new URLSearchParams(search).get('next')
    if (isValidReturnTo(fromQuery)) return fromQuery
  }
  return '/'
}
