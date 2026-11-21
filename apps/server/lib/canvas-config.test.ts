// ADR-342 D1/D2: unit tests for the canvas config validation + publish gate.
import { describe, expect, it } from 'vitest'
import {
  canvasPublishGate,
  computeHostedCanvasFeeSats,
  DEFAULT_CANVAS_HOSTED_FEE_BPS,
  normalizeInstanceUrl,
  parseCanvasConfig,
  readCanvasConfig,
  resolveCanvasHostedFeeBps,
} from './canvas-config.js'

describe('parseCanvasConfig', () => {
  it('accepts absent/null canvas as no canvas', () => {
    expect(parseCanvasConfig(undefined)).toEqual({ value: null })
    expect(parseCanvasConfig(null)).toEqual({ value: null })
  })

  it("treats provider 'none' as no canvas (D1 backward compat)", () => {
    expect(parseCanvasConfig({ provider: 'none' })).toEqual({ value: null })
  })

  it('rejects non-object canvas and unknown providers', () => {
    expect(parseCanvasConfig('doop-local')).toHaveProperty('error')
    expect(parseCanvasConfig(['doop-local'])).toHaveProperty('error')
    expect(parseCanvasConfig({ provider: 'miro' })).toHaveProperty('error')
  })

  it('requires instanceUrl for doop-local and normalizes it', () => {
    expect(parseCanvasConfig({ provider: 'doop-local' })).toHaveProperty('error')
    const parsed = parseCanvasConfig({ provider: 'doop-local', instanceUrl: 'https://doop.example.com/' })
    expect(parsed).toEqual({ value: { provider: 'doop-local', instanceUrl: 'https://doop.example.com' } })
  })

  it('allows localhost/LAN instance URLs (D1)', () => {
    const parsed = parseCanvasConfig({ provider: 'doop-local', instanceUrl: 'http://192.168.1.10:4300' })
    expect('value' in parsed && parsed.value?.instanceUrl).toBe('http://192.168.1.10:4300')
  })

  it('rejects non-http(s) URLs', () => {
    expect(parseCanvasConfig({ provider: 'doop-local', instanceUrl: 'ftp://doop.example.com' })).toHaveProperty('error')
    expect(parseCanvasConfig({ provider: 'doop-local', instanceUrl: 'not a url' })).toHaveProperty('error')
  })

  it('rejects instanceUrl for doop-hosted (instance is implied)', () => {
    expect(parseCanvasConfig({ provider: 'doop-hosted', instanceUrl: 'https://x.example.com' })).toHaveProperty('error')
    expect(parseCanvasConfig({ provider: 'doop-hosted' })).toEqual({ value: { provider: 'doop-hosted' } })
  })

  it('accepts an optional canvasId for both doop modes (owner decision Q1)', () => {
    const local = parseCanvasConfig({ provider: 'doop-local', instanceUrl: 'https://d.example.com', canvasId: 'abc123' })
    expect('value' in local && local.value?.canvasId).toBe('abc123')
    const hosted = parseCanvasConfig({ provider: 'doop-hosted', canvasId: 'abc123' })
    expect('value' in hosted && hosted.value?.canvasId).toBe('abc123')
  })

  it('validates buyerAccess (D4a)', () => {
    expect(parseCanvasConfig({ provider: 'doop-hosted', buyerAccess: 'view' })).toHaveProperty('error')
    const parsed = parseCanvasConfig({ provider: 'doop-hosted', buyerAccess: 'none' })
    expect('value' in parsed && parsed.value?.buyerAccess).toBe('none')
  })

  it('strips server-managed probeStatus/probeAt from client input (gate-bypass guard)', () => {
    const parsed = parseCanvasConfig({
      provider: 'doop-local', instanceUrl: 'https://d.example.com', probeStatus: 'ok', probeAt: '2026-01-01',
    })
    expect('value' in parsed && parsed.value && !('probeStatus' in parsed.value)).toBe(true)
    expect('value' in parsed && parsed.value && !('probeAt' in parsed.value)).toBe(true)
  })

  it('accepts agentInCanvas opt-in for doop-hosted (ADR-370 D6)', () => {
    const parsed = parseCanvasConfig({ provider: 'doop-hosted', agentInCanvas: true })
    expect('value' in parsed && parsed.value?.agentInCanvas).toBe(true)
    const off = parseCanvasConfig({ provider: 'doop-hosted', agentInCanvas: false })
    expect('value' in off && off.value?.agentInCanvas).toBe(false)
  })

  it('persists agentInCanvas=false for an edit round trip that turns it off', () => {
    const parsed = parseCanvasConfig({ provider: 'doop-hosted', agentInCanvas: false })
    expect('value' in parsed && parsed.value && 'agentInCanvas' in parsed.value).toBe(true)
  })

  it('rejects non-boolean agentInCanvas', () => {
    for (const bad of ['yes', 1, 'true']) {
      expect(parseCanvasConfig({ provider: 'doop-hosted', agentInCanvas: bad })).toHaveProperty('error')
    }
  })

  it('rejects agentInCanvas=true for doop-local (runner bridge is hosted-only)', () => {
    expect(parseCanvasConfig({ provider: 'doop-local', instanceUrl: 'https://d.example.com', agentInCanvas: true })).toHaveProperty('error')
  })

  it('does not leak agentInCanvas into no-canvas/non-hosted configs', () => {
    expect(parseCanvasConfig({ provider: 'none', agentInCanvas: true })).toEqual({ value: null })
    const local = parseCanvasConfig({ provider: 'doop-local', instanceUrl: 'https://d.example.com', agentInCanvas: false })
    expect('value' in local && local.value && !('agentInCanvas' in local.value)).toBe(true)
  })
})

describe('normalizeInstanceUrl', () => {
  it('strips trailing slashes and keeps the origin+path', () => {
    expect(normalizeInstanceUrl('https://doop.example.com/')).toBe('https://doop.example.com')
    expect(normalizeInstanceUrl('https://doop.example.com/base/')).toBe('https://doop.example.com/base')
  })
  it('rejects empty, overlong, and non-http input', () => {
    expect(normalizeInstanceUrl('')).toBeNull()
    expect(normalizeInstanceUrl('   ')).toBeNull()
    expect(normalizeInstanceUrl(`https://${'a'.repeat(600)}.com`)).toBeNull()
    expect(normalizeInstanceUrl('file:///etc/passwd')).toBeNull()
  })
})

describe('readCanvasConfig', () => {
  it('returns null for absent/none/invalid', () => {
    expect(readCanvasConfig(null)).toBeNull()
    expect(readCanvasConfig({})).toBeNull()
    expect(readCanvasConfig({ canvas: { provider: 'none' } })).toBeNull()
    expect(readCanvasConfig({ canvas: { provider: 'bogus' } })).toBeNull()
  })
  it('reads a stored config incl. server-managed probe fields', () => {
    const canvas = readCanvasConfig({ canvas: { provider: 'doop-local', instanceUrl: 'https://d.example.com', probeStatus: 'ok' } })
    expect(canvas?.provider).toBe('doop-local')
    expect(canvas?.probeStatus).toBe('ok')
  })

  it('attaches the server-derived hostedFeeBps for doop-hosted (ADR-372 D2)', () => {
    const canvas = readCanvasConfig({ canvas: { provider: 'doop-hosted' } })
    expect(canvas?.provider).toBe('doop-hosted')
    expect(canvas?.hostedFeeBps).toBe(DEFAULT_CANVAS_HOSTED_FEE_BPS)
  })

  it('does not attach hostedFeeBps for doop-local/none (fee is hosted-only, D6)', () => {
    const local = readCanvasConfig({ canvas: { provider: 'doop-local', instanceUrl: 'https://d.example.com' } })
    expect(local && 'hostedFeeBps' in local).toBe(false)
    expect(readCanvasConfig({ canvas: { provider: 'none' } })).toBeNull()
  })
})

describe('resolveCanvasHostedFeeBps (ADR-372 D2)', () => {
  it('defaults to 500 bps (5 %) when unset/blank', () => {
    expect(resolveCanvasHostedFeeBps({})).toBe(500)
    expect(resolveCanvasHostedFeeBps({ CANVAS_HOSTED_FEE_BPS: '' })).toBe(500)
    expect(resolveCanvasHostedFeeBps({ CANVAS_HOSTED_FEE_BPS: '   ' })).toBe(500)
  })

  it('rejects non-numeric/garbage and falls back to the default', () => {
    expect(resolveCanvasHostedFeeBps({ CANVAS_HOSTED_FEE_BPS: 'five' })).toBe(500)
    expect(resolveCanvasHostedFeeBps({ CANVAS_HOSTED_FEE_BPS: '5%' })).toBe(500)
    expect(resolveCanvasHostedFeeBps({ CANVAS_HOSTED_FEE_BPS: '-10' })).toBe(500)
    expect(resolveCanvasHostedFeeBps({ CANVAS_HOSTED_FEE_BPS: '1.5' })).toBe(500)
  })

  it('reads a positive integer override', () => {
    expect(resolveCanvasHostedFeeBps({ CANVAS_HOSTED_FEE_BPS: '250' })).toBe(250)
    expect(resolveCanvasHostedFeeBps({ CANVAS_HOSTED_FEE_BPS: '0' })).toBe(0)
  })
})

describe('computeHostedCanvasFeeSats (ADR-372 D1 revised 2026-09-21 — flat)', () => {
  it('returns the flat PLATFORM_MIN_PAYMENT_SATS regardless of sale size', () => {
    expect(computeHostedCanvasFeeSats()).toBe(2600)
  })
})

describe('canvasPublishGate (D2)', () => {
  it('passes when no canvas is configured', () => {
    expect(canvasPublishGate(null)).toBeNull()
    expect(canvasPublishGate({ capabilities: ['x'] })).toBeNull()
    expect(canvasPublishGate({ canvas: { provider: 'none' } })).toBeNull()
  })

  it('blocks doop-local until the probe reports ok (400 CANVAS_UNREACHABLE)', () => {
    const meta = { canvas: { provider: 'doop-local', instanceUrl: 'https://d.example.com' } }
    expect(canvasPublishGate(meta)?.code).toBe('CANVAS_UNREACHABLE')
    expect(canvasPublishGate({ canvas: { ...meta.canvas, probeStatus: 'unchecked' } })?.code).toBe('CANVAS_UNREACHABLE')
    expect(canvasPublishGate({ canvas: { ...meta.canvas, probeStatus: 'unreachable' } })?.code).toBe('CANVAS_UNREACHABLE')
    expect(canvasPublishGate({ canvas: { ...meta.canvas, probeStatus: 'ok' } })).toBeNull()
  })

  it('blocks doop-hosted until the hosted bridge is configured (400 CANVAS_HOSTED_UNAVAILABLE), passes once configured', () => {
    const meta = { canvas: { provider: 'doop-hosted' } }
    const savedUrl = process.env.DOOP_SERVICE_URL
    const savedToken = process.env.DOOP_SERVICE_TOKEN
    try {
      delete process.env.DOOP_SERVICE_URL
      delete process.env.DOOP_SERVICE_TOKEN
      expect(canvasPublishGate(meta)?.code).toBe('CANVAS_HOSTED_UNAVAILABLE')

      process.env.DOOP_SERVICE_URL = 'https://canvas.internal'
      process.env.DOOP_SERVICE_TOKEN = 'test-token'
      expect(canvasPublishGate(meta)).toBeNull()
    } finally {
      if (savedUrl === undefined) delete process.env.DOOP_SERVICE_URL
      else process.env.DOOP_SERVICE_URL = savedUrl
      if (savedToken === undefined) delete process.env.DOOP_SERVICE_TOKEN
      else process.env.DOOP_SERVICE_TOKEN = savedToken
    }
  })
})
