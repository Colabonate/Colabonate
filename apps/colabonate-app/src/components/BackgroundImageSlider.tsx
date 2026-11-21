/**
 * BackgroundImageSlider
 * 
 * Floating image gallery that slides through logos with a fast blur-fade effect.
 * Positioned top-right with offset, images are clipped for a polished look.
 * 
 * @example
 * <BackgroundImageSlider
 *   images={images}
 *   interval={8000}
 *   transitionDuration={2000}
 * />
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@ds/utils'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface BackgroundImageSliderProps {
  /** Array of image URLs to cycle through */
  images: string[]
  /** Interval between slides in milliseconds */
  interval?: number
  /** Duration of the blur-fade transition in milliseconds */
  transitionDuration?: number
  /** Custom className */
  className?: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BackgroundImageSlider({
  images,
  interval = 3000,
  transitionDuration = 1200,
  className,
}: BackgroundImageSliderProps) {
  const [currentIndex, setCurrentIndex] = useState(() =>
    images.length > 0 ? Math.floor(Math.random() * images.length) : 0
  )
  const [prevIndex, setPrevIndex] = useState<number | null>(null)
  const [progress, setProgress] = useState(0)
  const rafRef = useRef<number | undefined>(undefined)
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const TRANSITION_DURATION = transitionDuration

  // Advance to next slide
  const advance = useCallback(() => {
    if (images.length <= 1) return
    setPrevIndex(currentIndex)
    setCurrentIndex((prev) => (prev + 1) % images.length)
    setProgress(0)
  }, [currentIndex, images.length])

  // Handle blur-fade transition via rAF
  const startTransition = useCallback(() => {
    const startTime = performance.now()

    const tick = (timestamp: number) => {
      const elapsed = timestamp - startTime
      const p = Math.min(elapsed / TRANSITION_DURATION, 1)
      setProgress(p)

      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        setPrevIndex(null)
        setProgress(0)
        rafRef.current = undefined
      }
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [TRANSITION_DURATION])

  // Trigger animation when transitioning
  useEffect(() => {
    if (prevIndex !== null) {
      startTransition()
    }
    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
    }
  }, [prevIndex, startTransition])

  // Set up interval
  useEffect(() => {
    if (images.length <= 1) return
    intervalRef.current = setTimeout(advance, interval)
    return () => {
      if (intervalRef.current !== undefined) clearTimeout(intervalRef.current)
    }
  }, [advance, interval, images.length])

  // Compute eased progress (used in JSX)
  const eased = 1 - Math.pow(1 - progress, 3) // ease-out cubic

  if (images.length === 0) return null

  return (
    <div
      className={cn(
        'fixed pointer-events-none select-none',
        'top-0 right-0',
        'w-[360px] sm:w-[480px] md:w-[640px] lg:w-[800px]',
        'h-[280px] sm:h-[360px] md:h-[480px] lg:h-[600px]',
        '-mr-[10%]',
        '-mt-[5%]',
        className,
      )}
      style={{ zIndex: 0 }}
    >
      {/* Container with overflow visible to allow blur to expand during transition */}
      <div
        className="relative w-full h-full overflow-visible"
        style={{
          borderRadius: '0 0 0 30%',
        }}
      >
        {/* Previous image (fading out with blur) */}
        {prevIndex !== null && (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${images[prevIndex]})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              opacity: (1 - eased) * 0.25,
              filter: `blur(${eased * 16}px)`,
              transition: 'none',
            }}
          />
        )}

        {/* Current image (fading in) */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${images[currentIndex]})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: prevIndex !== null ? eased * 0.25 : 0.25,
            filter: prevIndex !== null ? `blur(${(1 - eased) * 16}px)` : 'blur(0px)',
            transition: 'none',
          }}
        />
      </div>
    </div>
  )
}
