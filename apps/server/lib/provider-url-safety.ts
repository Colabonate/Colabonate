/**
 * provider-url-safety — SSRF guard for user-supplied AI-provider base URLs
 * (ADR-281 FU-290). A saved base URL is later fetched server-side by the
 * mcp-server on the user's behalf (D4) — an unrestricted URL lets a user
 * point the server at internal infrastructure (metadata endpoints, admin
 * ports, sibling containers). Enforced at both save time (PUT /api/ai/config)
 * and test time (POST /api/ai/config/test).
 *
 * Scope: https-only + IP-literal/hostname checks, plus a DNS resolution
 * check against the same private-range table (closes the "hostname that
 * currently resolves to an internal IP" gap a literal-only check misses).
 * This check alone does not defend against DNS rebinding between validation and
 * the actual outbound fetch (TOCTOU); callers that need that use `resolvePublicAddresses`
 * with `lib/pinned-fetch.ts` (ADR-417, FU-1004).
 */
import { isIP } from 'net'
import { lookup } from 'dns/promises'

export interface UrlSafetyResult {
  ok: boolean
  error?: string
}

const BLOCKED_HOSTNAME_SUFFIXES = ['.local', '.internal', '.localdomain']
const BLOCKED_HOSTNAMES = new Set(['localhost'])

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0
}

function ipv4InRange(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask)
}

// RFC 1918 / 5735 / 6598 private, loopback, link-local, CGNAT, documentation,
// multicast and reserved ranges — anything that isn't routed on the public
// internet is out.
const IPV4_BLOCKED_RANGES: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

function isBlockedIPv4(ip: string): boolean {
  return IPV4_BLOCKED_RANGES.some(([base, bits]) => ipv4InRange(ip, base, bits))
}

/** Parses an IPv6 literal (incl. `::` compression, dotted IPv4 tail, zone id) to 16 bytes; null if invalid. */
function parseIPv6(raw: string): number[] | null {
  let ip = raw.toLowerCase().split('%')[0]
  const dotted = ip.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const octets = dotted[2].split('.').map(Number)
    if (octets.some((o) => o > 255)) return null
    const hi = ((octets[0] << 8) | octets[1]).toString(16)
    const lo = ((octets[2] << 8) | octets[3]).toString(16)
    ip = `${dotted[1]}${hi}:${lo}`
  }
  const halves = ip.split('::')
  if (halves.length > 2) return null
  const head = halves[0] === '' ? [] : halves[0].split(':')
  const tail = halves.length === 2 ? (halves[1] === '' ? [] : halves[1].split(':')) : []
  if (halves.length === 1 && head.length !== 8) return null
  if (halves.length === 2 && head.length + tail.length > 7) return null
  const groups = halves.length === 2 ? [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail] : head
  const bytes: number[] = []
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null
    const value = parseInt(group, 16)
    bytes.push(value >> 8, value & 0xff)
  }
  return bytes
}

function embeddedV4(bytes: number[], offset: number): string {
  return bytes.slice(offset, offset + 4).join('.')
}

// Anything that is not a plain public global-unicast address is out. Addresses that embed an
// IPv4 address (mapped, NAT64, 6to4) are judged by the embedded address: the WHATWG URL parser
// rewrites `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, so a textual regex on the dotted form misses it.
function isBlockedIPv6(ip: string): boolean {
  const bytes = parseIPv6(ip)
  if (!bytes) return true // unparseable: fail closed
  const first12Zero = bytes.slice(0, 12).every((b) => b === 0)
  if (first12Zero) return true // ::, ::1 and the deprecated IPv4-compatible ::/96
  const isMapped = bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff
  if (isMapped) return isBlockedIPv4(embeddedV4(bytes, 12)) // ::ffff:0:0/96
  const b0 = bytes[0]
  const b1 = bytes[1]
  // 64:ff9b::/96 NAT64: judge by the embedded IPv4; 64:ff9b:1::/48 local-use NAT64: always out.
  if (b0 === 0x00 && b1 === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    if (bytes[4] === 0 && bytes[5] === 0 && bytes.slice(6, 12).every((b) => b === 0)) {
      return isBlockedIPv4(embeddedV4(bytes, 12))
    }
    return true
  }
  if (b0 === 0x20 && b1 === 0x02) return isBlockedIPv4(embeddedV4(bytes, 2)) // 2002::/16 6to4
  if ((b0 & 0xfe) === 0xfc) return true // fc00::/7 unique local
  if (b0 === 0xfe && (b1 & 0xc0) === 0x80) return true // fe80::/10 link-local
  if (b0 === 0xfe && (b1 & 0xc0) === 0xc0) return true // fec0::/10 site-local (deprecated)
  if (b0 === 0xff) return true // ff00::/8 multicast
  if (b0 === 0x20 && b1 === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true // 2001:db8::/32 documentation
  return false
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) return isBlockedIPv4(ip)
  if (version === 6) return isBlockedIPv6(ip)
  return true // unrecognizable literal — fail closed
}

/**
 * Synchronous checks only (protocol + literal hostname/IP) — no network
 * round-trip. Always run this first; cheap enough for every request.
 */
export function checkProviderUrlSyntax(raw: string): UrlSafetyResult {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, error: 'Not a valid URL' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'Base URL must use https://' }
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, error: 'Base URL must not contain credentials' }
  }
  // A trailing dot is the same host (`localhost.` == `localhost`).
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '')
  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOSTNAME_SUFFIXES.some((s) => hostname.endsWith(s))) {
    return { ok: false, error: 'Base URL host is not a public address' }
  }
  if (isIP(hostname) && isBlockedIp(hostname)) {
    return { ok: false, error: 'Base URL resolves to a private/reserved IP range' }
  }
  return { ok: true }
}

/**
 * Full check: syntax + DNS resolution against the same block table. Use
 * before the server makes an outbound call to the URL, and at save time as
 * defense-in-depth — a hostname's current DNS answer can change later, but
 * this closes the common "internal DNS name" and "public hostname currently
 * pointed at 127.0.0.1" cases the syntax check alone cannot see.
 */
export async function checkProviderUrlSafe(raw: string): Promise<UrlSafetyResult> {
  const syntax = checkProviderUrlSyntax(raw)
  if (!syntax.ok) return syntax

  const hostname = new URL(raw).hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname)) return { ok: true } // already checked as a literal above

  try {
    const results = await lookup(hostname, { all: true, verbatim: true })
    if (results.length === 0) return { ok: false, error: 'Base URL host could not be resolved' }
    if (results.some((r) => isBlockedIp(r.address))) {
      return { ok: false, error: 'Base URL host resolves to a private/reserved IP range' }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Base URL host could not be resolved' }
  }
}

export type PublicAddressResult =
  | { ok: true; addresses: Array<{ address: string; family: 4 | 6 }> }
  | { ok: false; error: string }

/**
 * Like `checkProviderUrlSafe`, but returns the validated addresses so the caller can
 * pin the connection to them (closes the DNS-rebinding window, FU-1004). Every resolved
 * address must be public; one internal answer rejects the host.
 */
export async function resolvePublicAddresses(raw: string): Promise<PublicAddressResult> {
  const syntax = checkProviderUrlSyntax(raw)
  if (!syntax.ok) return { ok: false, error: syntax.error ?? 'unsafe url' }

  const hostname = new URL(raw).hostname.replace(/^\[|\]$/g, '')
  const literal = isIP(hostname)
  if (literal === 4 || literal === 6) return { ok: true, addresses: [{ address: hostname, family: literal }] }

  try {
    const results = await lookup(hostname, { all: true, verbatim: true })
    if (results.length === 0) return { ok: false, error: 'Host could not be resolved' }
    if (results.some((r) => isBlockedIp(r.address))) {
      return { ok: false, error: 'Host resolves to a private/reserved IP range' }
    }
    return {
      ok: true,
      addresses: results.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 })),
    }
  } catch {
    return { ok: false, error: 'Host could not be resolved' }
  }
}
