import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapPin, Save, ArrowLeft, Target, Tag } from 'lucide-react'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { cn } from '@ds/utils'
import { apiCall } from '../../lib/api'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { parseJsonField } from '../coop/coop-cards'
import { CategoryMultiSelect, type StandardCategoryOption } from '../../components/category/CategoryMultiSelect'

interface SelectedCategory {
  id: string
  name: string
  slug: string
  unspscCode: string | null
}

export function SellCompanyFields() {
  const navigate = useNavigate()
  const [pubkey] = useState(() => localStorage.getItem('pubkey') ?? '')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pageRef = usePageAnimation([
    { selector: '.fields-animate', from: { duration: 0.5, stagger: 0.12, y: 24 } },
  ])

  const [coopRadius, setCoopRadius] = useState(50)
  const [selectedCategories, setSelectedCategories] = useState<SelectedCategory[]>([])
  const [allCategories, setAllCategories] = useState<StandardCategoryOption[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)

  const loadCompany = useCallback(async (silent = false) => {
    if (!pubkey) {
      setLoading(false)
      return
    }
    if (!silent) setLoading(true)
    try {
      const res = await apiCall(`/api/company/${pubkey}`).then(r => r.json())
      if (res.company) {
        setCoopRadius(res.company.coopRadius || 50)
        const parsed = parseJsonField<Record<string, unknown>[]>(res.company.businessFields, [])
        setSelectedCategories(
          (parsed ?? [])
            .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null && 'id' in f)
            .map(f => ({
              id: f.id as string,
              name: f.name as string,
              slug: f.slug as string,
              unspscCode: (f.unspscCode as string) ?? null,
            })),
        )
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

  useEffect(() => {
    async function fetchCategories() {
      setCategoriesLoading(true)
      try {
        const res = await apiCall('/api/standard-categories/tree/flat').then(r => r.json())
        setAllCategories(res.standardCategories ?? [])
      } catch (err) {
        console.error('Failed to fetch standard categories:', err)
      } finally {
        setCategoriesLoading(false)
      }
    }
    fetchCategories()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pubkey) return

    setSaving(true)
    setError('')

    try {
      const businessFieldsPayload = selectedCategories.map(c => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        unspscCode: c.unspscCode,
      }))

      await apiCall(`/api/company/${pubkey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessFields: businessFieldsPayload,
          coopRadius: Number(coopRadius),
        }),
      })
      navigate('/sell/company')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error saving')
    } finally {
      setSaving(false)
    }
  }

  if (loading || categoriesLoading) {
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
    <PageContainer size="wide" spacing="lg" className="fields-animate !px-4 md:!px-6 !py-6" ref={pageRef}>
        <button
          onClick={() => navigate('/sell/company')}
          className="inline-flex items-center gap-2 mb-6 bg-transparent border-none text-[13px] cursor-pointer p-0 hover:text-(--color-primary-50) transition-colors duration-200"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          <ArrowLeft size={16} />
          Back to Overview
        </button>

        <PageHeader
          icon={<MapPin size={18} />}
          title="Business Fields & Cooperation"
          subtitle="Define your industries and cooperation radius"
          onBack={() => navigate('/sell/company')}
        />

        {error && (
          <div
            className="mb-6 p-4 rounded-xl border"
            style={{
              border: '1px solid rgba(245,101,101,0.3)',
              background: 'rgba(245,101,101,0.07)',
            }}
          >
            <p
              className="text-[13px]"
              style={{ color: 'var(--color-status-error)', fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              {error}
            </p>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border bg-(--theme-surface-secondary)"
          style={{ border: '1px solid var(--theme-border)' }}
        >
          <div className="p-6">
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <Tag size={16} style={{ color: 'var(--theme-text-muted)' }} />
                <label
                  className="text-[13px] font-semibold"
                  style={{ color: 'var(--theme-text)' }}
                >
                  Business Categories
                </label>
              </div>
              <p
                className="mb-3 text-[13px] leading-relaxed"
                style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                Select the standard categories that match your business activities. These are used for partner matching and marketplace visibility.
              </p>
              <CategoryMultiSelect
                value={selectedCategories.map(c => c.slug)}
                allCategories={allCategories}
                loading={categoriesLoading}
                onChange={(slugs) => {
                  setSelectedCategories(
                    slugs
                      .map(slug => allCategories.find(c => c.slug === slug))
                      .filter((c): c is StandardCategoryOption => c !== undefined)
                      .map(c => ({ id: c.id, name: c.name, slug: c.slug, unspscCode: c.unspscCode })),
                  )
                }}
              />
              {selectedCategories.length > 0 && (
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--theme-text-muted)' }}>
                    {selectedCategories.length} categor{selectedCategories.length !== 1 ? 'ies' : 'y'} selected
                  </span>
                </div>
              )}
            </div>

            <div className="pt-6 border-t" style={{ borderColor: 'var(--theme-border)' }}>
              <div className="flex items-center gap-2 mb-4">
                <Target size={18} style={{ color: 'var(--theme-text-muted)' }} />
                <label
                  className="text-[13px] font-semibold"
                  style={{ color: 'var(--theme-text)' }}
                >
                  Cooperation Radius (in km)
                </label>
              </div>
              <p
                className="mb-4 text-[13px] leading-relaxed"
                style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                How far would you travel at most for cooperation or orders?
              </p>

              <div className="mb-5">
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="1000"
                    step="10"
                    value={coopRadius}
                    onChange={e => setCoopRadius(Number(e.target.value))}
                    className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
                    style={{
                      background: 'linear-gradient(to right, var(--color-primary-50) 0%, var(--theme-border) 0%)',
                      backgroundSize: `${(coopRadius / 1000) * 100}% 100%`,
                      WebkitAppearance: 'none',
                    }}
                  />
                  <div
                    className="w-20 text-center px-3 py-2.5 rounded-lg font-semibold tabular-nums"
                    style={{
                      background: 'var(--theme-surface-primary)',
                      border: '1px solid var(--theme-border)',
                      color: 'var(--theme-text)',
                      fontFamily: 'var(--typography-fontfamily-barlow, Barlow, sans-serif)',
                    }}
                  >
                    {coopRadius >= 1000 ? '1000+' : coopRadius} km
                  </div>
                </div>

                <div className="flex justify-between mt-3 text-[11px]">
                  <span
                    className="font-semibold"
                    style={{ color: 'var(--theme-text-muted)' }}
                  >
                    Local (0)
                  </span>
                  <span
                    className="font-semibold"
                    style={{ color: 'var(--theme-text-muted)' }}
                  >
                    Nationwide (1000)
                  </span>
                </div>
              </div>

              <div className="relative h-1.5 rounded-full overflow-hidden mb-6">
                <div
                  className="absolute inset-y-0 left-0"
                  style={{
                    width: `${(coopRadius / 1000) * 100}%`,
                    background: 'var(--color-primary-50)',
                  }}
                />
                <div
                  className="absolute inset-y-0 left-0 right-0"
                  style={{ background: 'var(--theme-border)' }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full shadow-lg"
                  style={{
                    left: `${(coopRadius / 1000) * 100}%`,
                    transform: 'translate(-50%, -50%)',
                    background: 'var(--color-primary-50)',
                  }}
                />
              </div>
            </div>
          </div>

          <div
            className="px-6 py-4 border-t flex justify-end"
            style={{ borderColor: 'var(--theme-border)' }}
          >
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
                fontFamily: 'var(--typography-fontfamily-sans)',
              }}
            >
              <Save size={18} />
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
    </PageContainer>
  )
}
