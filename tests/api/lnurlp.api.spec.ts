import { test, expect } from '@playwright/test'
import { demoSession, DEMO_LOGIN_SKIP_REASON } from '../e2e/fixtures/roles.js'

// ADR-377 D1: contract-level smoke (no page.* interaction) — tagged @api.
// ADR-240 D1/D2: the self-serve `<handle>@<domain>` Lightning Address. Verified
// here through the REAL server over HTTP: the root-path mount, the LUD-06 error
// shape, and every settings-validation rule that guards a handle write. The
// metadata-200 / callback-200 paths need a resolvable receiving rail (external
// LUD-16 or a live NWC wallet), which the beta+mock stack has no mock for — see
// FU-759 and `scripts/adr240-lnurlp-smoke.ts` for the deployed-host check.

const SERVER_BASE_URL = process.env.PLAYWRIGHT_SERVER_URL || 'http://localhost:4001'

async function call(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  const res = await fetch(`${SERVER_BASE_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  })
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, any> }
}

test.describe('@api Self-serve Lightning Address (ADR-240)', () => {
  test('serves LUD-06 errors at the root path and validates every settings write', async () => {
    const uniq = Date.now().toString(36)
    const handle = `e2e${uniq}`.slice(0, 30)
    const unknownHandle = `nobody${uniq}`.slice(0, 30)

    await test.step('unknown handle → 404 in LUD-06 error shape (root mount, not the SPA)', async () => {
      const res = await call(`/.well-known/lnurlp/${unknownHandle}`)
      expect(res.status).toBe(404)
      expect(res.data).toEqual({ status: 'ERROR', reason: 'Lightning address not found' })
    })

    await test.step('cross-origin clients can read the endpoint (LUD-06 CORS)', async () => {
      const res = await fetch(`${SERVER_BASE_URL}/.well-known/lnurlp/${unknownHandle}`, {
        headers: { Origin: 'https://wallet.example' },
      })
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
      // helmet's same-origin default would block the cross-origin read even
      // with the wildcard origin present.
      expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
    })

    await test.step('unknown callback → 404 (no amount parsing before the lookup)', async () => {
      const res = await call(`/.well-known/lnurlp/${unknownHandle}/callback?amount=21000`)
      expect(res.status).toBe(404)
      expect(res.data.status).toBe('ERROR')
    })

    const pubkey = `e2eln${uniq}`.padEnd(64, '0').slice(0, 64)
    const user = await demoSession(pubkey)
    test.skip(!user, DEMO_LOGIN_SKIP_REASON)

    await test.step('fresh account has no handle, no mode and no NWC', async () => {
      const res = await call('/api/wallet/ln-address', { token: user!.token })
      expect(res.status).toBe(200)
      expect(res.data.handle).toBeNull()
      expect(res.data.mode).toBeNull()
      expect(res.data.address).toBeNull()
      expect(res.data.nwcConnected).toBe(false)
      expect(typeof res.data.domain).toBe('string')
      expect(res.data.domain.length).toBeGreaterThan(0)
    })

    await test.step('unauthenticated write → 401', async () => {
      const res = await call('/api/wallet/ln-address', {
        method: 'PUT',
        body: { handle, mode: 'NWC' },
      })
      expect(res.status).toBe(401)
    })

    await test.step('every invalid write is rejected with VALIDATION_ERROR', async () => {
      const cases: Array<[Record<string, unknown>, string]> = [
        [{ handle: 'ab', mode: 'NWC' }, 'handle too short'],
        [{ handle: '-alice', mode: 'NWC' }, 'invalid separator'],
        [{ handle: 'admin', mode: 'NWC' }, 'reserved handle'],
        [{ handle, mode: 'CASHU' }, 'cashu not served yet'],
        [{ handle, mode: 'EXTERNAL' }, 'no external address on profile'],
        [{ handle, mode: 'NWC' }, 'no NWC wallet connected'],
      ]
      for (const [body, label] of cases) {
        const res = await call('/api/wallet/ln-address', { method: 'PUT', body, token: user!.token })
        expect(res.status, label).toBe(400)
        expect(res.data.error, label).toBe('VALIDATION_ERROR')
      }
    })

    await test.step('a rejected write never persists a handle', async () => {
      const settings = await call('/api/wallet/ln-address', { token: user!.token })
      expect(settings.data.handle).toBeNull()
      // …and the address is therefore not served either.
      const served = await call(`/.well-known/lnurlp/${handle}`)
      expect(served.status).toBe(404)
      expect(served.data.status).toBe('ERROR')
    })
  })
})
