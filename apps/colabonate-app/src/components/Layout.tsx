import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Box } from '@mui/material'
import { useLocation, useNavigation } from 'react-router-dom'
import { Navbar } from './Navbar'
import { PollingBar } from '@ds/ui'
import { useIsMobile } from '@ds/utils'
import { useNotification, usePollingBar } from '../context/NotificationContext'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { useViewportBottomOffset } from '../hooks/useViewportBottomOffset'
import { SnackbarManager } from './SnackbarManager'
import { CoopDockSection } from './home/CoopDockSection'
import { AppFooter } from './Footer'
import { AIAssistant } from './ai-assistant/AIAssistant'
import { FeedbackWidget } from './feedback/FeedbackWidget'
import { IdentitySignerNotice } from './identity/IdentitySignerNotice'
import { ImmersiveLayoutContext } from '../context/ImmersiveLayoutContext'

function NavigationProgress() {
  const { state } = useNavigation()
  if (state !== 'loading') return null
  return (
    <Box sx={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: '2px',
      zIndex: 9999,
      bgcolor: 'var(--color-action-primary-default)',
      animation: 'nav-progress 1.2s ease-in-out infinite',
      '@keyframes nav-progress': {
        '0%':   { transform: 'scaleX(0)', transformOrigin: 'left' },
        '60%':  { transform: 'scaleX(0.8)', transformOrigin: 'left' },
        '100%': { transform: 'scaleX(1)', transformOrigin: 'left', opacity: 0 },
      },
    }} />
  )
}

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  const { barStatus, progress, countdownTick } = usePollingBar()
  const { notifications, transientSnackbarQueue, clearTransientSnackbar } = useNotification()
  const transientSnackbar = transientSnackbarQueue[0] ?? null
  const reducedMotion = useReducedMotion()
  const isMobile = useIsMobile()
  // Firefox Android leaves bottom-fixed elements behind when its URL bar hides.
  const { ref: navDockRef, offset: navDockOffset } = useViewportBottomOffset<HTMLDivElement>(isMobile)
  const location = useLocation()
  const isHome = location.pathname === '/'

  // ADR-406 D3: immersive layout contract. `immersive` is toggled by a route
  // via useImmersiveLayout(); the live chrome sizes are published as CSS
  // custom properties so a full-bleed page can fill the space between the
  // header and the footer without hardcoding 58/68px.
  const [immersive, setImmersive] = useState(false)
  const [navH, setNavH] = useState(0)
  const [footerH, setFooterH] = useState(0)
  const navMeasureRef = useRef<HTMLDivElement | null>(null)
  const footerMeasureRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = navMeasureRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setNavH(el.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = footerMeasureRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setFooterH(el.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const immersiveContext = useMemo(() => ({ immersive, setImmersive }), [immersive])

  return (
    <ImmersiveLayoutContext.Provider value={immersiveContext}>
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'transparent',
        color: 'var(--theme-text)',
        position: 'relative',
        zIndex: 1,
      }}
      style={{
        '--app-nav-h': `${navH}px`,
        '--app-footer-h': `${footerH}px`,
      } as CSSProperties}
    >
      <NavigationProgress />
      <PollingBar status={barStatus} progress={progress} tickMs={countdownTick} reducedMotion={reducedMotion} />
      {/* Mobile → docks fixed at the bottom (matches the reserved 58px + safe-area
          space in PageContainer/AppFooter/FABs). Desktop → sticky top bar. */}
      <Box ref={navDockRef} sx={{
        position: isMobile ? 'fixed' : 'sticky',
        top: isMobile ? 'auto' : 0,
        bottom: isMobile ? 0 : 'auto',
        left: isMobile ? 0 : 'auto',
        right: isMobile ? 0 : 'auto',
        zIndex: 1200,
        bgcolor: 'transparent',
        pb: isMobile ? 'env(safe-area-inset-bottom, 0px)' : 0,
        // navDockOffset re-anchors the bar to the visual viewport bottom on
        // browsers that don't do it themselves (Firefox Android); 0 elsewhere.
        transform: `translateY(${navDockOffset}px)`,
        animation: isMobile && !reducedMotion ? 'nav-dock-in 320ms cubic-bezier(0.4,0,0.2,1)' : 'none',
        '@keyframes nav-dock-in': {
          from: { transform: 'translateY(100%)' },
          to:   { transform: 'translateY(0)' },
        },
      }}>
        <div ref={navMeasureRef}>
          <Navbar />
        </div>
      </Box>
      <Box component="main" sx={{
        flex: 1,
        width: '100%',
        // Full-bleed: PageContainer (and other pages' own wrappers) own the
        // horizontal padding + max-width centering. This keeps page content
        // flush with the AppFooter, which renders outside <main> and is itself
        // full-bleed (see packages/ui/footer → CONTENT_MAX_W / SIDE_PAD).
        px: 0,
        // Top spacing (user feedback 2026-08-24): mobile (<md) keeps the
        // 16px gap to the page edge; from md up the shell adds nothing —
        // desktop pages start flush under the in-flow sticky top bar (their
        // PageContainer `pt-0!` kills the old pt-[68px] double-offset).
        // NOTE: this theme's sm breakpoint starts at 360, so the split key
        // must be md, not sm.
        // ADR-406 D3: an immersive route owns its own height/padding.
        ...(immersive
          ? { pt: 0, pb: 0 }
          : { pt: { xs: 4, md: 0 }, pb: { xs: 'calc(58px + 1rem)', sm: '1.5rem' } }),
        overflow: 'clip',
      }}>
        <IdentitySignerNotice />
        {children}
      </Box>

      <SnackbarManager
        notifications={notifications}
        transientSnackbar={transientSnackbar}
        onTransientConsumed={clearTransientSnackbar}
      />

      <div ref={footerMeasureRef} style={{ borderBottom: '1px solid var(--theme-border)' }}>
        <AppFooter />
      </div>

      {/* ADR-324 — Home → /search scroll-dock transition preview.
          Lives AFTER the Footer in Layout. User scrolls past Footer,
          into the preview, and after COMMIT_PROGRESS the route commits.
          (Supersedes the ADR-303 dock section, which targeted /coop.) */}
      {isHome && <CoopDockSection />}

      <AIAssistant />
      <FeedbackWidget />
    </Box>
    </ImmersiveLayoutContext.Provider>
  )
}
