// ADR-384: the gradient "pack" row shared by the AI credit dialog and the MCP
// pass dialog: a large gradient number with a subtle glow that grows per stage,
// a corner highlight, an optional badge and the price on the right.
import Button from '@mui/material/Button';
import type { ReactNode } from 'react';

// Same tier palette as the Support Colabonate dialog (CustomTipModal).
export const TIER_COLORS = [
  { color: '#3b82f6', border: 'rgba(59,130,246,0.40)', bg: 'rgba(59,130,246,0.10)', hoverBg: 'rgba(59,130,246,0.18)' },
  { color: '#a855f7', border: 'rgba(168,85,247,0.40)', bg: 'rgba(168,85,247,0.10)', hoverBg: 'rgba(168,85,247,0.18)' },
  { color: '#f59e0b', border: 'rgba(245,158,11,0.40)', bg: 'rgba(245,158,11,0.10)', hoverBg: 'rgba(245,158,11,0.18)' },
];

/** Tier color at a custom alpha, derived from the tier's base rgba string. */
export function tint(c: (typeof TIER_COLORS)[number], alpha: number): string {
  return c.bg.replace(/0\.10\)$/, alpha + ')');
}

interface PackCardProps {
  /** Stage index: picks the color and how strong the glow is. */
  index: number;
  /** The big number. */
  value: string | number;
  /** Small caption under the number, e.g. "requests" or "days". */
  unit: string;
  badge?: string | null;
  price: ReactNode;
  /** Muted line under the price. */
  caption: string;
  disabled?: boolean;
  onClick: () => void;
}

export function PackCard({ index, value, unit, badge, price, caption, disabled, onClick }: PackCardProps) {
  const c = TIER_COLORS[index % TIER_COLORS.length];
  const level = index % TIER_COLORS.length;
  return (
    <Button
      variant="outlined"
      disabled={disabled}
      onClick={onClick}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        textAlign: 'left',
        px: 3,
        py: 2.25,
        borderRadius: '16px',
        textTransform: 'none',
        color: c.color,
        border: `1px solid ${c.border}`,
        background: `linear-gradient(135deg, ${tint(c, 0.16 + level * 0.05)} 0%, ${tint(c, 0.03)} 65%, transparent 100%)`,
        boxShadow: `0 0 ${level * 10}px ${level}px ${tint(c, 0.1 + level * 0.06)}`,
        transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease',
        // soft corner highlight, stronger with every stage
        '&::after': {
          content: '""',
          position: 'absolute',
          top: -40,
          right: -40,
          width: 140,
          height: 140,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${tint(c, 0.14 + level * 0.08)} 0%, transparent 70%)`,
          pointerEvents: 'none',
        },
        '&:hover': {
          borderColor: c.color,
          transform: 'translateY(-2px)',
          boxShadow: `0 6px 22px ${c.border}`,
          background: `linear-gradient(135deg, ${tint(c, 0.22 + level * 0.05)} 0%, ${tint(c, 0.06)} 65%, transparent 100%)`,
        },
        '&:active': { transform: 'translateY(0) scale(0.985)', boxShadow: 'none' },
        '&.Mui-disabled': { color: c.color, border: `1px solid ${c.border}`, opacity: 0.55 },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover, &:active': { transform: 'none' } },
      }}
    >
      <span className="flex flex-col gap-1 relative z-10">
        <span
          className="text-[44px] leading-none font-extrabold tabular-nums"
          style={{
            background: `linear-gradient(180deg, ${c.color} 0%, color-mix(in srgb, ${c.color} 62%, var(--theme-text)) 100%)`,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            filter: `drop-shadow(0 0 ${6 + level * 5}px ${c.border})`,
          }}
        >
          {value}
        </span>
        <span className="text-[13px] font-bold uppercase tracking-[0.14em] opacity-80">{unit}</span>
      </span>

      <span className="flex flex-col items-end gap-1.5 relative z-10">
        {badge && (
          <span
            className="text-[11px] font-bold uppercase tracking-wider rounded-full px-2.5 py-0.5"
            style={{ background: tint(c, 0.22), border: `1px solid ${c.border}`, color: c.color }}
          >
            {badge}
          </span>
        )}
        <span className="text-[18px] font-bold" style={{ color: 'var(--theme-text)' }}>{price}</span>
        <span className="text-[13px] font-medium" style={{ color: 'var(--theme-text-muted)' }}>{caption}</span>
      </span>
    </Button>
  );
}
