/**
 * MobileNavHeaderContext
 *
 * Lets page components push their header info (title, subtitle, icon, back handler)
 * into the mobile bottom nav bar's center slot.
 *
 * Usage in a page:
 *   useSetMobileNavHeader({ title: 'Account', subtitle: 'Einstellungen', onBack: () => navigate(-1) })
 *
 * Navbar reads the value via useMobileNavHeader() and passes it as mobileHeader to MainMenu.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

export interface MobileNavHeader {
  title: string
  subtitle?: string
  icon?: ReactNode
  onBack?: () => void
}

interface MobileNavHeaderContextValue {
  header: MobileNavHeader | null
  setHeader: (h: MobileNavHeader | null) => void
}

const MobileNavHeaderContext = createContext<MobileNavHeaderContextValue>({
  header: null,
  setHeader: () => {},
})

export function MobileNavHeaderProvider({ children }: { children: ReactNode }) {
  const [header, setHeader] = useState<MobileNavHeader | null>(null)
  const value = useMemo(() => ({ header, setHeader }), [header])
  return (
    <MobileNavHeaderContext.Provider value={value}>
      {children}
    </MobileNavHeaderContext.Provider>
  )
}

/** Read the current mobile nav header (used by Navbar). */
export function useMobileNavHeader(): MobileNavHeader | null {
  return useContext(MobileNavHeaderContext).header
}

/**
 * Set the mobile nav header for the current page.
 * Automatically clears on unmount.
 *
 * @example
 * useSetMobileNavHeader({ title: 'Account', subtitle: 'Profil & Einstellungen', onBack: () => navigate(-1) })
 */
export function useSetMobileNavHeader(header: MobileNavHeader | null) {
  const { setHeader } = useContext(MobileNavHeaderContext)
  // Keep the latest header in a ref so a publish always sends the freshest
  // object (including new onBack/icon from later renders).
  const headerRef = useRef(header)
  headerRef.current = header

  useEffect(() => {
    setHeader(headerRef.current)
    return () => setHeader(null)
    // Deps are the stable DISPLAY primitives (title/subtitle strings), NOT the
    // header object identity. Pages pass an inline object literal
    // (`{ title, subtitle, onBack: () => navigate(-1) }`) → new identity every
    // render. Keying the effect on identity caused setHeader → provider
    // re-render → page re-render → new inline object → setHeader … = the
    // "Maximum update depth exceeded" infinite loop. String deps are stable
    // across renders for a given page, so setHeader fires once on mount (and
    // again only when the title/subtitle actually change), and the ref above
    // still publishes the latest onBack/icon at that point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header?.title, header?.subtitle])
}
