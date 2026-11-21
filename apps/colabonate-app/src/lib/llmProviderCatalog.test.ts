/**
 * ADR-409 D2 — catalog invariant tests. The path-suffix invariant is the
 * safety net that keeps every catalog entry executable by the unchanged
 * Workspace-Canister: `{baseUrl}/v1/chat/completions` (openai flavor) /
 * `{baseUrl}/v1/messages` (anthropic) / `{baseUrl}/api/chat` (ollama) must be
 * the provider's real endpoint, so a preset baseUrl may never end with `/v1`
 * or a trailing slash, and every seller-entered entry must leave baseUrl
 * null. Plus the assistant↔agent base-URL convention translators (D4/D5).
 */
import { describe, expect, it } from 'vitest'
import {
  LLM_CATALOG, LLM_CATALOG_BY_ID, agentBaseToAssistantBaseUrl, assistantBaseUrlToAgentBase,
  assistantBaseUrlPresets, catalogEntriesGrouped, getCatalogEntry, matchCatalogEntry,
} from './llmProviderCatalog'

const FLAVOR_PATHS = {
  openai: '/v1/chat/completions',
  anthropic: '/v1/messages',
  ollama: '/api/chat',
} as const

describe('LLM catalog invariants (ADR-409 D2)', () => {
  it('has unique ids and non-empty labels', () => {
    const ids = new Set(LLM_CATALOG.map((e) => e.id))
    expect(ids.size).toBe(LLM_CATALOG.length)
    for (const e of LLM_CATALOG) {
      expect(e.label.trim().length).toBeGreaterThan(0)
      expect(['openai', 'anthropic', 'ollama']).toContain(e.flavor)
    }
  })

  it('every preset baseUrl is https, root-form, and resolves to a valid URL under the flavor path', () => {
    for (const e of LLM_CATALOG) {
      if (e.baseUrl === null) continue
      expect(e.baseUrl.startsWith('https://')).toBe(true)
      expect(e.baseUrl.endsWith('/')).toBe(false)
      // A trailing /v1 would double up against the canister's fixed suffix.
      expect(e.baseUrl.endsWith('/v1')).toBe(false)
      // The composed endpoint must parse as a URL (no double slashes etc.).
      const url = new URL(`${e.baseUrl}${FLAVOR_PATHS[e.flavor]}`)
      expect(url.protocol).toBe('https:')
      expect(url.pathname.includes('//')).toBe(false)
    }
  })

  it('seller-entered entries (local runtimes + custom) have baseUrl null', () => {
    for (const e of LLM_CATALOG) {
      if (e.group === 'local' || e.group === 'custom') expect(e.baseUrl).toBeNull()
    }
  })

  it('grouped select covers every entry exactly once, in display order', () => {
    const grouped = catalogEntriesGrouped()
    const flat = grouped.flatMap((g) => g.entries)
    expect(flat.length).toBe(LLM_CATALOG.length)
    expect(new Set(flat.map((e) => e.id)).size).toBe(LLM_CATALOG.length)
    expect(grouped.map((g) => g.group)).toEqual(['first-party', 'aggregator', 'open-weight', 'local', 'custom'])
  })

  it('getCatalogEntry falls back to custom-openai for unknown ids', () => {
    expect(getCatalogEntry('nope').id).toBe('custom-openai')
    expect(getCatalogEntry('openai').id).toBe('openai')
  })
})

describe('matchCatalogEntry (edit-mode prefill)', () => {
  it('prefers a stored catalogId when its flavor matches the sealed one', () => {
    expect(matchCatalogEntry({ flavor: 'openai', baseUrl: 'https://api.openai.com', catalogId: 'groq' }).id).toBe('groq')
  })

  it('ignores a catalogId whose flavor disagrees with the sealed flavor', () => {
    expect(matchCatalogEntry({ flavor: 'anthropic', baseUrl: 'https://api.anthropic.com', catalogId: 'openai' }).id).toBe('anthropic')
  })

  it('matches by normalized baseUrl, tolerating /v1 and trailing slashes', () => {
    expect(matchCatalogEntry({ flavor: 'openai', baseUrl: 'https://api.groq.com/openai/' }).id).toBe('groq')
    expect(matchCatalogEntry({ flavor: 'openai', baseUrl: 'https://api.minimax.io/v1' }).id).toBe('minimax')
  })

  it('falls back to the custom entry for unknown base URLs and to first-party/ollama without a base URL', () => {
    expect(matchCatalogEntry({ flavor: 'openai', baseUrl: 'https://llm.corp.example.com' }).id).toBe('custom-openai')
    expect(matchCatalogEntry({ flavor: 'anthropic', baseUrl: 'https://proxy.example.com' }).id).toBe('custom-anthropic')
    expect(matchCatalogEntry({ flavor: 'openai' }).id).toBe('openai')
    expect(matchCatalogEntry({ flavor: 'anthropic' }).id).toBe('anthropic')
    expect(matchCatalogEntry({ flavor: 'ollama' }).id).toBe('ollama')
  })
})

describe('assistant ↔ agent base URL conventions (ADR-409 D4/D5)', () => {
  it('strips /v1 and trailing slashes from assistant-style bases', () => {
    expect(assistantBaseUrlToAgentBase('https://api.minimax.io/v1')).toBe('https://api.minimax.io')
    expect(assistantBaseUrlToAgentBase('https://api.openai.com/v1/')).toBe('https://api.openai.com')
    expect(assistantBaseUrlToAgentBase('https://api.groq.com/openai/v1')).toBe('https://api.groq.com/openai')
  })

  it('adds /v1 for the assistant/test convention', () => {
    expect(agentBaseToAssistantBaseUrl('https://api.minimax.io')).toBe('https://api.minimax.io/v1')
    expect(agentBaseToAssistantBaseUrl('https://api.groq.com/openai')).toBe('https://api.groq.com/openai/v1')
    // Idempotent for an already-assistant-style input.
    expect(agentBaseToAssistantBaseUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1')
  })

  it('Settings presets (D8) are assistant-style and cover the hosted openai-flavor entries', () => {
    const presets = assistantBaseUrlPresets()
    expect(presets.some((p) => p.label === 'OpenRouter' && p.baseUrl === 'https://openrouter.ai/api/v1')).toBe(true)
    for (const p of presets) expect(p.baseUrl.endsWith('/v1')).toBe(true)
    expect(presets.some((p) => p.label === 'Ollama (self-hosted)')).toBe(false)
    expect(LLM_CATALOG_BY_ID['anthropic'] && !presets.some((p) => p.label === 'Anthropic')).toBe(true)
  })
})
