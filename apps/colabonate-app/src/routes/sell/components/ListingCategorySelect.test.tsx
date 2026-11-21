// @vitest-environment jsdom
import '../../../test/setup-component-tests'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListingCategorySelect } from './ListingCategorySelect'

// Minimal 3-level taxonomy mirroring /api/standard-categories/tree/flat rows.
const taxonomy = [
  { id: 'c-goods', slug: 'goods', name: 'Goods', level: 1 },
  { id: 'c-elec', slug: 'goods/electronics', name: 'Electronics', level: 2 },
  { id: 'c-phones', slug: 'goods/electronics/smartphones', name: 'Smartphones', level: 3 },
  { id: 'c-digital', slug: 'digital', name: 'Digital', level: 1 },
  { id: 'c-software', slug: 'digital/software', name: 'Software', level: 2 },
]

vi.mock('../../../lib/api', () => ({
  apiCall: vi.fn().mockResolvedValue({
    json: async () => ({ standardCategories: taxonomy }),
  }),
}))

const onChange = vi.fn()

function renderSelect(initialSlug: string) {
  onChange.mockClear()
  render(<ListingCategorySelect initialSlug={initialSlug} onChange={onChange} />)
}

describe('ListingCategorySelect (ADR-420 L3 round-trip)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preselects all three levels from a stored L3 categoryCode', async () => {
    renderSelect('goods/electronics/smartphones')
    // MUI renders each InputLabel twice (label + notched-outline span).
    await screen.findAllByText('Detail Category')
    // The comboboxes render in L1/L2/L3 order; each shows its selected option.
    const [l1, l2, l3] = screen.getAllByRole('combobox')
    expect(l1).toHaveTextContent('Goods')
    expect(l2).toHaveTextContent('Electronics')
    expect(l3).toHaveTextContent('Smartphones')
    expect(onChange).toHaveBeenCalledWith('goods/electronics/smartphones', 'goods')
  })

  it('preselects L1+L2 from an L2 categoryCode and hides the L3 select', async () => {
    renderSelect('digital/software')
    await screen.findAllByText('Subcategory')
    expect(screen.queryAllByText('Detail Category')).toHaveLength(0)
    const [l1, l2] = screen.getAllByRole('combobox')
    expect(l1).toHaveTextContent('Digital')
    expect(l2).toHaveTextContent('Software')
    expect(onChange).toHaveBeenCalledWith('digital/software', 'digital')
  })

  it('reports the deepest slug and clears deeper levels when L1 changes', async () => {
    renderSelect('goods/electronics/smartphones')
    await screen.findAllByText('Detail Category')
    onChange.mockClear()

    const user = userEvent.setup()
    await user.click(screen.getAllByRole('combobox')[0])
    await user.click(await screen.findByRole('option', { name: 'Digital' }))
    expect(onChange).toHaveBeenCalledWith('digital', 'digital')
    // L2/L3 reset: the L3 select is gone (digital/software has no L3 in the
    // fixture) and no stale Electronics/Smartphones selection remains.
    expect(screen.queryAllByText('Detail Category')).toHaveLength(0)
  })

  it('preselects only L1 from an L1 categoryCode and shows "None" for L2', async () => {
    renderSelect('digital')
    await screen.findAllByText('Subcategory')
    const [l1, l2] = screen.getAllByRole('combobox')
    expect(l1).toHaveTextContent('Digital')
    // displayEmpty: the '' MenuItem must render as "None", not a blank box
    // (MUI skips the display for an unfilled value without it).
    expect(l2.textContent?.replace(/\u200b/g, '')).toBe('None')
    expect(screen.queryAllByText('Detail Category')).toHaveLength(0)
    expect(onChange).toHaveBeenCalledWith('digital', 'digital')
  })

  it('leaves everything unselected for an unknown slug', async () => {
    renderSelect('nope/unknown')
    // Only the L1 select renders (no L1 selected → no L2/L3 options).
    await screen.findAllByText('Category')
    const comboboxes = screen.getAllByRole('combobox')
    expect(comboboxes).toHaveLength(1)
    // MUI pads an empty Select display with a zero-width space.
    expect(comboboxes[0].textContent?.replace(/\u200b/g, '')).toBe('')
    // Reports the empty selection so the parent omits the category keys.
    expect(onChange).toHaveBeenCalledWith('', '')
  })
})
