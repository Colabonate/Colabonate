export { cn } from './cn';
export { ThemeProvider, useTheme } from './useTheme';
export type { Theme, ThemePreference } from './useTheme';
export { computeReputationScore } from './computeReputationScore';
export type { ReputationInput } from './computeReputationScore';
export { OFFER_TYPE_LABELS, getOfferTypeLabel } from './offerTypeLabel';
export { formatCompactDate } from './formatCompactDate';
export { truncateHandle } from './truncateHandle';
export { useScrollVanish } from './useScrollVanish';
export type { ScrollVanishOptions } from './useScrollVanish';

// Responsive utilities
export {
  BREAKPOINTS,
  LAYOUT,
  gridCols,
  gap,
  pagePadding,
  pageMaxWidth,
  useBreakpoint,
  useIsMobile,
  useIsDesktop,
  useNavSafeArea,
} from './responsive';
export type { Breakpoint } from './responsive';

// Page layout hook
export {
  usePageLayout,
  useIsMobile as useIsMobileLayout,
  useIsTablet,
  useIsDesktop as useIsDesktopLayout,
  useViewportWidth,
} from './usePageLayout';
export type { PageLayout } from './usePageLayout';
