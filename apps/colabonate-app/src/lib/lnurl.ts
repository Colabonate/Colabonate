import { apiCall } from './api'

/**
 * Resolves a Lightning Address (LUD-16, `name@domain`) to a bolt11 invoice
 * for a fixed sat amount. Proxied through our own server (GET
 * /api/wallet/lnurl-invoice) — the CSP `connect-src` in vite.config.ts only
 * allowlists known origins, so the browser can't fetch arbitrary third-party
 * LN wallet domains directly.
 */
export async function fetchLnAddressInvoice(lnAddress: string, amountSats: number): Promise<string> {
  const params = new URLSearchParams({ address: lnAddress, amountSats: String(amountSats) })
  const res = await apiCall(`/api/wallet/lnurl-invoice?${params.toString()}`)
  const data = await res.json()
  if (!data.bolt11) throw new Error('No invoice returned')
  return data.bolt11 as string
}
