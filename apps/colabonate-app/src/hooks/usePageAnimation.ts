import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useReducedMotion } from './useReducedMotion'

gsap.registerPlugin(ScrollTrigger)

interface SectionAnimation {
  selector: string
  from?: gsap.TweenVars
  stagger?: number
  scrollTrigger?: ScrollTrigger.Vars
}

export function usePageAnimation(sections: SectionAnimation[], loading = false) {
  const containerRef = useRef<HTMLDivElement>(null)
  const prefersReduced = useReducedMotion()
  // Keep a stable ref to the sections array so callers can pass inline literals
  // without causing the effect to re-run on every render.
  const sectionsRef = useRef(sections)
  sectionsRef.current = sections

  useEffect(() => {
    if (loading || prefersReduced || !containerRef.current) return

    let gsapCtx: gsap.Context

    const rafId = requestAnimationFrame(() => {
      const container = containerRef.current
      if (!container) return

      const allSelectors = sectionsRef.current.map(s => s.selector)
      if (allSelectors.some(sel => !container.querySelector(sel))) return

      gsapCtx = gsap.context(() => {
        for (const section of sectionsRef.current) {
          const { selector, from, stagger, scrollTrigger } = section

          if (scrollTrigger) {
            gsap.from(selector, {
              scrollTrigger: {
                trigger: containerRef.current,
                start: 'top 80%',
                once: true,
                ...scrollTrigger,
              },
              opacity: 0,
              y: 32,
              duration: 0.5,
              stagger: stagger ?? 0.08,
              ease: 'power2.out',
              clearProps: 'opacity,transform',
              ...from,
            })
          } else {
            gsap.from(selector, {
              opacity: 0,
              y: 32,
              duration: 0.6,
              stagger: stagger ?? 0.12,
              ease: 'power2.out',
              clearProps: 'opacity,transform',
              ...from,
            })
          }
        }
      }, container)
      ScrollTrigger.refresh()
    })

    return () => {
      cancelAnimationFrame(rafId)
      gsapCtx?.revert()
    }
  }, [loading, prefersReduced])

  return containerRef
}

export function useSectionAnimation(
  selector: string,
  options?: {
    from?: gsap.TweenVars
    stagger?: number
    delay?: number
    scrollTrigger?: boolean
    start?: string
  }
) {
  const sectionRef = useRef<HTMLDivElement>(null)
  const prefersReduced = useReducedMotion()
  // Stable ref so callers can pass inline option objects without re-triggering the effect.
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    if (prefersReduced || !sectionRef.current) return

    const opts = optionsRef.current
    let ctx: gsap.Context

    // Use RAF to ensure DOM is ready
    const rafId = requestAnimationFrame(() => {
      if (!sectionRef.current) return
      if (!sectionRef.current.querySelector(selector)) return

      ctx = gsap.context(() => {
        if (opts?.scrollTrigger) {
          gsap.from(selector, {
            scrollTrigger: {
              trigger: sectionRef.current,
              start: opts.start ?? 'top 85%',
              once: true,
              toggleActions: 'play none none none',
            },
            opacity: 0,
            y: 32,
            duration: 0.55,
            stagger: opts.stagger ?? 0.08,
            ease: 'power2.out',
            clearProps: 'opacity,transform',
            delay: opts.delay ?? 0,
            ...opts.from,
          })
        } else {
          gsap.from(selector, {
            opacity: 0,
            y: 32,
            duration: 0.6,
            stagger: opts?.stagger ?? 0.1,
            ease: 'power2.out',
            clearProps: 'opacity,transform',
            delay: opts?.delay ?? 0,
            ...opts?.from,
          })
        }
      }, sectionRef)

      // Trigger sofort gegen aktuelle Scroll-Position prüfen –
      // verhindert dass Elemente die beim Load bereits im Viewport sind
      // dauerhaft auf opacity:0 eingefroren bleiben.
      ScrollTrigger.refresh()
    })

    return () => {
      cancelAnimationFrame(rafId)
      ctx?.revert()
    }
  }, [prefersReduced, selector])

  return sectionRef
}
