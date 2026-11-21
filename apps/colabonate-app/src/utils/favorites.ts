// ── Entity Favorites CRUD ─────────────────────────────────────────────────

const FAVORITES_KEY = 'colabonate:favorites:'

/**
 * Get all favorite IDs for a given entity type
 * @param entityType - e.g., 'offer', 'vendor', 'product'
 */
export function getFavorites(entityType: string): string[] {
  try {
    const raw = localStorage.getItem(`${FAVORITES_KEY}${entityType}`)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/**
 * Set favorites for an entity type
 * @param entityType - e.g., 'offer', 'vendor', 'product'
 * @param ids - Array of entity IDs
 */
export function setFavorites(entityType: string, ids: string[]): void {
  try {
    localStorage.setItem(`${FAVORITES_KEY}${entityType}`, JSON.stringify(ids))
  } catch (e) {
    console.error('Failed to save favorites to localStorage:', e)
  }
}

/**
 * Add an entity to favorites
 * @returns New favorite state (true = is now favorite)
 */
export function addFavorite(entityType: string, id: string): boolean {
  const favs = getFavorites(entityType)
  if (favs.includes(id)) return true
  
  setFavorites(entityType, [...favs, id])
  return true
}

/**
 * Remove an entity from favorites
 * @returns New favorite state (false = is no longer favorite)
 */
export function removeFavorite(entityType: string, id: string): boolean {
  const favs = getFavorites(entityType)
  if (!favs.includes(id)) return false
  
  setFavorites(entityType, favs.filter(f => f !== id))
  return false
}

/**
 * Toggle favorite status
 * @returns New favorite state after toggle
 */
export function toggleFavorite(entityType: string, id: string): boolean {
  const favs = getFavorites(entityType)
  const isFav = favs.includes(id)
  
  if (isFav) {
    setFavorites(entityType, favs.filter(f => f !== id))
    return false
  } else {
    setFavorites(entityType, [...favs, id])
    return true
  }
}

/**
 * Check if an entity is a favorite
 */
export function isFavorite(entityType: string, id: string): boolean {
  return getFavorites(entityType).includes(id)
}

/**
 * Clear all favorites for an entity type
 */
export function clearFavorites(entityType: string): void {
  setFavorites(entityType, [])
}