// ADR-414 / FU-961 — keep external MCP tool results small.
//
// Found live on colabonate.app (2026-11-12): list_daos returned 512 KB for one
// DAO (510 KB of it inline `data:image/webp;base64,…`), list_bounties 162 KB for
// two bounties, discover_cooperations 242 KB for six cooperations — each record
// twice (`edges[].node` and `cooperations[]`) plus base64 thumbnails. One such
// call can exceed an agent's whole context window, and an agent cannot use a
// base64 blob for anything.
//
// The external gateway therefore post-processes every tool result:
//   1. inline base64 image data URIs are replaced by a short placeholder
//      (works inside nested JSON AND inside JSON-in-a-string fields such as
//      `images: "[\"data:image/…\"]"`, because it operates on the text);
//   2. a cooperation page that carries both `edges` and `cooperations` for the
//      same records is reduced to `cooperations` + `pageInfo`.
// `upload_image` is exempt: it returns the stored URL, which can itself be a
// data URL the agent must pass back verbatim in `images[]`.
//
// The in-app AI assistant builds its own server (adapter/ai-chat.ts) and keeps
// the full payloads — its result cards render thumbnails from them.

export const INLINE_IMAGE_PLACEHOLDER = '[inline image omitted]'

/** Tools whose output may legitimately contain a data URL the caller must reuse. */
export const COMPACT_EXEMPT_TOOLS: ReadonlySet<string> = new Set(['upload_image'])

// Base64 alphabet only (no JSON-significant characters), so the match never
// swallows a quote or backslash and the surrounding JSON stays valid.
const INLINE_IMAGE = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{64,}/gi

export function compactText(text: string): string {
  let out = text.replace(INLINE_IMAGE, INLINE_IMAGE_PLACEHOLDER)

  // Cheap guard first: only parse the shape that is known to duplicate.
  if (out.startsWith('{') && out.includes('"edges"') && out.includes('"cooperations"')) {
    try {
      const parsed = JSON.parse(out) as Record<string, unknown>
      if (
        Array.isArray(parsed.edges) &&
        Array.isArray(parsed.cooperations) &&
        parsed.edges.length === parsed.cooperations.length
      ) {
        delete parsed.edges
        out = JSON.stringify(parsed)
      }
    } catch {
      // not JSON after all — leave the (already image-stripped) text as is
    }
  }
  return out
}

export function compactToolResult<T>(tool: string, result: T): T {
  if (COMPACT_EXEMPT_TOOLS.has(tool) || !result || typeof result !== 'object') return result
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) return result
  return {
    ...(result as object),
    content: content.map((item) =>
      item && typeof item === 'object' && (item as { type?: unknown }).type === 'text' && typeof (item as { text?: unknown }).text === 'string'
        ? { ...(item as object), text: compactText((item as { text: string }).text) }
        : item
    ),
  } as T
}
