import { Logo } from '@ds/ui'
import type { LogoProps } from '@ds/ui'

/**
 * App-level Logo wrapper — a drop-in replacement for `<Logo>` that forwards all
 * props unchanged. Used on the login/onboarding/error surfaces.
 *
 * The BETA badge that used to be pinned to this logo was removed 2026-09-23
 * (the beta host was retired; the only remaining badge lives in the main menu).
 */
export function AppLogo({ className, ...logoProps }: LogoProps) {
  return <Logo {...logoProps} className={className} />
}
