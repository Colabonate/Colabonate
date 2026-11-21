/**
 * Footer-Wrapper für die Colabonate App
 *
 * Erkennt automatisch die aktuelle Route und wählt die passende Footer-Variante:
 * - `/` (Home) → `extended`
 * - Alle anderen Seiten → `minimal`
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Footer, type NewsletterStatus } from '@ds/ui'
import { apiCall, ApiError } from '../lib/api'
import { cn } from '@ds/utils'

const APP_VERSION = __APP_VERSION__

export function AppFooter() {
  const location = useLocation()
  const navigate = useNavigate()
  const isHome = location.pathname === '/'
  const footerRef = useRef<HTMLDivElement>(null)

  const [newsletterEmail, setNewsletterEmail] = useState('')
  const [newsletterStatus, setNewsletterStatus] = useState<NewsletterStatus>('idle')
  const [newsletterError, setNewsletterError] = useState<string>()
  const [visible, setVisible] = useState(false)

  const handleNewsletterSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setNewsletterStatus('loading')
    setNewsletterError(undefined)
    try {
      await apiCall('/api/newsletter', {
        method: 'POST',
        body: JSON.stringify({ email: newsletterEmail }),
      })
      setNewsletterStatus('success')
    } catch (err) {
      setNewsletterStatus('error')
      setNewsletterError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    }
  }

  // Performant footer reveal: a tiny IntersectionObserver toggles a CSS class,
  // and the opacity + position transition runs on the compositor — no per-frame
  // JS, no global scroll listener. Reduced-motion users see it instantly via
  // the prefers-reduced-motion rule in index.css.
  useEffect(() => {
    const el = footerRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '0px 0px -40px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={footerRef} className={cn('footer-enter', visible && 'is-visible')}>
      <Footer
        variant={isHome ? 'extended' : 'minimal'}
        onNavigate={(href) => navigate(href)}
        version={APP_VERSION}
        newsletter={{
          email: newsletterEmail,
          onEmailChange: setNewsletterEmail,
          onSubmit: handleNewsletterSubmit,
          status: newsletterStatus,
          errorMessage: newsletterError,
        }}
      />
    </div>
  )
}
