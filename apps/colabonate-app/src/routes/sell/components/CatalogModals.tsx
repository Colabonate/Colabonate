import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { X, AlertCircle, Package, Bot } from 'lucide-react'
import { Box, Typography, FormControl, InputLabel, MenuItem, Select } from '@mui/material'
import { cn } from '@ds/utils'
import { apiCall } from '../../../lib/api'
import type { Catalog } from '../../../types/api'
import { useStandardCategoryTree } from './useStandardCategoryTree'

export function CreateCatalogModal({
  companyId,
  onClose,
  onCreated,
  defaultType,
}: {
  companyId: string | null
  onClose: () => void
  onCreated: (catalog: Catalog) => void
  /** ADR-368 D3: preset the catalog type and hide the type selector — used by
   *  surface-scoped creation (Sell catalogs = PRODUCT, Cooperate stack = AGENT_SETUP). */
  defaultType?: 'PRODUCT' | 'AGENT_SETUP'
}) {
  const [type, setType] = useState<'PRODUCT' | 'AGENT_SETUP'>(
    defaultType ?? (companyId ? 'PRODUCT' : 'AGENT_SETUP'),
  )
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const t = useStandardCategoryTree()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    // PRODUCT needs a companyId; AGENT_SETUP derives ownerPubkey from session
    // and doesn't need one.
    if (type === 'PRODUCT' && !companyId) {
      setError('A company profile is required to create a product catalog. Set one up under Sell > Company.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const body: Record<string, unknown> = {
        type,
        name: name.trim(),
        description: description.trim() || undefined,
        standardCategoryId: t.selectedCategoryId,
      }
      if (type === 'PRODUCT') body.companyId = companyId
      const res = await apiCall('/api/catalog', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.catalog) {
        onCreated(data.catalog)
      } else {
        setError(data.message || data.error || 'Failed to create catalog')
      }
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--theme-scrim-bg)', backdropFilter: 'blur(var(--theme-scrim-blur))', WebkitBackdropFilter: 'blur(var(--theme-scrim-blur))' }}>
      <div
        className="w-full max-w-lg rounded-2xl max-h-[92vh] overflow-y-auto"
        style={{
          background: 'var(--theme-glass-bg)',
          backdropFilter: 'blur(var(--theme-glass-blur))',
          WebkitBackdropFilter: 'blur(var(--theme-glass-blur))',
          border: '1px solid var(--theme-glass-border)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
        }}
      >
        <div
          className="sticky top-0 z-10 flex items-start justify-between gap-3 px-7 pt-6 pb-5"
          style={{
            backgroundColor: 'transparent',
            backdropFilter: 'blur(var(--theme-glass-blur))',
            WebkitBackdropFilter: 'blur(var(--theme-glass-blur))',
            borderBottom: '1px solid var(--theme-border-subtle)',
          }}
        >
          <div className="min-w-0 flex-1">
            <h3
              className="text-[22px] font-bold tracking-tight leading-tight"
              style={{ color: 'var(--theme-text)' }}
            >
              Create Catalog
            </h3>
            <p
              className="text-[14px] mt-1.5 leading-snug"
              style={{ color: 'var(--theme-text-secondary)' }}
            >
              {type === 'PRODUCT'
                ? 'Group products under a master category for structured browsing.'
                : 'Group your agent setups under a label (a private organizational surface).'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 flex items-center justify-center w-10 h-10 rounded-lg cursor-pointer transition-colors duration-150"
            style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-secondary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--theme-surface-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--theme-bg-subtle)' }}
          >
            <X size={18} strokeWidth={2.25} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-7 py-6">
          {!defaultType && (
          <fieldset className="flex flex-col gap-2.5">
            <legend
              className="text-[14px] font-semibold mb-1"
              style={{ color: 'var(--theme-text)' }}
            >
              Catalog Type <span style={{ color: 'var(--color-status-error)' }} aria-hidden>*</span>
            </legend>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={() => setType('PRODUCT')}
                disabled={!companyId}
                aria-pressed={type === 'PRODUCT'}
                className={cn(
                  'flex-1 flex items-center gap-3 px-4 py-3.5 rounded-xl text-left transition-all duration-150 cursor-pointer',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                  type === 'PRODUCT'
                    ? 'shadow-[0_0_0_2px_rgba(99,179,237,0.45)]'
                    : 'opacity-75 hover:opacity-100',
                )}
                style={{
                  background: type === 'PRODUCT' ? 'rgba(99,179,237,0.10)' : 'var(--theme-bg-subtle)',
                  border: '1px solid ' + (type === 'PRODUCT' ? 'rgba(99,179,237,0.55)' : 'var(--theme-border)'),
                  color: 'var(--theme-text)',
                  // focus-ring offset matches the modal surface
                  ['--tw-ring-offset-color' as string]: 'var(--theme-glass-bg)',
                } as React.CSSProperties}
              >
                <span
                  className="shrink-0 flex items-center justify-center w-9 h-9 rounded-lg"
                  style={{
                    background: type === 'PRODUCT' ? 'rgba(99,179,237,0.18)' : 'var(--theme-surface-secondary)',
                    color: type === 'PRODUCT' ? 'var(--color-primary-50)' : 'var(--theme-text-secondary)',
                  }}
                >
                  <Package size={18} strokeWidth={2.25} />
                </span>
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[15px] font-semibold leading-tight" style={{ color: 'var(--theme-text)' }}>
                    Products
                  </span>
                  <span className="text-[12.5px] leading-tight" style={{ color: 'var(--theme-text-secondary)' }}>
                    {companyId ? 'Goods or services' : 'Needs a company profile'}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setType('AGENT_SETUP')}
                aria-pressed={type === 'AGENT_SETUP'}
                className={cn(
                  'flex-1 flex items-center gap-3 px-4 py-3.5 rounded-xl text-left transition-all duration-150 cursor-pointer',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                  type === 'AGENT_SETUP'
                    ? 'shadow-[0_0_0_2px_rgba(159,122,234,0.45)]'
                    : 'opacity-75 hover:opacity-100',
                )}
                style={{
                  background: type === 'AGENT_SETUP' ? 'rgba(159,122,234,0.10)' : 'var(--theme-bg-subtle)',
                  border: '1px solid ' + (type === 'AGENT_SETUP' ? 'rgba(159,122,234,0.55)' : 'var(--theme-border)'),
                  color: 'var(--theme-text)',
                  ['--tw-ring-offset-color' as string]: 'var(--theme-glass-bg)',
                } as React.CSSProperties}
              >
                <span
                  className="shrink-0 flex items-center justify-center w-9 h-9 rounded-lg"
                  style={{
                    background: type === 'AGENT_SETUP' ? 'rgba(159,122,234,0.18)' : 'var(--theme-surface-secondary)',
                    color: type === 'AGENT_SETUP' ? 'var(--color-secondary-50)' : 'var(--theme-text-secondary)',
                  }}
                >
                  <Bot size={18} strokeWidth={2.25} />
                </span>
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[15px] font-semibold leading-tight" style={{ color: 'var(--theme-text)' }}>
                    Agent Setups
                  </span>
                  <span className="text-[12.5px] leading-tight" style={{ color: 'var(--theme-text-secondary)' }}>
                    Group your AI agents
                  </span>
                </span>
              </button>
            </div>
          </fieldset>
          )}

          <div className="h-px" style={{ background: 'var(--theme-border-subtle)' }} />

          <div className="flex flex-col gap-2">
            <label
              htmlFor="ccm-name"
              className="text-[14px] font-semibold"
              style={{ color: 'var(--theme-text)' }}
            >
              Catalog Name <span style={{ color: 'var(--color-status-error)' }} aria-hidden>*</span>
            </label>
            <input
              id="ccm-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === 'PRODUCT' ? 'e.g. Summer Collection 2026' : 'e.g. Research Crew'}
              autoFocus
              className="w-full px-4 py-3 rounded-xl text-[15px] outline-none transition-all duration-150"
              style={{
                background: 'var(--theme-bg-elevated)',
                color: 'var(--theme-text)',
                border: '1px solid var(--theme-border)',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-primary-50)'
                e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,179,237,0.18)'
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'var(--theme-border)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="ccm-desc"
              className="text-[14px] font-semibold"
              style={{ color: 'var(--theme-text)' }}
            >
              Description <span style={{ color: 'var(--theme-text-muted)', fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea
              id="ccm-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this catalog for? Buyers and agents see this on the catalog header."
              rows={3}
              className="w-full px-4 py-3 rounded-xl text-[15px] outline-none resize-none transition-all duration-150"
              style={{
                background: 'var(--theme-bg-elevated)',
                color: 'var(--theme-text)',
                border: '1px solid var(--theme-border)',
                lineHeight: 1.55,
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-primary-50)'
                e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,179,237,0.18)'
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'var(--theme-border)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            />
          </div>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography
              variant="body1"
              sx={{ fontWeight: 600, fontSize: 14, lineHeight: 1.4, color: 'var(--theme-text)' }}
            >
              Master Category <Typography component="span" sx={{ fontWeight: 400, color: 'var(--theme-text-muted)', fontSize: 13.5 }}>(optional)</Typography>
            </Typography>

            <FormControl fullWidth size="medium">
              <InputLabel id="ccm-cat-l1-label" sx={{ fontSize: 15 }}>Root Category (Level 1)</InputLabel>
              <Select
                labelId="ccm-cat-l1-label"
                value={t.activeL1Slug}
                label="Root Category (Level 1)"
                onChange={(e) => t.handleL1Change(e.target.value)}
                sx={{ fontSize: 15 }}
              >
                <MenuItem value=""><em>None</em></MenuItem>
                {t.l1Options.map(cat => (
                  <MenuItem key={cat.id} value={cat.slug} sx={{ fontSize: 14 }}>{cat.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {t.l2Options.length > 0 && (
              <FormControl fullWidth size="medium">
                <InputLabel id="ccm-cat-l2-label" sx={{ fontSize: 15 }}>Subcategory (Level 2)</InputLabel>
                <Select
                  labelId="ccm-cat-l2-label"
                  value={t.activeL2Slug}
                  label="Subcategory (Level 2)"
                  onChange={(e) => t.handleL2Change(e.target.value)}
                  sx={{ fontSize: 15 }}
                >
                  <MenuItem value=""><em>None</em></MenuItem>
                  {t.l2Options.map(cat => (
                    <MenuItem key={cat.id} value={cat.slug} sx={{ fontSize: 14 }}>
                      {'\u00A0\u00A0'}{cat.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {t.l3Options.length > 0 && (
              <FormControl fullWidth size="medium">
                <InputLabel id="ccm-cat-l3-label" sx={{ fontSize: 15 }}>Detail Category (Level 3)</InputLabel>
                <Select
                  labelId="ccm-cat-l3-label"
                  value={t.activeL2Slug ? t.selectedSlug : ''}
                  label="Detail Category (Level 3)"
                  onChange={(e) => t.handleL3Change(e.target.value)}
                  sx={{ fontSize: 15 }}
                >
                  <MenuItem value=""><em>None</em></MenuItem>
                  {t.l3Options.map(cat => (
                    <MenuItem key={cat.id} value={cat.slug} sx={{ fontSize: 14 }}>
                      {'\u00A0\u00A0\u00A0\u00A0'}{cat.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Box>

          {type === 'PRODUCT' && !companyId && (
            <div
              role="note"
              className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl text-[13.5px] leading-snug"
              style={{
                background: 'var(--theme-bg-subtle)',
                color: 'var(--theme-text-secondary)',
                border: '1px solid var(--theme-border)',
              }}
            >
              <AlertCircle size={16} className="shrink-0 mt-0.5" style={{ color: 'var(--color-status-info)' }} />
              <span>
                Product catalogs require an active company profile — that's the
                public identity buyers see and trust.{' '}
                <Link
                  to="/sell/company"
                  className="font-semibold underline underline-offset-2"
                  style={{ color: 'var(--color-primary-50)' }}
                >
                  Create your company
                </Link>{' '}
                first; the create button unlocks automatically afterwards.
              </span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl text-[13.5px] leading-snug"
              style={{
                background: 'rgba(245,101,101,0.12)',
                color: 'var(--color-status-error)',
                border: '1px solid rgba(245,101,101,0.30)',
              }}
            >
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div
            className="flex flex-col-reverse sm:flex-row gap-2.5 pt-2"
            style={{ borderTop: '1px solid var(--theme-border-subtle)' }}
          >
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-xl text-[14.5px] font-semibold transition-all duration-150 cursor-pointer"
              style={{
                background: 'var(--theme-bg-subtle)',
                color: 'var(--theme-text)',
                border: '1px solid var(--theme-border)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--theme-surface-secondary)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--theme-bg-subtle)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || saving || (type === 'PRODUCT' && !companyId)}
              className="flex-1 py-3 rounded-xl text-[14.5px] font-semibold transition-all duration-150 cursor-pointer disabled:cursor-not-allowed"
              style={{
                background: (name.trim() && !(type === 'PRODUCT' && !companyId))
                  ? 'var(--color-primary-50)'
                  : 'var(--theme-surface-secondary)',
                color: (name.trim() && !(type === 'PRODUCT' && !companyId))
                  ? 'white'
                  : 'var(--theme-text-muted)',
                opacity: (name.trim() && !(type === 'PRODUCT' && !companyId)) ? 1 : 0.6,
                border: '1px solid ' + ((name.trim() && !(type === 'PRODUCT' && !companyId))
                  ? 'var(--color-primary-50)'
                  : 'transparent'),
                boxShadow: (name.trim() && !(type === 'PRODUCT' && !companyId))
                  ? '0 4px 12px rgba(99,179,237,0.25)'
                  : 'none',
              }}
            >
              {saving ? 'Creating…' : 'Create Catalog'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}

/** The subset of Catalog the edit modal touches — widened so AGENT_SETUP
 *  catalogs (AgentCatalog shape) can be edited from Cooperate Manage (ADR-368
 *  D3) without pretending they carry PRODUCT-only fields. */
type EditableCatalog = Pick<Catalog, 'id' | 'name'> & {
  description?: string | null
  standardCategory?: { slug?: string } | null
}

export function EditCatalogModal({
  catalog,
  onClose,
  onSaved,
}: {
  catalog: EditableCatalog
  onClose: () => void
  onSaved: (catalog: Catalog) => void
}) {
  const existingSlug = (catalog as any).standardCategory?.slug || ''
  const [name, setName] = useState(catalog.name)
  const [description, setDescription] = useState(catalog.description || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const t = useStandardCategoryTree(existingSlug)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await apiCall(`/api/catalog/${catalog.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          standardCategoryId: t.selectedCategoryId,
        }),
      })
      const data = await res.json()
      if (data.catalog) {
        onSaved(data.catalog)
      } else {
        setError(data.error || 'Failed to update catalog')
      }
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--theme-scrim-bg)', backdropFilter: 'blur(var(--theme-scrim-blur))', WebkitBackdropFilter: 'blur(var(--theme-scrim-blur))' }}>
      <div className="w-full max-w-md p-5 rounded-xl" style={{ background: 'var(--theme-glass-bg)', backdropFilter: 'blur(var(--theme-glass-blur))', WebkitBackdropFilter: 'blur(var(--theme-glass-blur))', border: '1px solid var(--theme-glass-border)', boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[17px] font-semibold" style={{ color: 'var(--theme-text)' }}>Edit Catalog</h3>
          <button onClick={onClose} className="flex items-center justify-center w-8 h-8 transition-all duration-200 rounded-lg cursor-pointer hover:opacity-80" style={{ background: 'var(--theme-surface-secondary)' }}>
            <X size={16} style={{ color: 'var(--theme-text-muted)' }} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--theme-text-muted)' }}>Catalog Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="w-full px-3 py-2.5 rounded-lg text-[13px] outline-none transition-all duration-200"
              style={{ background: 'var(--theme-surface-secondary)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--theme-text-muted)' }}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2.5 rounded-lg text-[13px] outline-none resize-none transition-all duration-200"
              style={{ background: 'var(--theme-surface-secondary)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
            />
          </div>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2" fontWeight={600} color="text.secondary">
              Master Category
            </Typography>

            <FormControl fullWidth size="small">
              <InputLabel id="ecm-cat-l1-label">Root Category (Level 1)</InputLabel>
              <Select
                labelId="ecm-cat-l1-label"
                value={t.activeL1Slug}
                label="Root Category (Level 1)"
                onChange={(e) => t.handleL1Change(e.target.value)}
              >
                <MenuItem value=""><em>None</em></MenuItem>
                {t.l1Options.map(cat => (
                  <MenuItem key={cat.id} value={cat.slug}>{cat.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {t.l2Options.length > 0 && (
              <FormControl fullWidth size="small">
                <InputLabel id="ecm-cat-l2-label">Subcategory (Level 2)</InputLabel>
                <Select
                  labelId="ecm-cat-l2-label"
                  value={t.activeL2Slug}
                  label="Subcategory (Level 2)"
                  onChange={(e) => t.handleL2Change(e.target.value)}
                >
                  <MenuItem value=""><em>None</em></MenuItem>
                  {t.l2Options.map(cat => (
                    <MenuItem key={cat.id} value={cat.slug}>
                      {'\u00A0\u00A0'}{cat.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {t.l3Options.length > 0 && (
              <FormControl fullWidth size="small">
                <InputLabel id="ecm-cat-l3-label">Detail Category (Level 3)</InputLabel>
                <Select
                  labelId="ecm-cat-l3-label"
                  value={t.activeL2Slug ? t.selectedSlug : ''}
                  label="Detail Category (Level 3)"
                  onChange={(e) => t.handleL3Change(e.target.value)}
                >
                  <MenuItem value=""><em>None</em></MenuItem>
                  {t.l3Options.map(cat => (
                    <MenuItem key={cat.id} value={cat.slug}>
                      {'\u00A0\u00A0\u00A0\u00A0'}{cat.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Box>

          {error && (
            <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--color-status-error)' }}>
              <AlertCircle size={14} />
              {error}
            </div>
          )}
          <div className="flex gap-2 mt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 cursor-pointer hover:opacity-90" style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)' }}>
              Cancel
            </button>
            <button type="submit" disabled={!name.trim() || saving} className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 cursor-pointer hover:opacity-90" style={{ background: name.trim() ? 'var(--color-primary-50)' : 'var(--theme-surface-secondary)', color: name.trim() ? 'white' : 'var(--theme-text-muted)', opacity: name.trim() ? 1 : 0.5 }}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
