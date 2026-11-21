import { useCallback, useEffect, useMemo, useState } from 'react'

// Probes image URLs in the browser and reports whether each one actually
// renders a real picture. `images.length > 0` alone is not a usable signal:
// remote (Nostr-ingested) listings frequently carry dead URLs or 1x1
// placeholder pixels (e.g. every media.reventioned.com URL serves the same
// 69-byte 1x1 PNG), so they pass the array check but render nothing.
//
// Results are cached session-wide per URL, so repeated mounts, route
// switches and the 30s polling refetches probe each URL only once.

const probeCache = new Map<string, Promise<boolean>>()

const PROBE_TIMEOUT_MS = 10_000

function probeImage(url: string): Promise<boolean> {
  let pending = probeCache.get(url)
  if (!pending) {
    pending = new Promise<boolean>(resolve => {
      const img = new Image()
      const timer = setTimeout(() => {
        img.src = '' // cancel the load
        resolve(false)
      }, PROBE_TIMEOUT_MS)
      img.onload = () => {
        clearTimeout(timer)
        // 1x1 (or 0x0) means tracking pixel / placeholder, not a picture.
        resolve(img.naturalWidth > 1 && img.naturalHeight > 1)
      }
      img.onerror = () => {
        clearTimeout(timer)
        resolve(false)
      }
      img.src = url
    })
    probeCache.set(url, pending)
  }
  return pending
}

export interface ImageValidity {
  /**
   * Tri-state usable check:
   * - no URL / empty array → `false` (definitely no image)
   * - probed broken or 1x1 → `false`
   * - probed OK **or not yet probed** → `true` (optimistic; bad entries drop
   *   out as their probes resolve instead of the whole list flashing empty)
   */
  isUsableImage: (url: string | undefined) => boolean
}

export function useImageValidity(urls: ReadonlyArray<string | undefined>): ImageValidity {
  const uniqueKey = useMemo(
    () => Array.from(new Set(urls.filter((u): u is string => Boolean(u)))).join('|'),
    [urls],
  )
  const [validity, setValidity] = useState<ReadonlyMap<string, boolean>>(new Map())

  useEffect(() => {
    if (!uniqueKey) return
    let cancelled = false
    for (const url of uniqueKey.split('|')) {
      void probeImage(url).then(ok => {
        if (cancelled) return
        setValidity(prev => {
          if (prev.get(url) === ok) return prev
          const next = new Map(prev)
          next.set(url, ok)
          return next
        })
      })
    }
    return () => { cancelled = true }
  }, [uniqueKey])

  const isUsableImage = useCallback(
    (url: string | undefined) => (url ? validity.get(url) !== false : false),
    [validity],
  )

  return { isUsableImage }
}
