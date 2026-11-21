/**
 * usePageLayout – Layout Hook für Pages
 * 
 * Zentraler Hook für alle Layout-bezogenen Entscheidungen in Pages.
 * Nutzt useSyncExternalStore für SSR-sichere Media Queries.
 * 
 * @example
 * import { usePageLayout } from '@ds/utils'
 * 
 * function MyPage() {
 *   const { isMobile, isDesktop, navHeight, container } = usePageLayout()
 *   
 *   if (isMobile) {
 *     return <MobileLayout navHeight={navHeight} />
 *   }
 *   return <DesktopLayout />
 * }
 */

import { useSyncExternalStore, useState } from 'react';
import { LAYOUT } from './responsive';

// ─── Media Query Strings ────────────────────────────────────────────────────────

const MOBILE_QUERY = '(max-width: 899px)';
const DESKTOP_QUERY = '(min-width: 900px)';
const TABLET_QUERY = '(min-width: 600px) and (max-width: 899px)';

// ─── Media Query Helpers ───────────────────────────────────────────────────────

function createQueryListener(query: string) {
  return (callback: () => void) => {
    if (typeof window === 'undefined') return () => {};
    const mediaQuery = window.matchMedia(query);
    mediaQuery.addEventListener('change', callback);
    return () => mediaQuery.removeEventListener('change', callback);
  };
}

function getQuerySnapshot(query: string, defaultValue: boolean): boolean {
  if (typeof window === 'undefined') return defaultValue;
  return window.matchMedia(query).matches;
}

// ─── Individual Hooks ───────────────────────────────────────────────────────────

/**
 * Ist das aktuelle Gerät ein Mobile (<900px)?
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    createQueryListener(MOBILE_QUERY),
    () => getQuerySnapshot(MOBILE_QUERY, true),
    () => true, // SSR: Mobile annehmen
  );
}

/**
 * Ist das aktuelle Gerät ein Tablet (600-899px)?
 */
export function useIsTablet(): boolean {
  return useSyncExternalStore(
    createQueryListener(TABLET_QUERY),
    () => getQuerySnapshot(TABLET_QUERY, false),
    () => false, // SSR: kein Tablet
  );
}

/**
 * Ist das aktuelle Gerät ein Desktop (>=900px)?
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    createQueryListener(DESKTOP_QUERY),
    () => getQuerySnapshot(DESKTOP_QUERY, false),
    () => false, // SSR: kein Desktop
  );
}

/**
 * Aktuelle Viewport-Breite als Zahl.
 */
export function useViewportWidth(): number {
  return useSyncExternalStore(
    (callback) => {
      if (typeof window === 'undefined') return () => {};
      window.addEventListener('resize', callback);
      return () => window.removeEventListener('resize', callback);
    },
    () => typeof window !== 'undefined' ? window.innerWidth : 1024,
    () => 1024, // SSR default
  );
}

// ─── Layout Interface ──────────────────────────────────────────────────────────

export interface PageLayout {
  /** Ist aktuelles Gerät Mobile (<900px)? */
  isMobile: boolean;
  /** Ist aktuelles Gerät Tablet (600-899px)? */
  isTablet: boolean;
  /** Ist aktuelles Gerät Desktop (>=900px)? */
  isDesktop: boolean;
  /** Aktuelle Viewport-Breite */
  viewportWidth: number;
  /** Höhe der Navigation (Bottom Nav: 58px, Top Bar: 68px) */
  navHeight: number;
  /** Ob der User scrollt */
  isScrolled: boolean;
  /** Safe Area Bottom (für iOS) */
  safeAreaBottom: number;
  /** Container-Classes basierend auf Page-Größe */
  container: {
    narrow: {
      className: string;
      maxWidth: string;
    };
    standard: {
      className: string;
      maxWidth: string;
    };
    wide: {
      className: string;
      maxWidth: string;
    };
    full: {
      className: string;
      maxWidth: string;
    };
  };
  /** Grid Column Classes */
  grid: {
    cols1: string;
    cols2: string;
    cols3: string;
    cols4: string;
  };
  /** Spacing Classes */
  spacing: {
    section: string;
    card: string;
    inline: string;
  };
}

/**
 * usePageLayout – Zentraler Layout-Hook
 * 
 * Gibt alle wichtigen Layout-Informationen zurück.
 * Optimiert für die Nutzung in Pages.
 */
export function usePageLayout(): PageLayout {
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const isDesktop = useIsDesktop();
  const viewportWidth = useViewportWidth();
  
  // Scroll State - mit useState für reaktive Updates
  const [isScrolled, setIsScrolled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.scrollY > 40;
  });
  
  // Effekt für Scroll-Listener
  if (typeof window !== 'undefined') {
    // Dies läuft nur client-side
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 40);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
  }
  
  // Safe Area Bottom (iOS) - geschätzter Wert
  const safeAreaBottom = 0; // Wird via CSS env() gesetzt wenn verfügbar
  
  // Nav Height
  const navHeight = isMobile 
    ? LAYOUT.mobileNavHeight 
    : isScrolled 
      ? LAYOUT.desktopNavHeightScrolled 
      : LAYOUT.desktopNavHeight;
  
  // Container Classes
  const container = {
    narrow: {
      className: 'max-w-[720px] mx-auto px-4 sm:px-6 lg:px-8',
      maxWidth: '720px',
    },
    standard: {
      className: 'max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-8',
      maxWidth: '1100px',
    },
    wide: {
      className: 'max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8',
      maxWidth: '1200px',
    },
    full: {
      className: 'w-full px-4 sm:px-6 lg:px-8',
      maxWidth: '100%',
    },
  };
  
  // Grid Classes
  const grid = {
    cols1: 'grid grid-cols-1',
    cols2: 'grid grid-cols-1 sm:grid-cols-2',
    cols3: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    cols4: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  };
  
  // Spacing Classes
  const spacing = {
    section: 'mt-5 md:mt-6',
    card: 'p-4 md:p-5',
    inline: 'gap-3 md:gap-4',
  };
  
  return {
    isMobile,
    isTablet,
    isDesktop,
    viewportWidth,
    navHeight,
    isScrolled,
    safeAreaBottom,
    container,
    grid,
    spacing,
  };
}
