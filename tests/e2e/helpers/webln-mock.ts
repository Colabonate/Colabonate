import type { Page } from '@playwright/test'
import { SERVER_BASE_URL } from '../fixtures/test-fixtures.js'

export async function injectWebLNMock(page: Page, testUserPubkey: string) {
  await page.addInitScript((pubkey) => {
    ;(window as any).webln = {
      enabled: false,
      enable: async () => {
        (window as any).webln.enabled = true
      },
      sendPayment: async (bolt11: string) => {
        const hashMatch = bolt11.match(/_(\w{20})/)
        const fakeHash = hashMatch ? hashMatch[1] + '0'.repeat(44) : bolt11

        const res = await fetch(`${window.location.origin}/api/lightning/webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_hash: fakeHash }),
        })
        return res.json()
      },
      makeInvoice: async (args: { amount: number; defaultMemo?: string }) => {
        const res = await fetch(`${window.location.origin}/api/lightning/invoice`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amountSats: args.amount, description: args.defaultMemo || '' }),
        })
        const data = await res.json()
        return { paymentRequest: data.invoice, rHash: data.paymentHash }
      },
    }

    ;(window as any).nostr = {
      getPublicKey: async () => pubkey,
      signEvent: async (event: Record<string, unknown>) => {
        return { ...event, sig: 'mock-sig-' + pubkey.slice(0, 8) }
      },
      nip04: {
        encrypt: async (_pubkey: string, plaintext: string) => `enc:${plaintext}`,
        decrypt: async (_pubkey: string, ciphertext: string) => ciphertext.replace(/^enc:/, ''),
      },
    }
  }, testUserPubkey)
}
