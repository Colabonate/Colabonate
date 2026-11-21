export interface PaginationArgs {
  first?: string | number
  after?: string
  includeCount?: string
}

export interface PaginatedResult<T> {
  edges: { cursor: string; node: T }[]
  pageInfo: {
    hasNextPage: boolean
    hasPreviousPage: boolean
    startCursor: string | null
    endCursor: string | null
  }
  totalCount?: number
}

export interface CursorPayload {
  id: string
  sortKey: string
}

export function decodeCursor(after: string): CursorPayload | null {
  try {
    const decoded = JSON.parse(Buffer.from(after, 'base64url').toString('utf-8'))
    if (decoded.id && decoded.sortKey) {
      const parsedDate = Date.parse(decoded.sortKey)
      if (!isNaN(parsedDate)) {
        return decoded as CursorPayload
      }
    }
  } catch {
    // invalid cursor — treated as no cursor
  }
  return null
}

export function parsePagination(query: Record<string, unknown>): {
  limit: number
  cursor: CursorPayload | null
  includeCount: boolean
} {
  const rawFirst = query.first
  const limit = Math.min(
    Math.max(1, typeof rawFirst === 'string' ? parseInt(rawFirst, 10) : (rawFirst as number) || 20),
    100,
  )
  const includeCount = query.includeCount === 'true' || query.includeCount === true

  const cursor =
    query.after && typeof query.after === 'string' ? decodeCursor(query.after) : null

  return { limit, cursor, includeCount }
}

export function encodeCursor(id: string, sortKey: string): string {
  return Buffer.from(JSON.stringify({ id, sortKey })).toString('base64url')
}

export function buildPaginatedResult<T extends { id: string }>(
  items: T[],
  limit: number,
  getSortKey: (item: T) => string,
  totalCount?: number,
): PaginatedResult<T> {
  const hasNextPage = items.length > limit
  const edges = items.slice(0, limit).map((item) => ({
    cursor: encodeCursor(item.id, getSortKey(item)),
    node: item,
  }))

  return {
    edges,
    pageInfo: {
      hasNextPage,
      hasPreviousPage: false,
      startCursor: edges.length > 0 ? edges[0].cursor : null,
      endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
    },
    ...(totalCount !== undefined ? { totalCount } : {}),
  }
}
