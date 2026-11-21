import { describe, expect, it } from 'vitest'
import { MAX_CHAT_MESSAGE_LENGTH, validateChatMessageInput, validateSignerPubkey } from './workspace-chat.js'

const VALID_TIMESTAMP = '1755600000000000000'
const VALID_SIGNATURE = 'a'.repeat(128)
const VALID_PUBKEY = 'b'.repeat(64)

describe('validateChatMessageInput', () => {
  it('accepts a well-formed message', () => {
    const result = validateChatMessageInput({ content: 'hello agent', timestamp: VALID_TIMESTAMP, signature: VALID_SIGNATURE })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.content).toBe('hello agent')
      expect(result.value.timestamp).toBe(BigInt(VALID_TIMESTAMP))
      expect(result.value.signature).toHaveLength(64)
    }
  })

  it('rejects a non-object body', () => {
    expect(validateChatMessageInput(null).ok).toBe(false)
    expect(validateChatMessageInput('nope').ok).toBe(false)
  })

  it('rejects empty or whitespace-only content', () => {
    expect(validateChatMessageInput({ content: '', timestamp: VALID_TIMESTAMP, signature: VALID_SIGNATURE }).ok).toBe(false)
    expect(validateChatMessageInput({ content: '   ', timestamp: VALID_TIMESTAMP, signature: VALID_SIGNATURE }).ok).toBe(false)
  })

  it('rejects content over the length cap', () => {
    const tooLong = 'a'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1)
    expect(validateChatMessageInput({ content: tooLong, timestamp: VALID_TIMESTAMP, signature: VALID_SIGNATURE }).ok).toBe(false)
  })

  it('accepts content exactly at the length cap', () => {
    const atCap = 'a'.repeat(MAX_CHAT_MESSAGE_LENGTH)
    expect(validateChatMessageInput({ content: atCap, timestamp: VALID_TIMESTAMP, signature: VALID_SIGNATURE }).ok).toBe(true)
  })

  it('never trims or mutates content (canister re-derives the signed message byte-for-byte)', () => {
    const padded = '  hello  '
    const result = validateChatMessageInput({ content: padded, timestamp: VALID_TIMESTAMP, signature: VALID_SIGNATURE })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.content).toBe(padded)
  })

  it('rejects a non-numeric timestamp', () => {
    expect(validateChatMessageInput({ content: 'hi', timestamp: 'not-a-number', signature: VALID_SIGNATURE }).ok).toBe(false)
    expect(validateChatMessageInput({ content: 'hi', timestamp: '12.5', signature: VALID_SIGNATURE }).ok).toBe(false)
    expect(validateChatMessageInput({ content: 'hi', timestamp: -1, signature: VALID_SIGNATURE }).ok).toBe(false)
  })

  it('rejects a malformed signature', () => {
    expect(validateChatMessageInput({ content: 'hi', timestamp: VALID_TIMESTAMP, signature: 'ab' }).ok).toBe(false)
    expect(validateChatMessageInput({ content: 'hi', timestamp: VALID_TIMESTAMP, signature: 'z'.repeat(128) }).ok).toBe(false)
    expect(validateChatMessageInput({ content: 'hi', timestamp: VALID_TIMESTAMP, signature: 123 }).ok).toBe(false)
  })

  it('accepts uppercase hex signature', () => {
    expect(validateChatMessageInput({ content: 'hi', timestamp: VALID_TIMESTAMP, signature: 'A'.repeat(128) }).ok).toBe(true)
  })
})

describe('validateSignerPubkey', () => {
  it('accepts undefined (legacy default)', () => {
    const result = validateSignerPubkey(undefined)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBeUndefined()
  })

  it('accepts a well-formed hex64 pubkey', () => {
    const result = validateSignerPubkey(VALID_PUBKEY)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(VALID_PUBKEY)
  })

  it('rejects a malformed pubkey', () => {
    expect(validateSignerPubkey('short').ok).toBe(false)
    expect(validateSignerPubkey(123).ok).toBe(false)
    expect(validateSignerPubkey(null).ok).toBe(false)
  })
})
