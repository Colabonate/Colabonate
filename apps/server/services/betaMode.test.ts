import { describe, it, expect, afterEach, vi } from 'vitest'
import { isBetaMode, isProductionDirectPayOnly } from './betaMode'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isProductionDirectPayOnly', () => {
  it('is false in local development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('BETA_MODE', '')
    vi.stubEnv('BETA_MODE_ALLOW_PRODUCTION', '')
    expect(isProductionDirectPayOnly()).toBe(false)
  })

  it('is true on a NODE_ENV=production host without the beta opt-in pair', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BETA_MODE', '')
    vi.stubEnv('BETA_MODE_ALLOW_PRODUCTION', '')
    expect(isBetaMode()).toBe(false)
    expect(isProductionDirectPayOnly()).toBe(true)
  })

  it('is false on the declared beta stack (production + beta opt-in)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BETA_MODE', 'true')
    vi.stubEnv('BETA_MODE_ALLOW_PRODUCTION', 'true')
    expect(isBetaMode()).toBe(true)
    expect(isProductionDirectPayOnly()).toBe(false)
  })

  it('stays true when BETA_MODE leaks without the production allow flag', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BETA_MODE', 'true')
    vi.stubEnv('BETA_MODE_ALLOW_PRODUCTION', '')
    expect(isProductionDirectPayOnly()).toBe(true)
  })
})
