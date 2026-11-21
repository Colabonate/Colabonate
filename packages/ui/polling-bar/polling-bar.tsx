import type { CSSProperties } from 'react'
import type { PollingBarProps, PollingBarStatus } from './polling-bar.types'

const trackStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  height: '1px',
  zIndex: 1300,
  pointerEvents: 'none',
  backgroundColor: 'transparent',
  overflow: 'hidden',
}

function getInnerStyle(
  status: PollingBarStatus,
  progress: number,
  reducedMotion: boolean,
  tickMs: number,
): CSSProperties {
  const primary = 'var(--color-primary-50)'
  const success = 'var(--color-status-success)'
  const warning = 'var(--color-status-warning)'

  if (reducedMotion) {
    return { height: '100%', width: '100%', background: primary, opacity: 0.4, willChange: 'opacity' }
  }

  switch (status) {
    case 'idle':
      return {
        height: '100%',
        width: '100%',
        background: primary,
        opacity: 0.04,
        willChange: 'opacity',
      }

    case 'scanning':
      // Countdown: Progress bar grows from 0% to 100% over the poll interval.
      // Transition-Dauer = tickMs + 20ms Puffer → smooth egal ob 200ms oder rAF-Takt.
      return {
        height: '100%',
        width: `${progress}%`,
        background: primary,
        opacity: 0.1,
        willChange: 'width, opacity',
        transform: 'translateZ(0)',
        transition: `width ${(tickMs + 20) / 1000}s linear`,
      }

    case 'fetching':
      // Fast loading bar during API request - show activity
      return {
        height: '100%',
        width: '100%',
        background: `linear-gradient(90deg, ${primary}00 0%, ${primary}80 50%, ${primary}00 100%)`,
        opacity: 1,
        animation: 'polling-scan 1.0s linear infinite',
        transform: 'translateX(-100%)',
        willChange: 'opacity, transform',
      }

    case 'found':
      return {
        height: '100%',
        width: '100%',
        background: success,
        opacity: 1,
        animation: 'polling-found 1.0s ease-out forwards',
        willChange: 'opacity',
      }

    case 'error':
      return {
        height: '100%',
        width: '100%',
        background: warning,
        opacity: 0.8,
        animation: 'polling-error-fade 1.0s ease-out forwards',
        willChange: 'opacity',
      }
  }
}

export function PollingBar({
  status,
  progress = 0,
  reducedMotion = false,
  tickMs = 1000,
  className,
}: PollingBarProps) {
  return (
    <div style={trackStyle} className={className} aria-hidden="true">
      <div style={getInnerStyle(status, progress, reducedMotion, tickMs)} />
    </div>
  )
}
