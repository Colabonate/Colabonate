/**
 * SectionMenu – Dual-Rendering für Navigations-Untermenüs
 *
 * Rendert NavSubItem-Einträge entweder als Dashboard-Karten (`cards`)
 * oder als kompakte Liste für Floating Context Pages (`list`). (ADR-027)
 *
 * Tokens: var(--color-*), var(--typography-*) – kein hardcoded CSS
 */

import { cn } from '@ds/utils';
import type { SectionMenuProps } from './section-menu.types';
import type { NavSubItem } from '../navigation/navigation.types';

// ─── Icons ─────────────────────────────────────────────────────────────────

const IcoChevron = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41Z"
      fill="currentColor" />
  </svg>
);

const IcoArrow = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8Z"
      fill="currentColor" />
  </svg>
);

// ─── Card Item ──────────────────────────────────────────────────────────────

function CardItem({
  item,
  onSelect,
}: {
  item: NavSubItem;
  onSelect?: (item: NavSubItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(item)}
      className={cn(
        'group relative flex flex-col gap-2 rounded-xl p-4 text-left',
        'bg-[var(--color-surface-secondary,#f5f5f5)]',
        'border border-[var(--color-border-default,rgba(0,0,0,0.08))]',
        'transition-all duration-150',
        'hover:bg-[var(--color-action-primary-10,rgba(232,69,65,0.08))]',
        'hover:border-[var(--color-action-primary-default,#e84541)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2',
        'focus-visible:outline-[var(--color-action-primary-default,#e84541)]',
        'cursor-pointer',
      )}
    >
      {/* Badge */}
      {item.badge && (
        <span className={cn(
          'absolute right-3 top-3',
          'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
          'bg-[var(--color-action-primary-default,#e84541)]',
          'text-[var(--color-neutral-white,#fff)]',
        )}>
          {item.badge}
        </span>
      )}

      {/* Label */}
      <span className={cn(
        'text-sm font-semibold leading-tight',
        'text-[var(--color-neutral-black,#1a1a1a)]',
        'font-[var(--typography-fontfamily-display,sans-serif)]',
      )}>
        {item.label}
      </span>

      {/* Description */}
      {item.description && (
        <span className={cn(
          'text-xs leading-relaxed',
          'text-[var(--color-neutral-5,#888)]',
          'font-[var(--typography-fontfamily-sans,sans-serif)]',
        )}>
          {item.description}
        </span>
      )}

      {/* Arrow */}
      <span className={cn(
        'mt-auto self-end',
        'text-[var(--color-neutral-5,#888)]',
        'group-hover:text-[var(--color-action-primary-default,#e84541)]',
        'transition-colors duration-150',
      )}>
        <IcoArrow />
      </span>
    </button>
  );
}

// ─── List Item ──────────────────────────────────────────────────────────────

function ListItem({
  item,
  onSelect,
}: {
  item: NavSubItem;
  onSelect?: (item: NavSubItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(item)}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-3 text-left',
        'transition-colors duration-100',
        'hover:bg-[var(--color-action-primary-10,rgba(232,69,65,0.08))]',
        'focus-visible:outline-2 focus-visible:outline-offset-2',
        'focus-visible:outline-[var(--color-action-primary-default,#e84541)]',
        'cursor-pointer',
      )}
    >
      {/* Label */}
      <span className={cn(
        'flex-1 text-sm font-medium',
        'text-[var(--color-neutral-black,#1a1a1a)]',
        'font-[var(--typography-fontfamily-sans,sans-serif)]',
      )}>
        {item.label}
      </span>

      {/* Badge */}
      {item.badge && (
        <span className={cn(
          'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
          'bg-[var(--color-action-primary-default,#e84541)]',
          'text-[var(--color-neutral-white,#fff)]',
        )}>
          {item.badge}
        </span>
      )}

      {/* Chevron */}
      <span className="text-[var(--color-neutral-5,#888)]">
        <IcoChevron />
      </span>
    </button>
  );
}

// ─── SectionMenu ────────────────────────────────────────────────────────────

export function SectionMenu({
  items,
  mode = 'cards',
  onSelect,
  className,
  ...props
}: SectionMenuProps) {
  if (!items || items.length === 0) return null;

  if (mode === 'list') {
    return (
      <div
        role="menu"
        className={cn(
          'flex flex-col overflow-hidden rounded-xl',
          'bg-[var(--color-surface-primary,#fff)]',
          'border border-[var(--color-border-default,rgba(0,0,0,0.08))]',
          'divide-y divide-[var(--color-border-default,rgba(0,0,0,0.06))]',
          className,
        )}
        {...props}
      >
        {items.map((item) => (
          <ListItem key={item.path} item={item} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  // mode === 'cards'
  return (
    <div
      className={cn(
        'grid gap-3',
        'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
      {...props}
    >
      {items.map((item) => (
        <CardItem key={item.path} item={item} onSelect={onSelect} />
      ))}
    </div>
  );
}
