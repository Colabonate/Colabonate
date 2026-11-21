import { useState, useCallback, useEffect } from 'react'
import {
  getFilterFavorites,
  saveFilterFavorite,
  deleteFilterFavorite,
  getFilterById,
  filtersMatch,
  type FilterFavorite,
} from '../utils/filterFavorites'

export interface UseFilterFavoritesOptions {
  /** Route path for storing filter favorites, e.g., '/buy/dashboard', '/offers' */
  route: string
}

export interface UseFilterFavoritesReturn {
  /** Get all saved filter configurations for the route */
  savedFilters: FilterFavorite[]
  /** Save current filters with a name */
  saveFilter: (name: string, filters: Record<string, unknown>) => FilterFavorite
  /** Delete a saved filter by ID */
  deleteFilter: (id: string) => void
  /** Get filter config by ID */
  getFilter: (id: string) => FilterFavorite | null
  /** Check if current filters match a saved filter */
  isFilterActive: (id: string, currentFilters: Record<string, unknown>) => boolean
  /** Refresh filters from localStorage */
  refresh: () => void
}

/**
 * Hook for managing saved filter configurations (filter favorites)
 */
export function useFilterFavorites({
  route,
}: UseFilterFavoritesOptions): UseFilterFavoritesReturn {
  const [savedFilters, setSavedFilters] = useState<FilterFavorite[]>(() =>
    getFilterFavorites(route)
  )

  // Sync across browser tabs
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === `colabonate:filters:${route}`) {
        setSavedFilters(e.newValue ? JSON.parse(e.newValue) : [])
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [route])

  const refresh = useCallback(() => {
    setSavedFilters(getFilterFavorites(route))
  }, [route])

  const saveFilter = useCallback(
    (name: string, filters: Record<string, unknown>) => {
      const newFilter = saveFilterFavorite(route, name, filters)
      setSavedFilters(getFilterFavorites(route))
      return newFilter
    },
    [route]
  )

  const deleteFilter = useCallback(
    (id: string) => {
      deleteFilterFavorite(route, id)
      setSavedFilters(getFilterFavorites(route))
    },
    [route]
  )

  const getFilter = useCallback(
    (id: string) => getFilterById(route, id),
    [route]
  )

  const isFilterActive = useCallback(
    (id: string, currentFilters: Record<string, unknown>) => {
      const saved = getFilterById(route, id)
      if (!saved) return false
      return filtersMatch(currentFilters, saved.filters)
    },
    [route]
  )

  return {
    savedFilters,
    saveFilter,
    deleteFilter,
    getFilter,
    isFilterActive,
    refresh,
  }
}