/**
 * Figma Code Connect – Logo Komponente
 *
 * Verknüpft die drei Figma-Komponenten (eine pro Theme) mit der
 * React-Implementierung in @ds/ui.
 *
 * Figma-Struktur:
 *   - "Logo"        (Default)  → node 218:56879  → theme="default"
 *   - "LogoOnWhite" (On White) → node 10075:121919 → theme="on-white"
 *   - "LogoOnDark"  (On Dark)  → node 635:62113  → theme="on-dark"
 *   Jede Komponente hat Property "Property 1":
 *     "Logo" | "ColaboBuy" | "ColaboNow" | "ColaboSell"
 *
 * Publish-Befehl (erfordert Figma Professional/Org/Enterprise + PAT):
 *   npx @figma/code-connect publish --token <FIGMA_TOKEN>
 */

// @ts-expect-error – @figma/code-connect ist ein optionales Dev-Dependency
import figma from '@figma/code-connect';
import { Logo } from './logo';
import type { LogoBrand } from './logo.types';

const brandMap = {
  Logo:       'colabonate',
  ColaboBuy:  'colabobuy',
  ColaboNow:  'colabonow',
  ColaboSell: 'colabosell',
} as const;

type BrandKey = keyof typeof brandMap;

function toBrand(key: BrandKey): LogoBrand {
  return brandMap[key]
}

// ─── Default Theme ────────────────────────────────────────────────────────────

figma.connect(
  Logo,
  'https://www.figma.com/design/Qqp6vB8VtEiMi5ohnAhNEG?node-id=218-56879',
  {
    props: {
      brand: figma.enum('Property 1', brandMap),
    },
    example: ({ brand }: { brand: BrandKey }) => <Logo brand={toBrand(brand)} theme="default" />,
  }
);

// ─── On White Theme ───────────────────────────────────────────────────────────

figma.connect(
  Logo,
  'https://www.figma.com/design/Qqp6vB8VtEiMi5ohnAhNEG?node-id=10075-121919',
  {
    props: {
      brand: figma.enum('Property 1', brandMap),
    },
    example: ({ brand }: { brand: BrandKey }) => <Logo brand={toBrand(brand)} theme="on-white" />,
  }
);

// ─── On Dark Theme ────────────────────────────────────────────────────────────

figma.connect(
  Logo,
  'https://www.figma.com/design/Qqp6vB8VtEiMi5ohnAhNEG?node-id=635-62113',
  {
    props: {
      brand: figma.enum('Property 1', brandMap),
    },
    example: ({ brand }: { brand: BrandKey }) => <Logo brand={toBrand(brand)} theme="on-dark" />,
  }
);
