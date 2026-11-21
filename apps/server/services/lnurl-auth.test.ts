// FU-760 class / ADR-240+381: the LNURL-auth login must persist the wallet's
// real LUD-16 address when the callback carries one (`?lud16=`), never keep a
// synthetic `@colabonate.local` placeholder, and never overwrite a usable
// address with a missing one.
import { describe, it, expect } from 'vitest'
import { pickLnurlAuthAddress } from './lnurl-auth'

describe('pickLnurlAuthAddress', () => {
  it('persists the wallet-provided address', () => {
    expect(pickLnurlAuthAddress('LN_ADDRESS_REDACTED', null)).toEqual({
      lnAddress: 'LN_ADDRESS_REDACTED',
      changed: true,
    })
  })

  it('treats an unchanged address as unchanged', () => {
    expect(pickLnurlAuthAddress('LN_ADDRESS_REDACTED', 'LN_ADDRESS_REDACTED').changed).toBe(false)
  })

  it('clears a synthetic placeholder when the login provides no usable address', () => {
    expect(pickLnurlAuthAddress(undefined, 'abcd1234@colabonate.local')).toEqual({
      lnAddress: null,
      changed: true,
    })
    expect(pickLnurlAuthAddress('abcd1234@demo.local', 'abcd1234@colabonate.local')).toEqual({
      lnAddress: null,
      changed: true,
    })
  })

  it('keeps an existing routable address when the login provides none', () => {
    expect(pickLnurlAuthAddress(undefined, 'alice@getalby.com')).toEqual({
      lnAddress: 'alice@getalby.com',
      changed: false,
    })
  })

  it('is a no-op for a fresh account without any address', () => {
    expect(pickLnurlAuthAddress(undefined, null)).toEqual({ lnAddress: null, changed: false })
  })
})
