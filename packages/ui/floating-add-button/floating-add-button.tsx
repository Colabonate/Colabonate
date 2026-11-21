/**
 * FloatingActionButton – FAB mit Context-Aware Dropdown
 *
 * Positioniert sich sticky oben rechts im Content-Bereich.
 * Das Submenu öffnet sich nach unten links.
 * Liest Aktionen dynamisch über den `actions` Prop (aus FABContext).
 * Fallback: legacy onCreateItem/onCreateService Props.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ButtonBase } from '@mui/material';
import { cn, useIsMobile, useScrollVanish, useTheme } from '@ds/utils';
import type { FloatingActionButtonProps } from './floating-add-button.types';

const T = {
  light: {
    bg:            'var(--color-neutral-90)',
    bgScrolled:    'rgba(255,255,255,0.96)',
    border:        'rgba(0,0,0,0.08)',
    text:          'var(--color-text-neutral-default)',
    textMuted:     'var(--color-neutral-5)',
    textOnPrimary: 'var(--color-neutral-white)',
    primary:       'var(--color-action-primary-default)',
    primaryActive: 'var(--color-action-primary-active)',
    primary10:     'var(--color-action-primary-10)',
    shadow:        '0 2px 16px rgba(0,0,0,0.08)',
    dropdownBg:    'var(--color-secondary-10)',
    accentSoft:    'var(--color-primary-50)',
    itemHover:     'rgba(0,0,0,0.15)',
  },
  dark: {
    bg:            'var(--color-secondary-90)',
    bgScrolled:    'rgba(30,36,44,0.97)',
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

const BUTTON_THEME = {
  gap:          '16px',
  px:           '16px',
  py:           '4px',
  borderRadius: '10px',
  iconSize:     32,
  iconRadius:   4,
  fontSize:     16,
  colors: (isDark: boolean, tk: typeof T.light) => ({
    iconBg:    isDark ? tk.itemHover : tk.accentSoft,
    iconColor: isDark ? tk.text : tk.textOnPrimary,
    label:     tk.text,
    rowHover:  isDark ? tk.itemHover : tk.itemHover,
    rowActive: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.09)',
  }),
};

const IcoPlus = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M19 13H13V19H11V13H5V11H11V5H13V11H19V13Z" fill="currentColor" />
  </svg>
);

const IcoAdd = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M19 13H13V19H11V13H5V11H11V5H13V11H19V13Z" fill="currentColor" />
  </svg>
);

const IcoInfo = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 17H11V11H13V17ZM13 9H11V7H13V9Z" fill="currentColor" />
  </svg>
);

function DropdownContent({ theme, actions, onClose }: {
  theme: 'light' | 'dark';
  actions: { id: string; label: string; info?: string; group: string; onClick: () => void }[];
  onClose: () => void;
}) {
  const isDark = theme === 'dark';
  const tk = isDark ? T.dark : T.light;
  const bt = BUTTON_THEME;
  const bc = bt.colors(isDark, tk);

  const groups = useMemo(() => {
    const map = new Map<string, typeof actions>();
    for (const action of actions) {
      const existing = map.get(action.group);
      if (existing) existing.push(action);
      else map.set(action.group, [action]);
    }
    return Array.from(map.entries());
  }, [actions]);

  return (
    <div className="flex flex-col gap-6">
      {groups.map(([group, items]) => (
        <div key={group} className="flex flex-col gap-0.5 mt-1">
          <p className="mt-2 mb-1 ml-2 font-bold text-sm uppercase tracking-[0.1em]"
             style={{
               fontFamily: 'var(--typography-fontfamily-display)',
               color: tk.accentSoft,
             }}>
            {group}
          </p>
          {items.map((item) => (
            <div key={item.id} className="flex flex-col gap-1">
              <ButtonBase
                onClick={() => { item.onClick(); onClose(); }}
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
                  transition: 'background 320ms',
                  cursor: 'pointer',
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
                  <IcoAdd />
                </span>
                <span style={{
                  fontFamily: 'var(--typography-fontfamily-sans)',
                  fontSize: bt.fontSize, fontWeight: 600, letterSpacing: '0.02em',
                  whiteSpace: 'nowrap', color: bc.label,
                  textTransform: 'uppercase',
                }}>
                  {item.label}
                </span>
              </ButtonBase>
              {item.info && (
                <div
                  className="flex items-center gap-1 text-[12px]"
                  style={{ color: tk.textMuted }}
                >
                  <IcoInfo />
                  <span>{item.info}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function FloatingActionButton({
  theme,
  size        = 'md',
  offsetRight = 75,
  offsetTop   = 10,
  className,
  actions: contextActions,
  scrollFade = false,
  onCreateItem,
  onCreateService,
}: FloatingActionButtonProps) {
  const ctx = useTheme();
  const resolvedTheme = theme ?? ctx.theme;
  const isMobile = useIsMobile();
  
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const isDark = resolvedTheme === 'dark';
  const tk = isDark ? T.dark : T.light;

  const btnSize  = (size === 'sm' ? 44 : size === 'lg' ? 64 : 56) - (isMobile ? 8 : 0);
  const iconSize = (size === 'sm' ? 16 : size === 'lg' ? 24 : 20) - (isMobile ? 2 : 0);

  const effectiveActions = useMemo(() => {
    if (contextActions && contextActions.length > 0) return contextActions;
    if (onCreateItem || onCreateService) {
      const legacy: typeof contextActions = [];
      if (onCreateItem) legacy.push({ id: 'legacy-item', label: 'Items', info: 'As a private seller', group: 'Sell', onClick: onCreateItem });
      if (onCreateService) legacy.push({ id: 'legacy-service', label: 'Services', info: 'Offer your expertise', group: 'Cooperate', onClick: onCreateService });
      return legacy;
    }
    return [];
  }, [contextActions, onCreateItem, onCreateService]);

  const isEmpty = effectiveActions.length === 0;

  useEffect(() => {
    if (isEmpty || !open) return;
    const fn = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open, isEmpty]);

  useEffect(() => {
    if (isEmpty) return;
    const el = dropRef.current;
    if (!el) return;
    el.style.opacity       = open ? '1' : '0';
    el.style.transform     = open ? 'translateY(0) scale(1)' : 'none';
    el.style.pointerEvents = open ? 'auto' : 'none';
    if (open) {
      el.removeAttribute('inert');
    } else {
      el.setAttribute('inert', '');
    }
  }, [open, isEmpty]);

  // Scroll-driven vanish with a rubber-band wobble (see useScrollVanish).
  // Paused while the menu is open so the FAB stays crisp and clickable.
  useScrollVanish(wrapRef, { enabled: scrollFade && !isEmpty, paused: open });

  if (isEmpty) return null;

  const handleButtonClick = () => {
    // Single action → execute directly, no dropdown needed.
    if (effectiveActions.length === 1) {
      effectiveActions[0].onClick();
      return;
    }
    setOpen(o => !o);
  };

  return (
    <div
      ref={wrapRef}
       className={cn('fixed inline-flex flex-col items-end', className)}
       style={{
         right: isMobile ? Math.min(offsetRight, 12) : offsetRight,
         ...(isMobile
           ? { bottom: 'calc(58px + env(safe-area-inset-bottom, 0px) + 12px)', top: 'auto' }
           : { top: offsetTop, bottom: 'auto' }),
          zIndex: open ? 1150 : 1100,
          ...(scrollFade && { willChange: 'opacity, transform, filter' }),
       }}
    >
      <div
        ref={dropRef}
        role="menu"
        className="absolute right-0 w-[240px] rounded-lg overflow-hidden opacity-0 pointer-events-none transition-all duration-800 ease-out"
        style={{
          ...(isMobile
            ? { bottom: 'calc(100% + 8px)', top: 'auto', transformOrigin: 'bottom right' }
            : { top: 'calc(100% + 8px)', transformOrigin: 'top right' }),
          zIndex: 1,
          transform: open ? 'translateY(0) scale(1)' : 'none',
          background: tk.dropdownBg,
          border: `1px solid ${tk.border}`,
          boxShadow: isDark
            ? '0 12px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)'
            : '0 8px 32px rgba(0,0,0,0.12)',
        }}
      >
        <div style={{ height: 2, background: `linear-gradient(90deg, ${tk.primary}, transparent)` }} />
        <div className="p-4">
          <DropdownContent theme={resolvedTheme} actions={effectiveActions} onClose={() => setOpen(false)} />
        </div>
      </div>

      <ButtonBase
        onClick={handleButtonClick}
        aria-expanded={open}
        aria-label={open ? 'Close Add menu': 'Open Add menu'}
        className="text-white"
        sx={{
          width: btnSize,
          height: btnSize,
          borderRadius: '50%',
          color: tk.textOnPrimary,
          background: open ? tk.primaryActive : tk.primary,
          boxShadow: open
            ? '0 8px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.1)'
            : '0 12px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)',
          transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
          transform: open ? 'rotate(45deg)' : 'none',
          '&:hover': {
            background: tk.primaryActive,
            transform: open ? 'rotate(45deg)' : 'none',
            filter: 'brightness(1.08)',
            boxShadow: '0 16px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.15)',
          },
          '&:active': {
            filter: 'brightness(0.95)',
          },
        }}
      >
        <IcoPlus size={iconSize} />
      </ButtonBase>
    </div>
  );
}
