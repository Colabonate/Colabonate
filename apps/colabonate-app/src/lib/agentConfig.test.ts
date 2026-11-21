/**
 * lib/agentConfig tests (ADR-306 D1/D2 — Agent Setup config sealing).
 *
 * Pure round-trip coverage for the seal/unseal seam: no network, no DOM.
 */

import { describe, it, expect } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import * as nip44 from 'nostr-tools/nip44'
import {
  sealAgentConfig, unsealAgentConfig, sealForRecipient, toWorkspaceInjectedConfig, validateAgentRuntimeConfig,
  type AgentConfigSecrets, type WorkspaceInjectedConfig,
} from './agentConfig'

function randomPrivkeyHex(): string {
  return Array.from(generateSecretKey())
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const SAMPLE_CONFIG: AgentConfigSecrets = {
  provider: 'openai',
  apiKey: 'sk-test-123',
  model: 'gpt-4o',
  systemPrompt: 'You are a helpful code reviewer.',
  toolCredentials: { github: { token: 'ghp-test' } },
}

describe('sealAgentConfig / unsealAgentConfig', () => {
  it('round-trips a config through seal -> unseal to self', async () => {
    const privkeyHex = randomPrivkeyHex()
    const sealed = await sealAgentConfig(privkeyHex, SAMPLE_CONFIG)
    expect(sealed).not.toContain('sk-test-123')
    expect(await unsealAgentConfig(privkeyHex, sealed)).toEqual(SAMPLE_CONFIG)
  })

  it('produces ciphertext a different key cannot unseal', async () => {
    const owner = randomPrivkeyHex()
    const stranger = randomPrivkeyHex()
    const sealed = await sealAgentConfig(owner, SAMPLE_CONFIG)
    await expect(unsealAgentConfig(stranger, sealed)).rejects.toThrow()
  })

  it('is stable across repeated seal calls (same key, same plaintext)', async () => {
    const privkeyHex = randomPrivkeyHex()
    const a = await sealAgentConfig(privkeyHex, SAMPLE_CONFIG)
    const b = await sealAgentConfig(privkeyHex, SAMPLE_CONFIG)
    expect(await unsealAgentConfig(privkeyHex, a)).toEqual(SAMPLE_CONFIG)
    expect(await unsealAgentConfig(privkeyHex, b)).toEqual(SAMPLE_CONFIG)
  })
})

const SAMPLE_INJECTED_CONFIG: WorkspaceInjectedConfig = {
  llm_provider: 'openai',
  llm_model: 'gpt-4o',
  llm_api_key: 'sk-test-123',
  llm_base_url: null,
  system_prompt: 'be terse',
  tools: [],
}

// Decrypts as the canister would (nostr-tools/nip44 side, not the Rust side —
// packages/icp-workspace-canister/src/nip44.rs is verified separately against
// the official NIP-44 test vectors, so a matching construction here proves
// interop without needing the Rust toolchain in this test run).
function decryptAsRecipient(recipientPrivkeyHex: string, senderPubkeyHex: string, ciphertext: string): unknown {
  const conversationKey = nip44.getConversationKey(new Uint8Array(recipientPrivkeyHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16))), senderPubkeyHex)
  return JSON.parse(nip44.v2.decrypt(ciphertext, conversationKey))
}

describe('sealForRecipient', () => {
  it('a two-party recipient (canister-equivalent) can decrypt with its own key + the sender pubkey', () => {
    const sender = randomPrivkeyHex()
    const recipient = randomPrivkeyHex()
    const recipientPubkey = getPublicKey(new Uint8Array(recipient.match(/.{1,2}/g)!.map((b) => parseInt(b, 16))))
    const ciphertext = sealForRecipient(sender, recipientPubkey, SAMPLE_INJECTED_CONFIG)
    const senderPubkey = getPublicKey(new Uint8Array(sender.match(/.{1,2}/g)!.map((b) => parseInt(b, 16))))
    expect(decryptAsRecipient(recipient, senderPubkey, ciphertext)).toEqual(SAMPLE_INJECTED_CONFIG)
  })

  it('does not leak the api key in plaintext', () => {
    const sender = randomPrivkeyHex()
    const recipientPubkey = getPublicKey(new Uint8Array(randomPrivkeyHex().match(/.{1,2}/g)!.map((b) => parseInt(b, 16))))
    const ciphertext = sealForRecipient(sender, recipientPubkey, SAMPLE_INJECTED_CONFIG)
    expect(ciphertext).not.toContain('sk-test-123')
  })

  it('a third party (wrong recipient key) cannot decrypt', () => {
    const sender = randomPrivkeyHex()
    const recipient = randomPrivkeyHex()
    const stranger = randomPrivkeyHex()
    const recipientPubkey = getPublicKey(new Uint8Array(recipient.match(/.{1,2}/g)!.map((b) => parseInt(b, 16))))
    const senderPubkey = getPublicKey(new Uint8Array(sender.match(/.{1,2}/g)!.map((b) => parseInt(b, 16))))
    const ciphertext = sealForRecipient(sender, recipientPubkey, SAMPLE_INJECTED_CONFIG)
    expect(() => decryptAsRecipient(stranger, senderPubkey, ciphertext)).toThrow()
  })
})

describe('toWorkspaceInjectedConfig (ADR-396 D1)', () => {
  it('passes model, base URL and system prompt through to the canister config', () => {
    const cfg = toWorkspaceInjectedConfig({
      provider: 'ollama', model: 'qwen2.5', baseUrl: 'https://ollama.example.com/', systemPrompt: 'Be brief.',
    })
    expect(cfg).toMatchObject({
      llm_provider: 'ollama', llm_model: 'qwen2.5', llm_base_url: 'https://ollama.example.com', system_prompt: 'Be brief.', llm_api_key: '',
    })
  })

  it('falls back to the provider default model for legacy seals without a model', () => {
    expect(toWorkspaceInjectedConfig({ provider: 'anthropic', apiKey: 'k' }).llm_model).toBe('claude-sonnet-5')
    expect(toWorkspaceInjectedConfig({ provider: 'something-else' }).llm_provider).toBe('openai')
  })

  it('ADR-409: normalizes the base URL to root form (strips trailing slash and /v1)', () => {
    expect(toWorkspaceInjectedConfig({ provider: 'openai', apiKey: 'k', baseUrl: 'https://api.openai.com/v1' }).llm_base_url)
      .toBe('https://api.openai.com')
    expect(toWorkspaceInjectedConfig({ provider: 'openai', apiKey: 'k', baseUrl: 'https://api.groq.com/openai/' }).llm_base_url)
      .toBe('https://api.groq.com/openai')
  })

  it('maps tools to the canister allowlist: HTTPS prefixes, "!" for approval-gated calls', () => {
    const cfg = toWorkspaceInjectedConfig({
      provider: 'openai',
      tools: [
        { name: 'search', url: 'https://api.search.test/v1/', requiresApproval: false },
        { name: 'mail', url: ' https://api.mail.test/send ', requiresApproval: true },
        { name: 'insecure', url: 'http://plain.test/', requiresApproval: false },
      ],
    })
    expect(cfg.tools).toEqual(['https://api.search.test/v1/', '!https://api.mail.test/send'])
  })

  it('never injects an empty-string base URL or system prompt', () => {
    const cfg = toWorkspaceInjectedConfig({ provider: 'openai', baseUrl: '   ', systemPrompt: '  ' })
    expect(cfg.llm_base_url).toBeNull()
    expect(cfg.system_prompt).toBeNull()
  })
})

describe('validateAgentRuntimeConfig (ADR-396 D1)', () => {
  const base = { provider: 'openai', apiKey: 'sk', model: 'gpt-4o', baseUrl: '', tools: [] as Array<{ name: string; url: string }> }

  it('accepts a complete OpenAI config', () => {
    expect(validateAgentRuntimeConfig(base)).toBeNull()
  })

  it('requires an API key for every flavor (ADR-409 OD-2 — canister demands non-empty llm_api_key)', () => {
    const missing = validateAgentRuntimeConfig({ ...base, apiKey: '' })
    expect(missing?.field).toBe('apiKey')
    expect(missing?.message).toMatch(/API key/)
    const ollamaMissing = validateAgentRuntimeConfig({ ...base, provider: 'ollama', apiKey: '', baseUrl: 'https://o.test' })
    expect(ollamaMissing?.field).toBe('apiKey')
    expect(ollamaMissing?.message).toMatch(/proxy token|API key/)
  })

  it('requires a model', () => {
    const missing = validateAgentRuntimeConfig({ ...base, model: ' ' })
    expect(missing?.field).toBe('model')
    expect(missing?.message).toMatch(/model/)
  })

  it('requires an HTTPS server address for Ollama and rejects plain HTTP anywhere', () => {
    const ollama = validateAgentRuntimeConfig({ ...base, provider: 'ollama', baseUrl: '' })
    expect(ollama?.field).toBe('baseUrl')
    expect(ollama?.message).toMatch(/Ollama/)
    const http = validateAgentRuntimeConfig({ ...base, baseUrl: 'http://proxy.test' })
    expect(http?.field).toBe('baseUrl')
    expect(http?.message).toMatch(/https/)
  })

  it('requires a name and an HTTPS address for every tool, ignoring empty rows', () => {
    expect(validateAgentRuntimeConfig({ ...base, tools: [{ name: '', url: '' }] })).toBeNull()
    const unnamed = validateAgentRuntimeConfig({ ...base, tools: [{ name: '', url: 'https://x.test' }] })
    expect(unnamed?.field).toBe('tools')
    expect(unnamed?.message).toMatch(/name/)
    const badUrl = validateAgentRuntimeConfig({ ...base, tools: [{ name: 'search', url: 'ftp://x.test' }] })
    expect(badUrl?.field).toBe('tools')
    expect(badUrl?.message).toMatch(/search/)
  })
})
