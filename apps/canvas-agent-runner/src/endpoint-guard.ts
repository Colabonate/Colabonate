/**
 * ADR-409 D9 (OD-3) — endpoint guard for the canvas-agent-runner.
 *
 * The runner executes on Colabonate infrastructure and decrypts the seller's
 * persona in memory; an unvalidated `llm_base_url` (or tool allowlist entry)
 * could aim the runner's outbound fetches at internal services (SSRF). The
 * ICP canister needs no such guard — its outcalls structurally reach only
 * the public internet — but this process runs beside postgres/redis/meili/doop.
 *
 * Self-contained mirror of apps/server/lib/provider-url-safety.ts (FU-290)
 * plus a platform-internal hostname table: cross-app imports would need a
 * shared package (a restructure that is ask-first per AGENTS.md), and the
 * runner deploys as its own process image. Keep the two tables in sync when
 * editing.
 *
 * Key-management rule (FU-195-C): guard errors carry a reason category, never
 * the URL or key material.
 */
import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

export type EndpointGuardTarget = 'llm_base_url' | 'tool'

export interface EndpointGuardResult {
  ok: boolean
  /** Stable, category-level reason safe for logs and the ticket UI. */
  error?: string
}

const BLOCKED_HOSTNAME_SUFFIXES = ['.local', '.internal', '.localdomain', '.localhost']
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'host.docker.internal',
  'gateway.docker.internal',
  // Compose service names reachable from the runner's network (docker-compose.beta.yml).
  'postgres', 'redis', 'meilisearch', 'lnbits', 'server', 'mcp', 'proxy', 'nginx', 'doop', 'doop-db',
])
// Operator extension without a code change (comma-separated).
function extraBlockedHostnames(): string[] {
  return (process.env.RUNNER_BLOCKED_HOSTNAMES ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0
}

function ipv4InRange(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask)
}

// Anything that is not routed on the public internet is out.
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

function isBlockedIp(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) return isBlockedIPv4(ip)
  if (version === 6) return isBlockedIPv6(ip)
  return true // unrecognizable literal — fail closed
}

function hostnameBlocked(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(h) || extraBlockedHostnames().includes(h)) return true
  return BLOCKED_HOSTNAME_SUFFIXES.some((s) => h.endsWith(s))
}

/** Synchronous syntax checks only (protocol + literals) — no network. */
export function checkEndpointSyntax(raw: string, target: EndpointGuardTarget): EndpointGuardResult {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, error: `${target}: not a valid URL` }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: `${target}: must use https:// (the runner only makes HTTPS calls)` }
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, error: `${target}: URL must not contain credentials` }
  }
  // A trailing dot is the same host (`localhost.` == `localhost`).
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '')
  if (hostnameBlocked(hostname)) {
    return { ok: false, error: `${target}: host is not a public address` }
  }
  if (isIP(hostname) && isBlockedIp(hostname)) {
    return { ok: false, error: `${target}: host is a private/reserved IP range` }
  }
  return { ok: true }
}

/** Full check: syntax + DNS resolution against the same table (closes the internal-DNS-name gap). */
export async function checkEndpointSafe(raw: string, target: EndpointGuardTarget): Promise<EndpointGuardResult> {
  const syntax = checkEndpointSyntax(raw, target)
  if (!syntax.ok) return syntax

  const hostname = new URL(raw).hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname)) return { ok: true } // already checked as a literal

  try {
    const results = await lookup(hostname, { all: true, verbatim: true })
    if (results.length === 0) return { ok: false, error: `${target}: host could not be resolved` }
    if (results.some((r) => isBlockedIp(r.address))) {
      return { ok: false, error: `${target}: host resolves to a private/reserved IP range` }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: `${target}: host could not be resolved` }
  }
}
