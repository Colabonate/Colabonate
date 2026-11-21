// ADR-281 D3 — per-user AI provider configuration (local / OpenAI-compatible /
// CLI adapter). The provider API key never leaves the backend: it is encrypted
// at rest (lib/ai-keybox.ts) and only handed to the mcp-server over the
// internal x-ai-internal-secret channel (`/plain` below). The browser always
// sees the masked shape (hasApiKey flag only) — FU-195-C key-material rule.
import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import { encryptKey, decryptKey, hasKeyEncryptionSecret } from '../lib/ai-keybox.js'
import { checkProviderUrlSafe } from '../lib/provider-url-safety.js'

// ADR-384 D1: 'platform' = Colabonate-hosted, paid via credit packs.
const PROVIDERS = ['local', 'openai', 'adapter', 'platform'] as const
type ProviderId = (typeof PROVIDERS)[number]

// Read lazily inside the handler: ES-module imports execute before the
// index.ts body runs dotenv.config(), so a module-level capture would always
// see an empty value in dev (tsx) and in the compiled bundle alike.
function internalSecret(): string {
  return process.env.AI_INTERNAL_SECRET ?? ''
}

function isProvider(v: unknown): v is ProviderId {
  return typeof v === 'string' && (PROVIDERS as readonly string[]).includes(v)
}

// FU-292 (scoped) — extra CLI flags for the user's selected adapter's own
// fixed binary (registry.ts). No new binary names are ever accepted here;
// this only extends an already-allowlisted invocation, so validation is
// about keeping argv entries sane, not about blocking command injection
// (shell:false + arg-array already rules that out, see ADR-281 D10).
const MAX_ADAPTER_ARGS = 8
const MAX_ADAPTER_ARG_LENGTH = 200
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x1F\x7F]/

function validateAdapterArgs(raw: unknown): { ok: true; args: string[] | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, args: null }
  if (!Array.isArray(raw)) return { ok: false, error: 'adapterArgs must be an array of strings' }
  if (raw.length > MAX_ADAPTER_ARGS) {
    return { ok: false, error: `adapterArgs supports at most ${MAX_ADAPTER_ARGS} entries` }
  }
  const args: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string' || !item) return { ok: false, error: 'adapterArgs entries must be non-empty strings' }
    if (item.length > MAX_ADAPTER_ARG_LENGTH) {
      return { ok: false, error: `adapterArgs entries must be ${MAX_ADAPTER_ARG_LENGTH} characters or fewer` }
    }
    if (CONTROL_CHAR_RE.test(item)) return { ok: false, error: 'adapterArgs entries must not contain control characters' }
    args.push(item)
  }
  return { ok: true, args: args.length > 0 ? args : null }
}

function parseAdapterArgs(stored: string | null): string[] | null {
  if (!stored) return null
  try {
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function createAiConfigRouter(prisma: PrismaClient) {
  const router = Router()

  // GET /api/ai/config — the browser's masked view of the user's config.
  router.get('/', async (req: Request, res: Response) => {
    const authPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!authPubkey) {
      res.status(401).json({ error: 'UNAUTHORIZED' })
      return
    }
    try {
      const cfg = await prisma.userAiConfig.findUnique({ where: { pubkey: authPubkey } })
      res.json({
        provider: cfg?.provider ?? 'openai',
        baseUrl: cfg?.baseUrl ?? null,
        model: cfg?.model ?? null,
        hasApiKey: Boolean(cfg?.apiKeyEncrypted),
        adapterId: cfg?.adapterId ?? null,
        runtime: cfg?.runtime ?? null,
        adapterArgs: parseAdapterArgs(cfg?.adapterArgs ?? null),
        keyEncryptionAvailable: hasKeyEncryptionSecret(),
        // Capability flags mirror what the operator configured on this stack
        // (mirrors GET /ai/config on the mcp-server for the Settings UI).
        operatorDefaults: {
          baseUrl: process.env.LLM_BASE_URL ?? process.env.OLLAMA_BASE ?? null,
          model: process.env.LLM_MODEL_OVERRIDE || null,
        },
        updatedAt: cfg?.updatedAt ?? null,
      })
    } catch (err) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: String(err) })
    }
  })

  // GET /api/ai/config/plain — internal only: lets the mcp-server decrypt the
  // user's provider key to call the LLM on the user's behalf. Guarded by a
  // shared secret that never reaches the browser bundle (ADR-281 D4).
  router.get('/plain', async (req: Request, res: Response) => {
    if (!internalSecret() || req.get('x-ai-internal-secret') !== internalSecret()) {
      res.status(403).json({ error: 'FORBIDDEN' })
      return
    }
    const authPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!authPubkey) {
      res.status(401).json({ error: 'UNAUTHORIZED' })
      return
    }
    try {
      const cfg = await prisma.userAiConfig.findUnique({ where: { pubkey: authPubkey } })
      if (!cfg) {
        res.json({ provider: 'openai', baseUrl: null, model: null, apiKey: null, adapterId: null, runtime: null, adapterArgs: null })
        return
      }
      res.json({
        provider: cfg.provider,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        apiKey: cfg.apiKeyEncrypted ? (() => { try { return decryptKey(cfg.apiKeyEncrypted) } catch { return null } })() : null,
        adapterId: cfg.adapterId,
        runtime: cfg.runtime,
        adapterArgs: parseAdapterArgs(cfg.adapterArgs),
      })
    } catch (err) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: String(err) })
    }
  })

  // PUT /api/ai/config — upsert the user's provider selection.
  router.put('/', async (req: Request, res: Response) => {
    const authPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!authPubkey) {
      res.status(401).json({ error: 'UNAUTHORIZED' })
      return
    }
    const body = req.body as {
      provider?: unknown
      baseUrl?: unknown
      model?: unknown
      apiKey?: unknown
      clearKey?: unknown
      adapterId?: unknown
      runtime?: unknown
      adapterArgs?: unknown
    }

    if (!isProvider(body.provider)) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'provider must be one of local, openai, adapter, platform' })
      return
    }
    const provider: ProviderId = body.provider

    try {
      const existing = await prisma.userAiConfig.findUnique({ where: { pubkey: authPubkey } })

      if (provider === 'adapter') {
        const adapterId = typeof body.adapterId === 'string' && body.adapterId ? body.adapterId : null
        const runtime = typeof body.runtime === 'string' && body.runtime ? body.runtime : null
        const argsCheck = validateAdapterArgs(body.adapterArgs)
        if (!argsCheck.ok) {
          res.status(400).json({ error: 'VALIDATION_ERROR', message: argsCheck.error })
          return
        }
        const adapterArgs = argsCheck.args ? JSON.stringify(argsCheck.args) : null
        await prisma.userAiConfig.upsert({
          where: { pubkey: authPubkey },
          create: { pubkey: authPubkey, provider, adapterId, runtime, adapterArgs },
          update: { provider, adapterId, runtime, adapterArgs, baseUrl: null, model: null, apiKeyEncrypted: null },
        })
        res.json({ ok: true, provider, adapterId, runtime, adapterArgs: argsCheck.args })
        return
      }

      if (provider === 'local' || provider === 'platform') {
        await prisma.userAiConfig.upsert({
          where: { pubkey: authPubkey },
          create: { pubkey: authPubkey, provider },
          update: { provider, baseUrl: null, model: null, apiKeyEncrypted: null, adapterId: null, runtime: null, adapterArgs: null },
        })
        res.json({ ok: true, provider })
        return
      }

      // provider === 'openai'
      const baseUrl = typeof body.baseUrl === 'string' && body.baseUrl.trim() ? body.baseUrl.trim() : null
      if (baseUrl) {
        // FU-290 — https-only + block private/reserved ranges before this
        // server-chosen URL is fetched on the user's behalf by the mcp-server.
        const urlCheck = await checkProviderUrlSafe(baseUrl)
        if (!urlCheck.ok) {
          res.status(400).json({ error: 'VALIDATION_ERROR', message: urlCheck.error })
          return
        }
      }
      const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim().slice(0, 200) : null

      let apiKeyEncrypted = existing?.apiKeyEncrypted ?? null
      if (typeof body.apiKey === 'string' && body.apiKey) {
        if (!hasKeyEncryptionSecret()) {
          res.status(503).json({ error: 'KEY_ENCRYPTION_UNAVAILABLE', message: 'AI_KEY_ENCRYPTION_SECRET is not configured on this server' })
          return
        }
        // Never persist a key visibly formatted — trim whitespace only.
        apiKeyEncrypted = encryptKey(body.apiKey.trim())
      } else if (body.apiKey === '' || body.clearKey === true) {
        apiKeyEncrypted = null
      }

      await prisma.userAiConfig.upsert({
        where: { pubkey: authPubkey },
        create: { pubkey: authPubkey, provider, baseUrl, model, apiKeyEncrypted },
        update: { provider, baseUrl, model, apiKeyEncrypted, adapterId: null, runtime: null, adapterArgs: null },
      })
      res.json({ ok: true, provider, baseUrl, model, hasApiKey: Boolean(apiKeyEncrypted) })
    } catch (err) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: String(err) })
    }
  })

  // POST /api/ai/config/test — one-shot connectivity check against an
  // OpenAI-compatible /chat/completions endpoint. The key comes from the
  // request body (the Settings form); it is never stored or logged, and never
  // reaches this endpoint from the stored config.
  router.post('/test', async (req: Request, res: Response) => {
    const authPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!authPubkey) {
      res.status(401).json({ error: 'UNAUTHORIZED' })
      return
    }
    const { baseUrl, apiKey, model } = req.body as { baseUrl?: unknown; apiKey?: unknown; model?: unknown }
    if (typeof baseUrl !== 'string') {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'baseUrl is required' })
      return
    }
    // FU-290 — same https-only + private-range guard as PUT /, applied before
    // this endpoint's outbound fetch (this is the actual network call, PUT
    // only ever stores the string).
    const urlCheck = await checkProviderUrlSafe(baseUrl)
    if (!urlCheck.ok) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: urlCheck.error })
      return
    }
    if (typeof apiKey !== 'string' || !apiKey) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'apiKey is required for the connection test' })
      return
    }

    const trimmedBase = baseUrl.replace(/\/+$/, '')

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      const upstream = await fetch(`${trimmedBase}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: typeof model === 'string' && model ? model : 'MiniMax-M2',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (!upstream.ok) {
        res.status(200).json({ ok: false, status: upstream.status, error: `Provider returned HTTP ${upstream.status}` })
        return
      }

      // FU-286 — best-effort model catalog for the Settings UI's Model
      // picker. The ping above already proved the provider + key work; a
      // provider that doesn't implement /models (or times out) still counts
      // as a successful test, just without a model list to offer.
      let models: string[] | undefined
      try {
        const modelsController = new AbortController()
        const modelsTimer = setTimeout(() => modelsController.abort(), 5_000)
        const modelsRes = await fetch(`${trimmedBase}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: modelsController.signal,
        })
        clearTimeout(modelsTimer)
        if (modelsRes.ok) {
          const data = await modelsRes.json()
          if (Array.isArray(data?.data)) {
            models = data.data
              .map((m: unknown) => (m && typeof m === 'object' && 'id' in m ? String((m as { id: unknown }).id) : null))
              .filter((id: string | null): id is string => Boolean(id))
              .sort()
          }
        }
      } catch {
        // /models unsupported or unreachable — the connection test itself already succeeded above.
      }

      res.json({ ok: true, ...(models && models.length > 0 ? { models } : {}) })
    } catch (err) {
      const msg = err instanceof Error && err.name === 'AbortError'
        ? 'Connection timed out (10s)'
        : `Connection failed: ${err instanceof Error ? err.message : String(err)}`
      res.status(200).json({ ok: false, error: msg })
    }
  })

  return router
}