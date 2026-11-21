import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from '../../contexts/LocaleContext'
import {
  Box, Card, CardActionArea, Typography, Skeleton, Grid,
  Paper, Stack, Avatar, Menu, MenuItem, ListItemText, Button,
} from '@mui/material'
import {
  Inventory2 as Inventory2Icon, ArrowRight as ArrowRightIcon,
  Bolt as BoltIcon, Tune as TuneIcon, ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material'
import { PageContainer, ListHeader } from '@ds/ui'
import { KPIStrip } from '../../components/kpi/KpiStrip'
import type { KPIItem } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { useCategoryProducts } from '../../hooks/useEntityQueries'
import { RemotePriceLabel, usesNonSatsPriceLabel } from '../../components/offers/RemotePriceLabel'
import type { Offer } from '../../types/api'

type ViewMode = 'list' | 'gallery'
type SortOption = 'newest' | 'price-asc' | 'price-desc' | 'name'

// Offers without a comparable sats price sort last in both price directions.
function comparePriceRows(a: Offer, b: Offer, direction: 1 | -1): number {
  const aNoSats = usesNonSatsPriceLabel(a)
  const bNoSats = usesNonSatsPriceLabel(b)
  if (aNoSats !== bNoSats) return aNoSats ? 1 : -1
  if (aNoSats) return 0
  return direction * (a.priceSats - b.priceSats)
}

// ── Product Card (Gallery) ────────────────────────────────────────────

function ProductGalleryCard({ offer }: { offer: Offer }) {
  const { formatNumber } = useTranslation()
  const hasImage = offer.images && offer.images.length > 0

  return (
    <Card elevation={0}>
      <CardActionArea
        component={Link}
        to={`/buy/product/${offer.id}`}
        sx={{ textDecoration: 'none', display: 'block' }}
      >
        <Box sx={{ height: 140, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {hasImage ? (
            <Box component="img" src={offer.images![0]} alt={offer.title} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <Inventory2Icon sx={{ fontSize: 32, color: 'text.secondary' }} />
          )}
        </Box>
        <Box sx={{ px: 1.5, pt: 1.25, pb: 1.5 }}>
          <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', mb: 0.5, color: 'text.secondary' }}>
            {offer.offerType === 'SERVICE' ? 'Service' : 'Product'}
          </Typography>
          <Typography variant="body2" fontWeight={600} noWrap sx={{ lineHeight: 'tight' }}>
            {offer.title}
          </Typography>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 1 }}>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              {usesNonSatsPriceLabel(offer) ? (
                <Typography variant="caption" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums', color: 'primary.main' }}>
                  <RemotePriceLabel offer={offer} rates={{}} formatNumber={formatNumber} showEstimate={false} />
                </Typography>
              ) : (
                <>
                  <BoltIcon sx={{ fontSize: 11, color: 'primary.main' }} />
                  <Typography variant="caption" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums', color: 'primary.main' }}>
                    {formatNumber(offer.priceSats)}
                  </Typography>
                </>
              )}
            </Stack>
            {offer.company?.name && (
              <Typography variant="caption" noWrap sx={{ maxWidth: 80, color: 'text.secondary' }}>
                {offer.company.name}
              </Typography>
            )}
          </Stack>
        </Box>
      </CardActionArea>
    </Card>
  )
}

// ── Product Row (List) ────────────────────────────────────────────────

function ProductListRow({ offer }: { offer: Offer }) {
  const { formatNumber } = useTranslation()
  const isService = offer.offerType === 'SERVICE'
  const hasImage = offer.images && offer.images.length > 0

  return (
    <Card variant="outlined" elevation={0}>
      <CardActionArea
        component={Link}
        to={`/buy/product/${offer.id}`}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          px: 2,
          py: 1.75,
          borderRadius: 3,
          textDecoration: 'none',
        }}
      >
        <Avatar
          variant="rounded"
          sx={{ width: 48, height: 48, bgcolor: 'action.hover', flexShrink: 0, overflow: 'hidden' }}
        >
          {hasImage
            ? <Box component="img" src={offer.images![0]} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <Inventory2Icon sx={{ fontSize: 18, color: isService ? '#63B3ED' : '#48BB78' }} />}
        </Avatar>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.25 }}>
            <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'text.secondary' }}>
              {isService ? 'Service' : 'Product'}
            </Typography>
            <Typography variant="body2" fontWeight={600} noWrap sx={{ lineHeight: 1 }}>
              {offer.title}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" noWrap component="span">
            {offer.categoryCode}{offer.company?.name ? ` · ${offer.company.name}` : ''}
          </Typography>
        </Box>

        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0 }}>
          {usesNonSatsPriceLabel(offer) ? (
            <Typography variant="caption" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums', color: 'primary.main' }}>
              <RemotePriceLabel offer={offer} rates={{}} formatNumber={formatNumber} showEstimate={false} />
            </Typography>
          ) : (
            <>
              <BoltIcon sx={{ fontSize: 11, color: 'primary.main' }} />
              <Typography variant="caption" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums', color: 'primary.main' }}>
                {formatNumber(offer.priceSats)}
              </Typography>
            </>
          )}
        </Stack>

        <ArrowRightIcon sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
      </CardActionArea>
    </Card>
  )
}

// ── BuyCategoryProducts Component ─────────────────────────────────────

export function BuyCategoryProducts() {
  const { categoryId: slug } = useParams<{ categoryId: string }>()
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('buyCategoryProducts_viewMode')
    return (saved === 'list' || saved === 'gallery') ? saved : 'gallery'
  })
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  const pageRef = usePageAnimation([
    { selector: '.page-animate', from: { duration: 0.5, stagger: 0.08, y: 20 } },
  ])

  const { data, isLoading } = useCategoryProducts(slug ?? '')
  const category = data?.category ?? null
  const offers = data?.offers ?? []

  const filteredOffers = useMemo(() => {
    let filtered = [...offers]

    switch (sortBy) {
      case 'price-asc': filtered.sort((a, b) => comparePriceRows(a, b, 1)); break
      case 'price-desc': filtered.sort((a, b) => comparePriceRows(a, b, -1)); break
      case 'name': filtered.sort((a, b) => a.title.localeCompare(b.title)); break
      case 'newest':
      default: filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); break
    }

    return filtered
  }, [offers, sortBy])

  const kpiItems = useMemo<KPIItem[]>(() => {
    // Average only over offers with a real sats price (foreign/unpriced remote listings carry a 0 sentinel).
    const satsOffers = filteredOffers.filter(o => !usesNonSatsPriceLabel(o))
    return [
      { icon: <Inventory2Icon sx={{ fontSize: 14 }} />, value: filteredOffers.length, label: 'Products' },
      { icon: <BoltIcon sx={{ fontSize: 14 }} />, value: satsOffers.length > 0 ? Math.round(satsOffers.reduce((s, o) => s + o.priceSats, 0) / satsOffers.length) : '–', label: 'Avg Price' },
    ]
  }, [filteredOffers])

  function handleViewModeChange(mode: ViewMode) {
    setViewMode(mode)
    localStorage.setItem('buyCategoryProducts_viewMode', mode)
  }

  const sortLabels: Record<SortOption, string> = {
    newest: 'Newest first',
    'price-asc': 'Price: Low → High',
    'price-desc': 'Price: High → Low',
    name: 'Name A–Z',
  }

  const [sortAnchorEl, setSortAnchorEl] = useState<null | HTMLElement>(null)

  return (
    <PageContainer size="wide" spacing="lg" className="page-animate" ref={pageRef}>
      {/* Header + KPI Strip */}
      <PageHeader
        icon={<Inventory2Icon />}
        title={category?.name ?? 'Products'}
        subtitle={category?.unspscCode ? `UNSPSC ${category.unspscCode}` : 'Browse products in this category'}
        onBack={() => window.history.back()}
        actions={<KPIStrip items={kpiItems} loading={isLoading} skeletonCount={2} embedded />}
      />

      {/* View & Sort Controls */}
      <ListHeader
        tabs={[]}
        activeTab=""
        onTabChange={() => {}}
        actions={[
          {
            key: 'sort',
            element: (
              <>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<TuneIcon sx={{ fontSize: 13 }} />}
                  endIcon={<ExpandMoreIcon sx={{ fontSize: 12 }} />}
                  onClick={(e) => setSortAnchorEl(e.currentTarget)}
                  sx={{ textTransform: 'none', fontSize: '12px' }}
                >
                  {sortLabels[sortBy]}
                </Button>
                <Menu
                  anchorEl={sortAnchorEl}
                  open={Boolean(sortAnchorEl)}
                  onClose={() => setSortAnchorEl(null)}
                  PaperProps={{ sx: { minWidth: 160 } }}
                >
                  {(Object.keys(sortLabels) as SortOption[]).map(key => (
                    <MenuItem
                      key={key}
                      selected={sortBy === key}
                      onClick={() => { setSortBy(key); setSortAnchorEl(null) }}
                      sx={{ fontSize: '12px' }}
                    >
                      <ListItemText inset={sortBy !== key} sx={{ fontWeight: sortBy === key ? 600 : 400 }}>
                        {sortLabels[key]}
                      </ListItemText>
                    </MenuItem>
                  ))}
                </Menu>
              </>
            ),
          },
        ]}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        mt={2}
        mb={1.5}
      />

      {/* Products */}
      {isLoading ? (
        viewMode === 'gallery' ? (
          <Grid container spacing={1.5}>
            {[0, 1, 2, 3, 4, 5].map(i => (
              <Grid size={{ xs: 6, md: 4, lg: 3 }} key={i}>
                <Stack spacing={0}>
                  <Skeleton variant="rounded" height={140} />
                  <Box sx={{ px: 1.5, pt: 1.25, pb: 1.5 }}>
                    <Skeleton variant="text" width={56} height={12} />
                    <Skeleton variant="text" width="100%" height={16} />
                    <Skeleton variant="text" width="40%" height={12} sx={{ mt: 0.5 }} />
                  </Box>
                </Stack>
              </Grid>
            ))}
          </Grid>
        ) : (
          <Stack spacing={1}>
            {[0, 1, 2, 3].map(i => (
              <Skeleton key={i} variant="rounded" height={64} />
            ))}
          </Stack>
        )
      ) : filteredOffers.length === 0 ? (
        <Paper variant="outlined" sx={{ py: 8, textAlign: 'center' }}>
          <Avatar sx={{ mx: 'auto', mb: 2, bgcolor: 'action.hover', width: 56, height: 56 }}>
            <Inventory2Icon sx={{ fontSize: 28, color: 'text.secondary' }} />
          </Avatar>
          <Typography variant="subtitle1" fontWeight={600}>
            No products yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 320, mx: 'auto' }}>
            No offers found in this category. Browse other categories or search the marketplace.
          </Typography>
          <Button
            component={Link}
            to="/buy/categories"
            variant="contained"
            size="small"
            startIcon={<ArrowRightIcon />}
            sx={{ mt: 2, textTransform: 'none' }}
          >
            All Categories
          </Button>
        </Paper>
      ) : viewMode === 'gallery' ? (
        <Grid container spacing={1.5}>
          {filteredOffers.map(offer => (
            <Grid size={{ xs: 6, md: 4, lg: 3 }} key={offer.id}>
              <ProductGalleryCard offer={offer} />
            </Grid>
          ))}
        </Grid>
      ) : (
        <Stack spacing={1}>
          {filteredOffers.map(offer => (
            <ProductListRow key={offer.id} offer={offer} />
          ))}
        </Stack>
      )}
    </PageContainer>
  )
}