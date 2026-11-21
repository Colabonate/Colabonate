/**
 * MainMenu – NavContainer
 * Figma Node: 505:66660
 *
 * Mobile  → Bottom Nav Bar (58px)
 * Desktop → Sticky Top Bar (68px / 52px scrolled)
 *
 * 2-Ebenen-Navigation:
 * Klick auf Tab mit subItems → Bar wechselt IN-PLACE zur Ebene 2.
 * Ebene 2 zeigt: Back-Icon | Parent-Label | Sub-Items (als Tabs / Links)
 * Kein Overlay, kein Sheet, kein Dropdown – alles innerhalb der Bar.
 *
 * Tokens: var(--color-*) – kein hardcoded CSS
 */

import React, { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ButtonBase } from '@mui/material';
import { cn } from '@ds/utils';
import { AnimatedLogo } from '../logo/logo';
import { AnimatedLogoIcon } from '../logo/logo-svgs';
import type {
  MainMenuProps,
  MainMenuVariant,
  MainMenuTheme,
  MainMenuLevel,
  MainMenuSubItem,
  MainMenuTab,
} from './main-menu.types';
// ─── Design Tokens ─────────────────────────────────────────────────────────────

const T = {
  light: {
    bgScrolled:    'rgba(255,255,255,0.75)',
    border:        'rgba(0,0,0,0.08)',
    text:          'var(--color-neutral-default)',
    textMuted:     'var(--color-neutral-5)',
    textOnPrimary: 'var(--color-neutral-white)',
    primary:       'var(--color-action-primary-default)',
    primaryActive: 'var(--color-action-primary-active)',
    primary10:     'var(--color-action-primary-10)',
    shadow:        '0 2px 16px rgba(0,0,0,0.08)',
    dropdownBg:    'var(--color-secondary-10)',
    accentSoft:    'var(--color-primary-10)',
    itemHover:     'rgba(0,0,0,0.05)',
  },
  dark: {
    bgScrolled:    'rgba(30,36,44,0.80)',
    border:        'rgba(255,255,255,0.08)',
    text:          'var(--color-text-neutral-on-neutral)',
    textMuted:     'var(--color-neutral-6)',
    textOnPrimary: 'var(--color-neutral-white)',
    primary:       'var(--color-action-primary-default)',
    primaryActive: 'var(--color-action-primary-active)',
    primary10:     'rgba(232,69,65,0.14)',
    shadow:        '0 4px 24px rgba(0,0,0,0.35)',
    dropdownBg:    'var(--color-secondary-90)',
    accentSoft:    'var(--color-primary-30)',
    itemHover:     'rgba(255,255,255,0.07)',
  },
};

// ─── Burger-Menu Button Theme ──────────────────────────────────────────────────
// Einheitliches Design für Desktop-Dropdown und Mobile-Drawer.
// Hier anpassen, um beide Kontexte global zu steuern.
const BUTTON_THEME = {
  // ── Desktop ───────────────────────────────────────────────────────────────
  desktop: {
    gap:          '12px',
    px:           '12px',
    py:           '10px',
    borderRadius: '10px',
    iconSize:     32,
    iconRadius:   8,
    fontSize:     12,
  },
  // ── Mobile ────────────────────────────────────────────────────────────────
  mobile: {
    gap:          '14px',
    px:           '10px',
    py:           '12px',
    borderRadius: '10px',
    iconSize:     36,
    iconRadius:   10,
    fontSize:     16,
  },
  // ── Theme-abhängige Farben (dark / light) ─────────────────────────────────
  colors: (isDark: boolean, tk: typeof T.dark) => ({
    iconBg:    isDark ? 'rgba(255,255,255,0.08)' : tk.primary10,
    iconColor: tk.primary,
    label:     tk.text,
    rowHover:  isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
    rowActive: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.09)',
  }),
};

// ─── Icons ─────────────────────────────────────────────────────────────────────



const IcoBuy = ({ color }: { color: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M20 4H4V6H20V4ZM21 14V12L20 7H4L3 12V14H4V20H14V14H18V20H20V14H21ZM12 18H6V14H12V18Z" fill={color} />
  </svg>
);

const IcoCoOp = ({ color }: { color: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M16 11C17.66 11 18.99 9.66 18.99 8C18.99 6.34 17.66 5 16 5C14.34 5 13 6.34 13 8C13 9.66 14.34 11 16 11ZM8 11C9.66 11 10.99 9.66 10.99 8C10.99 6.34 9.66 5 8 5C6.34 5 5 6.34 5 8C5 9.66 6.34 11 8 11ZM8 13C5.67 13 1 14.17 1 16.5V19H15V16.5C15 14.17 10.33 13 8 13ZM16 13C15.71 13 15.38 13.02 15.03 13.05C16.19 13.89 17 15.02 17 16.5V19H23V16.5C23 14.17 18.33 13 16 13Z" fill={color} />
  </svg>
);

const IcoWallet = ({ color }: { color: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M21 18V19C21 20.1 20.1 21 19 21H5C3.89 21 3 20.1 3 19V5C3 3.9 3.89 3 5 3H19C20.1 3 21 3.9 21 5V6H12C10.89 6 10 6.9 10 8V16C10 17.1 10.89 18 12 18H21ZM12 16H22V8H12V16ZM16 13.5C15.17 13.5 14.5 12.83 14.5 12C14.5 11.17 15.17 10.5 16 10.5C16.83 10.5 17.5 11.17 17.5 12C17.5 12.83 16.83 13.5 16 13.5Z" fill={color} />
  </svg>
);

const IcoCategories = ({ color }: { color: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 2L6.5 11H17.5L12 2ZM17.5 13C15.01 13 13 15.01 13 17.5C13 19.99 15.01 22 17.5 22C19.99 22 22 19.99 22 17.5C22 15.01 19.99 13 17.5 13ZM3 21.5H11V13.5H3V21.5Z" fill={color} />
  </svg>
);

const IcoProfile = ({ color }: { color: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12ZM12 14C9.33 14 4 15.34 4 18V20H20V18C20 15.34 14.67 14 12 14Z" fill={color} />
  </svg>
);

const IcoCart = ({ color }: { color: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M7 18C5.9 18 5.01 18.9 5.01 20C5.01 21.1 5.9 22 7 22C8.1 22 9 21.1 9 20C9 18.9 8.1 18 7 18ZM17 18C15.9 18 15.01 18.9 15.01 20C15.01 21.1 15.9 22 17 22C18.1 22 19 21.1 19 20C19 18.9 18.1 18 17 18ZM7.17 14.75L7.2 14.63L8.1 13H15.55C16.3 13 16.96 12.59 17.3 11.97L21.16 4.96L19.42 4H19.41L18.31 6L15.55 11H8.53L8.4 10.73L6.16 6L5.21 4L4.27 2H1V4H3L6.6 11.59L5.25 14.04C5.09 14.32 5 14.65 5 15C5 16.1 5.9 17 7 17H19V15H7.42C7.29 15 7.17 14.89 7.17 14.75Z" fill={color} />
  </svg>
);

const IcoBack = ({ color }: { color: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M20 11H7.83L13.42 5.41L12 4L4 12L12 20L13.41 18.59L7.83 13H20V11Z" fill={color} />
  </svg>
);

const IcoMenu = () => (
  <svg width="18" height="13" viewBox="0 0 18 13" fill="none" aria-hidden="true">
    <rect x="0" y="0"   width="18" height="2" rx="1" fill="currentColor" />
    <rect x="2" y="5.5" width="16" height="2" rx="1" fill="currentColor" />
    <rect x="5" y="11"  width="13" height="2" rx="1" fill="currentColor" />
  </svg>
);

const IcoClose = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12L19 6.41Z" fill="currentColor" />
  </svg>
);

// ─── Statische Tab-Konfiguration ───────────────────────────────────────────────

type TabCfg = {
  label: string;
  icon: (color: string) => React.ReactNode;
  activeIn: MainMenuVariant[];
  subItems: MainMenuSubItem[];
};

const DEFAULT_TABS: TabCfg[] = [
  {
    label: 'Buy',
    icon: (c) => <IcoBuy color={c} />,
    activeIn: ['Buy'],
    subItems: [
      { label: 'Marketplace', description: 'Alle Angebote' },
      { label: 'Kategorien',  description: 'Nach Kategorie filtern' },
      { label: 'Deals',       description: 'Sonderangebote', badge: 'NEU' },
      { label: 'Saved',       description: 'Gespeicherte Artikel' },
    ],
  },
  {
    label: 'CoOp',
    icon: (c) => <IcoCoOp color={c} />,
    activeIn: ['Help'],
    subItems: [
      { label: 'Services',    description: 'Dienstleistungen', badge: 'BETA' },
      { label: 'Kooperation', description: 'Mit anderen arbeiten' },
      { label: 'Anfragen',    description: 'Offene Anfragen' },
    ],
  },
  {
    label: 'Wallet',
    icon: (c) => <IcoWallet color={c} />,
    activeIn: ['Wallet'],
    subItems: [
      { label: 'Guthaben',    description: 'Kontostand' },
      { label: 'Einzahlen',   description: 'Guthaben aufladen' },
      { label: 'Auszahlen',   description: 'Überweisung' },
    ],
  },
];

const VARIANT9_TABS: TabCfg[] = [
  {
    label: 'Categories',
    icon: (c) => <IcoCategories color={c} />,
    activeIn: [],
    subItems: [
      { label: 'Elektronik', description: 'Geräte & Zubehör' },
      { label: 'Kleidung',   description: 'Mode & Accessoires' },
      { label: 'Wohnen',     description: 'Möbel & Einrichtung' },
    ],
  },
  {
    label: 'Wallet',
    icon: (c) => <IcoWallet color={c} />,
    activeIn: [],
    subItems: [
      { label: 'Guthaben',      description: 'Aktueller Kontostand' },
      { label: 'Transaktionen', description: 'Zahlungshistorie' },
    ],
  },
  {
    label: 'Profile',
    icon: (c) => <IcoProfile color={c} />,
    activeIn: [],
    subItems: [
      { label: 'Mein Profil',   description: 'Persönliche Daten' },
      { label: 'Einstellungen', description: 'Konto & Benachrichtigungen' },
    ],
  },
  {
    label: 'Cart',
    icon: (c) => <IcoCart color={c} />,
    activeIn: [],
    subItems: [
      { label: 'Warenkorb', description: '3 Artikel' },
      { label: 'Merkliste',  description: 'Gespeicherte Artikel' },
    ],
  },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

const hasTabs   = (v: MainMenuVariant) => ['START','Variant9','Help','Wallet','Buy','Init'].includes(v);
const hasHome   = (v: MainMenuVariant) => v !== 'BarOnly';
const hasBurger = (v: MainMenuVariant) => !['noMenu','BarOnly'].includes(v);

// ─── Burger-Menu Einträge ──────────────────────────────────────────────────────

// Desktop: Sekundäre Navigation + Explore (Notifications/Account sind im rightSlot)
const DESKTOP_BURGER_ITEMS = [
  { label: 'AI Assistant', path: '/ai', icon: 'M20 9V7c0-1.1-.9-2-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6c-1.1 0-2 .9-2 2v2c-1.66 0-3 1.34-3 3s1.34 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.66 0 3-1.34 3-3s-1.34-3-3-3zM7.5 11.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5S9.83 13 9 13s-1.5-.67-1.5-1.5zM15 17H9c-.55 0-1-.45-1-1h8c0 .55-.45 1-1 1zm1-4c-.83 0-1.5-.67-1.5-1.5S15.17 10 16 10s1.5.67 1.5 1.5S16.83 13 16 13z' },
  { label: 'Explore',  path: '/search',   icon: 'M7 9H2V7h5zm0 3H2v2h5zm13.59 7-3.83-3.83c-.8.52-1.74.83-2.76.83-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5c0 1.02-.31 1.96-.83 2.75L22 17.59zM17 11c0-1.65-1.35-3-3-3s-3 1.35-3 3 1.35 3 3 3 3-1.35 3-3M2 19h10v-2H2z' },
  { label: 'Tickets',  path: '/tickets', icon: 'M20 12c0-1.1.9-2 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v4c1.1 0 2 .9 2 2s-.9 2-2 2v4c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2v-4c-1.1 0-2-.9-2-2z' },
  { label: 'Wallet',   path: '/wallet',   icon: 'M21 18v1c0 1.1-.9 2-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1h-9a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h9zm-9-2h10V8H12v8zm4-2.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z' },
  { label: 'Settings', path: '/settings', icon: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.2 7.2 0 0 0-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z' },
  { label: 'Help',     path: '/help',     icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z' },
  { label: 'Contact',  path: '/contact',  icon: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z' },
];

// Mobile: Inkludiert Notifications/Account vor der sekundären Navigation.
// Explore ist jetzt als eigener IconButton in der Bottom Nav (Platz 2 nach Home), nicht im Drawer.
const MOBILE_BURGER_ITEMS = [
  { label: 'Notifications', path: '/notifications', icon: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z' },
  { label: 'Account',      path: '/account',        icon: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' },
  ...DESKTOP_BURGER_ITEMS.filter(item => item.label !== 'Explore'),
];

// Legacy: beide nutzen denselben Typ
const BURGER_MENU_ITEMS = DESKTOP_BURGER_ITEMS;

function BurgerMenuItemIcon({ d, color }: { d: string; color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} fill={color} />
    </svg>
  );
}

// ─── Desktop Burger Dropdown ────────────────────────────────────────────────────

function DesktopBurgerDropdown({ open, theme, onNavigate, onClose }: { open: boolean; theme: MainMenuTheme; onNavigate?: (to: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const isDark = theme === 'dark';
  const tk = isDark ? T.dark : T.light;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.opacity       = open ? '1'                      : '0';
    el.style.transform     = open ? 'translateY(0) scale(1)' : 'translateY(-6px) scale(0.97)';
    el.style.pointerEvents = open ? 'auto'                   : 'none';
    // When closing, move focus out of the menu so aria-hidden doesn't trap it
    if (!open && el.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
    }
  }, [open]);

  return (
    <div ref={ref} role="menu" aria-hidden={!open} inert={!open || undefined} tabIndex={-1}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          onClose();
        }
      }}
      style={{
        position: 'absolute', right: 0, top: 'calc(100% + 8px)',
        width: 220, borderRadius: 10, overflow: 'hidden',
        opacity: 0, pointerEvents: 'none',
        transform: 'translateY(-6px) scale(0.97)',
        transition: 'opacity 180ms ease, transform 180ms ease',
        background: tk.dropdownBg,
        boxShadow: isDark
          ? '0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)'
          : '0 8px 32px rgba(0,0,0,0.12)',
        zIndex: 500,
      }}
    >
      <div style={{ height: 2, background: `linear-gradient(90deg, ${tk.primary}, transparent)` }} />
      <div style={{ padding: 8 }}>
        {BURGER_MENU_ITEMS.map((item) => {
          const bt = BUTTON_THEME.desktop;
          const bc = BUTTON_THEME.colors(isDark, tk);
          return (
            <ButtonBase
              key={item.label}
              role="menuitem"
              onClick={() => { onNavigate?.(item.path); onClose(); }}
              sx={{
                display: 'flex !important',
                justifyContent: 'flex-start',
                alignItems: 'center',
                gap: bt.gap,
                borderRadius: bt.borderRadius,
                px: bt.px,
                py: bt.py,
                width: '100%',
                textAlign: 'left',
                transition: 'background 120ms',
                '&:hover':  { background: bc.rowHover },
                '&:active': { background: bc.rowActive },
              }}
            >
              <span style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: bt.iconSize, height: bt.iconSize,
                borderRadius: bt.iconRadius, flexShrink: 0,
                background: bc.iconBg, color: bc.iconColor,
              }}>
                <BurgerMenuItemIcon d={item.icon} color={bc.iconColor} />
              </span>
              <span style={{
                fontFamily: 'var(--typography-fontfamily-display, sans-serif)',
                fontSize: bt.fontSize, fontWeight: 600, letterSpacing: '0.02em',
                whiteSpace: 'nowrap', color: bc.label,
              }}>
                {item.label}
              </span>
            </ButtonBase>
          );
        })}
      </div>
    </div>
  );
}

// ─── SubMenu Icons ─────────────────────────────────────────────────────────────

const SUB_ICON_PATHS: Record<string, string> = {
  search:     'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  wallet:     'M21 18v1c0 1.1-.9 2-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1h-9a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h9zm-9-2h10V8H12v8zm4-2.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  profile:    'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  settings:   'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.2 7.2 0 0 0-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z',
  categories: 'M12 2L6.5 11h11L12 2zm5.5 11C15.01 13 13 15.01 13 17.5S15.01 22 17.5 22 22 19.99 22 17.5 19.99 13 17.5 13zM3 21.5h8v-8H3v8z',
  vendors:    'M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z',
  map:        'M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z',
  orders:     'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z',
  dashboard:  'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  company:    'M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z',
  catalog:    'M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z',
  listings:   'M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z',
  services:   'M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z',
  marketplace: 'M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z',
  guide:      'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z',
  partners:   'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  networks:   'M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z',
  projects:   'M20 6h-2.18c.07-.44.18-.88.18-1.36C18 2.1 15.9 0 13.36 0c-1.3 0-2.43.52-3.27 1.35L9 2.5 7.91 1.35C7.07.52 5.94 0 4.64 0 2.1 0 0 2.1 0 4.64c0 .48.11.92.18 1.36H0v2h20V6zM4.64 6c-1.07 0-2-.93-2-2s.93-2 2-2 2 .93 2 2-.93 2-2 2zm8.72 0c-1.07 0-2-.93-2-2s.93-2 2-2 2 .93 2 2-.93 2-2 2zM0 20h20v-2H0v2zm0-4h20v-2H0v2zm0-4h20v-2H0v2z',
  tenders:    'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  delivery:   'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9 1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
  products:   'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
  templates:  'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z',
  cart:       'M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1.003 1.003 0 0 0 20 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z',
  // ADR-326 / FU-444: Bounty Board (open call → apply → select, ADR-319).
  // Renamed from 'tasks' → 'bounties' by ADR-336.
  bounties:   'M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm7 16H5V5h2v3h10V5h2v14z',
  // FU-474 (ADR-326 D6.5): Agent Roster's own icon — previously shared
  // 'partners' with the Agents entry, now visually distinct (robot glyph).
  roster:     'M20 9V7c0-1.1-.9-2-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6c-1.1 0-2 .9-2 2v2c-1.66 0-3 1.34-3 3s1.34 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.66 0 3-1.34 3-3s-1.34-3-3-3zM7.5 11.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5S9.83 13 9 13s-1.5-.67-1.5-1.5zm9 5h-9v-2h9v2zm-1-3.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
};

function SubMenuIcon({ iconKey, size = 15 }: { iconKey?: string; size?: number }) {
  const d = iconKey ? SUB_ICON_PATHS[iconKey] : undefined;
  if (!d) {
    if (iconKey) console.warn(`[main-menu] SubMenuIcon: iconKey "${iconKey}" has no SVG path in SUB_ICON_PATHS`);
    return <span style={{ width: size, height: size, display: 'block' }} />;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} fill="currentColor" />
    </svg>
  );
}

// ─── Desktop Top Bar ───────────────────────────────────────────────────────────

const NAV_LINKS = [
  { to: '/',        label: 'Home',    icon: 'M10 20V14H14V20H19V12H22L12 3L2 12H5V20H10Z' },
  { to: '/tickets', label: 'Tickets', icon: 'M20 12c0-1.1.9-2 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v4c1.1 0 2 .9 2 2s-.9 2-2 2v4c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2v-4c-1.1 0-2-.9-2-2z' },
  { to: '/account', label: 'Account', icon: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4-4-4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' },
] as const;

interface DesktopTopBarProps {
  variant:     MainMenuVariant;
  theme:       MainMenuTheme;
  tabCfgs:     TabCfg[];
  customTabs?: import('./main-menu.types').MainMenuTab[];
  activeTabIdx?: number;
  onHome?:     () => void;
  onSearch?:   () => void;
  currentPath: string;
  onNavigate?: (to: string) => void;
  onLevelChange?: (level: MainMenuLevel, parent?: string) => void;
  rightSlot?: React.ReactNode;
  brandBadge?: React.ReactNode;
}

function DesktopTopBar({ variant, theme, tabCfgs: _tabCfgs, customTabs, activeTabIdx, onHome, onSearch, currentPath, onNavigate, rightSlot, brandBadge }: DesktopTopBarProps) {
  const [openDropdown, setOpenDropdown] = useState<number | null>(null);
  const [startOpen,    setStartOpen]    = useState(false);
  const [scrolled,     setScrolled]     = useState(false);

  const barRef = useRef<HTMLDivElement>(null);
  const isDark = theme === 'dark';
  const tk     = isDark ? T.dark : T.light;
  const navH   = scrolled ? 52 : 68;

  // Scroll-Listener
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  // Click-Outside schließt alle Dropdowns
  useEffect(() => {
    if (openDropdown === null && !startOpen) return;
    const fn = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
        setStartOpen(false);
      }
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [openDropdown, startOpen]);

  // Blur focus from dropdown buttons when menu closes (aria-hidden fix)
  useEffect(() => {
    if (openDropdown === null && document.activeElement instanceof HTMLElement) {
      if (barRef.current?.contains(document.activeElement)) {
        document.activeElement.blur();
      }
    }
  }, [openDropdown]);

  return (
    <div ref={barRef} className="sticky top-0 z-[1200]" style={{ overflow: 'visible' }}>
      <nav
        aria-label="Main Navigation"
        style={{ height: navH, background: 'transparent', overflow: 'visible', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
        className={cn(
          'transition-[height,box-shadow] duration-300',
          scrolled && 'shadow-[0_2px_16px_rgba(0,0,0,0.08)]',
        )}
      >
        {/* 3-column: brand | tabs | plus */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center',
            height: '100%',
            padding: '0 32px',
            overflow: 'visible',
          }}
        >

          {/* ── Brand ───────────────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {hasHome(variant) && (
              <ButtonBase
                onClick={onHome}
                aria-label="Colabonate Home"
                sx={{
                  borderRadius: '8px',
                  px: '8px',
                  py: '6px',
                  transition: 'opacity 150ms',
                  '&:hover': { opacity: 0.8 },
                }}
              >
                <AnimatedLogo height={32} theme={theme === 'dark' ? 'on-dark' : 'on-white'} />
              </ButtonBase>
            )}
            {brandBadge}
          </div>

          {/* ── Navigation Tabs ──────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {/* Erster Tab (Dashboard) separat – danach kommt Search IconButton */}
            {(() => {
              const allTabs = customTabs
                ? customTabs
                : NAV_LINKS.map((l) => ({ label: l.label, subItems: [] as MainMenuSubItem[], onClick: () => onNavigate?.(l.to) }));
              const firstTab = allTabs[0];
              if (!firstTab) return null;
              const active = customTabs ? activeTabIdx === 0 : currentPath === (NAV_LINKS[0]?.to ?? '');
              return (
                <div key={firstTab.label} style={{ position: 'relative' }}>
                  <ButtonBase
                    onClick={() => { firstTab.onClick?.(); setOpenDropdown(null); }}
                    onMouseEnter={() => customTabs && (firstTab as MainMenuTab).onMouseEnter?.()}
                    onMouseLeave={() => customTabs && (firstTab as MainMenuTab).onMouseLeave?.()}
                    aria-current={active ? 'page' : undefined}
                    aria-label={customTabs && (firstTab as MainMenuTab).iconOnly ? firstTab.label : undefined}
                    sx={{
                      position: 'relative',
                      borderRadius: '8px',
                      padding: customTabs && (firstTab as MainMenuTab).iconOnly ? '13px' : '8px 20px 10px',
                      minWidth: customTabs && (firstTab as MainMenuTab).iconOnly ? 44 : undefined,
                      whiteSpace: 'nowrap',
                      fontFamily: 'var(--typography-fontfamily-display, sans-serif)',
                      fontSize: '11px',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      fontWeight: active ? 700 : 500,
                      background: active ? tk.primary10 : 'transparent',
                      color: active ? tk.primary : tk.textMuted,
                      transition: 'background 150ms, color 150ms',
                      '&:hover': {
                        background: active ? tk.primary10 : tk.itemHover,
                        color: active ? tk.primary : tk.text,
                      },
                    }}
                  >
                    {active && (
                      <span style={{
                        position: 'absolute', bottom: 3, left: '50%',
                        transform: 'translateX(-50%)',
                        width: '60%', height: 2, borderRadius: 9999,
                        background: tk.primary,
                      }} />
                    )}
                    {customTabs && (firstTab as MainMenuTab).icon && (
                      <span style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 18, height: 18, marginRight: customTabs && (firstTab as MainMenuTab).iconOnly ? 0 : 6, flexShrink: 0,
                        color: active ? tk.primary : tk.textMuted,
                      }}>
                        {(firstTab as MainMenuTab).icon}
                      </span>
                    )}
                    {!(customTabs && (firstTab as MainMenuTab).iconOnly) && firstTab.label}
                  </ButtonBase>
                </div>
              );
            })()}

            {/* Search – direkt nach Dashboard, vor Cooperate */}
            {onSearch && (() => {
              const searchActive = currentPath === '/search' || currentPath.startsWith('/search');
              return (
                <div style={{ position: 'relative' }}>
                  <ButtonBase
                    onClick={onSearch}
                    aria-label="Search"
                    aria-current={searchActive ? 'page' : undefined}
                    sx={{
                      position: 'relative',
                      borderRadius: '8px',
                      padding: '13px',
                      minWidth: 44,
                      color: searchActive ? tk.primary : tk.textMuted,
                      background: searchActive ? tk.primary10 : 'transparent',
                      transition: 'background 150ms, color 150ms',
                      '&:hover': {
                        background: searchActive ? tk.primary10 : tk.itemHover,
                        color: searchActive ? tk.primary : tk.text,
                      },
                    }}
                  >
                    {searchActive && (
                      <span style={{
                        position: 'absolute', bottom: 3, left: '50%',
                        transform: 'translateX(-50%)',
                        width: '60%', height: 2, borderRadius: 9999,
                        background: tk.primary,
                      }} />
                    )}
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" fill="currentColor" />
                    </svg>
                  </ButtonBase>
                </div>
              );
            })()}

            {/* Restliche Tabs (ab Index 1 = Cooperate) */}
            {(customTabs
              ? customTabs
              : NAV_LINKS.map((l) => ({ label: l.label, subItems: [] as MainMenuSubItem[], onClick: () => onNavigate?.(l.to) }))
            ).slice(1).map((tab, _si) => {
              // Original-Index = _si + 1 (wegen Slice)
              const i = _si + 1;
              const hasSub   = (tab.subItems?.length ?? 0) > 0;
              const isOpen   = openDropdown === i;
              const active   = customTabs ? (activeTabIdx === i || isOpen) : currentPath === (NAV_LINKS[i]?.to ?? '');
              const colCount = Math.max(1, Math.ceil((tab.subItems?.length ?? 0) / 4));
              const isCustomTab = customTabs !== undefined;

              return (
                <div key={tab.label} style={{ position: 'relative' }}>

                  {/* Tab button – MUI ripple + sx hover */}
                  <ButtonBase
                    onClick={() => {
                      if (hasSub) { setOpenDropdown(isOpen ? null : i); setStartOpen(false); }
                      else { tab.onClick?.(); setOpenDropdown(null); }
                    }}
                    onMouseEnter={() => isCustomTab && (tab as MainMenuTab).onMouseEnter?.()}
                    onMouseLeave={() => isCustomTab && (tab as MainMenuTab).onMouseLeave?.()}
                    aria-current={active ? 'page' : undefined}
                    aria-expanded={hasSub ? isOpen : undefined}
                    aria-label={isCustomTab && (tab as MainMenuTab).iconOnly ? tab.label : undefined}
                    sx={{
                      position: 'relative',
                      borderRadius: '8px',
                      padding: isCustomTab && (tab as MainMenuTab).iconOnly ? '13px' : '8px 20px 10px',
                      minWidth: isCustomTab && (tab as MainMenuTab).iconOnly ? 44 : undefined,
                      whiteSpace: 'nowrap',
                      fontFamily: 'var(--typography-fontfamily-display, sans-serif)',
                      fontSize: '11px',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      fontWeight: active ? 700 : 500,
                      background: active ? tk.primary10 : 'transparent',
                      color: active ? tk.primary : tk.textMuted,
                      transition: 'background 150ms, color 150ms',
                      '&:hover': {
                        background: active ? tk.primary10 : tk.itemHover,
                        color: active ? tk.primary : tk.text,
                      },
                    }}
                  >
                    {active && (
                      <span style={{
                        position: 'absolute', bottom: 3, left: '50%',
                        transform: 'translateX(-50%)',
                        width: '60%', height: 2, borderRadius: 9999,
                        background: tk.primary,
                      }} />
                    )}
                    {isCustomTab && (tab as MainMenuTab).icon && (
                      <span style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 18, height: 18, marginRight: isCustomTab && (tab as MainMenuTab).iconOnly ? 0 : 6, flexShrink: 0,
                        color: active ? tk.primary : tk.textMuted,
                      }}>
                        {(tab as MainMenuTab).icon}
                      </span>
                    )}
                    {!(isCustomTab && (tab as MainMenuTab).iconOnly) && tab.label}
                  </ButtonBase>

{/* Per-tab dropdown */}
                   {hasSub && (
                     <div
                       role="menu"
                       aria-hidden={!isOpen}
                       inert={!isOpen || undefined}
                       onBlur={(e) => {
                         if (!e.currentTarget.contains(e.relatedTarget)) {
                           setOpenDropdown(null);
                         }
                       }}
                       style={{
                         position: 'absolute',
                         top: 'calc(100% + 10px)',
                         left: '50%',
                         transform: isOpen
                           ? 'translateX(-50%) translateY(0) scale(1)'
                           : 'translateX(-50%) translateY(-8px) scale(0.97)',
                         minWidth: `${colCount * 224}px`,
                         zIndex: 300,
                         background: tk.dropdownBg,
                         borderRadius: 12,
                         overflow: 'hidden',
                         border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
                         boxShadow: isDark
                           ? '0 16px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04)'
                           : '0 8px 32px rgba(0,0,0,0.12)',
                         opacity: isOpen ? 1 : 0,
                         pointerEvents: isOpen ? 'auto' : 'none',
                         transition: 'opacity 160ms ease, transform 160ms ease',
                       }}
                    >
                      {/* Accent line – matches DesktopStartDropdown */}
                      <div style={{ height: 2, background: `linear-gradient(90deg, ${tk.primary}, transparent)` }} />

                      {/* Items: grid flow column, max 4 rows */}
                      <div style={{ display: 'grid', gridAutoFlow: 'column', gridTemplateRows: 'repeat(4, auto)', padding: 8, gap: 2 }}>
                        {(tab.subItems ?? []).map((item, j) => (
                          <ButtonBase
                            key={j}
                            role="menuitem"
                            onClick={() => { if (!item.disabled) { item.onClick?.(); setOpenDropdown(null); } }}
                            disabled={item.disabled}
                            sx={{
                              display: 'flex !important',
                              alignItems: 'center',
                              gap: '12px',
                              borderRadius: '10px',
                              px: '12px',
                              py: '10px',
                              textAlign: 'left',
                              minWidth: 200,
                              width: '100%',
                              opacity: item.disabled ? 0.4 : 1,
                              cursor: item.disabled ? 'not-allowed' : 'pointer',
                              transition: 'background 120ms',
                              '&:hover': { background: tk.itemHover },
                            }}
                          >
                            {/* Icon */}
                            <span style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                              background: isDark ? 'rgba(255,255,255,0.08)' : tk.primary10,
                              color: tk.primary,
                            }}>
                              <SubMenuIcon iconKey={item.iconKey} size={15} />
                            </span>

                            {/* Label + description */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                              <span style={{
                                fontFamily: 'var(--typography-fontfamily-display, sans-serif)',
                                fontSize: 12, fontWeight: 600, letterSpacing: '0.02em',
                                whiteSpace: 'nowrap', color: tk.text,
                              }}>
                                {item.label}
                              </span>
                              {item.description && (
                                <span style={{
                                  fontFamily: 'var(--typography-fontfamily-sans, sans-serif)',
                                  fontSize: 10, lineHeight: 1.4,
                                  maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  color: tk.textMuted,
                                }}>
                                  {item.description}
                                </span>
                              )}
                            </div>

                            {/* Badge */}
                            {item.badge && (
                              <span style={{
                                flexShrink: 0, marginLeft: 'auto',
                                padding: '2px 6px', borderRadius: 4,
                                fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                                background: tk.primary, color: '#fff',
                              }}>
                                {item.badge}
                              </span>
                            )}
                          </ButtonBase>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Right Slot + Burger Button ───────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
            {rightSlot}
            {hasBurger(variant) && (
              <div style={{ position: 'relative' }}>
                <ButtonBase
                  onClick={() => { setStartOpen(o => !o); setOpenDropdown(null); }}
                  aria-expanded={startOpen}
                  aria-label={startOpen ? 'Menü schließen' : 'Menü öffnen'}
                  sx={{
                    borderRadius: '8px',
                    p: '10px',
                    color: startOpen ? tk.primary : tk.textMuted,
                    background: startOpen ? tk.primary10 : 'transparent',
                    transition: 'background 150ms, color 150ms',
                    '&:hover': { background: tk.itemHover, color: tk.text },
                  }}
                >
                  {startOpen ? <IcoClose /> : <IcoMenu />}
                </ButtonBase>
                <DesktopBurgerDropdown open={startOpen} theme={theme} onNavigate={onNavigate} onClose={() => setStartOpen(false)} />
              </div>
            )}
          </div>

        </div>
      </nav>
    </div>
  );
}


// ─── Mobile Bottom Nav ─────────────────────────────────────────────────────────

const NAV_H = 58; // px – feste Höhe der Bottom Nav (without safe-area)

interface MobileNavProps {
  variant:     MainMenuVariant;
  theme:       MainMenuTheme;
  tabCfgs:     TabCfg[];
  customTabs?: import('./main-menu.types').MainMenuTab[];
  activeTabIdx?: number;
  currentPath?: string;
  onHome?:     () => void;
  onSearch?:   () => void;
  onBurger?:   () => void;
  onBack?:     () => void;
  onNavigate?: (to: string) => void;
  onLevelChange?: (level: MainMenuLevel, parent?: string) => void;
  brandBadge?: React.ReactNode;
  className?:  string;
  mobileHeader?: import('./main-menu.types').MainMenuProps['mobileHeader'];
}

function MobileNav({ variant, theme, tabCfgs, customTabs, activeTabIdx, currentPath, onHome, onSearch, onBurger, onNavigate, onLevelChange, brandBadge, className, mobileHeader }: MobileNavProps) {
  const [level,       setLevel]       = useState<MainMenuLevel>('root');
  const [parentLabel, setParentLabel] = useState('');
  const [subItems,    setSubItems]    = useState<MainMenuSubItem[]>([]);
  const [activeSubIdx, setActiveSubIdx] = useState<number>(-1);
  const [drawerOpen,  setDrawerOpen]  = useState(false);
  const userDismissedSub = useRef(false);
  const tabsScrollRef = useRef<HTMLDivElement>(null);

  // Keep the active root tab visible inside the horizontally scrollable tabs row.
  useEffect(() => {
    const c = tabsScrollRef.current;
    if (!c) return;
    const el = c.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el) return;
    const target = el.offsetLeft - (c.clientWidth - el.offsetWidth) / 2;
    c.scrollLeft = Math.max(0, Math.round(target));
  }, [activeTabIdx, currentPath, customTabs]);

  const isDark = theme === 'dark';
  const tk     = isDark ? T.dark : T.light;

  const goSub = useCallback((label: string, items: MainMenuSubItem[], autoSubIdx?: number) => {
    setLevel('sub');
    setParentLabel(label);
    setSubItems(items);
    setActiveSubIdx(autoSubIdx ?? -1);
    userDismissedSub.current = false;
    onLevelChange?.('sub', label);
  }, [onLevelChange]);

  const goRoot = useCallback(() => {
    setLevel('root');
    setParentLabel('');
    setSubItems([]);
    setActiveSubIdx(-1);
    userDismissedSub.current = true;
    // Back always navigates to Home, not to tab root or browser history
    onHome?.();
    onLevelChange?.('root');
  }, [onHome, onLevelChange]);

  // Tabs auflösen
  const tabs = customTabs
    ? customTabs.map((t, i) => ({
        label:    t.label,
        icon:     (c: string) => <span style={{ color: c }}>{t.icon}</span>,
        activeIn: [] as MainMenuVariant[],
        subItems: t.subItems ?? [],
        extOnClick:      t.onClick,
        extOnMouseEnter: t.onMouseEnter,
        extOnMouseLeave: t.onMouseLeave,
        idx: i,
      }))
    : tabCfgs.map((t, i) => ({ ...t, extOnClick: undefined, extOnMouseEnter: undefined, extOnMouseLeave: undefined, idx: i }));

  // Auto-derive sub-level from currentPath.
  // Uses most-specific (longest) match to avoid /coop matching before /coop/guide.
  // Consistent for all depths: tab-root (/buy) and deeper (/buy/map) both open
  // the sub-menu with the matching item active.
  // When no tab matches (Home, /account, etc.) the nav resets to root level.
  useEffect(() => {
    if (!currentPath || !customTabs || userDismissedSub.current) return;

    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      if (tab.subItems.length === 0) continue;

      // Find the most specific (longest) matching sub-item
      let bestJ  = -1;
      let bestLen = -1;
      for (let j = 0; j < tab.subItems.length; j++) {
        const p = tab.subItems[j].path ?? '';
        if (!p) continue;
        const isRootSub = p.split('/').filter(Boolean).length === 1;
        const matches   = isRootSub
          ? currentPath === p
          : (currentPath === p || currentPath.startsWith(p + '/'));
        if (matches && p.length > bestLen) { bestJ = j; bestLen = p.length; }
      }

      if (bestJ >= 0) {
        goSub(tab.label, tab.subItems, bestJ);
        return;
      }
    }

    // No tab matched — we're on Home, /account, or a non-tab route.
    // Reset to root level so the bottom nav doesn't show a stale sub-menu.
    setLevel('root');
    setParentLabel('');
    setSubItems([]);
    setActiveSubIdx(-1);
    onLevelChange?.('root');
  }, [currentPath]);

  return (
    <>
      {/* Floating wrapper – always docked (floating pill), even without scroll */}
      <div
        style={{
          padding: '6px 10px',
          boxSizing: 'border-box',
        }}
      >
<nav
        aria-label="Main Menu"
        className={className}
        style={{
          position: 'relative',
          width: '100%',
          height: NAV_H,
          overflow: 'hidden',
          background: isDark ? 'rgba(22,27,35,0.92)' : 'rgba(255,255,255,0.92)',
          borderRadius: 18,
          boxShadow: isDark
            ? '0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.2), inset 0 0 0 1px rgba(255,255,255,0.09)'
            : '0 8px 32px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.05), inset 0 0 0 1px rgba(0,0,0,0.07)',
        }}
      >
        {/* ════════ EBENE 1 – Root ════════ */}
          <div
            aria-hidden={level !== 'root'}
            style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center',
              padding: '0 8px',
              transform: level === 'root' ? 'translateX(0)' : 'translateX(-20%)',
              opacity:   level === 'root' ? 1 : 0,
              pointerEvents: level === 'root' ? 'auto' : 'none',
              transition: 'transform 260ms cubic-bezier(0.4,0,0.2,1), opacity 220ms ease',
          }}
        >
            {/* Home */}
          {hasHome(variant) && (
            <div style={{ flexShrink: 0, width: 44, height: 44, position: 'relative' }}>
              <button onClick={onHome} aria-label="Home"
                style={{
                  width: 44, height: 44,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'none', border: 0, cursor: 'pointer', borderRadius: 10,
                  overflow: 'visible',
                }}
              >
                <div style={{ width: 26, height: 26, '--fill-0': tk.primary } as React.CSSProperties}>
                  <AnimatedLogoIcon />
                </div>
              </button>
              {/* Rendered as a sibling, not nested inside the Home <button> — a
                  clickable brandBadge (e.g. BetaBadge) needs its own tap target;
                  nesting an interactive element inside a <button> is invalid HTML
                  and would fight the Home button for the click. */}
              {brandBadge && (
                <span style={{
                  position: 'absolute',
                  bottom: -9, left: 'calc(50% + 1px)',
                  display: 'inline-block',
                  transform: 'translateX(-50%) scale(0.65)',
                  transformOrigin: 'top center',
                }}>
                  {brandBadge}
                </span>
              )}
            </div>
          )}

          {/* Search – direkt nach Home (Platz 2) */}
          {onSearch && (
            <button onClick={onSearch} aria-label="Search"
              style={{
                flexShrink: 0,
                width: 44, height: 44,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 0, cursor: 'pointer', borderRadius: 10,
                color: tk.textMuted,
                transition: 'background 150ms, color 150ms',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = tk.itemHover;
                (e.currentTarget as HTMLButtonElement).style.color = tk.text;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'none';
                (e.currentTarget as HTMLButtonElement).style.color = tk.textMuted;
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" fill="currentColor" />
              </svg>
            </button>
          )}

          {/* Tabs */}
          {hasTabs(variant) && (
            <div ref={tabsScrollRef} style={{
              flex: 1, minWidth: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
              overflowX: 'auto', overflowY: 'hidden',
              scrollbarWidth: 'none',
              maskImage: 'linear-gradient(90deg, #000 0, #000 calc(100% - 14px), transparent 100%)',
              WebkitMaskImage: 'linear-gradient(90deg, #000 0, #000 calc(100% - 14px), transparent 100%)',
            }}>
              {tabs.map(tab => {
                const isActive  = customTabs ? activeTabIdx === tab.idx : tab.activeIn.includes(variant);
                const color     = isActive ? tk.primary : tk.textMuted;
                const hasSub    = tab.subItems.length > 0;
                return (
                  <button
                    key={tab.label}
                    onClick={() => { tab.extOnClick?.(); if (hasSub) goSub(tab.label, tab.subItems); }}
                    onMouseEnter={() => tab.extOnMouseEnter?.()}
                    onMouseLeave={() => tab.extOnMouseLeave?.()}
                    aria-label={tab.label}
                    aria-current={isActive ? 'page' : undefined}
                    style={{
                      position: 'relative',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 3,
                      flexShrink: 0,
                      minWidth: 52, padding: '5px 8px',
                      background: 'none', border: 0, cursor: 'pointer',
                      color,
                    }}
                  >
                    <span style={{ lineHeight: 0 }}>{tab.icon(color)}</span>
                    <span style={{
                      fontFamily: 'var(--typography-fontfamily-display)',
                      fontWeight: isActive ? 700 : 500,
                      fontSize: 9,
                      letterSpacing: '0.07em',
                      textTransform: 'uppercase',
                      lineHeight: 1,
                      whiteSpace: 'nowrap',
                    }}>
                      {tab.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Middle slot: Tabs or mobileHeader or plain spacer */}
          {hasTabs(variant) ? null : mobileHeader ? (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 0,
              overflow: 'hidden',
              padding: '0 4px',
            }}>
              {/* Back button */}
              {mobileHeader.onBack && (
                <button
                  onClick={mobileHeader.onBack}
                  aria-label="Zurück"
                  style={{
                    flexShrink: 0,
                    width: 30, height: 30,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'transparent',
                    border: 0, cursor: 'pointer', borderRadius: 8,
                    color: tk.textMuted,
                    marginRight: -2,
                  }}
                >
                  <IcoBack color={tk.textMuted} />
                </button>
              )}
              {/* Title + Subtitle */}
              <div style={{
                flex: 1, minWidth: 0,
                display: 'flex', flexDirection: 'column',
                justifyContent: 'center',
                gap: mobileHeader.subtitle ? 1 : 0,
              }}>
                <span style={{
                  fontFamily: 'var(--typography-fontfamily-sans, system-ui, sans-serif)',
                  fontWeight: 600,
                  fontSize: mobileHeader.subtitle ? 14 : 15,
                  letterSpacing: '-0.01em',
                  color: tk.text,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  lineHeight: 1.25,
                }}>
                  {mobileHeader.title}
                </span>
                {mobileHeader.subtitle && (
                  <span style={{
                    fontFamily: 'var(--typography-fontfamily-sans, system-ui, sans-serif)',
                    fontWeight: 400,
                    fontSize: 11,
                    letterSpacing: 0,
                    color: tk.textMuted,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: 1.3,
                  }}>
                    {mobileHeader.subtitle}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div style={{ flex: 1 }} />
          )}

          {/* Burger */}
          {hasBurger(variant) && (
            <button
              onClick={() => { setDrawerOpen(o => !o); onBurger?.(); }}
              aria-label={drawerOpen ? 'Menü schließen' : 'Menü öffnen'}
              aria-expanded={drawerOpen}
              style={{
                flexShrink: 0,
                width: 44, height: 44,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: drawerOpen ? tk.primary10 : 'none',
                border: 0, cursor: 'pointer', borderRadius: 10,
                color: drawerOpen ? tk.primary : tk.textMuted,
                transition: 'background 180ms ease, color 180ms ease',
              }}
            >
              {drawerOpen ? <IcoClose /> : <IcoMenu />}
            </button>
          )}
        </div>

        {/* ════════ EBENE 2 – Sub ════════ */}
          <div
            aria-hidden={level !== 'sub'}
            style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center',
              padding: '0 8px',
              gap: 6,
              transform: level === 'sub' ? 'translateX(0)' : 'translateX(20%)',
              opacity:   level === 'sub' ? 1 : 0,
              pointerEvents: level === 'sub' ? 'auto' : 'none',
              transition: 'transform 260ms cubic-bezier(0.4,0,0.2,1), opacity 220ms ease',
          }}
        >
          {/* Back Button */}
          <button
            onClick={goRoot}
            aria-label="Zurück"
            style={{
              flexShrink: 0,
              width: 36, height: 36,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: tk.primary10,
              border: 0, cursor: 'pointer', borderRadius: 10,
              color: tk.primary,
              transition: 'opacity 150ms ease',
            }}
          >
            <IcoBack color={tk.primary} />
          </button>

          {/* Parent Label */}
          <span style={{
            fontFamily: 'var(--typography-fontfamily-display)',
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
            color: tk.primary,
            flexShrink: 0,
          }}>
            {parentLabel}
          </span>

          {/* Divider */}
          <span style={{ width: 1, height: 14, background: tk.border, flexShrink: 0 }} />

          {/* Sub-Items als horizontale Scroll-Liste */}
          <div style={{
            flex: 1,
            display: 'flex', alignItems: 'center',
            gap: 2,
            overflow: 'hidden',
            maskImage: 'linear-gradient(90deg, transparent 0%, black 8px, black calc(100% - 8px), transparent 100%)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center',
              gap: 2,
              overflowX: 'auto',
              scrollbarWidth: 'none',
              padding: '0 4px',
            }}>
              {subItems.map((item, i) => {
                  const isItemActive = i === activeSubIdx;
                  return (
                <button
                  key={i}
                  onClick={() => !item.disabled && item.onClick?.()}
                  disabled={item.disabled}
                  aria-current={isItemActive ? 'page' : undefined}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '6px 12px',
                    minHeight: 36,
                    background: isItemActive ? tk.primary10 : 'transparent',
                    border: 0,
                    borderRadius: 8,
                    cursor: item.disabled ? 'not-allowed' : 'pointer',
                    color: item.disabled
                      ? (isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)')
                      : isItemActive
                        ? tk.primary
                        : tk.textMuted,
                    fontFamily: 'var(--typography-fontfamily-display)',
                    fontSize: 10,
                    fontWeight: isItemActive ? 700 : 500,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    transition: 'background 140ms ease, color 140ms ease',
                  }}
                  onMouseEnter={e => {
                    if (!item.disabled && !isItemActive) {
                      const el = e.currentTarget as HTMLButtonElement;
                      el.style.background = tk.itemHover;
                      el.style.color      = tk.text;
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isItemActive) {
                      const el = e.currentTarget as HTMLButtonElement;
                      el.style.background = 'transparent';
                      el.style.color      = item.disabled
                        ? (isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)')
                        : tk.textMuted;
                    }
                  }}
                >
                  {item.label}
                  {item.badge && (
                    <span style={{
                      padding: '1px 4px', borderRadius: 3,
                      fontSize: 7, fontWeight: 700, letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      background: tk.primary, color: '#fff',
                    }}>
                      {item.badge}
                    </span>
                  )}
                </button>
                  );
                })}
            </div>
          </div>
        </div>
      </nav>
      </div>

      {/* Start-Drawer (Burger → Start-Menu) */}
      <MobileStartDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} theme={theme} onNavigate={onNavigate} tabs={customTabs} />
    </>
  );
}

// ─── Collapsible Section (Accordion) ───────────────────────────────────────────

function IcoChevronDown({ color, rotated }: { color: string; rotated: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      style={{ transition: 'transform 220ms ease', transform: rotated ? 'rotate(180deg)' : 'rotate(0deg)' }}
    >
      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" fill={color} />
    </svg>
  );
}

function DrawerCollapsibleSection({
  label,
  icon,
  isOpen,
  onToggle,
  children,
  isDark,
  tk,
}: {
  label: string;
  icon?: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  isDark: boolean;
  tk: typeof T.dark;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [maxH, setMaxH] = useState(0);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    if (isOpen) {
      setMaxH(el.scrollHeight);
    }
  }, [isOpen, children]);

  const bt = BUTTON_THEME.mobile;
  const bc = BUTTON_THEME.colors(isDark, tk);

  return (
    <div>
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        style={{
          display: 'flex', alignItems: 'center', gap: bt.gap,
          width: '100%',
          padding: `${bt.py} ${bt.px}`,
          background: isOpen ? bc.rowHover : 'none',
          border: 0,
          borderRadius: bt.borderRadius,
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background 120ms',
        }}
        onMouseEnter={e => { if (!isOpen) (e.currentTarget as HTMLButtonElement).style.background = bc.rowHover; }}
        onMouseLeave={e => { if (!isOpen) (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
        onMouseDown={e =>   { (e.currentTarget as HTMLButtonElement).style.background = bc.rowActive; }}
        onMouseUp={e =>     { (e.currentTarget as HTMLButtonElement).style.background = bc.rowHover; }}
      >
        {icon && (
          <span style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: bt.iconSize, height: bt.iconSize,
            borderRadius: bt.iconRadius, flexShrink: 0,
            background: bc.iconBg, color: bc.iconColor,
          }}>
            {icon}
          </span>
        )}
        <span style={{
          fontFamily: 'var(--typography-fontfamily-display)',
          fontWeight: 600, fontSize: bt.fontSize,
          letterSpacing: '0.02em',
          color: bc.label,
          flex: 1,
        }}>
          {label}
        </span>
        <IcoChevronDown color={tk.textMuted} rotated={isOpen} />
      </button>
      <div
        ref={contentRef}
        style={{
          maxHeight: isOpen ? maxH : 0,
          overflow: 'hidden',
          transition: 'max-height 260ms cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <div style={{ paddingLeft: 12, paddingBottom: 4 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Mobile Start Drawer ───────────────────────────────────────────────────────

function MobileStartDrawer({ open, onClose, theme, onNavigate, tabs }: {
  open: boolean;
  onClose: () => void;
  theme: MainMenuTheme;
  onNavigate?: (to: string) => void;
  tabs?: MainMenuTab[];
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef   = useRef<HTMLDivElement>(null);
  const isDark = theme === 'dark';
  const tk     = isDark ? T.dark : T.light;
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  useEffect(() => {
    const overlay = overlayRef.current;
    const panel   = panelRef.current;
    if (!overlay || !panel) return;
    if (open) {
      overlay.style.display = 'flex';
      void overlay.offsetHeight;
      overlay.style.opacity = '1';
      panel.style.transform = 'translateY(0)';
    } else {
      overlay.style.opacity = '0';
      panel.style.transform = 'translateY(100%)';
      const t = setTimeout(() => {
        if (overlay) overlay.style.display = 'none';
        setExpandedIdx(null);
      }, 280);
      return () => clearTimeout(t);
    }
  }, [open]);

  const toggleSection = useCallback((idx: number) => {
    setExpandedIdx(prev => prev === idx ? null : idx);
  }, []);

  const handleSubItemClick = useCallback((subItem: MainMenuSubItem) => {
    subItem.onClick?.();
    onClose();
  }, [onClose]);

  return createPortal(
    <div
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        display: 'none', opacity: 0,
        position: 'fixed', inset: 0,
        alignItems: 'flex-end',
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(6px)',
        zIndex: 1200,
        transition: 'opacity 280ms ease',
      }}
      role="dialog" aria-modal="true" aria-label="Start-Menü"
    >
      <div
        ref={panelRef}
        style={{
          position: 'relative',
          width: '100%',
          maxHeight: '80vh',
          overflowY: 'auto',
          borderRadius: '16px 16px 0 0',
          background: tk.dropdownBg,
          boxShadow: isDark
            ? '0 -8px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.05)'
            : '0 -4px 32px rgba(0,0,0,0.12)',
          transform: 'translateY(100%)',
          transition: 'transform 280ms cubic-bezier(0.4,0,0.2,1)',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)',
        }}
      >
        {/* Handle */}
        <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', width: 32, height: 4, borderRadius: 2, background: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)' }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 20px 14px', borderBottom: `1px solid ${tk.border}` }}>
          <span style={{ fontFamily: 'var(--typography-fontfamily-display)', fontWeight: 800, fontSize: 15, letterSpacing: '0.07em', textTransform: 'uppercase', color: tk.text }}>
            Menü
          </span>
          <button onClick={onClose} aria-label="Schließen"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: '50%', background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)', border: 0, cursor: 'pointer', color: tk.textMuted }}
          >
            <IcoClose />
          </button>
        </div>

        <div style={{ padding: '8px 12px 12px' }}>
          {/* ── Accordion: Haupt-Tabs ── */}
          {tabs && tabs.map((tab, idx) => {
            const hasSub = tab.subItems && tab.subItems.length > 0;
            if (!hasSub) return null;
            const bt = BUTTON_THEME.mobile;
            const bc = BUTTON_THEME.colors(isDark, tk);
            return (
              <DrawerCollapsibleSection
                key={tab.label}
                label={tab.label}
                icon={tab.icon}
                isOpen={expandedIdx === idx}
                onToggle={() => toggleSection(idx)}
                isDark={isDark}
                tk={tk}
              >
                {tab.subItems!.map((sub, si) => (
                  <button
                    key={si}
                    onClick={() => handleSubItemClick(sub)}
                    disabled={sub.disabled}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 10,
                      width: '100%',
                      padding: '8px 10px',
                      background: 'none', border: 0,
                      borderRadius: 8,
                      cursor: sub.disabled ? 'not-allowed' : 'pointer',
                      textAlign: 'left',
                      transition: 'background 120ms',
                      opacity: sub.disabled ? 0.4 : 1,
                    }}
                    onMouseEnter={e => {
                      if (!sub.disabled) (e.currentTarget as HTMLButtonElement).style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'none';
                    }}
                  >
                    {/* Icon – matches L1 accordion header styling */}
                    <span style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: bt.iconSize, height: bt.iconSize,
                      borderRadius: bt.iconRadius, flexShrink: 0,
                      background: bc.iconBg, color: bc.iconColor,
                    }}>
                      <SubMenuIcon iconKey={sub.iconKey} size={18} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{
                        display: 'block',
                        fontFamily: 'var(--typography-fontfamily-display)',
                        fontWeight: 500, fontSize: 15,
                        color: tk.text,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {sub.label}
                      </span>
                      {sub.description && (
                        <span style={{
                          display: 'block',
                          fontSize: 12,
                          color: tk.textMuted,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          marginTop: 1,
                        }}>
                          {sub.description}
                        </span>
                      )}
                    </div>
                    {sub.badge && (
                      <span style={{
                        flexShrink: 0,
                        padding: '2px 6px', borderRadius: 4,
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                        textTransform: 'uppercase' as const,
                        background: tk.primary, color: '#fff',
                        marginLeft: 8,
                      }}>
                        {sub.badge}
                      </span>
                    )}
                  </button>
                ))}
              </DrawerCollapsibleSection>
            );
          })}

          {/* ── Divider ── */}
          <div style={{ height: 1, background: tk.border, margin: '8px 4px' }} />

          {/* ── Utilities ── */}
          {MOBILE_BURGER_ITEMS.map((item) => {
            const bt = BUTTON_THEME.mobile;
            const bc = BUTTON_THEME.colors(isDark, tk);
            return (
              <button
                key={item.label}
                onClick={() => { onNavigate?.(item.path); onClose(); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: bt.gap,
                  width: '100%',
                  padding: `${bt.py} ${bt.px}`,
                  background: 'none', border: 0,
                  borderRadius: bt.borderRadius,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 120ms',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = bc.rowHover; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                onMouseDown={e =>   { (e.currentTarget as HTMLButtonElement).style.background = bc.rowActive; }}
                onMouseUp={e =>     { (e.currentTarget as HTMLButtonElement).style.background = bc.rowHover; }}
              >
                <span style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: bt.iconSize, height: bt.iconSize,
                  borderRadius: bt.iconRadius, flexShrink: 0,
                  background: bc.iconBg, color: bc.iconColor,
                }}>
                  <BurgerMenuItemIcon d={item.icon} color={bc.iconColor} />
                </span>
                <span style={{
                  fontFamily: 'var(--typography-fontfamily-display)',
                  fontWeight: 600, fontSize: bt.fontSize,
                  letterSpacing: '0.02em',
                  color: bc.label,
                }}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Haupt-Komponente ──────────────────────────────────────────────────────────

export function MainMenu({
  variant = 'Default',
  mode    = 'auto',
  theme   = 'light',
  onHome,
  onSearch,
  onBurger,
  onBack,
  tabs,
  activeTab,
  hoveredTab: _hoveredTab,
  currentPath,
  onNavigate,
  onLevelChange,
  rightSlot,
  brandBadge,
  mobileHeader,
  className,
  ...props
}: MainMenuProps) {
  const tabCfgs = variant === 'Variant9' ? VARIANT9_TABS : DEFAULT_TABS;
  const tk      = theme === 'dark' ? T.dark : T.light;

  // Im auto-Modus: Breakpoint 900px (lg aus theme.ts)
  // useSyncExternalStore für SSR-sicheres, flicker-freies Mediaquerie-Listening
  const mq = typeof window !== 'undefined'
    ? window.matchMedia('(min-width: 900px)')
    : null;

  const isDesktop = useSyncExternalStore(
    (cb) => {
      mq?.addEventListener('change', cb);
      return () => mq?.removeEventListener('change', cb);
    },
    () => mq?.matches ?? false,
    () => false, // server snapshot
  );

  const showMobile  = mode === 'mobile'  || (mode === 'auto' && !isDesktop);
  const showDesktop = mode === 'desktop' || (mode === 'auto' &&  isDesktop);

  // ── BarOnly ──────────────────────────────────────────────────────────────
  if (variant === 'BarOnly') {
    return (
      <div
        role="navigation"
        aria-label="Main Menu"
        className={className}
        style={{ width: '100%', height: 50, background: tk.bgScrolled }}
        {...props}
      />
    );
  }

  return (
    <>
      {/* ── Mobile Bottom Nav ─────────────────────────────────────────── */}
      {showMobile && (
        <MobileNav
          variant={variant}
          theme={theme}
          tabCfgs={tabCfgs}
          customTabs={tabs}
          activeTabIdx={activeTab}
          currentPath={currentPath}
          onHome={onHome}
          onSearch={onSearch}
          onBurger={onBurger}
          onBack={onBack}
          onNavigate={onNavigate}
          onLevelChange={onLevelChange}
          brandBadge={brandBadge}
          mobileHeader={mobileHeader}
          className={className}
        />
      )}

      {/* ── Desktop Top Bar ───────────────────────────────────────────── */}
      {showDesktop && (
        <DesktopTopBar
          variant={variant}
          theme={theme}
          tabCfgs={tabCfgs}
          customTabs={tabs}
          activeTabIdx={activeTab}
          onHome={onHome}
          onSearch={onSearch}
          currentPath={currentPath ?? '/'}
          onNavigate={onNavigate}
          onLevelChange={onLevelChange}
          rightSlot={rightSlot}
          brandBadge={brandBadge}
        />
      )}
    </>
  );
}
