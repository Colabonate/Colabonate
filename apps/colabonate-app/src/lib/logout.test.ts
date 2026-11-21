/**
 * logout — the Bearer session must not survive a sign-out on a shared browser
 * (ADR-401 review): server revoke + local cleanup, even when the server call fails.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { logout } from './logout'

function makeStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeStorage())
  vi.stubGlobal('sessionStorage', makeStorage())
  localStorage.setItem('authToken', 'tok')
  localStorage.setItem('pubkey', 'pk')
  localStorage.setItem('email', 'a@b.c')
  localStorage.setItem('nostr_burner_key', 'k'.repeat(64))
})

describe('logout', () => {
  it('revokes the session on the server with the current token', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await logout()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/api\/auth\/logout$/)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('clears the local session including the Bearer token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    await logout()
    expect(localStorage.getItem('authToken')).toBeNull()
    expect(localStorage.getItem('pubkey')).toBeNull()
    expect(localStorage.getItem('email')).toBeNull()
  })

  it('still clears locally when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await logout()
    expect(localStorage.getItem('authToken')).toBeNull()
  })

  it('clears the identity-signer flag (FU-893)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    localStorage.setItem('colabonate:identitySigner', 'a'.repeat(64))
    await logout()
    expect(localStorage.getItem('colabonate:identitySigner')).toBeNull()
  })

  it('keeps the device signer (chat/workspace key)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    await logout()
    expect(localStorage.getItem('nostr_burner_key')).toBe('k'.repeat(64))
  })
})
