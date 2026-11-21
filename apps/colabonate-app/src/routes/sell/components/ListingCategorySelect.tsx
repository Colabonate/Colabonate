import { useEffect } from 'react'
import { FormControl, InputLabel, MenuItem, Select } from '@mui/material'
import { useStandardCategoryTree } from './useStandardCategoryTree'

/**
 * L1/L2/L3 standard-category cascade for the listing edit form (ADR-420).
 *
 * Same taxonomy source as the create wizard (`/api/standard-categories/tree/flat`
 * via useStandardCategoryTree) and slug-based like its payload, so a stored
 * `Offer.categoryCode` round-trips exactly — including level-3 detail codes the
 * old display-name selects dropped. The hook only preselects on mount, so the
 * parent must mount this component with a stable `key` once the offer's
 * categoryCode is known.
 */
export function ListingCategorySelect({
  initialSlug,
  onChange,
}: {
  /** Stored Offer.categoryCode to preselect (any level; '' for none/create). */
  initialSlug: string
  /** Reports the deepest selected slug plus its L1 slug on every change. */
  onChange: (slug: string, l1Slug: string) => void
}) {
  const cat = useStandardCategoryTree(initialSlug)

  useEffect(() => {
    onChange(cat.selectedSlug, cat.activeL1Slug)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat.selectedSlug, cat.activeL1Slug])

  return (
    <>
      <FormControl fullWidth>
        <InputLabel>Category</InputLabel>
        <Select value={cat.activeL1Slug} label="Category" onChange={e => cat.handleL1Change(e.target.value)}>
          {cat.l1Options.map(c => <MenuItem key={c.id} value={c.slug}>{c.name}</MenuItem>)}
        </Select>
      </FormControl>
      {cat.l2Options.length > 0 && (
        <FormControl fullWidth>
          <InputLabel shrink>Subcategory</InputLabel>
          <Select
            value={cat.activeL2Slug}
            label="Subcategory"
            displayEmpty
            onChange={e => cat.handleL2Change(e.target.value)}
          >
            <MenuItem value=""><em>None</em></MenuItem>
            {cat.l2Options.map(c => <MenuItem key={c.id} value={c.slug}>{'\u00A0\u00A0'}{c.name}</MenuItem>)}
          </Select>
        </FormControl>
      )}
      {cat.l3Options.length > 0 && (
        <FormControl fullWidth>
          <InputLabel shrink>Detail Category</InputLabel>
          <Select
            value={cat.l3Options.some(c => c.slug === cat.selectedSlug) ? cat.selectedSlug : ''}
            label="Detail Category"
            displayEmpty
            onChange={e => cat.handleL3Change(e.target.value)}
          >
            <MenuItem value=""><em>None</em></MenuItem>
            {cat.l3Options.map(c => <MenuItem key={c.id} value={c.slug}>{'\u00A0\u00A0\u00A0\u00A0'}{c.name}</MenuItem>)}
          </Select>
        </FormControl>
      )}
    </>
  )
}
