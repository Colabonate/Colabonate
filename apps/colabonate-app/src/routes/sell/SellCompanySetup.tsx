import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatLocaleTime } from '../../contexts/LocaleContext'
import { Building2, Save, ArrowLeft, Globe } from 'lucide-react'
import {
  Box,
  Typography,
  Paper,
} from '@mui/material'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { de } from 'date-fns/locale'
import { Card } from '../../components/ui/Card'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { cn } from '@ds/utils'
import { apiCall } from '../../lib/api'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { MultiImageUploadInput } from '../../components/offers/MultiImageUploadInput'
import { ImageUploadInput } from '../../components/offers/ImageUploadInput'
import { parseJsonField } from '../coop/coop-cards'

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

export function SellCompanySetup() {
  const navigate = useNavigate()
  const [pubkey] = useState(() => localStorage.getItem('pubkey') ?? '')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [publishStatus, setPublishStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [publishError, setPublishError] = useState('')
  const [company, setCompany] = useState<any>(null)
  const pageRef = usePageAnimation([
    { selector: '.setup-animate', from: { duration: 0.5, stagger: 0.12, y: 24 } },
  ])

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    address: '',
    zipCode: '',
    city: '',
    country: 'Germany',
    openingHours: DEFAULT_OPENING_HOURS,
    logoUrl: '',
    bannerUrl: '',
    images: [] as string[],
  })

  const loadCompany = useCallback(async (silent = false) => {
    if (!pubkey) {
      setLoading(false)
      return
    }
    if (!silent) setLoading(true)
    try {
      const res = await apiCall(`/api/company/${pubkey}`).then(r => r.json())
      if (res.company) {
        setCompany(res.company)
        setFormData({
          name: res.company.name || '',
          description: res.company.description || '',
          address: res.company.address || '',
          zipCode: res.company.zipCode || '',
          city: res.company.city || '',
          country: res.company.country || 'Germany',
          openingHours: parseJsonField<OpeningHoursMap>(res.company.openingHours, DEFAULT_OPENING_HOURS) ?? DEFAULT_OPENING_HOURS,
          logoUrl: res.company.logoUrl || '',
          bannerUrl: res.company.bannerUrl || '',
          // API already parses images JSON to array in companyWithParsedImages
          images: Array.isArray(res.company.images) ? res.company.images : [],
        })
        if (res.company.nostrEventId) {
          setPublishStatus('success')
        }
      }
    } catch (err) {
      console.error(err)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [pubkey])

  useEffect(() => {
    loadCompany()
  }, [loadCompany])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pubkey) return

    setSaving(true)
    setError('')
    setPublishStatus('idle')
    setPublishError('')

    try {
      const payload = {
        ownerPubkey: pubkey,
        name: formData.name,
        description: formData.description,
        address: formData.address,
        zipCode: formData.zipCode,
        city: formData.city,
        country: formData.country,
        openingHours: formData.openingHours,
        logoUrl: formData.logoUrl || undefined,
        bannerUrl: formData.bannerUrl || undefined,
        images: formData.images.length > 0 ? formData.images : undefined,
      }
      await apiCall('/api/company', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      navigate('/sell/company')
    } catch (err: any) {
      setError(err.message || 'Error saving')
    } finally {
      setSaving(false)
}
  }

  const handlePublish = async () => {
    if (!pubkey || !company) return
    setPublishStatus('loading')
    setPublishError('')

    try {
      const payload: Record<string, unknown> = { ownerPubkey: pubkey }
      if (formData.logoUrl) {
        payload.logoUrl = formData.logoUrl
      }
      if (formData.images.length > 0) {
        payload.images = formData.images
      }
      await apiCall(`/api/company/${pubkey}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      await apiCall(`/api/company/${pubkey}/publish`, {
        method: 'POST',
      })
      setPublishStatus('success')
      setPublishError('')
    } catch (err: any) {
      console.error('Publish error:', err)
      setPublishError(err.message || 'Failed to publish to Nostr')
      setPublishStatus('error')
    }
  }

  const getOpeningHours = (hours: OpeningHoursMap, day: string): { start: string; end: string } | null => {
    return hours[day] ?? null
  }

  const handleOpeningHoursChange = (day: string, start: string | null, end: string | null) => {
    setFormData(prev => ({
      ...prev,
      openingHours: { ...prev.openingHours, [day]: start && end ? { start, end } : null },
    }))
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  if (loading) {
    return (
      <PageContainer size="wide" spacing="lg">
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div
              className="w-12 h-12 rounded-full border-4 border-(--color-primary-50) border-t-transparent animate-spin mx-auto mb-4"
              style={{ borderColor: 'var(--color-primary-50) var(--color-primary-50) var(--color-primary-50) transparent' }}
            />
            <p className="text-(--theme-text-muted)">Loading data...</p>
          </div>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer size="wide" spacing="lg" className="setup-animate !px-4 md:!px-6 !py-6" ref={pageRef}>
        <button
          onClick={() => navigate('/sell/company')}
          className="inline-flex items-center gap-2 mb-6 bg-transparent border-none text-[13px] cursor-pointer p-0 hover:text-(--color-primary-50) transition-colors duration-200"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          <ArrowLeft size={16} />
          Back to Overview
        </button>

        <PageHeader
          icon={<Building2 size={18} />}
          title="Create Company"
          subtitle="Basic data for your public profile"
          onBack={() => navigate('/sell/company')}
        />

        {error && (
          <div
            className={cn(
              'mb-6 p-4 rounded-xl border',
              'text-[13px]',
            )}
            style={{
              border: '1px solid var(--color-status-error)',
              background: 'var(--color-status-error-bg)',
              color: 'var(--color-status-error)',
            }}
          >
            {error}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className={cn(
            'rounded-xl border bg-(--theme-surface-secondary)',
            'p-6',
          )}
          style={{ border: '1px solid var(--theme-border)' }}
        >
          <div className="mb-5">
            <label
              className={cn(
                'block mb-2 text-[13px] font-semibold',
              )}
              style={{ color: 'var(--theme-text)' }}
            >
              Company Name *
            </label>
            <input
              required
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="e.g. Max Mustermann GmbH"
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

          <div className="mb-5">
            <label
              className={cn(
                'block mb-2 text-[13px] font-semibold',
              )}
              style={{ color: 'var(--theme-text)' }}
            >
              Description
            </label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Short description of your company and activities..."
              className={cn(
                'w-full px-3 py-2.5 rounded-lg outline-none transition-all duration-200 min-h-[120px] resize-y',
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

          <div className={cn('grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-5 mb-5')}>
            <div>
              <label
                className={cn(
                  'block mb-2 text-[13px] font-semibold',
                )}
                style={{ color: 'var(--theme-text)' }}
              >
                Street & House Number
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
            <div className={cn('grid grid-cols-[1fr_2fr] gap-3')}>
              <div>
                <label
                  className={cn(
                    'block mb-2 text-[13px] font-semibold',
                  )}
                  style={{ color: 'var(--theme-text)' }}
                >
                  ZIP Code
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
                  className={cn(
                    'block mb-2 text-[13px] font-semibold',
                  )}
                  style={{ color: 'var(--theme-text)' }}
                >
                  City
                </label>
                <input
                  name="city"
                  value={formData.city}
                  onChange={handleChange}
                  placeholder="Musterstadt"
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
          </div>

          <div className={cn('grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-5 mb-6')}>
            <div>
              <label
                className={cn(
                  'block mb-2 text-[13px] font-semibold',
                )}
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

          <div className="mb-5">
            <label
              className={cn(
                'block mb-2 text-[13px] font-semibold',
              )}
              style={{ color: 'var(--theme-text)' }}
            >
              Logo
            </label>
            <ImageUploadInput
              value={formData.logoUrl}
              onChange={(url) => setFormData(prev => ({ ...prev, logoUrl: url }))}
              onClear={() => setFormData(prev => ({ ...prev, logoUrl: '' }))}
            />
            <p className={cn('mt-2 text-[12px]')} style={{ color: 'var(--theme-text-muted)' }}>
              PNG recommended for transparency · optimized to ~150 KB
            </p>
          </div>

          <div className="mb-5">
            <label
              className={cn(
                'block mb-2 text-[13px] font-semibold',
              )}
              style={{ color: 'var(--theme-text)' }}
            >
              Banner
            </label>
            <ImageUploadInput
              value={formData.bannerUrl}
              onChange={(url) => setFormData(prev => ({ ...prev, bannerUrl: url }))}
              onClear={() => setFormData(prev => ({ ...prev, bannerUrl: '' }))}
            />
            <p className={cn('mt-2 text-[12px]')} style={{ color: 'var(--theme-text-muted)' }}>
              Wide header image shown on your public company profile · optimized to ~150 KB
            </p>
          </div>

          <div className="mb-6">
            <label
              className={cn(
                'block mb-2 text-[13px] font-semibold',
              )}
              style={{ color: 'var(--theme-text)' }}
            >
              Company Images (max 5)
            </label>
            <MultiImageUploadInput
              values={formData.images}
              onChange={(urls) => setFormData(prev => ({ ...prev, images: urls }))}
              maxImages={5}
            />
            <p className={cn('mt-2 text-[12px]')} style={{ color: 'var(--theme-text-muted)' }}>
              JPG · PNG · WebP · GIF · max 20 MB each · optimized to ~150 KB
            </p>
          </div>

          <div className="mt-6">
            <Typography
              variant="overline"
              sx={{
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                color: 'var(--theme-text-muted)',
                textTransform: 'uppercase',
                display: 'block',
                mb: 2,
              }}
            >
              Opening Hours
            </Typography>
            <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: 'var(--theme-border)', bgcolor: 'var(--theme-surface)' }}>
              <Box sx={{ p: 3 }}>
                <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={de}>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
                    {[
                      { day: 'mon', label: 'Monday' },
                      { day: 'tue', label: 'Tuesday' },
                      { day: 'wed', label: 'Wednesday' },
                      { day: 'thu', label: 'Thursday' },
                      { day: 'fri', label: 'Friday' },
                      { day: 'sat', label: 'Saturday' },
                      { day: 'sun', label: 'Sunday' },
                    ].map((day) => {
                      const hours = getOpeningHours(formData.openingHours, day.day)
                      return (
                        <Card key={day.day} variant="interactive">
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--theme-text)' }}>
                              {day.label}
                            </Typography>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                              <TimePicker
                                label="Start"
                                value={hours?.start ? new Date(`2000-01-01T${hours.start}`) : null}
                                onChange={(newValue) => {
                                  if (newValue) {
                                    const time = formatLocaleTime(newValue, { hour: '2-digit', minute: '2-digit' })
                                    handleOpeningHoursChange(day.day, time, hours?.end || null)
                                  } else {
                                    handleOpeningHoursChange(day.day, null, null)
                                  }
                                }}
                                slotProps={{
                                  textField: {
                                    fullWidth: true,
                                    size: 'small',
                                    variant: 'outlined',
                                  },
                                }}
                              />
                              <TimePicker
                                label="End"
                                value={hours?.end ? new Date(`2000-01-01T${hours.end}`) : null}
                                onChange={(newValue) => {
                                  if (newValue) {
                                    const time = formatLocaleTime(newValue, { hour: '2-digit', minute: '2-digit' })
                                    handleOpeningHoursChange(day.day, hours?.start || null, time)
                                  } else {
                                    handleOpeningHoursChange(day.day, hours?.start || null, null)
                                  }
                                }}
                                slotProps={{
                                  textField: {
                                    fullWidth: true,
                                    size: 'small',
                                    variant: 'outlined',
                                  },
                                }}
                              />
                            </Box>
                          </Box>
                        </Card>
                      )
                    })}
                  </div>
                </LocalizationProvider>
              </Box>
            </Paper>
          </div>

          <div
            className="flex items-center justify-between px-6 py-4 border-t"
            style={{ borderColor: 'var(--theme-border)' }}
          >
            <button
              onClick={handlePublish}
              disabled={publishStatus === 'loading' || !company}
              className={cn(
                'inline-flex items-center gap-2 px-6 py-2.5 rounded-lg transition-all duration-200 cursor-pointer active:scale-95',
                publishStatus === 'loading' || !company 
                  ? 'opacity-50 cursor-not-allowed' 
                  : 'hover:opacity-90',
              )}
              style={{
                background: publishStatus === 'success'
                  ? 'rgba(35,202,97,0.12)'
                  : 'rgba(232,69,65,0.12)',
                color: publishStatus === 'success'
                  ? 'var(--color-status-success)'
                  : 'var(--color-primary-50)',
              }}
            >
              <Globe size={18} />
              {publishStatus === 'loading' 
                ? 'Publishing...' 
                : publishStatus === 'success'
                  ? 'Published'
                  : 'Publish to Nostr'}
            </button>
            <button
              type="submit"
              disabled={saving}
              className={cn(
                'inline-flex items-center gap-2 px-6 py-2.5 rounded-lg transition-all duration-200 cursor-pointer active:scale-95',
                saving ? 'opacity-70 cursor-not-allowed' : 'hover:opacity-90',
              )}
              style={{
                background: 'var(--color-primary-50)',
                color: 'white',
              }}
            >
              <Save size={18} />
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>

          {publishStatus !== 'idle' && (
            <div
              className="p-4 mt-6 border rounded-xl"
              style={{
                border: publishStatus === 'error' 
                  ? '1px solid rgba(245,101,101,0.3)' 
                  : '1px solid rgba(72,187,120,0.3)',
                background: publishStatus === 'error'
                  ? 'rgba(245,101,101,0.07)'
                  : 'rgba(72,187,120,0.07)',
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                {publishStatus === 'loading' && (
                  <div
                    className="w-4 h-4 border-2 border-current rounded-full border-t-transparent animate-spin"
                    style={{ color: 'var(--theme-text-muted)' }}
                  />
                )}
                {publishStatus === 'success' && (
                  <Globe size={16} style={{ color: 'var(--color-status-success)' }} />
                )}
                {publishStatus === 'error' && (
                  <Globe size={16} style={{ color: 'var(--color-status-error)' }} />
                )}
                <p
                  className="text-[13px] font-semibold"
                  style={{ 
                    color: publishStatus === 'error' 
                      ? 'var(--color-status-error)' 
                      : 'var(--color-status-success)',
                    fontFamily: 'var(--typography-fontfamily-sans)',
                  }}
                >
                  {publishStatus === 'loading' && 'Publishing to Nostr...'}
                  {publishStatus === 'success' && 'Company published to Nostr'}
                  {publishStatus === 'error' && 'Publish failed'}
                </p>
              </div>
              {publishError && (
                <p
                  className="text-[12px]"
                  style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                >
                  {publishError}
                </p>
              )}
            </div>
          )}

          {formData.images.length > 0 && (
            <div
              className="p-4 mt-6 border rounded-xl"
              style={{
                border: '1px solid rgba(72,187,120,0.3)',
                background: 'rgba(72,187,120,0.07)',
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Globe size={16} style={{ color: 'var(--color-status-success)' }} />
                <p
                  className="text-[13px] font-semibold"
                  style={{ 
                    color: 'var(--color-status-success)',
                    fontFamily: 'var(--typography-fontfamily-sans)',
                  }}
                >
                  {formData.images.length} image{formData.images.length !== 1 ? 's' : ''} uploaded
                </p>
              </div>
              <p
                className="text-[12px]"
                style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                Images are optimized and stored as data-URLs. They will be published to Nostr when you click "Publish to Nostr".
              </p>
            </div>
          )}
        </form>
    </PageContainer>
  )
}
