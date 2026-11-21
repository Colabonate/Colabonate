// Shared MUI sections for all cooperation "Create" forms (ADR-033)
// Exports: StepIntro, CoopTypeSection, CoopCategorySection
// Used by CoopCreateOfferForm, CoopCreateProjectForm, CoopCreateNetworkForm

import { useCallback, useMemo } from 'react'
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  Skeleton,
  TextField,
  Typography,
} from '@mui/material'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import CategoryOutlinedIcon from '@mui/icons-material/CategoryOutlined'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import CloudOutlinedIcon from '@mui/icons-material/CloudOutlined'
import HandshakeOutlinedIcon from '@mui/icons-material/HandshakeOutlined'
import { CARD_THEME } from '@ds/ui'
import { useTheme } from '@ds/utils'
import { COOPERATION_TYPES, type CooperationType } from './coopGuideConstants'
import type { StandardCategory } from '../../../types/api'

// ─── StepIntro ────────────────────────────────────────────────────────────────

export function StepIntro({
  icon,
  title,
  what,
  why,
  how,
}: {
  icon: React.ReactNode
  title: string
  what: string
  why: string
  how: string
}) {
  return (
    <Alert
      icon={icon ?? <InfoOutlinedIcon fontSize="small" />}
      severity="info"
      sx={{ mb: 3, borderRadius: 2, '& .MuiAlert-message': { width: '100%' } }}
    >
      <Typography variant="subtitle2" fontWeight={700} gutterBottom>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: 0.5 }}>
        {([
          { label: 'What', text: what, color: 'default' as const },
          { label: 'Why', text: why, color: 'primary' as const },
          { label: 'How', text: how, color: 'success' as const },
        ]).map(row => (
          <Box key={row.label} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <Chip
              label={row.label}
              size="small"
              color={row.color}
              variant="outlined"
              sx={{ minWidth: 44, fontSize: '0.65rem', height: 20, mt: 0.15 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.55 }}>
              {row.text}
            </Typography>
          </Box>
        ))}
      </Box>
    </Alert>
  )
}

// ─── CoopTypeSection ──────────────────────────────────────────────────────────

export function CoopTypeSection({
  value,
  onChange,
}: {
  value: CooperationType
  onChange: (type: CooperationType) => void
}) {
  const selected = COOPERATION_TYPES.find(ct => ct.id === value)

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 2 }}>
      <Typography variant="subtitle2" fontWeight={700} gutterBottom>
        Cooperation Type
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        Choose the model that best describes your collaboration intent.
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)' },
          gap: 1,
        }}
      >
        {COOPERATION_TYPES.map(ct => {
          const Icon = ct.icon
          const isSelected = value === ct.id
          return (
            <Box
              component="button"
              key={ct.id}
              type="button"
              onClick={() => onChange(ct.id)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                py: 1.25,
                borderRadius: 1.5,
                border: isSelected ? `2px solid ${ct.color}` : '1px solid',
                borderColor: isSelected ? ct.color : 'divider',
                bgcolor: isSelected ? ct.bg : 'transparent',
                cursor: 'pointer',
                transition: 'all 150ms',
                textAlign: 'left',
                '&:hover': { borderColor: ct.color, opacity: 0.9 },
              }}
            >
              <Icon size={15} style={{ color: ct.color, flexShrink: 0 }} />
              <Typography
                variant="caption"
                fontWeight={isSelected ? 700 : 500}
                sx={{ color: isSelected ? ct.color : 'text.primary', lineHeight: 1.3 }}
              >
                {ct.label}
              </Typography>
            </Box>
          )
        })}
      </Box>

      {selected && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          {selected.description}
        </Typography>
      )}
    </Paper>
  )
}

// ─── CoopCategorySection ──────────────────────────────────────────────────────
// 3-level StandardCategory picker matching CreateOfferPage card UI (ADR-083)
// L1: large visual cards (icon + name + description) identical to CreateOfferPage
// L2/L3: dropdown selects

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  goods:    <Inventory2OutlinedIcon sx={{ fontSize: 28 }} />,
  digital:  <CloudOutlinedIcon sx={{ fontSize: 28 }} />,
  services: <HandshakeOutlinedIcon sx={{ fontSize: 28 }} />,
}

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  goods:    'Physical products like electronics, clothing, food, or handmade items.',
  digital:  'Downloadable or accessible content like software, templates, or digital media.',
  services: 'Work performed between partners: consulting, development, design, or cooperation.',
}

const SELECTED_ACCENT = 'var(--color-action-secondary-default)'
const SELECTED_BG     = 'rgba(33, 225, 104, 0.12)'

export function CoopCategorySection({
  categories,
  categoriesLoading = false,
  categorySlug,
  subcategorySlug,
  onCategoryChange,
  onSubcategoryChange,
  error,
}: {
  categories: StandardCategory[]
  categoriesLoading?: boolean
  categorySlug: string
  subcategorySlug: string
  onCategoryChange: (slug: string) => void
  onSubcategoryChange: (slug: string) => void
  error?: string
}) {
  const { theme } = useTheme()
  const categoryTree = useMemo(() => {
    const bySlug = new Map<string, StandardCategory[]>()
    for (const cat of categories) {
      if (cat.parentId) {
        const parentSlug = cat.slug.substring(0, cat.slug.lastIndexOf('/'))
        if (parentSlug) {
          if (!bySlug.has(parentSlug)) bySlug.set(parentSlug, [])
          bySlug.get(parentSlug)!.push(cat)
        }
      } else {
        if (!bySlug.has('_root')) bySlug.set('_root', [])
        bySlug.get('_root')!.push(cat)
      }
    }
    for (const [, cats] of bySlug) cats.sort((a, b) => a.name.localeCompare(b.name))
    return bySlug
  }, [categories])

  const getChildren = useCallback((slug: string): StandardCategory[] => {
    return categoryTree.get(slug) ?? []
  }, [categoryTree])

  // Resolve active L2 slug from subcategorySlug
  const { activeL2Slug, subcategoryLevel } = useMemo(() => {
    if (!subcategorySlug) return { activeL2Slug: '', subcategoryLevel: 0 }
    const l2Options = getChildren(categorySlug)
    if (l2Options.some(c => c.slug === subcategorySlug)) {
      return { activeL2Slug: subcategorySlug, subcategoryLevel: 2 }
    }
    for (const l2 of l2Options) {
      if (getChildren(l2.slug).some(c => c.slug === subcategorySlug)) {
        return { activeL2Slug: l2.slug, subcategoryLevel: 3 }
      }
    }
    return { activeL2Slug: '', subcategoryLevel: 0 }
  }, [categorySlug, subcategorySlug, categories.length, getChildren])

  const selectedCategoryCode = subcategorySlug || categorySlug || undefined

  const rootCats = getChildren('_root')

  if (categoriesLoading) {
    return (
      <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 }, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
          <Box
            sx={{
              width: 40, height: 40,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-accent-4)',
            }}
          >
            <CategoryOutlinedIcon sx={{ fontSize: 20 }} />
          </Box>
          <Typography variant="subtitle1" fontWeight={700}>Category Classification</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1 }}>
          <CircularProgress size={20} />
          <Skeleton variant="text" width="60%" />
          <Skeleton variant="text" width="30%" />
        </Box>
      </Paper>
    )
  }

  if (categories.length === 0) {
    if (import.meta.env.DEV) {
      console.warn('[CoopCategorySection] Standard category list is empty. Ops: POST /api/standard-categories/seed')
    }
    return (
      <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 }, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
          <Box
            sx={{
              width: 40, height: 40,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-accent-4)',
            }}
          >
            <CategoryOutlinedIcon sx={{ fontSize: 20 }} />
          </Box>
          <Typography variant="subtitle1" fontWeight={700}>Category Classification</Typography>
        </Box>
        <Alert severity="warning" sx={{ borderRadius: 2 }}>
          <Typography variant="body2">
            Categories are temporarily unavailable. Please try again in a moment.
          </Typography>
        </Alert>
      </Paper>
    )
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 6, sm: 8 }, borderRadius: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, mb: 3 }}>
        <Box
          sx={{
            width: 40, height: 40,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--color-accent-4)',
          }}
        >
          <CategoryOutlinedIcon sx={{ fontSize: 20 }} />
        </Box>
        <Typography variant="subtitle1" fontWeight={700}>
          Category Classification
        </Typography>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 'var(--spacing-16)', lineHeight: 1.6 }}>
        Assign this cooperation to the standard taxonomy so partners can find it via filters.
      </Typography>

      {/* Level 1: Root category cards */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: `repeat(${Math.min(rootCats.length, 3)}, 1fr)` },
          gap: { xs: 2.5, sm: 3 },
          mb: 2.5,
        }}
      >
        {rootCats.map(cat => {
          const catKey = cat.slug.split('/')[0]
          const selected = categorySlug === cat.slug
          return (
            <Box
              key={cat.slug}
              role="button"
              tabIndex={0}
              onClick={() => { onCategoryChange(cat.slug); onSubcategoryChange('') }}
              onKeyDown={e => { if (e.key === 'Enter') { onCategoryChange(cat.slug); onSubcategoryChange('') } }}
              sx={{
                position: 'relative',
                overflow: 'hidden',
                p: 6,
                borderRadius: 'var(--radius-md, 8px)',
                border: '2px solid',
                borderColor: selected ? SELECTED_ACCENT : 'var(--theme-border)',
                // Same background treatment as the guide's OptionCard and the
                // marketplace list-entry cards (@ds/ui CARD_THEME) — the
                // neutral theme-aware gradient stays underneath regardless of
                // selection; the sheen + selected-tint overlays layer on top.
                background: CARD_THEME.bg(theme),
                cursor: 'pointer',
                outline: 'none',
                transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                '&:hover': {
                  transform: 'translateY(-2px)',
                  boxShadow: 'var(--theme-shadow)',
                },
                '&:focus-visible': {
                  boxShadow: `0 0 0 3px ${SELECTED_ACCENT}40`,
                },
              }}
            >
              {/* Static sheen overlay — matches OptionCard / marketplace list-entry cards */}
              <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: CARD_THEME.overlay(theme) }} />
              {selected && (
                <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', bgcolor: SELECTED_BG }} />
              )}
              {selected && (
                <Box
                  sx={{
                    position: 'absolute', top: 10, right: 10,
                    width: 22, height: 22, borderRadius: '50%',
                    bgcolor: SELECTED_ACCENT,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <svg width="12" height="9" viewBox="0 0 12 9" fill="none">
                    <path d="M1 4.5L4.5 8L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </Box>
              )}
              <Box sx={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 1.5 }}>
                <Box
                  sx={{
                    width: 56, height: 56, borderRadius: '14px',
                    bgcolor: selected ? SELECTED_BG : 'var(--theme-bg-subtle)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: selected ? SELECTED_ACCENT : 'var(--theme-text-muted)',
                    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                >
                  {CATEGORY_ICONS[catKey] ?? <CategoryOutlinedIcon sx={{ fontSize: 28 }} />}
                </Box>
                <Typography
                  variant="body2"
                  fontWeight={700}
                  sx={{ color: selected ? 'var(--theme-text)' : 'var(--theme-text-secondary)', fontSize: '0.9375rem' }}
                >
                  {cat.name}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.5, fontSize: '0.75rem', maxWidth: 180 }}
                >
                  {CATEGORY_DESCRIPTIONS[catKey] ?? `Items in the ${cat.name} category`}
                </Typography>
              </Box>
            </Box>
          )
        })}
      </Box>

      {error && (
        <Typography variant="caption" color="error" sx={{ display: 'block', mb: 2 }}>
          {error}
        </Typography>
      )}

      {/* Level 2: Subcategory dropdown */}
      {getChildren(categorySlug).length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1.5, color: 'var(--theme-text-secondary)' }}>
            Subcategory
          </Typography>
          <TextField
            select
            label="Select subcategory"
            value={activeL2Slug}
            onChange={e => onSubcategoryChange(e.target.value)}
            fullWidth
            helperText="Refine the category with a more specific subcategory"
          >
            <MenuItem value="">None</MenuItem>
            {getChildren(categorySlug).map(cat => (
              <MenuItem key={cat.id} value={cat.slug}>
                {'\u00A0\u00A0'}{cat.name}
                {getChildren(cat.slug).length > 0 && ` (${getChildren(cat.slug).length} sub)`}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      )}

      {/* Level 3: Detail category dropdown */}
      {activeL2Slug && getChildren(activeL2Slug).length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1.5, color: 'var(--theme-text-secondary)' }}>
            Detail Category
          </Typography>
          <TextField
            select
            label="Select detail category"
            value={subcategoryLevel === 3 ? subcategorySlug : ''}
            onChange={e => onSubcategoryChange(e.target.value)}
            fullWidth
            helperText="Most specific classification available"
          >
            <MenuItem value="">None</MenuItem>
            {getChildren(activeL2Slug).map(cat => (
              <MenuItem key={cat.id} value={cat.slug}>
                {'\u00A0\u00A0\u00A0\u00A0'}{cat.name}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      )}

      {/* Category code preview */}
      {selectedCategoryCode && (
        <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)' }}>
          Category code: <code style={{ color: SELECTED_ACCENT }}>{selectedCategoryCode}</code>
        </Typography>
      )}
    </Paper>
  )
}
