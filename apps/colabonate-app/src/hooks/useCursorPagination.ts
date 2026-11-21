import { useState, useCallback, useRef } from 'react'

export interface CursorResult<T> {
  edges: { cursor: string; node: T }[]
  pageInfo: {
    hasNextPage: boolean
    hasPreviousPage: boolean
    startCursor: string | null
    endCursor: string | null
  }
  totalCount?: number
}

export function useCursorPagination<T>(
  fetchFn: (first: number, after?: string) => Promise<Response>,
  options?: { initialFirst?: number },
) {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [totalCount, setTotalCount] = useState<number | undefined>(undefined)
  const endCursorRef = useRef<string | null>(null)
  const isFetchingMore = useRef(false)

  const loadInitial = useCallback(async (first?: number) => {
    setLoading(true)
    try {
      const res = await fetchFn(first ?? options?.initialFirst ?? 20)
      const data = await res.json() as CursorResult<T>
      setItems(data.edges?.map(e => e.node) ?? [])
      setHasNextPage(data.pageInfo?.hasNextPage ?? false)
      setTotalCount(data.totalCount)
      endCursorRef.current = data.pageInfo?.endCursor ?? null
    } finally {
      setLoading(false)
    }
  }, [fetchFn, options?.initialFirst])

  const loadMore = useCallback(async () => {
    if (isFetchingMore.current || !hasNextPage || !endCursorRef.current) return
    isFetchingMore.current = true
    try {
      const res = await fetchFn(20, endCursorRef.current)
      const data = await res.json() as CursorResult<T>
      setItems(prev => [...prev, ...(data.edges?.map(e => e.node) ?? [])])
      setHasNextPage(data.pageInfo?.hasNextPage ?? false)
      endCursorRef.current = data.pageInfo?.endCursor ?? null
    } finally {
      isFetchingMore.current = false
    }
  }, [fetchFn, hasNextPage])

  const reset = useCallback(async (first?: number) => {
    endCursorRef.current = null
    await loadInitial(first)
  }, [loadInitial])

  return {
    items,
    loading,
    hasNextPage,
    totalCount,
    loadInitial,
    loadMore,
    reset,
  }
}