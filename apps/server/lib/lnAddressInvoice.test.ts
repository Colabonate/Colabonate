// FU-881: the LUD-06 binding (ADR-394 FU-839) must survive providers that drop
// `h` when a LUD-12 comment is sent (getalby.com), without weakening the check.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
const mockRequestInvoice = vi.fn()
vi.mock('@getalby/lightning-tools', () => {
  class LightningAddress {
    lnurlpData = { metadataHash: 'meta-hash' }
    constructor(public readonly address: string) {}
    fetch = () => mockFetch()
    requestInvoice = (args: unknown) => mockRequestInvoice(args)
  }
  return { LightningAddress }
})

// Fake invoices encode their `h` tag in the string: "inv:<h|none>".
vi.mock('./bolt11-tags.js', () => {
  const readInvoiceDescriptionHash = (bolt11: string) => {
    const h = bolt11.split(':')[1]
    return h === 'none' ? null : h
  }
  return {
    readInvoiceDescriptionHash,
    assertInvoiceMatchesLnurlMetadata: (bolt11: string, expected: string) => {
      const h = readInvoiceDescriptionHash(bolt11)
      if (!h) throw new Error('LNURL invoice carries no description_hash (LUD-06)')
      if (h !== expected) throw new Error('LNURL invoice description_hash does not match the LNURL metadata (LUD-06)')
    },
  }
})

vi.mock('./lnAddressHandle.js', () => ({ readLnurlpDomain: () => 'colabonate.app' }))

import { resolveLnAddressInvoice } from './lnAddressInvoice'

const inv = (h: string) => ({ paymentRequest: `inv:${h}`, paymentHash: `ph-${h}` })

beforeEach(() => {
  mockFetch.mockReset().mockResolvedValue(undefined)
  mockRequestInvoice.mockReset()
})

describe('resolveLnAddressInvoice (LUD-06 binding)', () => {
  it('keeps the comment when the provider sets a matching h tag', async () => {
    mockRequestInvoice.mockResolvedValueOnce(inv('meta-hash'))
    const res = await resolveLnAddressInvoice('a@blink.sv', 21, 'memo')
    expect(res.bolt11).toBe('inv:meta-hash')
    expect(mockRequestInvoice).toHaveBeenCalledTimes(1)
    expect(mockRequestInvoice).toHaveBeenCalledWith({ satoshi: 21, comment: 'memo' })
  })

  it('retries once without the comment when h is missing (getalby.com)', async () => {
    mockRequestInvoice.mockResolvedValueOnce(inv('none')).mockResolvedValueOnce(inv('meta-hash'))
    const res = await resolveLnAddressInvoice('a@getalby.com', 21, 'memo')
    expect(res.bolt11).toBe('inv:meta-hash')
    expect(mockRequestInvoice).toHaveBeenNthCalledWith(2, { satoshi: 21 })
  })

  it('still rejects when the retry has no h tag either', async () => {
    mockRequestInvoice.mockResolvedValue(inv('none'))
    await expect(resolveLnAddressInvoice('a@x.example', 21, 'memo')).rejects.toThrow(/no description_hash/)
    expect(mockRequestInvoice).toHaveBeenCalledTimes(2)
  })

  it('never retries a wrong h tag', async () => {
    mockRequestInvoice.mockResolvedValue(inv('evil-hash'))
    await expect(resolveLnAddressInvoice('a@x.example', 21, 'memo')).rejects.toThrow(/does not match/)
    expect(mockRequestInvoice).toHaveBeenCalledTimes(1)
  })

  it('exempts the own lnurlp domain (FU-844)', async () => {
    mockRequestInvoice.mockResolvedValueOnce(inv('none'))
    const res = await resolveLnAddressInvoice('bob@colabonate.app', 21, 'memo')
    expect(res.bolt11).toBe('inv:none')
    expect(mockRequestInvoice).toHaveBeenCalledTimes(1)
  })
})
