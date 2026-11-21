// ── Filter Favorites CRUD ─────────────────────────────────────────────────

export interface FilterFavorite {
  id: string
  name: string
  route: string
  filters: Record<string, unknown>
  createdAt: number
}

const FILTER_KEY = 'colabonate:filters:'

/**
 * Get all saved filter configurations for a route
 * @param route - e.g., '/buy/dashboard', '/tickets'
 */
export function getFilterFavorites(route: string): FilterFavorite[] {
  try {
    const raw = localStorage.getItem(`${FILTER_KEY}${route}`)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/**
 * Get all filter favorites across all routes (for debugging/cleanup)
 */
export function getAllFilterFavorites(): Record<string, FilterFavorite[]> {
  const result: Record<string, FilterFavorite[]> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(FILTER_KEY)) {
      const route = key.replace(FILTER_KEY, '')
      result[route] = getFilterFavorites(route)
    }
  }
  return result
}

/**
 * Save a filter configuration
 * @returns The new filter object
 */
export function saveFilterFavorite(
  route: string,
  name: string,
  filters: Record<string, unknown>
): FilterFavorite {
  const favs = getFilterFavorites(route)
  const newFilter: FilterFavorite = {
    id: `filt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    route,
    filters,
    createdAt: Date.now(),
  }
  
  try {
    localStorage.setItem(`${FILTER_KEY}${route}`, JSON.stringify([...favs, newFilter]))
  } catch (e) {
    console.error('Failed to save filter favorite to localStorage:', e)
  }
  
  return newFilter
}

/**
 * Update an existing filter favorite
 */
export function updateFilterFavorite(
  route: string,
  id: string,
  updates: Partial<Pick<FilterFavorite, 'name' | 'filters'>>
): FilterFavorite | null {
  const favs = getFilterFavorites(route)
  const index = favs.findIndex(f => f.id === id)
  
  if (index === -1) return null
  
  const updated = { ...favs[index], ...updates }
  favs[index] = updated
  
  try {
    localStorage.setItem(`${FILTER_KEY}${route}`, JSON.stringify(favs))
  } catch (e) {
    console.error('Failed to update filter favorite:', e)
  }
  
  return updated
}

/**
 * Delete a filter favorite
 */
export function deleteFilterFavorite(route: string, id: string): void {
  const favs = getFilterFavorites(route)
  
  try {
    localStorage.setItem(
      `${FILTER_KEY}${route}`,
      JSON.stringify(favs.filter(f => f.id !== id))
    )
  } catch (e) {
    console.error('Failed to delete filter favorite:', e)
  }
}

/**
 * Get a specific filter by ID
 */
export function getFilterById(route: string, id: string): FilterFavorite | null {
  const favs = getFilterFavorites(route)
  return favs.find(f => f.id === id) ?? null
}

/**
 * Check if filters match a saved filter (for highlighting active filter)
 */
export function filtersMatch(
  currentFilters: Record<string, unknown>,
  savedFilters: Record<string, unknown>
): boolean {
  const keys = Object.keys(currentFilters).filter(k => currentFilters[k] !== undefined && currentFilters[k] !== '')
  if (keys.length === 0) return false
  
  return keys.every(key => {
    const current = JSON.stringify(currentFilters[key])
    const saved = JSON.stringify(savedFilters[key])
    return current === saved
  })
}