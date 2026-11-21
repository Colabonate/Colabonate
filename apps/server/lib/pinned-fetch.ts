/**
 * pinned-fetch — outbound JSON GET for server-chosen URLs (LNURL endpoints and callbacks,
 * ADR-417). The hostname is resolved once, every answer is checked against the private-range
 * table, and the TCP connection is then pinned to exactly those addresses. A second DNS answer
 * (rebinding) therefore cannot redirect the request to an internal host (FU-1004). TLS still
 * validates the certificate against the original hostname (SNI is unchanged). Redirects are
 * never followed, the body is size-capped and the request has a hard timeout.
 */
import https from 'node:https'
import type { LookupFunction } from 'node:net'
import { resolvePublicAddresses } from './provider-url-safety.js'

export interface PinnedFetchOptions {
  timeoutMs?: number
  maxBytes?: number
}

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_BYTES = 64 * 1024

export class UnsafeUrlError extends Error {
  constructor() {
    super('unsafe url')
    this.name = 'UnsafeUrlError'
  }
}

/** A `lookup` that ignores DNS and answers with the pre-validated addresses only. */
export function createPinnedLookup(addresses: Array<{ address: string; family: 4 | 6 }>): LookupFunction {
  return (_hostname, options, callback) => {
    if (options && (options as { all?: boolean }).all) {
      ;(callback as unknown as (err: Error | null, all: typeof addresses) => void)(null, addresses)
      return
    }
    const first = addresses[0]
    callback(null, first.address, first.family)
  }
}

export async function pinnedFetchJson(rawUrl: string, options: PinnedFetchOptions = {}): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES

  const resolved = await resolvePublicAddresses(rawUrl)
  if (!resolved.ok) throw new UnsafeUrlError()

  const url = new URL(rawUrl)
  const body = await new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        protocol: 'https:',
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { accept: 'application/json' },
        lookup: createPinnedLookup(resolved.addresses),
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status < 200 || status >= 300) {
          res.resume()
          reject(new Error(`HTTP ${status}`))
          return
        }
        const chunks: Buffer[] = []
        let total = 0
        res.on('data', (chunk: Buffer) => {
          total += chunk.length
          if (total > maxBytes) {
            req.destroy(new Error('response too large'))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
  return JSON.parse(body) as unknown
}
