// ADR-240 addendum — the Kind-0 republish that adds the self-serve Lightning
// address must never drop fields the user set elsewhere (name, about, banner,
// colabonate_pubkey, …). The merge is pure, so it is tested directly.
import { describe, it, expect } from 'vitest'
import { mergeLud16IntoKind0Content } from './nostr'

describe('mergeLud16IntoKind0Content', () => {
  it('sets lud16 while preserving every existing field', () => {
    const existing = JSON.stringify({
      name: 'Alice',
      about: 'hi',
      banner: 'https://img/banner.png',
      colabonate_pubkey: 'abc',
      colabonate_protocol_version: '1.0.0-draft',
    })
    const merged = JSON.parse(mergeLud16IntoKind0Content(existing, 'alice@colabonate.app'))
    expect(merged).toEqual({
      name: 'Alice',
      about: 'hi',
      banner: 'https://img/banner.png',
      colabonate_pubkey: 'abc',
      colabonate_protocol_version: '1.0.0-draft',
      lud16: 'alice@colabonate.app',
    })
  })

  it('overwrites an existing lud16', () => {
    const merged = JSON.parse(mergeLud16IntoKind0Content(JSON.stringify({ lud16: 'old@x.com' }), 'new@colabonate.app'))
    expect(merged.lud16).toBe('new@colabonate.app')
  })

  it('degrades to { lud16 } for malformed / empty / array content', () => {
    expect(JSON.parse(mergeLud16IntoKind0Content('not json', 'a@b.c'))).toEqual({ lud16: 'a@b.c' })
    expect(JSON.parse(mergeLud16IntoKind0Content(null, 'a@b.c'))).toEqual({ lud16: 'a@b.c' })
    expect(JSON.parse(mergeLud16IntoKind0Content('[1,2]', 'a@b.c'))).toEqual({ lud16: 'a@b.c' })
  })
})
