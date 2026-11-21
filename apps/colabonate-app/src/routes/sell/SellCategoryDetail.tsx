import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Save, ArrowLeft, Tag } from 'lucide-react'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { UnspscPicker } from '../../components/categories/UnspscPicker'
import type { UnspscPickerValue } from '../../components/categories/UnspscPicker'
import { apiCall } from '../../lib/api'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { useCatalogCategory } from '../../hooks/useEntityQueries'
import { queryClient } from '../../lib/queryClient'

export function SellCategoryDetail() {
  const { catalogId, categoryId } = useParams<{ catalogId: string; categoryId: string }>()
  const navigate = useNavigate()
  const pageRef = usePageAnimation([
    { selector: '.detail-animate', from: { duration: 0.5, stagger: 0.1, y: 20 } },
  ])

  const isNew = !categoryId || categoryId === 'new'
  // ADR-340 FU-541: useCatalogCategory is a no-op (the legacy
  // /api/catalog/categories/:id endpoint was removed in ADR-078). The form
  // stays in its initial empty state on this dead route.
  const { data: category, isLoading } = useCatalogCategory(isNew ? '' : (categoryId || ''))

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [unspscValue, setUnspscValue] = useState<UnspscPickerValue | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (category && typeof category === 'object' && 'name' in category) {
      const c = category as { name: string; description?: string; unspscCode?: string; unspscLabel?: string }
      setName(c.name)
      setDescription(c.description || '')
      if (c.unspscCode) {
        setUnspscValue({ unspscCode: c.unspscCode, unspscLabel: c.unspscLabel || '' })
      }
    }
  }, [category])

  async function handleSave() {
    if (!name.trim()) {
      setError('Category name is required')
      return
    }
    if (!catalogId) return
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
        catalogId,
        sortOrder: 0,
      }
      if (unspscValue) {
        body.unspscCode = unspscValue.unspscCode
        body.unspscLabel = unspscValue.unspscLabel
      }

      let res: Response
      if (isNew) {
        res = await apiCall('/api/catalog/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        res = await apiCall(`/api/catalog/categories/${categoryId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save category')
      }

      queryClient.invalidateQueries({ queryKey: ['catalogCategory', categoryId] })
      queryClient.invalidateQueries({ queryKey: ['catalog'] })

      navigate(`/sell/catalog/${catalogId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <PageContainer size="wide" spacing="lg">
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: 'var(--color-primary-50) var(--color-primary-50) var(--color-primary-50) transparent' }} />
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer size="wide" spacing="lg" ref={pageRef}>
      <PageHeader
        icon={<Tag size={18} />}
        title={isNew ? 'New Category' : name}
        subtitle={isNew ? 'Create a new category for your catalog' : 'Edit category details and UNSPSC mapping'}
        onBack={() => navigate(`/sell/catalog/${catalogId}`)}
      />

      <div className="max-w-2xl detail-animate">
        <div
          className="p-6 rounded-xl border"
          style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
        >
          <div className="flex flex-col gap-5">
            <div>
              <label className="block text-[12px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--theme-text-muted)' }}>
                Category Name
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Smartphones"
                className="w-full px-4 py-2.5 rounded-lg text-[14px] outline-none transition-all duration-200 focus:ring-2 focus:ring-[rgba(99,179,237,0.25)] focus:border-[rgba(99,179,237,0.5)]"
                style={{ background: 'var(--theme-bg-elevated)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
              />
            </div>

            <div>
              <label className="block text-[12px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--theme-text-muted)' }}>
                Description
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Optional description for this category..."
                rows={3}
                className="w-full px-4 py-2.5 rounded-lg text-[14px] outline-none transition-all duration-200 resize-none focus:ring-2 focus:ring-[rgba(99,179,237,0.25)] focus:border-[rgba(99,179,237,0.5)]"
                style={{ background: 'var(--theme-bg-elevated)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
              />
            </div>

            <div className="h-px" style={{ background: 'var(--theme-border)' }} />

            <div>
              <label className="block text-[12px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--theme-text-muted)' }}>
                UNSPSC Mapping
              </label>
              <p className="text-[13px] mb-3" style={{ color: 'var(--theme-text-muted)' }}>
                Optionally map this category to a UNSPSC code for marketplace discoverability.
              </p>
              <UnspscPicker
                value={unspscValue}
                onChange={setUnspscValue}
                label="UNSPSC Code"
                placeholder="Search UNSPSC categories..."
              />
            </div>

            {error && (
              <div className="px-4 py-3 rounded-lg text-[13px]" style={{ background: 'rgba(245,101,101,0.1)', color: 'var(--color-status-error)' }}>
                {error}
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 cursor-pointer hover:opacity-90 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'var(--color-primary-50)', color: 'white' }}
              >
                <Save size={16} />
                {saving ? 'Saving...' : isNew ? 'Create Category' : 'Save Changes'}
              </button>
              <button
                onClick={() => navigate(`/sell/catalog/${catalogId}`)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 cursor-pointer hover:opacity-90"
                style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)' }}
              >
                <ArrowLeft size={16} />
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
