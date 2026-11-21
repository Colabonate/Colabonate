import type { LogoBrand, LogoProps, LogoTheme } from './logo.types';
import {
  LogoIcon, AnimatedLogoIcon, LogoWordmark, AnimatedLogoWordmark,
  ColabobuyA,  ColabobuyB,  ColabobuyC,
  ColabonowA,  ColabonowB,  ColabonowC,
  ColabosellA, ColabosellB, ColabosellC,
} from './logo-svgs';

// ─── Theme → CSS Custom Property --fill-0 ─────────────────────────────────────
// Default: nicht gesetzt → Fallback-Farben der Pfade (Dual-Color: Slate + Rot)
// On-white/On-dark: Farbe setzen → alle Pfade monochrom

const THEME_FILL: Record<LogoTheme, string | undefined> = {
  'default':  undefined,
  'on-white': '#2A2A2A',
  'on-dark':  '#F3F3F3',
};

// ─── Maße (aus Figma) ─────────────────────────────────────────────────────────

const SIZES: Record<LogoBrand, { width: number; height: number }> = {
  colabonate: { width: 463,     height: 96 },
  colabobuy:  { width: 375.172, height: 64 },
  colabonow:  { width: 403.302, height: 64 },
  colabosell: { width: 382.968, height: 64 },
};

// ─── CSS inset (top right bottom left) – 1:1 aus Figma ────────────────────────

const POSITIONS = {
  colabonate: {
    icon:     '9.84% 80.1% 9.02% 3.07%',
    wordmark: '22.62% 3.18% 32.79% 26.54%',
  },
  colabobuy: {
    a: '10.84% 47.25% 21.08% 0.02%',
    b: '0 8.72% 0 54.7%',
    c: '39.16% 0.05% 33.74% 95.25%',
  },
  colabonow: {
    a: '11.87% 50.07% 17.5% 0',
    b: '41.25% 0 30.62% 95.55%',
    c: '0 8.4% 0 51.77%',
  },
  colabosell: {
    a: '11.56% 47.25% 17.5% 0.02%',
    b: '40.94% 0.05% 30.94% 95.25%',
    c: '0 9.45% 0 54.7%',
  },
} as const;

const BRAND_NAMES: Record<LogoBrand, string> = {
  colabonate: 'Colabonate',
  colabobuy:  'ColaboBuy',
  colabonow:  'ColaboNow',
  colabosell: 'ColaboSell',
};

const abs = (inset: string): React.CSSProperties => ({ position: 'absolute', inset });

// ─── Komponente ───────────────────────────────────────────────────────────────

export function Logo({ brand = 'colabonate', theme = 'default', className, height: heightProp }: LogoProps) {
  const { width: naturalWidth, height: naturalHeight } = SIZES[brand];
  const height = heightProp ?? naturalHeight;
  const width  = naturalWidth * (height / naturalHeight);
  const fill   = THEME_FILL[theme];

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    width,
    height,
    ...(fill ? ({ '--fill-0': fill } as React.CSSProperties) : {}),
  };

  if (brand === 'colabonate') {
    const p = POSITIONS.colabonate;
    return (
      <div className={className} style={containerStyle} role="img" aria-label="Colabonate">
        <div style={abs(p.icon)}><LogoIcon /></div>
        <div style={abs(p.wordmark)}><LogoWordmark /></div>
      </div>
    );
  }

  const SUB = {
    colabobuy:  { A: ColabobuyA,  B: ColabobuyB,  C: ColabobuyC  },
    colabonow:  { A: ColabonowA,  B: ColabonowB,  C: ColabonowC  },
    colabosell: { A: ColabosellA, B: ColabosellB, C: ColabosellC },
  } as const;

  const { A, B, C } = SUB[brand];
  const pos = POSITIONS[brand];

  return (
    <div className={className} style={containerStyle} role="img" aria-label={BRAND_NAMES[brand]}>
      <div style={abs(pos.a)}><A /></div>
      <div style={abs(pos.b)}><B /></div>
      <div style={abs(pos.c)}><C /></div>
    </div>
  );
}

export function AnimatedLogo({ className, height: heightProp }: Omit<LogoProps, 'brand'>) {
  const { width: naturalWidth, height: naturalHeight } = SIZES.colabonate;
  const height = heightProp ?? naturalHeight;
  const width  = naturalWidth * (height / naturalHeight);

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    width,
    height,
  };

  const p = POSITIONS.colabonate;

  return (
    <div className={className} style={containerStyle} role="img" aria-label="Colabonate">
      <div style={abs(p.icon)}><AnimatedLogoIcon /></div>
      <div style={abs(p.wordmark)}><AnimatedLogoWordmark /></div>
    </div>
  );
}
