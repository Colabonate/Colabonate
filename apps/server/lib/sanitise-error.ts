/**
 * FU-26 (ADR-179): strip internal config / admin keys / wallet ids / internal
 * URLs from an upstream error message before returning it to the client.
 *
 * Keeps a short human-readable summary — the LNBits `{"detail": "..."}` /
 * LND `{"message": "..."}` field, or the HTTP status — so the user still gets
 * actionable feedback ("Not enough balance") without the raw body that can
 * echo internal hosts, ports, or key material.
 *
 * Server logs keep the full raw message (the call sites `console.error` the
 * original `error`); this only affects what crosses the wire to the client.
 */

const MAX_LEN = 200

/** Hex runs (≥16 chars) or base64-ish runs (≥24 chars) — keys, wallet ids, hashes. */
const KEY_RE = /\b[a-f0-9]{16,}\b|\b[A-Za-z0-9+/_-]{24,}\b/gi
/** Absolute URLs — internal hosts, ports, query strings carrying tokens. */
const URL_RE = /https?:\/\/[^\s"')]+/gi
/** An HTTP status code (4xx / 5xx) embedded anywhere in the message. */
const STATUS_RE = /\b([45]\d\d)\b/
/** A brace-delimited JSON object somewhere in the message. */
const JSON_RE = /\{[\s\S]*\}/

function looksLikeHtml(s: string): boolean {
  return /^\s*<(?:!doctype|html|head|body|h1|center|title)\b/i.test(s) || /<html\b/i.test(s)
}

/**
 * Returns a client-safe summary of an upstream payment-provider error.
 *
 * @param raw the thrown value (Error or string) from the provider call.
 */
export function sanitiseUpstreamError(raw: unknown): string {
  const message = raw instanceof Error ? raw.message : String(raw ?? '')

  // nginx/Apache 502 pages are full HTML and routinely leak internal hostnames.
  if (looksLikeHtml(message)) {
    const s = message.match(STATUS_RE)?.[1]
    return s ? `Upstream provider error (HTTP ${s}).` : 'Upstream payment provider returned an HTML error page.'
  }

  const status = message.match(STATUS_RE)?.[1]

  // Isolate the provider's body: drop any leading wrapper before the body.
  // Providers format errors as "LNBits API error: 401 - <body>" /
  // "LND error: 500 - <body>"; the useful part is what follows the status.
  let body = message
  if (status) {
    const afterStatus = message.slice(message.indexOf(status) + status.length)
    const stripped = afterStatus.replace(/^[\s:.\-|]+/, '')
    if (stripped) body = stripped
  }

  // If the body is a JSON object, pull the human-readable field out of it —
  // LNBits uses {"detail": "..."}, LND uses {"message": "..."}, some {"error": "..."}.
  let human: string | undefined
  let hadJson = false
  const jsonMatch = body.match(JSON_RE)
  if (jsonMatch) {
    hadJson = true
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
      const detail = parsed.detail ?? parsed.message ?? parsed.error
      if (typeof detail === 'string' && detail.trim()) human = detail.trim()
    } catch {
      // not valid JSON — fall through to redacting the body text
    }
  }

  // A JSON body with no human-readable field (e.g. "{}") carries no useful
  // detail — don't leak the wrapper text, return a status-only summary.
  if (hadJson && !human) {
    return status ? `Upstream provider error (HTTP ${status}).` : 'Upstream payment provider error.'
  }

  const redacted = (human ?? body)
    .replace(URL_RE, '<url>')
    .replace(KEY_RE, '<redacted>')
    .replace(/\s+/g, ' ')
    .trim()

  const out = redacted.length > MAX_LEN ? `${redacted.slice(0, MAX_LEN)}…` : redacted
  if (!out) return status ? `Upstream provider error (HTTP ${status}).` : 'Upstream payment provider error.'
  return status ? `HTTP ${status}: ${out}` : out
}
