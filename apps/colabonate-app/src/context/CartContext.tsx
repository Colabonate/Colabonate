import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CartItem, DeliveryAddress } from '../types/api'
import { apiCall } from '../lib/api'
import { applySourceResults, needsSourceCheck, parseStoredCart } from '../lib/cart-integrity'

const CART_STORAGE_KEY = 'colabonate_cart'
const DELIVERY_STORAGE_KEY = 'colabonate_delivery'
const GUEST_CART_SESSION_KEY = 'colabonate_cart_guest_session'
// ADR-415: the "removed because remote" notice outlives the page. Removal runs at app start,
// but a guest who goes on to log in triggers a full reload that would otherwise drop the
// in-memory notice. Device-level on purpose (no pubkey suffix): it holds only public offer ids
// and titles, and stays until the user dismisses it.
const REMOVED_REMOTE_KEY = 'colabonate_cart_removed_remote'
// Legacy items are checked against the server at most this many per run; the
// rest are checked on a later change of the legacy set.
const LEGACY_CHECK_MAX_PER_RUN = 25

interface CartContextValue {
  items: CartItem[]
  deliveryAddress: DeliveryAddress | null
  itemCount: number
  totalSats: number
  addItem: (item: Omit<CartItem, 'quantity'>) => void
  removeItem: (offerId: string) => void
  updateQuantity: (offerId: string, quantity: number) => void
  clearCart: () => void
  setDeliveryAddress: (address: DeliveryAddress | null) => void
  isInCart: (offerId: string) => boolean
  lastAddedItem: CartItem | null
  undoLastAdd: () => void
  // ADR-415: items dropped because their offer turned out to be REMOTE.
  removedRemoteItems: CartItem[]
  dismissRemovedRemoteItems: () => void
}

const CartContext = createContext<CartContextValue | null>(null)

// ADR-394: cart + delivery are per-identity. The storage key is suffixed with
// the logged-in pubkey so a cart never leaks from one user to the next on a
// shared device (previously one global key survived logout/login). The legacy
// unsuffixed key is deliberately NOT migrated into a logged-in session —
// adopting it would be exactly the leak this prevents; it stays only as the
// anonymous (logged-out) cart.
function storageKey(base: string): string {
  try {
    const pubkey = localStorage.getItem('pubkey')
    return pubkey ? `${base}:${pubkey}` : base
  } catch {
    return base
  }
}

/** Shipping charged once per cart line — physical ITEM/PRODUCT only (FU-842). */
export function lineShippingSats(item: Pick<CartItem, 'offerType' | 'deliveryCostSats'>): number {
  if (item.offerType !== 'ITEM' && item.offerType !== 'PRODUCT') return 0
  const cost = item.deliveryCostSats ?? 0
  return Number.isInteger(cost) && cost > 0 ? cost : 0
}

function loadCartItems(): CartItem[] {
  try {
    const raw = localStorage.getItem(storageKey(CART_STORAGE_KEY))
    return raw ? parseStoredCart(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

function saveCartItems(items: CartItem[]): void {
  try {
    localStorage.setItem(storageKey(CART_STORAGE_KEY), JSON.stringify(items))
    // Mark a guest cart as filled in THIS tab session (sessionStorage survives
    // the full-page reload that every login performs, but not a new tab or a
    // browser restart) — see adoptGuestCart().
    if (!localStorage.getItem('pubkey') && items.length > 0) {
      sessionStorage.setItem(GUEST_CART_SESSION_KEY, '1')
    }
  } catch {
    // Storage unavailable (private mode / quota) — the in-memory cart still works.
  }
}

// ADR-394: checkout requires login (BuyCartFlow → requireLogin), and every
// login does a full reload. Without a handoff the guest's cart would vanish at
// exactly that step, because the logged-in key is `colabonate_cart:<pubkey>`.
// Only a guest cart that was filled in this same tab session is adopted (and
// then removed from the anonymous key); a leftover anonymous cart from another
// person on a shared device carries no session marker and is never adopted.
function adoptGuestCart(): void {
  try {
    const pubkey = localStorage.getItem('pubkey')
    if (!pubkey || sessionStorage.getItem(GUEST_CART_SESSION_KEY) !== '1') return
    sessionStorage.removeItem(GUEST_CART_SESSION_KEY)
    const guestItems = parseStoredCart(JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? '[]'))
    if (guestItems.length > 0) {
      const userKey = `${CART_STORAGE_KEY}:${pubkey}`
      const userItems = parseStoredCart(JSON.parse(localStorage.getItem(userKey) ?? '[]'))
      const merged = [...userItems]
      for (const item of guestItems) {
        if (!merged.some(i => i.offerId === item.offerId)) merged.push(item)
      }
      localStorage.setItem(userKey, JSON.stringify(merged))
      const guestAddress = localStorage.getItem(DELIVERY_STORAGE_KEY)
      const userAddressKey = `${DELIVERY_STORAGE_KEY}:${pubkey}`
      if (guestAddress && !localStorage.getItem(userAddressKey)) {
        localStorage.setItem(userAddressKey, guestAddress)
      }
    }
    localStorage.removeItem(CART_STORAGE_KEY)
    localStorage.removeItem(DELIVERY_STORAGE_KEY)
  } catch {
    // Corrupt JSON or storage unavailable — leave both carts untouched.
  }
}

function loadRemovedRemoteItems(): CartItem[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(REMOVED_REMOTE_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((e): e is CartItem => (
      typeof e === 'object' && e !== null
      && typeof (e as CartItem).offerId === 'string' && typeof (e as CartItem).title === 'string'
    ))
  } catch {
    return []
  }
}

function saveRemovedRemoteItems(items: CartItem[]): void {
  try {
    if (items.length > 0) localStorage.setItem(REMOVED_REMOTE_KEY, JSON.stringify(items))
    else localStorage.removeItem(REMOVED_REMOTE_KEY)
  } catch {
    // Storage unavailable — the in-memory notice still works for this page view.
  }
}

function loadDeliveryAddress(): DeliveryAddress | null {
  try {
    const raw = localStorage.getItem(storageKey(DELIVERY_STORAGE_KEY))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveDeliveryAddress(address: DeliveryAddress | null): void {
  if (address) {
    localStorage.setItem(storageKey(DELIVERY_STORAGE_KEY), JSON.stringify(address))
  } else {
    localStorage.removeItem(storageKey(DELIVERY_STORAGE_KEY))
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => {
    adoptGuestCart()
    return loadCartItems()
  })
  const [deliveryAddress, setDeliveryAddressState] = useState<DeliveryAddress | null>(loadDeliveryAddress)
  const [lastAddedItem, setLastAddedItem] = useState<CartItem | null>(null)
  const [removedRemoteItems, setRemovedRemoteItems] = useState<CartItem[]>(loadRemovedRemoteItems)
  useEffect(() => { saveRemovedRemoteItems(removedRemoteItems) }, [removedRemoteItems])

  // Persist cart items to localStorage
  useEffect(() => { saveCartItems(items) }, [items])

  // ADR-415: legacy items (saved before the source field existed) are checked
  // once against the server. REMOTE ones are removed; failed lookups change
  // nothing and are retried on the next load.
  const legacyIds = items.filter(needsSourceCheck).map(i => i.offerId).join(',')
  useEffect(() => {
    if (!legacyIds) return
    let cancelled = false
    // Snapshot of the legacy items at the time the check started; used only to
    // report which items were removed. The removal itself uses functional state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const snapshot = items
    const ids = legacyIds.split(',').slice(0, LEGACY_CHECK_MAX_PER_RUN)
    ;(async () => {
      const settled = await Promise.allSettled(ids.map(async (id) => {
        const res = await apiCall(`/api/offers/${encodeURIComponent(id)}`)
        const data = await res.json()
        if (!data?.offer) throw new Error('offer missing in response')
        return { id, source: data.offer.source === 'REMOTE' ? 'REMOTE' as const : 'LOCAL' as const }
      }))
      if (cancelled) return
      const results: Record<string, 'LOCAL' | 'REMOTE'> = {}
      for (const r of settled) {
        if (r.status === 'fulfilled') results[r.value.id] = r.value.source
      }
      if (Object.keys(results).length === 0) return
      const { removedRemote } = applySourceResults(snapshot, results)
      setItems(prev => applySourceResults(prev, results).items)
      if (removedRemote.length > 0) {
        setRemovedRemoteItems(prev => [...prev, ...removedRemote])
      }
    })()
    return () => { cancelled = true }
  }, [legacyIds])

  // ADR-394: another tab logging in/out changes `pubkey`; reload that identity's
  // cart so the two tabs do not cross-contaminate. Same-tab login/logout does
  // a full page reload (window.location.href), which re-initialises the
  // provider from the new key (and runs adoptGuestCart) anyway.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'pubkey') return
      setItems(loadCartItems())
      setDeliveryAddressState(loadDeliveryAddress())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Persist delivery address
  const setDeliveryAddress = useCallback((address: DeliveryAddress | null) => {
    setDeliveryAddressState(address)
    saveDeliveryAddress(address)
  }, [])

  const addItem = useCallback((newItem: Omit<CartItem, 'quantity'>) => {
    // ADR-415: remote offers can never be ordered, so they never enter the basket.
    if (newItem.source === 'REMOTE') return
    setItems(prev => {
      const existing = prev.find(i => i.offerId === newItem.offerId)
      if (existing) {
        // Increment quantity, respect stock limit
        const maxQty = existing.stock ?? 99
        const newQty = Math.min(existing.quantity + 1, maxQty)
        return prev.map(i => i.offerId === newItem.offerId ? { ...i, quantity: newQty } : i)
      }
      const added: CartItem = { ...newItem, quantity: 1 }
      setLastAddedItem(added)
      return [...prev, added]
    })
  }, [])

  const undoLastAdd = useCallback(() => {
    if (!lastAddedItem) return
    setItems(prev => {
      const existing = prev.find(i => i.offerId === lastAddedItem.offerId)
      if (existing && existing.quantity > 1) {
        return prev.map(i => i.offerId === lastAddedItem.offerId ? { ...i, quantity: i.quantity - 1 } : i)
      }
      return prev.filter(i => i.offerId !== lastAddedItem.offerId)
    })
    setLastAddedItem(null)
  }, [lastAddedItem])

  const removeItem = useCallback((offerId: string) => {
    setItems(prev => prev.filter(i => i.offerId !== offerId))
  }, [])

  const updateQuantity = useCallback((offerId: string, quantity: number) => {
    if (quantity < 1) {
      setItems(prev => prev.filter(i => i.offerId !== offerId))
      return
    }
    setItems(prev => prev.map(i => {
      if (i.offerId !== offerId) return i
      const maxQty = i.stock ?? 99
      return { ...i, quantity: Math.min(quantity, maxQty) }
    }))
  }, [])

  const clearCart = useCallback(() => {
    setItems([])
  }, [])

  const isInCart = useCallback((offerId: string) => {
    return items.some(i => i.offerId === offerId)
  }, [items])

  const dismissRemovedRemoteItems = useCallback(() => {
    setRemovedRemoteItems([])
  }, [])

  const itemCount = useMemo(() => items.reduce((sum, i) => sum + i.quantity, 0), [items])
  // Mirrors the server total (ADR-394 FU-842): price × quantity per line, plus
  // the line's shipping ONCE for physical goods. The server stays authoritative.
  const totalSats = useMemo(() => items.reduce((sum, i) => sum + i.priceSats * i.quantity + lineShippingSats(i), 0), [items])

  return (
    <CartContext.Provider value={{
      items, deliveryAddress, itemCount, totalSats,
      addItem, removeItem, updateQuantity, clearCart,
      setDeliveryAddress, isInCart,
      lastAddedItem, undoLastAdd,
      removedRemoteItems, dismissRemovedRemoteItems,
    }}>
      {children}
    </CartContext.Provider>
  )
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
