import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiCall, ApiError } from './api'

// FU-590: apiCall() threw an ApiError whose `.message` was the raw error
// CODE (e.g. "ALREADY_MEMBER") instead of the server's human-readable
// `message` field — every caller across the app that displayed `err.message`
// directly showed the bare code. Verifies the fix's preference order.
function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

describe('apiCall error message preference', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, removeItem: () => {} })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prefers the human-readable message over the raw error code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockResponse(409, { error: 'ALREADY_MEMBER', message: 'this pubkey is already a collaborator' }),
    ))

    await expect(apiCall('/api/x')).rejects.toMatchObject({
      message: 'this pubkey is already a collaborator',
      status: 409,
      data: { error: 'ALREADY_MEMBER', message: 'this pubkey is already a collaborator' },
    })
  })

  it('falls back to the error code when no message is present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(400, { error: 'VALIDATION_ERROR' })))

    await expect(apiCall('/api/x')).rejects.toMatchObject({ message: 'VALIDATION_ERROR', status: 400 })
  })

  it('falls back to a generic HTTP message when the body has neither field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(500, {})))

    await expect(apiCall('/api/x')).rejects.toMatchObject({ message: 'HTTP 500', status: 500 })
  })

  it('still exposes the raw code on .data.error for callers that branch on it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockResponse(409, { error: 'WORKSPACE_EXISTS', message: 'a workspace already exists for this ticket', workspace: { id: 'w1' } }),
    ))

    try {
      await apiCall('/api/workspaces', { method: 'POST' })
      expect.unreachable('apiCall should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      const err = e as ApiError
      expect(err.data.error).toBe('WORKSPACE_EXISTS')
      expect(err.data.workspace).toEqual({ id: 'w1' })
    }
  })

  it('resolves normally on a 2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers() } as Response))

    const res = await apiCall('/api/x')
    expect(res.ok).toBe(true)
  })
})
