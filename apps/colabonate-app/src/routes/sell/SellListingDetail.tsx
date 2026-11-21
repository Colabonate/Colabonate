import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Grid,
  InputAdornment,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import PlaceIcon from '@mui/icons-material/Place'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { NotFoundState } from '../../components/NotFoundState'
import { apiCall } from '../../lib/api'
import { RichDescriptionEditor } from '../../components/offers'
import { SatsAmountInput } from '../../components/currency/SatsAmountInput'
import { queryClient } from '../../lib/queryClient'
import { useOffer } from '../../hooks/useEntityQueries'
import { MultiImageUploadInput } from '../../components/offers/MultiImageUploadInput'
import { ListingCategorySelect } from './components/ListingCategorySelect'
import {
  COUNTRIES,
  countryCodeFromText,
  offerTypeFromCategoryCode,
} from '../../components/offers/offerFormConstants'
// import type { Offer } from '../../types/api' // Removed since we don't cast manually anymore

function parseLocationString(locStr: string | undefined | null): { street: string; city: string; zip: string; country: string } {
  if (!locStr) return { street: '', city: '', zip: '', country: '' }
  const parts = locStr.split(',').map(p => p.trim())
  if (parts.length === 4) return { street: parts[0], city: parts[1], zip: parts[2], country: parts[3] }
  if (parts.length === 3) return { street: '', city: parts[0], zip: parts[1], country: parts[2] }
  if (parts.length === 2) return { street: '', city: parts[0], zip: '', country: parts[1] }
  if (parts.length === 1) return { street: '', city: '', zip: parts[0], country: '' }
  return { street: '', city: '', zip: '', country: '' }
}

function serializeLocation(loc: { street: string; city: string; zip: string; country: string }): string | undefined {
  const parts = [loc.street, loc.city, loc.zip, loc.country].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : undefined
}

export function SellListingDetail() {
  const navigate = useNavigate()
  const { listingId } = useParams<{ listingId?: string }>()
  const isEditMode = listingId && listingId !== 'new'

  const pubkey = localStorage.getItem('pubkey')

  const { data: offer, isLoading, error: queryError } = useOffer(listingId === 'new' ? '' : (listingId || ''))

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priceSats: '',
    offerType: 'ITEM' as 'ITEM' | 'PRODUCT' | 'SERVICE' | 'COOP',
    status: 'DRAFT' as 'DRAFT' | 'ACTIVE',
  })
  // ADR-420: category selection is slug-based (same taxonomy + payload shape as
  // the create wizard) so a stored categoryCode round-trips exactly, incl. L3.
  const [selectedCategoryCode, setSelectedCategoryCode] = useState('')
  const [selectedL1Slug, setSelectedL1Slug] = useState('')
  // ADR-420: street/zip/city live in the free-text `location`; the country is a real
  // ISO code (sent as `country`) so country filters, facets and search can match it.
  const [location, setLocation] = useState({ street: '', city: '', zip: '', country: '' })
  const [countryCode, setCountryCode] = useState('')
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [primaryImageIndex, setPrimaryImageIndex] = useState(0)

  useEffect(() => {
    if (queryError) {
      console.error('Failed to load listing:', queryError)
      setSubmitError('Failed to load listing')
      return
    }

    if (!isEditMode || !offer) return

    if (offer.creatorPubkey !== pubkey) {
      setSubmitError('You can only edit your own listings')
      return
    }

    setFormData({
      title: offer.title,
      description: offer.description || '',
      priceSats: String(offer.priceSats),
      // This page doesn't support editing AGENT_SETUP offers (they're
      // managed via /sell/agents, ADR-309) — fall back to ITEM if one is
      // somehow opened here rather than widening this page's own form state.
      offerType: (offer.offerType === 'AGENT_SETUP' ? 'ITEM' : offer.offerType) || 'ITEM',
      status: (offer.status as 'DRAFT' | 'ACTIVE') || 'DRAFT',
    })
    const parsedLocation = parseLocationString(offer.location)
    setLocation({ ...parsedLocation, country: '' })
    setCountryCode(countryCodeFromText(offer.country) || countryCodeFromText(parsedLocation.country))
    setImageUrls(offer.images || [])
  }, [isEditMode, offer, pubkey, queryError])

  async function handleSubmit(publishNow: boolean) {
    const parsedPrice = parseInt(formData.priceSats)
    if (!formData.title) { setSubmitError('Title is required'); return }
    if (!formData.priceSats || isNaN(parsedPrice) || parsedPrice < 1) { setSubmitError('Valid price required'); return }
    if (!pubkey) { setSubmitError('You must be logged in'); return }

    setSubmitError('')
    setSubmitting(true)

    const orderedImages = primaryImageIndex === 0 ? imageUrls : [imageUrls[primaryImageIndex], ...imageUrls.filter((_, i) => i !== primaryImageIndex)]

    // ADR-420: send the deepest selected slug; `category` carries the L1 slug,
    // matching the create wizard's payload. An empty selection omits both keys
    // so the server keeps the stored values.
    const categoryCode = selectedCategoryCode || undefined
    // Re-derive offerType only when the category actually changed — a stored
    // offerType that disagrees with the code's root (e.g. SERVICE under
    // 'digital') must not silently flip on every save.
    const categoryChanged = !isEditMode || categoryCode !== (offer?.categoryCode ?? '')
    const resolvedOfferType = categoryCode && categoryChanged
      ? offerTypeFromCategoryCode(categoryCode)
      : formData.offerType
    const countryName = COUNTRIES.find(c => c.code === countryCode)?.name ?? ''
    const locationText = serializeLocation({ ...location, country: countryName })

    try {
      if (isEditMode && listingId) {
        await apiCall(`/api/offers/${listingId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            title: formData.title,
            description: formData.description,
            priceSats: parsedPrice,
            category: selectedL1Slug || undefined,
            categoryCode,
            offerType: resolvedOfferType,
            location: locationText,
            country: countryCode || null,
            city: location.city || null,
            images: orderedImages,
            status: publishNow ? 'ACTIVE' : formData.status,
            creatorPubkey: pubkey,
          }),
        })
        queryClient.invalidateQueries({ queryKey: ['offers'] })
        queryClient.invalidateQueries({ queryKey: ['offer', listingId] })
        navigate('/sell/listings')
      } else {
        const response = await apiCall('/api/offers', {
          method: 'POST',
          body: JSON.stringify({
            title: formData.title,
            description: formData.description,
            priceSats: parsedPrice,
            category: selectedL1Slug || undefined,
            categoryCode,
            offerType: resolvedOfferType,
            location: locationText,
            country: countryCode || null,
            city: location.city || null,
            images: orderedImages,
            creatorPubkey: pubkey,
            status: publishNow ? 'ACTIVE' : 'DRAFT',
          }),
        })
        if (response.ok) {
          queryClient.invalidateQueries({ queryKey: ['offers'] })
          navigate('/sell/listings')
        }
      }
    } catch (error) {
      console.error('Failed to save listing:', error)
      setSubmitError(error instanceof Error ? error.message : 'Failed to save listing')
    } finally {
      setSubmitting(false)
    }
  }

  if (isEditMode && isLoading) {
    return (
      <PageContainer size="narrow" spacing="lg">
        <PageHeader title="Edit Listing" onBack={() => navigate(-1)} />
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 rounded-full border-4 animate-spin" style={{ borderColor: 'var(--color-primary-50) var(--color-primary-50) var(--color-primary-50) transparent' }} />
        </div>
      </PageContainer>
    )
  }

  if (isEditMode && !isLoading && !offer) {
    return (
      <NotFoundState
        title="Listing not found"
        message="This listing may have been removed, or the link is incorrect."
        detail={listingId ? `Listing ${listingId}` : undefined}
        primary={{ label: 'Back to listings', to: '/sell/listings' }}
        secondary={{ label: 'Go back', onClick: () => navigate(-1) }}
      />
    )
  }

  return (
    <PageContainer size="narrow" spacing="lg">
      <PageHeader
        title={isEditMode ? 'Edit Listing' : 'Create Listing'}
        subtitle="Product listing for the marketplace"
        onBack={() => navigate(-1)}
        backLabel="Back to listings"
      />

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
          <Typography variant="subtitle1" fontWeight={700} gutterBottom>
            Product Details
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 2 }}>
            <TextField label="Title" value={formData.title} onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))} placeholder="e.g. Organic Apple Juice" required fullWidth />
            {/* ADR-295: WYSIWYG description editor + AI assist */}
            <RichDescriptionEditor
              value={formData.description}
              onChange={(html) => setFormData(prev => ({ ...prev, description: html }))}
              aiContext={{
                title: formData.title,
                offerType: formData.offerType,
                category: selectedCategoryCode,
              }}
            />
            <SatsAmountInput
              label="Price"
              valueSats={formData.priceSats === '' ? '' : Number(formData.priceSats)}
              onChangeSats={sats => setFormData(prev => ({ ...prev, priceSats: sats === '' ? '' : String(sats) }))}
              required
            />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <ListingCategorySelect
                key={offer?.id ?? listingId ?? 'create'}
                initialSlug={isEditMode ? (offer?.categoryCode ?? '') : ''}
                onChange={(slug, l1Slug) => {
                  setSelectedCategoryCode(slug)
                  setSelectedL1Slug(l1Slug)
                }}
              />
            </Box>
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
          <Typography variant="subtitle1" fontWeight={700} gutterBottom>Photos</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Up to 5 photos. First image is the cover.</Typography>
          <MultiImageUploadInput values={imageUrls} onChange={setImageUrls} maxImages={5} primaryIndex={primaryImageIndex} onPrimaryChange={setPrimaryImageIndex} />
        </Paper>

        <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
          <Typography variant="subtitle1" fontWeight={700} gutterBottom>Location</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Optional – helps buyers find local products</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField label="Street (optional)" value={location.street} onChange={e => setLocation(prev => ({ ...prev, street: e.target.value }))} fullWidth slotProps={{ input: { startAdornment: <InputAdornment position="start"><PlaceIcon fontSize="small" color="action" /></InputAdornment> } }} />
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 5 }}><TextField label="ZIP (optional)" value={location.zip} onChange={e => setLocation(prev => ({ ...prev, zip: e.target.value }))} fullWidth /></Grid>
              <Grid size={{ xs: 12, sm: 7 }}><TextField label="City (optional)" value={location.city} onChange={e => setLocation(prev => ({ ...prev, city: e.target.value }))} fullWidth /></Grid>
            </Grid>
            <Autocomplete
              options={COUNTRIES.map(c => c.code)}
              value={countryCode || null}
              onChange={(_, code) => setCountryCode(code ?? '')}
              getOptionLabel={code => COUNTRIES.find(c => c.code === code)?.name ?? code}
              renderInput={params => <TextField {...params} label="Country (optional)" />}
              fullWidth
            />
          </Box>
        </Paper>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pb: 4 }}>
          {submitError && <Alert severity="error">{submitError}</Alert>}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
            <Button variant="outlined" onClick={() => navigate(-1)} disabled={submitting}>Cancel</Button>
            {!isEditMode && formData.status === 'DRAFT' && (
              <Button variant="outlined" onClick={() => handleSubmit(false)} disabled={submitting}>Save Draft</Button>
            )}
            <Button variant="contained" onClick={() => handleSubmit(true)} disabled={submitting}>
              {submitting ? 'Saving...' : isEditMode ? 'Save Changes' : 'Publish Listing'}
            </Button>
          </Box>
        </Box>
      </Box>
    </PageContainer>
  )
}