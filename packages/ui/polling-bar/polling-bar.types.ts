export type PollingBarStatus = 'idle' | 'scanning' | 'fetching' | 'found' | 'error'

export interface PollingBarProps {
  /** Aktueller Animations-Status des Balkens */
  status: PollingBarStatus
  /** Fortschritt 0–100, nur relevant bei 'scanning' */
  progress?: number
  /** Deaktiviert Animationen (prefers-reduced-motion) */
  reducedMotion?: boolean
  /** Update-Takt des Countdowns in ms – passt die CSS-Transition an (default: 200) */
  tickMs?: number
  /** Zusätzliche CSS-Klassen */
  className?: string
}
