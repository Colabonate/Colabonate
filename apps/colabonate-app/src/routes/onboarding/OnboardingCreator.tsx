import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Building2,
  ArrowRight,
  Save,
  Globe,
  Check,
  CheckCircle2,
  Sparkles,
  KeyRound,
} from 'lucide-react'
import { cn } from '@ds/utils'
import { apiCall } from '../../lib/api'
import { ImageUploadInput } from '../../components/offers/ImageUploadInput'
import { OnboardingSectionPage } from './components/OnboardingSectionPage'
import { OnboardingFooter } from './components/OnboardingFooter'
import { OnboardingStagger } from './components/OnboardingStagger'
import { Seo } from '../../components/Seo'
import { parseJsonField } from '../coop/coop-cards'

// ── Page Types (ADR-151: 5 wizard steps → 4 pages) ─────────────────────

type CreatorPage = 'welcome' | 'basics' | 'details' | 'done'

type OpeningHoursMap = Record<string, { start: string; end: string } | null>

const DEFAULT_OPENING_HOURS: OpeningHoursMap = {
  mon: { start: '09:00', end: '17:00' },
  tue: { start: '09:00', end: '17:00' },
  wed: { start: '09:00', end: '17:00' },
  thu: { start: '09:00', end: '17:00' },
  fri: { start: '09:00', end: '15:00' },
  sat: null,
  sun: null,
}

const PAGES: { id: CreatorPage; label: string }[] = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'basics', label: 'Basics' },
  { id: 'details', label: 'Details' },
  { id: 'done', label: 'Done' },
]

// ── Component ──────────────────────────────────────────────────────────

export function OnboardingCreator() {
  const navigate = useNavigate()
  const location = useLocation()
  const isCompanyRoute = location.pathname === '/onboarding/creator/company'

  const [pubkey] = useState(() => localStorage.getItem('pubkey') ?? '')
  const [page, setPage] = useState<CreatorPage>(isCompanyRoute ? 'basics' : 'welcome')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [agreedTerms, setAgreedTerms] = useState(false)

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    address: '',
    zipCode: '',
    city: '',
    country: 'Germany',
    openingHours: DEFAULT_OPENING_HOURS,
    logoUrl: '',
  })

  const [existingCompany, setExistingCompany] = useState(false)

  // Check if user already has a company
  useEffect(() => {
    if (!pubkey) return
    apiCall(`/api/company/${pubkey}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.company) {
          setExistingCompany(true)
          setFormData({
            name: res.company.name || '',
            description: res.company.description || '',
            address: res.company.address || '',
            zipCode: res.company.zipCode || '',
            city: res.company.city || '',
            country: res.company.country || 'Germany',
            openingHours: parseJsonField<OpeningHoursMap>(res.company.openingHours, DEFAULT_OPENING_HOURS) ?? DEFAULT_OPENING_HOURS,
            logoUrl: res.company.logoUrl || '',
          })
        }
      })
      .catch(() => {/* not found = first time */})
  }, [pubkey]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSave = useCallback(async () => {
    if (!pubkey || !formData.name.trim()) return
    setSaving(true)
    setError('')
    try {
      await apiCall('/api/company', {
        method: 'POST',
        body: JSON.stringify({
          ownerPubkey: pubkey,
          ...formData,
          logoUrl: formData.logoUrl || undefined,
        }),
      })
      setPage('done')
      // Mark onboarding as completed
      localStorage.setItem('hasCompletedOnboarding', 'true')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error saving'
      setError(message)
    } finally {
      setSaving(false)
    }
  }, [pubkey, formData])

  const handleFinish = useCallback(() => {
    navigate('/')
  }, [navigate])

  const goNextPage = useCallback(() => {
    const idx = PAGES.findIndex((p) => p.id === page)
    if (idx < PAGES.length - 1) setPage(PAGES[idx + 1].id)
  }, [page])

  const goPrevPage = useCallback(() => {
    const idx = PAGES.findIndex((p) => p.id === page)
    if (idx > 0) setPage(PAGES[idx - 1].id)
  }, [page])

  const handleSkip = useCallback(() => {
    localStorage.setItem('hasCompletedOnboarding', 'true')
    navigate('/')
  }, [navigate])

  const pageIndex = PAGES.findIndex((p) => p.id === page)
  const showProgress = page === 'basics' || page === 'details'

  return (
    <>
      <Seo noindex />
    <OnboardingSectionPage
      pageKey={page}
      topBar={
        showProgress ? (
          <div className="px-6 mb-2">
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-[11px] font-bold uppercase tracking-widest"
                style={{ color: 'var(--theme-text-muted)' }}
              >
                Page {pageIndex + 1} of {PAGES.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {PAGES.map((p, i) => (
                <div
                  key={p.id}
                  className="h-1 flex-1 rounded-full transition-all duration-300"
                  style={{
                    background:
                      i <= pageIndex
                        ? 'var(--color-primary-50)'
                        : 'var(--theme-border)',
                  }}
                />
              ))}
            </div>
          </div>
        ) : undefined
      }
      footer={
        page === 'welcome' ? (
          // Bespoke welcome footer: full-width primary + secondary CTA
          <div className="px-6 pb-8 pt-2">
            <div className="flex flex-col gap-3 max-w-md mx-auto">
              <button
                onClick={goNextPage}
                className="flex items-center justify-center gap-2 w-full h-12 rounded-xl border-none text-[15px] font-semibold cursor-pointer transition-all duration-200 active:scale-[0.98] hover:opacity-90"
                style={{ background: 'var(--color-primary-50)', color: 'white' }}
              >
                {existingCompany ? 'Edit profile' : 'Create company'}
                <ArrowRight size={18} />
              </button>
              <button
                onClick={handleSkip}
                className="flex items-center justify-center gap-2 w-full h-12 rounded-xl border-none text-[14px] font-medium cursor-pointer transition-all duration-200 hover:opacity-70"
                style={{
                  background: 'var(--theme-surface-secondary)',
                  color: 'var(--theme-text-muted)',
                }}
              >
                Set up later
              </button>
            </div>
          </div>
        ) : page === 'basics' ? (
          <OnboardingFooter
            onBack={goPrevPage}
            onContinue={goNextPage}
            continueDisabled={!formData.name.trim()}
          />
        ) : page === 'details' ? (
          <OnboardingFooter
            onBack={goPrevPage}
            onContinue={handleSave}
            continueLabel="Create profile"
            continueIcon={<Save size={18} />}
            continueDisabled={!agreedTerms || !formData.name.trim() || saving}
          />
        ) : page === 'done' ? (
          // Done: primary CTA pinned in the footer
          <div className="px-6 pb-8 pt-2">
            <button
              onClick={handleFinish}
              className="flex items-center justify-center gap-2 w-full max-w-md mx-auto h-12 rounded-xl border-none text-[15px] font-semibold cursor-pointer transition-all duration-200 active:scale-[0.98] hover:opacity-90"
              style={{ background: 'var(--color-primary-50)', color: 'white' }}
            >
              <Sparkles size={18} />
              Let&apos;s go!
            </button>
          </div>
        ) : undefined
      }
    >
      {/* ── Page: Welcome ────────────────────────────────────────── */}
      {page === 'welcome' && (
        <div className="flex flex-col items-center justify-center min-h-full px-6 py-8 text-center">
          <div className="w-full max-w-md">
            <div
              className="w-24 h-24 rounded-2xl flex items-center justify-center mb-8 mx-auto"
              style={{
                background: 'rgba(232,69,65,0.08)',
                color: 'var(--color-primary-50)',
              }}
            >
              <Building2 size={40} />
            </div>

            <h1
              className="text-[24px] sm:text-[28px] font-bold leading-tight mb-3"
              style={{ color: 'var(--theme-text)' }}
            >
              Become a{' '}
              <span style={{ color: 'var(--color-primary-50)' }}>Creator</span>
            </h1>
            <p
              className="text-[15px] leading-relaxed mb-8"
              style={{ color: 'var(--theme-text-muted)', maxWidth: 340, margin: '0 auto 2rem' }}
            >
              Create your business profile and start selling
              on Colabonate — free and in just a few minutes.
            </p>

            {existingCompany ? (
              <div
                className="w-full p-5 rounded-xl border mb-8"
                style={{
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-surface)',
                }}
              >
                <div className="flex items-center gap-3 mb-3">
                  <CheckCircle2 size={20} style={{ color: 'var(--color-status-success)' }} />
                  <span className="text-[14px] font-semibold" style={{ color: 'var(--theme-text)' }}>
                    Company found
                  </span>
                </div>
                <p className="text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>
                  You already have a company profile (
                  <strong>{formData.name}</strong>). You can edit it now
                  or go to the dashboard.
                </p>
              </div>
            ) : (
              <div
                className="w-full p-5 rounded-xl border mb-8"
                style={{
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-surface)',
                }}
              >
                <div className="flex flex-col gap-3">
                  {[
                    { icon: <Building2 size={18} />, text: 'Public company profile' },
                    { icon: <Globe size={18} />, text: 'Nostr publishing for maximum reach' },
                    { icon: <Sparkles size={18} />, text: 'Catalogs, listings & reviews' },
                  ].map((item) => (
                    <div key={item.text} className="flex items-center gap-3">
                      <div style={{ color: 'var(--color-primary-50)' }}>{item.icon}</div>
                      <span className="text-[13px]" style={{ color: 'var(--theme-text)' }}>
                        {item.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Page: Basics (Name & Brand · Description · Location) ── */}
      {page === 'basics' && (
        <div className="px-6 py-6">
          <div className="w-full max-w-md mx-auto">
            <h2
              className="text-[22px] font-bold mb-1"
              style={{ color: 'var(--theme-text)' }}
            >
              Basics
            </h2>
            <p className="text-[14px] mb-6" style={{ color: 'var(--theme-text-muted)' }}>
              What is your company called and what do you offer?
            </p>

            <OnboardingStagger className="space-y-7">
              {/* Section 1: Name & Brand */}
              <Section title="Name &amp; Brand">
                <label
                  className="block mb-2 text-[13px] font-semibold"
                  style={{ color: 'var(--theme-text)' }}
                >
                  Company name *
                </label>
                <input
                  required
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="e.g. John Doe GmbH"
                  className={cn(
                    'w-full px-3 py-2.5 rounded-lg outline-none transition-all duration-200',
                    'placeholder:text-[var(--theme-text-muted)]',
                    'focus:ring-2 focus:ring-[var(--color-primary-50)]/25 focus:border-[var(--color-primary-50)]',
                  )}
                  style={{
                    border: '1px solid var(--theme-border)',
                    background: 'var(--theme-surface)',
                    color: 'var(--theme-text)',
                  }}
                />
              </Section>

              {/* Section 2: Description */}
              <Section title="Description">
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  placeholder="Short description of your company and activities..."
                  className={cn(
                    'w-full px-3 py-2.5 rounded-lg outline-none transition-all duration-200 min-h-[100px] resize-y',
                    'placeholder:text-[var(--theme-text-muted)]',
                    'focus:ring-2 focus:ring-[var(--color-primary-50)]/25 focus:border-[var(--color-primary-50)]',
                  )}
                  style={{
                    border: '1px solid var(--theme-border)',
                    background: 'var(--theme-surface)',
                    color: 'var(--theme-text)',
                  }}
                />
              </Section>

              {/* Section 3: Location */}
              <Section title="Location">
                <div className="space-y-5">
                  <div>
                    <label
                      className="block mb-2 text-[13px] font-semibold"
                      style={{ color: 'var(--theme-text)' }}
                    >
                      Street &amp; Number
                    </label>
                    <input
                      name="address"
                      value={formData.address}
                      onChange={handleChange}
                      placeholder="Musterweg 123"
                      className={cn(
                        'w-full px-3 py-2.5 rounded-lg outline-none transition-all duration-200',
                        'placeholder:text-[var(--theme-text-muted)]',
                        'focus:ring-2 focus:ring-[var(--color-primary-50)]/25 focus:border-[var(--color-primary-50)]',
                      )}
                      style={{
                        border: '1px solid var(--theme-border)',
                        background: 'var(--theme-surface)',
                        color: 'var(--theme-text)',
                      }}
                    />
                  </div>

                  <div className="grid grid-cols-[1fr_2fr] gap-3">
                    <div>
                      <label
                        className="block mb-2 text-[13px] font-semibold"
                        style={{ color: 'var(--theme-text)' }}
                      >
                        Zip Code
                      </label>
                      <input
                        name="zipCode"
                        value={formData.zipCode}
                        onChange={handleChange}
                        placeholder="12345"
                        className={cn(
                          'w-full px-3 py-2.5 rounded-lg outline-none transition-all duration-200',
                          'placeholder:text-[var(--theme-text-muted)]',
                          'focus:ring-2 focus:ring-[var(--color-primary-50)]/25 focus:border-[var(--color-primary-50)]',
                        )}
                        style={{
                          border: '1px solid var(--theme-border)',
                          background: 'var(--theme-surface)',
                          color: 'var(--theme-text)',
                        }}
                      />
                    </div>
                    <div>
                      <label
                        className="block mb-2 text-[13px] font-semibold"
                        style={{ color: 'var(--theme-text)' }}
                      >
                        City
                      </label>
                      <input
                        name="city"
                        value={formData.city}
                        onChange={handleChange}
                        placeholder="Your city"
                        className={cn(
                          'w-full px-3 py-2.5 rounded-lg outline-none transition-all duration-200',
                          'placeholder:text-[var(--theme-text-muted)]',
                          'focus:ring-2 focus:ring-[var(--color-primary-50)]/25 focus:border-[var(--color-primary-50)]',
                        )}
                        style={{
                          border: '1px solid var(--theme-border)',
                          background: 'var(--theme-surface)',
                          color: 'var(--theme-text)',
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      className="block mb-2 text-[13px] font-semibold"
                      style={{ color: 'var(--theme-text)' }}
                    >
                      Country
                    </label>
                    <input
                      name="country"
                      value={formData.country}
                      onChange={handleChange}
                      className={cn(
                        'w-full px-3 py-2.5 rounded-lg outline-none transition-all duration-200',
                        'placeholder:text-[var(--theme-text-muted)]',
                        'focus:ring-2 focus:ring-[var(--color-primary-50)]/25 focus:border-[var(--color-primary-50)]',
                      )}
                      style={{
                        border: '1px solid var(--theme-border)',
                        background: 'var(--theme-surface)',
                        color: 'var(--theme-text)',
                      }}
                    />
                  </div>
                </div>
              </Section>
            </OnboardingStagger>
          </div>
        </div>
      )}

      {/* ── Page: Details (Opening Hours · Logo · Review & Terms) ─ */}
      {page === 'details' && (
        <div className="px-6 py-6">
          <div className="w-full max-w-md mx-auto">
            <h2
              className="text-[22px] font-bold mb-1"
              style={{ color: 'var(--theme-text)' }}
            >
              Details &amp; Logo
            </h2>
            <p className="text-[14px] mb-6" style={{ color: 'var(--theme-text-muted)' }}>
              Opening hours, branding and the terms of service.
            </p>

            <OnboardingStagger className="space-y-7">
              {/* Section 1: Opening Hours */}
              <Section title="Opening Hours">
                <div
                  className="p-4 rounded-xl border"
                  style={{
                    border: '1px solid var(--theme-border)',
                    background: 'var(--theme-surface-secondary)',
                  }}
                >
                  <span
                    className="block text-[12px] font-bold uppercase tracking-wider mb-3"
                    style={{ color: 'var(--theme-text-muted)' }}
                  >
                    Opening Hours (default)
                  </span>
                  <div className="grid grid-cols-2 gap-1 text-[12px]">
                    {[
                      { day: 'mon', label: 'Mo' },
                      { day: 'tue', label: 'Di' },
                      { day: 'wed', label: 'Mi' },
                      { day: 'thu', label: 'Do' },
                      { day: 'fri', label: 'Fr' },
                      { day: 'sat', label: 'Sa' },
                      { day: 'sun', label: 'So' },
                    ].map(({ day, label }) => {
                      const hours = formData.openingHours[day] ?? null
                      return (
                        <div
                          key={day}
                          className="flex items-center gap-2 py-1"
                          style={{ color: hours ? 'var(--theme-text)' : 'var(--theme-text-muted)' }}
                        >
                          <span className="w-6 font-medium">{label}</span>
                          <span>{hours ? `${hours.start}–${hours.end}` : 'Closed'}</span>
                        </div>
                      )
                    })}
                  </div>
                  <p className="mt-2 text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
                    Opening hours can be customized later in settings.
                  </p>
                </div>
              </Section>

              {/* Section 2: Logo */}
              <Section title="Logo">
                <ImageUploadInput
                  value={formData.logoUrl}
                  onChange={(url) => setFormData((prev) => ({ ...prev, logoUrl: url }))}
                  onClear={() => setFormData((prev) => ({ ...prev, logoUrl: '' }))}
                />
                <p className="mt-2 text-[12px]" style={{ color: 'var(--theme-text-muted)' }}>
                  PNG recommended · auto-optimized
                </p>
              </Section>

              {/* Section 3: Review & Terms */}
              <Section title="Review &amp; Terms">
                {/* Error */}
                {error && (
                  <div
                    className="mb-4 p-4 rounded-xl border text-[13px]"
                    style={{
                      border: '1px solid var(--color-status-error)',
                      background: 'var(--color-status-error-bg)',
                      color: 'var(--color-status-error)',
                    }}
                  >
                    {error}
                  </div>
                )}

                {/* Summary Card */}
                <div
                  className="p-5 rounded-xl border mb-4"
                  style={{
                    border: '1px solid var(--theme-border)',
                    background: 'var(--theme-surface)',
                  }}
                >
                  <span
                    className="block text-[12px] font-bold uppercase tracking-wider mb-4"
                    style={{ color: 'var(--theme-text-muted)' }}
                  >
                    Summary
                  </span>
                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <Building2 size={16} className="shrink-0 mt-0.5" style={{ color: 'var(--color-primary-50)' }} />
                      <div>
                        <span className="text-[13px] font-semibold" style={{ color: 'var(--theme-text)' }}>
                          {formData.name || '—'}
                        </span>
                        {formData.description && (
                          <p className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }}>
                            {formData.description}
                          </p>
                        )}
                      </div>
                    </div>
                    {formData.address && (
                      <p className="text-[12px] pl-6" style={{ color: 'var(--theme-text-muted)' }}>
                        {formData.address}, {formData.zipCode} {formData.city}
                      </p>
                    )}
                  </div>
                </div>

                {/* AGB Checkbox */}
                <label
                  className="flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all duration-200"
                  style={{
                    border: agreedTerms
                      ? '1px solid var(--color-primary-50)'
                      : '1px solid var(--theme-border)',
                    background: agreedTerms
                      ? 'rgba(232,69,65,0.04)'
                      : 'var(--theme-surface-secondary)',
                  }}
                >
                  <div
                    className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 transition-all duration-200"
                    style={{
                      background: agreedTerms
                        ? 'var(--color-primary-50)'
                        : 'var(--theme-surface)',
                      border: agreedTerms ? 'none' : '1px solid var(--theme-border)',
                    }}
                  >
                    {agreedTerms && <Check size={14} style={{ color: 'white' }} />}
                  </div>
                  <input
                    type="checkbox"
                    checked={agreedTerms}
                    onChange={(e) => setAgreedTerms(e.target.checked)}
                    className="hidden"
                  />
                  <span className="text-[13px] leading-relaxed" style={{ color: 'var(--theme-text)' }}>
                    I agree to the{' '}
                    <span
                      className="font-semibold cursor-pointer"
                      style={{ color: 'var(--color-primary-50)' }}
                    >
                      Terms of Service
                    </span>{' '}
                    and{' '}
                    <span
                      className="font-semibold cursor-pointer"
                      style={{ color: 'var(--color-primary-50)' }}
                    >
                      Privacy Policy
                    </span>
                    . My data will be published via the Nostr network.
                  </span>
                </label>
              </Section>
            </OnboardingStagger>
          </div>
        </div>
      )}

      {/* ── Page: Done ───────────────────────────────────────────── */}
      {page === 'done' && (
        <div className="flex flex-col items-center justify-center min-h-full px-6 py-8 text-center">
          <div className="w-full max-w-md">
            <div
              className="w-24 h-24 rounded-2xl flex items-center justify-center mb-8 mx-auto"
              style={{
                background: 'rgba(35,202,97,0.1)',
                color: 'var(--color-status-success)',
              }}
            >
              <CheckCircle2 size={40} />
            </div>

            <h1
              className="text-[24px] sm:text-[28px] font-bold leading-tight mb-3"
              style={{ color: 'var(--theme-text)' }}
            >
              All done!
            </h1>
            <p
              className="text-[15px] leading-relaxed mb-8"
              style={{ color: 'var(--theme-text-muted)', maxWidth: 340, margin: '0 auto 2rem' }}
            >
              Your company profile has been created. You can edit and
              extend it anytime under{' '}
              <span className="font-semibold" style={{ color: 'var(--color-primary-50)' }}>
                Sell → Company
              </span>{' '}
            </p>

            {/* ── Nostr identity offer (queried once at the end of onboarding) ── */}
            <div
              className="w-full p-5 rounded-xl border mb-8 text-left"
              style={{
                border: '1px solid var(--color-primary-30)',
                background: 'rgba(232,69,65,0.04)',
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--color-primary-50)', color: 'white' }}
                >
                  Recommended
                </span>
              </div>
              <div className="flex items-start gap-3 mb-4">
                <div className="shrink-0" style={{ color: 'var(--color-primary-50)' }}>
                  <KeyRound size={22} />
                </div>
                <div>
                  <span
                    className="block text-[15px] font-semibold mb-1"
                    style={{ color: 'var(--theme-text)' }}
                  >
                    Create your Nostr identity
                  </span>
                  <p
                    className="text-[13px] leading-relaxed"
                    style={{ color: 'var(--theme-text-muted)' }}
                  >
                    Generate your personal Nostr key to publish your profile across the
                    Nostr network and truly own your identity. It stays on your device —
                    takes under a minute.
                  </p>
                </div>
              </div>
              <button
                onClick={() => navigate('/onboarding/generate-nostr-key')}
                className="flex items-center justify-center gap-2 w-full h-11 rounded-xl border-none text-[14px] font-semibold cursor-pointer transition-all duration-200 active:scale-[0.98] hover:opacity-90"
                style={{ background: 'var(--color-primary-50)', color: 'white' }}
              >
                Create my Nostr profile
                <ArrowRight size={16} />
              </button>
            </div>

            {/* Quick Links */}
            <div
              className="w-full p-5 rounded-xl border mb-8"
              style={{
                border: '1px solid var(--theme-border)',
                background: 'var(--theme-surface)',
              }}
            >
              <span
                className="block text-[12px] font-bold uppercase tracking-wider mb-4"
                style={{ color: 'var(--theme-text-muted)' }}
              >
                Next Steps
              </span>
              <div className="space-y-3">
                {[
                  { label: 'Create a catalog', path: '/sell/catalog' },
                  { label: 'List your first offer', path: '/sell/listings' },
                  { label: 'Go to Dashboard', path: '/' },
                ].map((item) => (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    className="flex items-center justify-between w-full p-3 rounded-lg border-none cursor-pointer transition-all duration-200 hover:opacity-80 active:scale-[0.98]"
                    style={{
                      background: 'var(--theme-surface-secondary)',
                      color: 'var(--theme-text)',
                    }}
                  >
                    <span className="text-[14px] font-medium">{item.label}</span>
                    <ArrowRight size={16} style={{ color: 'var(--theme-text-muted)' }} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </OnboardingSectionPage>
    </>
  )
}

// ── Section wrapper (≤3 labeled groups per page per ADR-151) ───────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3
        className="text-[12px] font-bold uppercase tracking-wider mb-3"
        style={{ color: 'var(--theme-text-muted)' }}
      >
        {title}
      </h3>
      {children}
    </section>
  )
}
