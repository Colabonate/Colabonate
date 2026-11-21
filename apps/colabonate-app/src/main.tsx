import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider as MuiThemeProvider, CssBaseline } from '@mui/material'
import { ThemeProvider, useTheme } from '@ds/utils'
import { createColabonateTheme } from './theme'
import { queryClient, persistOptions } from './lib/queryClient'
import { hydrate } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import './lib/gsap-setup'
import './index.css'
import App from './App'
import { restoreNip46Session } from './lib/nostr-nip46'

// ADR-154: best-effort restore of a persisted NIP-46 bunker session on app
// load. Fire-and-forget — never blocks render; failures just mean no bunker.
void restoreNip46Session().catch((err) => console.warn('[NIP-46] restore failed:', err))

// Synchronisiert MUI-Palette mit dem globalen Theme-Context
function MuiThemeSync({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme()
  return (
    <MuiThemeProvider theme={createColabonateTheme(theme)}>
      <CssBaseline />
      {children}
    </MuiThemeProvider>
  )
}

// ADR-294 D2 (Baustein B): first-visit hydration from the prerender snapshot.
// scripts/prerender.mjs injects an inert <script id="__RQ_STATE__"> data block
// (allowlisted anonymous query keys only) into the "/" snapshot. Hydrate it
// directly into the queryClient BEFORE mounting — seeding localStorage instead
// races PersistQueryClientProvider's synchronous empty mount flush against its
// own async restore (measured: the flush wins and wipes the seed). A warm
// visitor's own newer persisted cache restores afterwards and overwrites these
// entries; snapshot data older than staleTime simply triggers the normal
// background refetch (stale-while-revalidate). Pure data hydration — ADR-287
// D1 (createRoot, no hydrateRoot) is untouched. The tag leaves the live DOM
// either way.
const rqStateTag = document.getElementById('__RQ_STATE__')
if (rqStateTag) {
  try {
    const raw = rqStateTag.textContent
    if (raw) {
      const clientState = JSON.parse(raw)
      if (clientState && Array.isArray(clientState.queries)) {
        hydrate(queryClient, clientState)
        ;(window as unknown as { __RQ_SEED_COUNT__?: number }).__RQ_SEED_COUNT__ = clientState.queries.length
        console.info(`[boot] hydrated ${clientState.queries.length} snapshot queries`)
      }
    }
  } catch {
    // Malformed block — ignore, the normal fetch path takes over.
  }
  rqStateTag.remove()
}

// ADR-287: real visitors land on a build-time-prerendered snapshot whose
// #root already contains a fully mounted, fully settled DOM (data loaded,
// GSAP entrance animations finished). createRoot() below is deliberately
// not hydrateRoot (ADR-287 D1 — no hydration-mismatch surface), so it
// discards that markup and mounts a fresh tree from scratch: data re-fetches
// and entrance animations restart from their initial state. The snapshot
// always bakes the splash in its post-mount *hidden* state (captured after
// mount), so — unlike a cold SPA load, where the splash is visible by
// default and masks exactly this window — the remount here played out fully
// exposed, flashing loading/pre-animation layout and colors over content
// that was already correct on screen. Force the splash back up (via the
// `!important`-guarded `app-splash--force-visible` class — NOT inline
// styles; those out-specificity the `--hidden` class too and, if left set,
// make the splash impossible to hide again) right before mounting so it
// covers the remount; the existing post-mount logic below removes the
// override and fades the splash back out once the fresh tree has settled.
const splash = document.getElementById('app-splash')
splash?.classList.add('app-splash--force-visible')
splash?.classList.remove('app-splash--hidden')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <ThemeProvider>
        <MuiThemeSync>
          <App />
        </MuiThemeSync>
      </ThemeProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
)

// Hide the inline splash once React has mounted, but enforce a minimum
// visible time so the logo + spinner animation is actually perceivable
// (Vite dev hydration is typically <300ms — too fast to see).
const MIN_VISIBLE_MS = 700
const startedAt = performance.now()
function fadeOutSplash() {
  requestAnimationFrame(() => {
    const elapsed = performance.now() - startedAt
    const wait = Math.max(0, MIN_VISIBLE_MS - elapsed)
    setTimeout(() => {
      splash?.classList.remove('app-splash--force-visible')
      splash?.classList.add('app-splash--hidden')
    }, wait)
  })
}

// ADR-290: Home (/) re-fetches offers/tickets/cooperations/categories after
// this remount, and measured on production those queries can still be in
// flight past MIN_VISIBLE_MS — the fixed timer above reveals Home mid-load
// (half-styled cards, layout still settling). Wait for Home's own
// `colabonate:app-ready` signal instead (dispatched once its combined
// TanStack Query loading flag flips false — see useSignalAppReady), bounded
// by MAX_WAIT_MS so a signal that never fires can't leave the splash stuck
// forever — that exact regression already shipped once (v0.1.1, see
// ADR-287's post-launch fix note) and must not recur here. Every other
// prerendered route has no such post-mount data-loading gap and keeps the
// plain fixed-timer path.
if (window.location.pathname === '/') {
  const MAX_WAIT_MS = 4000
  let settled = false
  const onReady = () => {
    if (settled) return
    settled = true
    window.removeEventListener('colabonate:app-ready', onReady)
    fadeOutSplash()
  }
  window.addEventListener('colabonate:app-ready', onReady)
  setTimeout(onReady, MAX_WAIT_MS)
} else {
  fadeOutSplash()
}
