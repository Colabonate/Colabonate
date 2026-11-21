import React from 'react';

export interface MainMenuBadgeProps {
  /** Text displayed in the badge (default: "Beta") */
  label?: string;
  /** Hide the badge entirely */
  hidden?: boolean;
}

/**
 * Standalone pill badge for the MainMenu brand area.
 * Pure inline styles — no Tailwind, no CSS variables, no animation.
 * Renders as a normal flow element (sibling next to the logo).
 */
export function MainMenuBadge({ label = 'Beta', hidden = false }: MainMenuBadgeProps) {
  if (hidden) return null;

  return React.createElement(
    'span',
    {
      style: {
        marginLeft: 6,
        marginRight: 4,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 9999,
        padding: '2px 7px',
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        background: '#E84541',
        color: '#ffffff',
        position: 'relative',
        zIndex: 10,
      } as React.CSSProperties,
    },
    label,
  );
}
