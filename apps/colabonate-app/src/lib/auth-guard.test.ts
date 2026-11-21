import { describe, it, expect, beforeEach, vi } from 'vitest'
import { requireLogin, getValidatedReturnTo } from './auth-guard'

// Minimal localStorage polyfill — the unit-test runner is the `node`
// environment, so this file stands alone. ADR-303 D10 invariant: every
// login tab reads/writes the same validated returnTo semantics.
let store = new Map<string, string>()
const localStoragePolyfill = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => { store = new Map() },
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size },
}
vi.stubGlobal('localStorage', localStoragePolyfill)

function navMock() {
  return vi.fn() as unknown as Parameters<typeof requireLogin>[0]
}

describe('auth-guard (ADR-303 D10)', () => {
  beforeEach(() => {
    store = new Map()
  })

  describe('requireLogin', () => {
    it('returns true when a pubkey is set, without navigating', () => {
      store.set('pubkey', 'abc')
      const navigate = navMock()
      const ok = requireLogin(navigate as never, '/buy/cart')
      expect(ok).toBe(true)
      expect(navigate).not.toHaveBeenCalled()
    })

    it('returns false and navigates to /login with returnTo when no pubkey', () => {
      const navigate = navMock()
      const ok = requireLogin(navigate as never, '/buy/cart')
      expect(ok).toBe(false)
      expect(navigate).toHaveBeenCalledOnce()
      const [path, opts] = (navigate as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
      expect(path).toBe('/login')
      expect((opts as { state: { returnTo: string } }).state.returnTo).toBe('/buy/cart')
    })
  })

  describe('getValidatedReturnTo', () => {
    it('returns the validated state returnTo when present', () => {
      expect(getValidatedReturnTo({ returnTo: '/coop' })).toBe('/coop')
    })

    it('falls back to / when state is missing or wrong shape', () => {
      expect(getValidatedReturnTo(null)).toBe('/')
      expect(getValidatedReturnTo({})).toBe('/')
      expect(getValidatedReturnTo({ returnTo: 123 })).toBe('/')
    })

    it('rejects protocol-relative //open.example.com (open-redirect guard)', () => {
      expect(getValidatedReturnTo({ returnTo: '//evil.com' })).toBe('/')
      expect(getValidatedReturnTo({ returnTo: 'https://evil.com' })).toBe('/')
    })

    it('falls back to the ?next= query when no state returnTo is set', () => {
      expect(getValidatedReturnTo(null, '?next=%2Fbuy%2Fcart')).toBe('/buy/cart')
      expect(getValidatedReturnTo({}, '?next=%2Fcoop%2Foverview&other=1')).toBe('/coop/overview')
    })

    it('validates the query returnTo same as state', () => {
      expect(getValidatedReturnTo(null, '?next=//evil.com')).toBe('/')
      expect(getValidatedReturnTo(null, '?next=not-a-path')).toBe('/')
    })

    it('prefers state over query when both are valid', () => {
      expect(getValidatedReturnTo({ returnTo: '/from-state' }, '?next=%2Ffrom-query')).toBe('/from-state')
    })
  })
})
