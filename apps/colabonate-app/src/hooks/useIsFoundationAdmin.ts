import { useState, useEffect } from 'react'
import { apiCall } from '../lib/api'

export function useIsFoundationAdmin(pubkey?: string | null): boolean {
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    if (!pubkey || !window.nostr) return

    let cancelled = false

    async function check() {
      try {
        const res = await apiCall('/api/dao/foundation/admins')
        if (cancelled) return

        if (res.ok) {
          const data = await res.json()
          if (!cancelled) setIsAdmin(data.adminPubkeys?.includes(pubkey) ?? false)
        }
      } catch {
        if (!cancelled) setIsAdmin(false)
      }
    }

    check()
    return () => { cancelled = true }
  }, [pubkey])

  return isAdmin
}
