import { useState, useEffect, useCallback } from 'react'
import {
  getFavorites,
  toggleFavorite as toggleFavoriteUtil,
  addFavorite,
  removeFavorite,
} from '../utils/favorites'

export interface UseFavoritesOptions {
  /** Entity type for localStorage key, e.g., 'offer', 'vendor', 'product' */
  entityType: string
  /** Show snackbar messages on add/remove */
  showSnackbar?: boolean
  /** Custom snackbar function (optional, uses context if not provided) */
  showSnackbarFn?: (message: string, severity: 'success' | 'info' | 'warning' | 'error') => void
}

export interface UseFavoritesReturn {
  /** Check if a specific ID is a favorite */
  isFavorite: (id: string) => boolean
  /** Toggle favorite status for an ID */
  toggleFavorite: (id: string) => void
  /** Add a favorite */
  addFavorite: (id: string) => void
  /** Remove a favorite */
  removeFavorite: (id: string) => void
  /** Get all favorite IDs */
  favorites: string[]
  /** Refresh favorites from localStorage */
  refresh: () => void
}

/**
 * Hook for managing entity favorites with localStorage persistence
 * and optional snackbar notifications
 */
export function useFavorites({
  entityType,
  showSnackbar = false,
  showSnackbarFn,
}: UseFavoritesOptions): UseFavoritesReturn {
  const [favorites, setFavoritesState] = useState<string[]>(() => 
    getFavorites(entityType)
  )

  // Sync across browser tabs
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === `colabonate:favorites:${entityType}`) {
        setFavoritesState(e.newValue ? JSON.parse(e.newValue) : [])
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [entityType])

  const refresh = useCallback(() => {
    setFavoritesState(getFavorites(entityType))
  }, [entityType])

  const isFavorite = useCallback(
    (id: string) => favorites.includes(id),
    [favorites]
  )

  const handleAddFavorite = useCallback(
    (id: string) => {
      const isNowFavorite = addFavorite(entityType, id)
      if (isNowFavorite && showSnackbar && showSnackbarFn) {
        showSnackbarFn('Added to favorites', 'success')
      }
      setFavoritesState(getFavorites(entityType))
    },
    [entityType, showSnackbar, showSnackbarFn]
  )

  const handleRemoveFavorite = useCallback(
    (id: string) => {
      const isNowFavorite = removeFavorite(entityType, id)
      if (!isNowFavorite && showSnackbar && showSnackbarFn) {
        showSnackbarFn('Removed from favorites', 'info')
      }
      setFavoritesState(getFavorites(entityType))
    },
    [entityType, showSnackbar, showSnackbarFn]
  )

  const handleToggleFavorite = useCallback(
    (id: string) => {
      const isNowFavorite = toggleFavoriteUtil(entityType, id)
      if (showSnackbar && showSnackbarFn) {
        if (isNowFavorite) {
          showSnackbarFn('Added to favorites', 'success')
        } else {
          showSnackbarFn('Removed from favorites', 'info')
        }
      }
      setFavoritesState(getFavorites(entityType))
    },
    [entityType, showSnackbar, showSnackbarFn]
  )

  return {
    isFavorite,
    toggleFavorite: handleToggleFavorite,
    addFavorite: handleAddFavorite,
    removeFavorite: handleRemoveFavorite,
    favorites,
    refresh,
  }
}

/**
 * Hook for managing favorites with Undo support
 * Requires showSnackbarWithUndo to be available
 */
export interface UseFavoritesWithUndoOptions extends Omit<UseFavoritesOptions, 'showSnackbarFn'> {
  /** Snackbar function with undo support */
  showSnackbarWithUndo?: (params: {
    message: string
    severity: 'success' | 'info'
    undoLabel?: string
    onUndo?: () => void
    duration?: number
  }) => void
}

export interface UseFavoritesWithUndoReturn extends UseFavoritesReturn {
  /** Toggle with undo support for remove action */
  toggleFavoriteWithUndo: (id: string, itemTitle?: string) => void
}

export function useFavoritesWithUndo({
  entityType,
  showSnackbarWithUndo,
}: UseFavoritesWithUndoOptions): UseFavoritesWithUndoReturn {
  const [favorites, setFavoritesState] = useState<string[]>(() => 
    getFavorites(entityType)
  )

  // Sync across browser tabs
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === `colabonate:favorites:${entityType}`) {
        setFavoritesState(e.newValue ? JSON.parse(e.newValue) : [])
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [entityType])

  const refresh = useCallback(() => {
    setFavoritesState(getFavorites(entityType))
  }, [entityType])

  const isFavorite = useCallback(
    (id: string) => favorites.includes(id),
    [favorites]
  )

  const handleAddFavorite = useCallback(
    (id: string) => {
      const isNowFavorite = addFavorite(entityType, id)
      if (isNowFavorite && showSnackbarWithUndo) {
        showSnackbarWithUndo({
          message: 'Added to favorites',
          severity: 'success',
        })
      }
      setFavoritesState(getFavorites(entityType))
    },
    [entityType, showSnackbarWithUndo]
  )

  const handleRemoveFavorite = useCallback(
    (id: string) => {
      const isNowFavorite = removeFavorite(entityType, id)
      if (!isNowFavorite && showSnackbarWithUndo) {
        // Undo: re-add the favorite
        showSnackbarWithUndo({
          message: 'Removed from favorites',
          severity: 'info',
          undoLabel: 'Undo',
          duration: 5000,
          onUndo: () => {
            addFavorite(entityType, id)
            setFavoritesState(getFavorites(entityType))
            showSnackbarWithUndo?.({
              message: 'Favorite restored',
              severity: 'success',
            })
          },
        })
      }
      setFavoritesState(getFavorites(entityType))
    },
    [entityType, showSnackbarWithUndo]
  )

  const handleToggleFavorite = useCallback(
    (id: string) => {
      const isNowFavorite = toggleFavoriteUtil(entityType, id)
      
      if (showSnackbarWithUndo) {
        if (isNowFavorite) {
          showSnackbarWithUndo({
            message: 'Added to favorites',
            severity: 'success',
            duration: 3000,
          })
        } else {
          // Undo: re-add the favorite
          showSnackbarWithUndo({
            message: 'Removed from favorites',
            severity: 'info',
            undoLabel: 'Undo',
            duration: 5000,
            onUndo: () => {
              addFavorite(entityType, id)
              setFavoritesState(getFavorites(entityType))
              showSnackbarWithUndo?.({
                message: 'Favorite restored',
                severity: 'success',
              })
            },
          })
        }
      }
      
      setFavoritesState(getFavorites(entityType))
    },
    [entityType, favorites, showSnackbarWithUndo]
  )

  // Convenience method for toggle with undo (explicit)
  const toggleFavoriteWithUndo = useCallback(
    (id: string, _itemTitle?: string) => {
      handleToggleFavorite(id)
    },
    [handleToggleFavorite]
  )

  return {
    isFavorite,
    toggleFavorite: handleToggleFavorite,
    toggleFavoriteWithUndo,
    addFavorite: handleAddFavorite,
    removeFavorite: handleRemoveFavorite,
    favorites,
    refresh,
  }
}