// Co-emission gate for market-spec Kind 16/17 events (ADR-154).
//
// Co-emission is additive and optional. Native 30407/30408 remain the source of
// truth. The gate ensures relays are not spammed by default.

import type { VisibilityTier } from './visibility.js'

export function shouldCoEmit(visibility: VisibilityTier | undefined): boolean {
  return visibility != null && visibility >= 1
}
