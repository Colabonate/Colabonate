import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { apiCall } from '../lib/api'

export interface SearchSuggestOffer {
  id: string
  title: string
  categoryCode: string
  offerType: string
}

export interface SearchSuggestCategory {
  code: string
  label: string
  count: number
}

export interface SearchSuggestResult {
  offers: SearchSuggestOffer[]
  categories: SearchSuggestCategory[]
}

function getBrowserLanguage(): string {
  return typeof navigator !== 'undefined' ? navigator.language : 'en'
}

export function useSearchSuggest(q: string) {
  const [debouncedQ, setDebouncedQ] = useState('')

  useEffect(() => {
    if (q.length < 2) {
      setDebouncedQ('')
      return
    }
    const timeoutId = setTimeout(() => setDebouncedQ(q), 200)
    return () => clearTimeout(timeoutId)
  }, [q])

  const lang = getBrowserLanguage()

  return useQuery<SearchSuggestResult>({
    queryKey: ['search-suggest', { q: debouncedQ, lang }],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        q: debouncedQ,
        limit: '6',
        lang,
      })
      const response = await apiCall(`/api/search/suggest?${params.toString()}`, { signal })
      return response.json()
    },
    enabled: debouncedQ.length >= 2,
    staleTime: 60_000,
    retry: false,
  })
}
