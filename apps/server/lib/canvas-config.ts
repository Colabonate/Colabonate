/**
 * ADR-342 D1/D2: collaboration-canvas config inside the cleartext
 * `Offer.agentConfigMeta` (the searchable, unsealed half of an AGENT_SETUP
 * config — ADR-305/306). `canvas` is a declarative property of the offer:
 *
 * ```jsonc
 * {
 *   "canvas": {
 *     "provider": "none" | "doop-local" | "doop-hosted",
 *     "instanceUrl": "https://doop.example.com",   // doop-local only
 *     "canvasId": "…",                              // optional pre-existing canvas
 *     "buyerAccess": "edit" | "none",               // doop-hosted only (D4a)
 *     "agentInCanvas": true,                        // doop-hosted only (ADR-370 D6), opt-in
 *     // server-managed, never client-writable:
 *     "probeStatus": "ok" | "unreachable" | "unchecked",
 *     "probeAt": "2026-08-25T…"
 *   }
 * }
 * ```
 *
 * `probeStatus`/`probeAt` are written exclusively by the canvas probe worker
 * (services/canvas-probe.ts). Client-supplied values are stripped on parse so
 * the publish gate (D2) cannot be bypassed by forging `probeStatus: 'ok'`.
 */

import { PLATFORM_MIN_PAYMENT_SATS } from './platformPaymentLimits.js'

export const CANVAS_PROVIDERS = ['none', 'doop-local', 'doop-hosted'] as const
export type CanvasProvider = (typeof CANVAS_PROVIDERS)[number]

export type CanvasProbeStatus = 'ok' | 'unreachable' | 'unchecked'

export interface CanvasConfig {
  provider: CanvasProvider
  /** doop-local only — any reachable host allowed, incl. localhost/LAN (D1). */
  instanceUrl?: string
  /** Optional pre-existing canvas to link (both doop modes, owner decision Q1). */
  canvasId?: string
  /** doop-hosted only (D4a); default 'edit'. */
  buyerAccess?: 'edit' | 'none'
  /**
   * ADR-370 D6 (Phase 2): doop-hosted only, opt-in, default off. Declares that
   * the seller's configured agent (the AgentProfile behind the setup) also
   * works on the ticket canvas — buyer-facing disclosure + filter facet.
   * Client-supplied; validated below (only meaningful for doop-hosted).
   */
  agentInCanvas?: boolean
  /**
   * ADR-372 D2: server-derived hosted-canvas fee rate in basis points
   * (CANVAS_HOSTED_FEE_BPS, default 500 = 5 %). Populated by readCanvasConfig
   * for doop-hosted only — never client-writable (parse strips it like
   * probeStatus). doop-local / agentInCanvas carry no fee (D6).
   */
  hostedFeeBps?: number
  /** Server-managed probe cache (D2) — stripped from client input. */
  probeStatus?: CanvasProbeStatus
  probeAt?: string
}

// ADR-372 D2: default hosted-canvas service-fee rate — 5 % of the ticket
// priceSats (owner decision 2, 2026-09-07). Env-configurable via
// CANVAS_HOSTED_FEE_BPS (read server-side; forwarded through the compose
// `environment:` allowlist, D7.5). Same fail-safe default semantics as
// LAUNCH_MAX_TX_SATS: unset/blank/garbage → default, never "no fee".
export const DEFAULT_CANVAS_HOSTED_FEE_BPS = 500

export function resolveCanvasHostedFeeBps(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CANVAS_HOSTED_FEE_BPS
  if (raw === undefined || raw.trim() === '') return DEFAULT_CANVAS_HOSTED_FEE_BPS
  if (!/^\d+$/.test(raw.trim())) return DEFAULT_CANVAS_HOSTED_FEE_BPS
  const parsed = Number(raw.trim())
  if (!Number.isSafeInteger(parsed) || parsed < 0) return DEFAULT_CANVAS_HOSTED_FEE_BPS
  return parsed
}

// ADR-372 D1 revised 2026-09-21: the hosted-canvas service fee is now a FLAT
// PLATFORM_MIN_PAYMENT_SATS (owner decision, superseding the previous 5 % rate
// and the CANVAS_HOSTED_FEE_BPS env seam). A flat fee removes the percentage
// interaction with the hub's inbound-liquidity minimum — no sale size can ever
// produce a sub-floor fee.
export function computeHostedCanvasFeeSats(): number {
  return PLATFORM_MIN_PAYMENT_SATS
}

const MAX_INSTANCE_URL_LENGTH = 500
const MAX_CANVAS_ID_LENGTH = 200

/**
 * ADR-342 D3 (Phase B): the hosted-canvas bridge is available only when the
 * server-to-server connection to the Colabonate doop instance is configured
 * (fork-side service route, docs/adr342/doop-fork/README.md). Until then the
 * publish gate keeps doop-hosted offers in DRAFT (CANVAS_HOSTED_UNAVAILABLE).
 */
export function isCanvasHostedConfigured(): boolean {
  return Boolean(process.env.DOOP_SERVICE_URL && process.env.DOOP_SERVICE_TOKEN)
}

/** Normalize an instance URL: trims, enforces http(s), strips trailing slashes. */
export function normalizeInstanceUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > MAX_INSTANCE_URL_LENGTH) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url.toString().replace(/\/+$/, '')
}

/**
 * Validate the `canvas` sub-object of client-supplied agentConfigMeta.
 * Returns the sanitized config (server-managed keys stripped) or null when
 * the canvas key is absent / provider is 'none' (stored as no canvas at all —
 * `none` and the absent field are equivalent, D1 backward compatibility).
 */
export function parseCanvasConfig(raw: unknown): { value: CanvasConfig | null } | { error: string } {
  if (raw === undefined || raw === null) return { value: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'agentConfigMeta.canvas must be an object' }
  }
  const input = raw as Record<string, unknown>

  const provider = input.provider ?? 'none'
  if (typeof provider !== 'string' || !(CANVAS_PROVIDERS as readonly string[]).includes(provider)) {
    return { error: `agentConfigMeta.canvas.provider must be one of ${CANVAS_PROVIDERS.join('|')}` }
  }
  if (provider === 'none') return { value: null }

  let instanceUrl: string | undefined
  if (input.instanceUrl !== undefined && input.instanceUrl !== null && input.instanceUrl !== '') {
    if (typeof input.instanceUrl !== 'string') {
      return { error: 'agentConfigMeta.canvas.instanceUrl must be a string' }
    }
    const normalized = normalizeInstanceUrl(input.instanceUrl)
    if (!normalized) {
      return { error: 'agentConfigMeta.canvas.instanceUrl must be a valid http(s) URL' }
    }
    instanceUrl = normalized
  }
  if (provider === 'doop-local' && !instanceUrl) {
    return { error: 'agentConfigMeta.canvas.instanceUrl is required for provider doop-local' }
  }
  if (provider === 'doop-hosted' && instanceUrl) {
    return { error: 'agentConfigMeta.canvas.instanceUrl is not applicable to provider doop-hosted (the Colabonate-hosted instance is implied)' }
  }

  let canvasId: string | undefined
  if (input.canvasId !== undefined && input.canvasId !== null && input.canvasId !== '') {
    if (typeof input.canvasId !== 'string' || input.canvasId.length > MAX_CANVAS_ID_LENGTH) {
      return { error: 'agentConfigMeta.canvas.canvasId must be a string of at most 200 characters' }
    }
    canvasId = input.canvasId
  }

  let buyerAccess: 'edit' | 'none' | undefined
  if (input.buyerAccess !== undefined && input.buyerAccess !== null) {
    if (input.buyerAccess !== 'edit' && input.buyerAccess !== 'none') {
      return { error: "agentConfigMeta.canvas.buyerAccess must be 'edit' or 'none'" }
    }
    buyerAccess = input.buyerAccess
  }

  // ADR-370 D6 (Phase 2): agent-in-canvas is a doop-hosted-only opt-in. It is
  // rejected for doop-local (the agent attaches to Colabonate-hosted canvases
  // only — a foreign instance has no runner bridge) and stripped for 'none'
  // (the early return above already handled provider 'none'). A boolean must
  // be a real boolean — no truthy coercion.
  let agentInCanvas: boolean | undefined
  if (input.agentInCanvas !== undefined && input.agentInCanvas !== null) {
    if (typeof input.agentInCanvas !== 'boolean') {
      return { error: 'agentConfigMeta.canvas.agentInCanvas must be a boolean' }
    }
    if (provider === 'doop-local' && input.agentInCanvas) {
      return { error: 'agentConfigMeta.canvas.agentInCanvas is not applicable to provider doop-local (agent-in-canvas requires the Colabonate-hosted canvas)' }
    }
    if (provider === 'doop-hosted') {
      agentInCanvas = input.agentInCanvas
    }
  }

  return {
    value: {
      provider: provider as CanvasProvider,
      ...(instanceUrl ? { instanceUrl } : {}),
      ...(canvasId ? { canvasId } : {}),
      ...(buyerAccess ? { buyerAccess } : {}),
      // Persist the flag whenever it is set (true or false) so an edit round
      // trip that turns it off actually clears it (false must be storable).
      ...(provider === 'doop-hosted' && agentInCanvas !== undefined ? { agentInCanvas } : {}),
    },
  }
}

/** Read the canvas config out of a stored agentConfigMeta blob (tolerant — DB content is already validated). */
export function readCanvasConfig(meta: unknown): CanvasConfig | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  const canvas = (meta as Record<string, unknown>).canvas
  if (!canvas || typeof canvas !== 'object' || Array.isArray(canvas)) return null
  const c = canvas as Record<string, unknown>
  if (typeof c.provider !== 'string' || c.provider === 'none') return null
  if (!(CANVAS_PROVIDERS as readonly string[]).includes(c.provider)) return null
  const config = c as unknown as CanvasConfig
  // ADR-372 D2: attach the server-derived fee rate for display — doop-hosted
  // only, derived from env, never read from the stored client-written blob.
  if (config.provider === 'doop-hosted') {
    return { ...config, hostedFeeBps: resolveCanvasHostedFeeBps() }
  }
  return config
}

/**
 * D2 publish gate: publishing (status ACTIVE) with a configured canvas
 * requires a successful probe. Draft saves are never gated. Returns the
 * structured error (PAYMENTS.md contract: branch on `code`) or null.
 *
 * - `doop-local` requires probeStatus 'ok' → 400 CANVAS_UNREACHABLE.
 * - `doop-hosted` requires DOOP_SERVICE_URL + DOOP_SERVICE_TOKEN to be set
 *   on the server (Phase B). Without them → 400 CANVAS_HOSTED_UNAVAILABLE.
 */
export function canvasPublishGate(meta: unknown): { code: string; error: string } | null {
  const canvas = readCanvasConfig(meta)
  if (!canvas) return null
  if (canvas.provider === 'doop-local') {
    if (canvas.probeStatus !== 'ok') {
      return {
        code: 'CANVAS_UNREACHABLE',
        error: 'The configured canvas instance could not be reached. Check the instance URL, wait for the health probe, and try again.',
      }
    }
    return null
  }
  // doop-hosted
  if (isCanvasHostedConfigured()) return null
  return {
    code: 'CANVAS_HOSTED_UNAVAILABLE',
    error: 'The Colabonate-hosted canvas is not available yet. Save as draft — publishing will be enabled when the hosted canvas launches.',
  }
}
