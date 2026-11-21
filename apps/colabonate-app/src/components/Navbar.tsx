/**
 * Navbar – App-Navigation via MainMenu (@ds/ui)
 *
 * Tabs werden datengetrieben aus navigationConfig bezogen. (ADR-026)
 * Untermenüs (subItems) werden als 2. Ebene in der MainMenu-Bar gerendert. (ADR-027)
 *
 * Mobile  → Bottom Nav Bar
 * Desktop → Sticky Top Bar
 */

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { MainMenu, getTabRoutes, navigationConfig, NotificationDrawer } from '@ds/ui'
import type { MainMenuVariant, MainMenuTab, MainMenuTheme, MainMenuSubItem } from '@ds/ui'
import type { NavSubItem } from '@ds/ui'
import { useTheme } from '@ds/utils'
import { BetaBadge } from './branding/BetaBadge'
import NotificationsIcon from '@mui/icons-material/Notifications'
import PersonIcon from '@mui/icons-material/Person'
import { useNotification } from '../context/NotificationContext';
import { useMobileNavHeader } from '../context/MobileNavHeaderContext';
import { cooperationsDiscoverQueryOptions } from '../hooks/useEntityQueries'

// ─── Icons (L1-Tabs) ────────────────────────────────────────────────────────────

function IcoHome({ color }: { color?: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10 20V14H14V20H19V12H22L12 3L2 12H5V20H10Z" fill={color ?? 'currentColor'} />
    </svg>
  )
}

function IcoBuy({ color }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 4H4V6H20V4ZM21 14V12L20 7H4L3 12V14H4V20H14V14H18V20H20V14H21ZM12 18H6V14H12V18Z"
        fill={color ?? 'currentColor'} />
    </svg>
  )
}

function IcoSell({ color }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4C9.11 4 6.6 5.64 5.35 8.04C2.34 8.36 0 10.91 0 14C0 17.31 2.69 20 6 20H19C21.76 20 24 17.76 24 15C24 12.36 21.95 10.22 19.35 10.04ZM17 13H14V16H10V13H7L12 8L17 13Z"
        fill={color ?? 'currentColor'} />
    </svg>
  )
}

function IcoCoop({ color }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M16 11C17.66 11 18.99 9.66 18.99 8C18.99 6.34 17.66 5 16 5C14.34 5 13 6.34 13 8C13 9.66 14.34 11 16 11ZM8 11C9.66 11 10.99 9.66 10.99 8C10.99 6.34 9.66 5 8 5C6.34 5 5 6.34 5 8C5 9.66 6.34 11 8 11ZM8 13C5.67 13 1 14.17 1 16.5V19H15V16.5C15 14.17 10.33 13 8 13ZM16 13C15.71 13 15.38 13.02 15.03 13.05C16.19 13.89 17 15.02 17 16.5V19H23V16.5C23 14.17 18.33 13 16 13Z"
        fill={color ?? 'currentColor'} />
    </svg>
  )
}

function IcoDashboard({ color }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" fill={color ?? 'currentColor'} />
    </svg>
  )
}

// ─── Hilfsfunktion ──────────────────────────────────────────────────────────────

function toMenuSubItems(
  items: NavSubItem[],
  navigate: (to: string) => void,
): MainMenuSubItem[] {
  return items.map((item) => ({
    label:       item.label,
    description: item.description,
    badge:       item.badge,
    iconKey:     item.icon,
    path:        item.path,
    onClick:     () => navigate(item.path),
  }))
}

// ─── Navbar ───────────────────────────────────────────────────────────────────

// Tab-Routen aus Config (/coop, /buy, /sell) – Home (/) wird via onHome behandelt
const TAB_ROUTES = getTabRoutes(navigationConfig).filter((r) => r.path !== '/')

// Pfad-Index für aktiven Tab (prefix-basiert)
// Index 0 = Dashboard (/), Index 1–3 = COOP, BUY, SELL, Index 4 = DAO
const DAO_PATH_PREFIXES = ['/dao/', '/dao']

function getActiveTabIndex(pathname: string): number {
  if (pathname === '/') return 0 // Dashboard
  // BUY, SELL, COOP – um 1 verschoben wegen Dashboard(0)
  const idx = TAB_ROUTES.findIndex(
    (r) => pathname === r.path || pathname.startsWith(r.path + '/')
  )
  if (idx >= 0) return idx + 1
  // DAO – check against known prefixes
  if (DAO_PATH_PREFIXES.some(p => pathname.startsWith(p))) return TAB_ROUTES.length + 1
  return -1
}

export function Navbar() {
  const navigate                = useNavigate()
  const location                = useLocation()
  const queryClient             = useQueryClient()
  const { theme } = useTheme()
  const { notifications, unreadCount, markAsRead, markAllAsRead, clearAllNotifications, archiveNotification, archiveNotificationGroup } = useNotification();
  const mobileHeader = useMobileNavHeader();
  const [notificationDrawerOpen, setNotificationDrawerOpen] = useState(false);

  const menuTheme: MainMenuTheme   = theme
  const isHome                     = location.pathname === '/'
  const variant: MainMenuVariant   = isHome ? 'START' : 'Default'
  const activeTabIndex             = getActiveTabIndex(location.pathname)
  const activeTab                  = activeTabIndex >= 0 ? activeTabIndex : undefined

  const homeItems = navigationConfig.routes.find((r) => r.path === '/')?.subItems
  const filteredHomeItems = homeItems
  const coopItems = TAB_ROUTES[0]?.subItems
  const buyItems  = TAB_ROUTES[1]?.subItems
  const sellItems = TAB_ROUTES[2]?.subItems

  const tabs: MainMenuTab[] = [
    {
      label:    'Dashboard',
      icon:     <IcoDashboard color="currentColor" />,
      iconOnly: true,
      onClick:  () => navigate('/'),
      onMouseEnter: () => {
        import('../routes/home/Home')
        import('../routes/home/WalletDashboard')
      },
    },
    {
      label:    TAB_ROUTES[0]?.label ?? 'Cooperate',
      icon:     <IcoCoop color="currentColor" />,
      subItems: coopItems ? toMenuSubItems(coopItems, navigate) : undefined,
      onClick:  () => navigate('/coop'),
      onMouseEnter: () => {
        import('../routes/coop/CoopExplore')
        import('../routes/coop/CoopGuide')
        import('../routes/coop/manage/CoopManage')
        // ADR-376 D5: warm the same cache entry Home's "Services &
        // Collaborations" slider and CoopExplore/Search's coop context both
        // read (post-D1/D2) — a user who clicks straight into /coop or
        // /search?context=coop without scrolling through the Home dock
        // (ADR-324 D4's prefetch trigger) previously got no prefetch at all.
        // Fire-and-forget; TanStack Query dedupes against any in-flight or
        // still-fresh entry, so this is a no-op on a warm cache.
        void queryClient.prefetchQuery(cooperationsDiscoverQueryOptions('', 100))
      },
    },
    {
      label:    TAB_ROUTES[1]?.label ?? 'Buy',
      icon:     <IcoBuy  color="currentColor" />,
      subItems: buyItems  ? toMenuSubItems(buyItems,  navigate) : undefined,
      onClick:  () => navigate('/buy'),
      onMouseEnter: () => {
        import('../routes/buy/BuyDashboard')
        import('../routes/buy/BuyCategories')
        import('../routes/buy/BuyCategoryProducts')
      },
    },
    {
      label:    TAB_ROUTES[2]?.label ?? 'Sell',
      icon:     <IcoSell color="currentColor" />,
      subItems: sellItems ? toMenuSubItems(sellItems, navigate) : undefined,
      onClick:  () => navigate('/sell'),
      onMouseEnter: () => {
        import('../routes/sell/SellDashboard')
        import('../routes/sell/SellListings')
      },
    },
    {
      label:    'DAO',
      icon:     <IcoHome color="currentColor" />,
      subItems: filteredHomeItems ? toMenuSubItems(filteredHomeItems, navigate) : undefined,
      onClick:  () => navigate('/dao'),
      onMouseEnter: () => {
        import('../routes/dao/DaoDiscovery')
        import('../routes/dao/DaoLayout')
      },
    },
  ]

  const isDark = theme === 'dark'

  const navBtnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 8,
    border: 'none',
    background: 'transparent',
    color: isDark ? 'rgba(255,255,255,0.75)' : 'var(--color-neutral-5, #5A6672)',
    cursor: 'pointer',
    transition: 'background 150ms, color 150ms',
    flexShrink: 0,
  }

  const handleNavBtnEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget
    el.style.background = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)'
    el.style.color = isDark ? '#fff' : 'var(--color-neutral-default, #1A2026)'
  }

  const handleNavBtnLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget
    el.style.background = 'transparent'
    el.style.color = isDark ? 'rgba(255,255,255,0.75)' : 'var(--color-neutral-5, #5A6672)'
  }

  const rightSlot = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button
        onClick={() => setNotificationDrawerOpen(true)}
        aria-label="Notifications"
        title="Notifications"
        style={navBtnStyle}
        onMouseEnter={handleNavBtnEnter}
        onMouseLeave={handleNavBtnLeave}
      >
        <div style={{ position: 'relative' }}>
          <NotificationsIcon sx={{ fontSize: 18 }} />
          {unreadCount > 0 && (
            <>
              <span
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  background: 'var(--color-primary-50)',
                  borderRadius: '50%',
                  width: 8,
                  height: 8,
                  display: 'block',
                  animation: 'notif-ping 1.4s ease-in-out infinite',
                  opacity: 0.7,
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  background: 'var(--color-primary-50)',
                  borderRadius: '50%',
                  width: 8,
                  height: 8,
                  display: 'block',
                }}
              />
            </>
          )}
        </div>
      </button>
      <button
        onClick={() => navigate('/account')}
        aria-label="Account"
        title="Account"
        style={navBtnStyle}
        onMouseEnter={handleNavBtnEnter}
        onMouseLeave={handleNavBtnLeave}
      >
        <PersonIcon sx={{ fontSize: 18 }} />
      </button>
    </div>
  )

  return (
    <>
      <MainMenu
        variant={variant}
        mode="auto"
        theme={menuTheme}
        activeTab={activeTab}
        tabs={tabs}
        onHome={() => navigate('/')}
        onSearch={() => navigate('/search?focus=1')}
        currentPath={location.pathname}
        onNavigate={(to) => navigate(to === '/search' ? '/search?focus=1' : to)}
        rightSlot={rightSlot}
        brandBadge={<BetaBadge onClick={() => navigate('/help/beta')} />}
        mobileHeader={mobileHeader ?? undefined}
      />
      <NotificationDrawer
        open={notificationDrawerOpen}
        onClose={() => setNotificationDrawerOpen(false)}
        notifications={notifications}
        onMarkAsRead={markAsRead}
        onMarkAllAsRead={markAllAsRead}
        onArchive={archiveNotification}
        onArchiveGroup={archiveNotificationGroup}
        onNavigate={(to) => { setNotificationDrawerOpen(false); navigate(to); }}
        onClearAll={clearAllNotifications}
        onViewAll={() => { setNotificationDrawerOpen(false); navigate('/notifications'); }}
      />
    </>
  )
}
