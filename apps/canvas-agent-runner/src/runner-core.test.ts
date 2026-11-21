import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPublicKey, generateSecretKey } from 'nostr-tools'
import * as nip44 from 'nostr-tools/nip44'
import { resolveTicketPubkey, decryptPersona } from './runner-core.js'

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)))
}

/** Mirror of the app-side sealForRecipient (agentConfig.ts) for the roundtrip. */
function sealForRecipient(privkeyHex: string, recipientPubkeyHex: string, config: unknown): string {
  const conversationKey = nip44.getConversationKey(hexToBytes(privkeyHex), recipientPubkeyHex)
  return nip44.v2.encrypt(JSON.stringify(config), conversationKey)
}

describe('resolveTicketPubkey / decryptPersona (ADR-370 D4)', () => {
  const original = process.env.CANVAS_RUNNER_MASTER_SECRET
  afterEach(() => {
    if (original === undefined) delete process.env.CANVAS_RUNNER_MASTER_SECRET
    else process.env.CANVAS_RUNNER_MASTER_SECRET = original
  })

  it('is deterministic per ticket + a valid secp pubkey', () => {
    process.env.CANVAS_RUNNER_MASTER_SECRET = 'a'.repeat(64)
    const a = resolveTicketPubkey('ticket-1')
    const b = resolveTicketPubkey('ticket-1')
    const c = resolveTicketPubkey('ticket-2')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]{64}$/i)
  })

  it('round-trips a persona the seller sealed to the runner pubkey', () => {
    process.env.CANVAS_RUNNER_MASTER_SECRET = 'b'.repeat(64)
    const sellerPriv = Buffer.from(generateSecretKey()).toString('hex')
    const sellerPub = getPublicKey(hexToBytes(sellerPriv))
    const runnerPub = resolveTicketPubkey('ticket-9')
    const persona = { llm_provider: 'openai', llm_model: 'gpt-4o', llm_api_key: 'sk-secret', system_prompt: 'be blue' }
    const sealed = sealForRecipient(sellerPriv, runnerPub, persona)
    const decrypted = decryptPersona(sellerPub, 'ticket-9', sealed)
    expect(decrypted.llm_api_key).toBe('sk-secret')
    expect(decrypted.system_prompt).toBe('be blue')
  })

  it('rejects a blob sealed to a different ticket (wrong key)', () => {
    process.env.CANVAS_RUNNER_MASTER_SECRET = 'c'.repeat(64)
    const sellerPriv = Buffer.from(generateSecretKey()).toString('hex')
    const sellerPub = getPublicKey(hexToBytes(sellerPriv))
    const runnerPub = resolveTicketPubkey('ticket-10')
    const sealed = sealForRecipient(sellerPriv, runnerPub, { llm_api_key: 'x' })
    expect(() => decryptPersona(sellerPub, 'ticket-11', sealed)).toThrow()
  })

  it('throws when the master secret is unset', () => {
    delete process.env.CANVAS_RUNNER_MASTER_SECRET
    expect(() => resolveTicketPubkey('ticket-1')).toThrow(/CANVAS_RUNNER_MASTER_SECRET/)
  })

  it('never logs secrets through the decrypt path', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.CANVAS_RUNNER_MASTER_SECRET = 'd'.repeat(64)
    const sellerPriv = Buffer.from(generateSecretKey()).toString('hex')
    const sellerPub = getPublicKey(hexToBytes(sellerPriv))
    const runnerPub = resolveTicketPubkey('ticket-12')
    const sealed = sealForRecipient(sellerPriv, runnerPub, { llm_api_key: 'sk-ultra-secret' })
    try {
      decryptPersona(sellerPub, 'ticket-13', sealed)
    } catch {
      // expected — wrong ticket key
    }
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
