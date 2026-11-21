import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Box, Card, CardActionArea, Typography, Skeleton,
  Paper, Stack, Avatar, Chip,
} from '@mui/material'
import {
  GridView as GridViewIcon, ChevronRight as ChevronRightIcon,
  Category as CategoryIcon, Layers as LayersIcon,
} from '@mui/icons-material'
import { PageContainer } from '@ds/ui'
import { KPIStrip } from '../../components/kpi/KpiStrip'
import type { KPIItem } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { apiCall } from '../../lib/api'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import type { StandardCategory } from '../../types/api'

// ── Category Card ─────────────────────────────────────────────────────

function CategoryCard({ category }: { category: StandardCategory }) {
  const childCount = category.children?.length ?? 0

  return (
    <Card variant="outlined" elevation={0}>
      <CardActionArea
        component={Link}
        to={`/buy/categories/${category.slug}/products`}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2,
          py: 1.75,
          borderRadius: 3,
          textDecoration: 'none',
        }}
      >
        <Avatar sx={{ bgcolor: 'rgba(99,179,237,0.12)', width: 40, height: 40, flexShrink: 0 }}>
          <GridViewIcon sx={{ fontSize: 18, color: '#63B3ED' }} />
        </Avatar>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600} noWrap sx={{ lineHeight: 'tight' }}>
            {category.name}
          </Typography>
          {category.unspscCode && (
            <Typography variant="caption" color="text.secondary" noWrap component="span" sx={{ display: 'block', mt: 0.25 }}>
              UNSPSC {category.unspscCode}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" component="span" sx={{ mt: 0.5, display: 'block' }}>
            {childCount} sub-categor{childCount !== 1 ? 'ies' : 'y'}
          </Typography>
        </Box>

        <ChevronRightIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
      </CardActionArea>
    </Card>
  )
}

// ── Root Category Section ─────────────────────────────────────────────

function RootSection({ root }: { root: StandardCategory }) {
  const children = root.children ?? []

  if (children.length === 0) return null

  return (
    <Box sx={{ mb: 4 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <LayersIcon sx={{ fontSize: 16, color: 'primary.main' }} />
        <Typography variant="subtitle2" fontWeight={600}>
          {root.name}
        </Typography>
        <Chip
          label={`${children.length} ${children.length === 1 ? 'category' : 'categories'}`}
          size="small"
          variant="outlined"
          sx={{ height: 20, fontSize: '11px' }}
        />
      </Stack>
      <Stack spacing={1}>
        {children.map(cat => (
          <CategoryCard key={cat.id} category={cat} />
        ))}
      </Stack>
    </Box>
  )
}

// ── BuyCategories Component ───────────────────────────────────────────

export function BuyCategories() {
  const [categories, setCategories] = useState<StandardCategory[]>([])
  const [loading, setLoading] = useState(true)
  const pageRef = usePageAnimation([
    { selector: '.page-animate', from: { duration: 0.5, stagger: 0.1, y: 20 } },
  ])

  const fetchCategories = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiCall('/api/standard-categories').then(r => r.json())
      setCategories(Array.isArray(data) ? data : data.categories ?? [])
    } catch (error) {
      console.error('Failed to fetch categories:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchCategories() }, [fetchCategories])

  const rootCategories = useMemo(
    () => categories.filter(c => c.level === 1),
    [categories],
  )

  const totalL2 = useMemo(
    () => rootCategories.reduce((sum, r) => sum + (r.children?.length ?? 0), 0),
    [rootCategories],
  )

  const totalL3 = useMemo(
    () => rootCategories.reduce(
      (sum, r) => sum + (r.children ?? []).reduce(
        (s, l2) => s + (l2.children?.length ?? 0), 0,
      ), 0,
    ),
    [rootCategories],
  )

  const kpiItems = useMemo<KPIItem[]>(() => [
    { icon: <LayersIcon sx={{ fontSize: 14 }} />, value: rootCategories.length, label: 'Root Categories' },
    { icon: <GridViewIcon sx={{ fontSize: 14 }} />, value: totalL2, label: 'Subcategories' },
    { icon: <CategoryIcon sx={{ fontSize: 14 }} />, value: totalL3, label: 'Leaf Categories' },
  ], [rootCategories.length, totalL2, totalL3])

  return (
    <PageContainer size="wide" spacing="lg" className="page-animate" ref={pageRef}>
      {/* Header + KPI Strip */}
      <PageHeader
        icon={<GridViewIcon />}
        title="Categories"
        subtitle="Browse the universal category catalog"
        onBack={() => window.history.back()}
        actions={<KPIStrip items={kpiItems} loading={loading} skeletonCount={3} embedded />}
      />

      {loading ? (
        <Stack spacing={3} sx={{ mt: 3 }}>
          {[0, 1, 2].map(i => (
            <Stack key={i} spacing={1}>
              <Skeleton variant="text" width={128} height={20} />
              {[0, 1].map(j => (
                <Skeleton key={j} variant="rounded" height={64} />
              ))}
            </Stack>
          ))}
        </Stack>
      ) : rootCategories.length === 0 ? (
        <Paper variant="outlined" sx={{ py: 8, textAlign: 'center' }}>
          <Avatar sx={{ mx: 'auto', mb: 2, bgcolor: 'action.hover', width: 56, height: 56 }}>
            <GridViewIcon sx={{ fontSize: 28, color: 'text.secondary' }} />
          </Avatar>
          <Typography variant="subtitle1" fontWeight={600}>
            No categories available
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 320, mx: 'auto' }}>
            Categories will be available once the catalog is seeded.
          </Typography>
        </Paper>
      ) : (
        <Box sx={{ mt: 3 }}>
          {rootCategories.map(root => (
            <RootSection key={root.id} root={root} />
          ))}
        </Box>
      )}
    </PageContainer>
  )
}
