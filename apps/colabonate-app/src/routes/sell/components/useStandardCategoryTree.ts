import { useState, useEffect, useMemo } from 'react'
import { apiCall } from '../../../lib/api'

/**
 * Shared L1/L2/L3 standard-category cascade hook.
 * Used by CatalogModals (Create/Edit Catalog) and SellProductDetail.
 *
 * State model: explicit L1 / L2 selections. The leaf (selectedSlug) is
 * derived — when nothing finer is chosen, it equals the deepest selected
 * level. This keeps the cascade consistent: changing L1 clears L2 + L3,
 * changing L2 clears L3, and the visible Select values always reflect the
 * user's last choice at each level.
 *
 * @param existingSlug - preselects the tree to this slug (for edit mode)
 */
export function useStandardCategoryTree(existingSlug = '') {
  const [allCategories, setAllCategories] = useState<any[]>([])
  const [categoriesByParent, setCategoriesByParent] = useState<Record<string, any[]>>({})
  const [l1Options, setL1Options] = useState<any[]>([])
  const [selectedL1, setSelectedL1] = useState('')
  const [selectedL2, setSelectedL2] = useState('')
  const [selectedL3, setSelectedL3] = useState('')

  const slugToId = useMemo(() => {
    const map = new Map<string, string>()
    for (const cat of allCategories) map.set(cat.slug, cat.id)
    return map
  }, [allCategories])

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      try {
        const res = await apiCall('/api/standard-categories/tree/flat')
        const data = await res.json()
        if (!cancelled && data.standardCategories) {
          const all = data.standardCategories
          setAllCategories(all)
          const byParent: Record<string, any[]> = {}
          const roots: any[] = []
          for (const cat of all) {
            if (cat.level === 1) {
              roots.push(cat)
            } else {
              const parentSlug = cat.slug.substring(0, cat.slug.lastIndexOf('/'))
              if (!byParent[parentSlug]) byParent[parentSlug] = []
              byParent[parentSlug].push(cat)
            }
          }
          setCategoriesByParent(byParent)
          const sortedRoots = roots.sort((a, b) => a.name.localeCompare(b.name))
          setL1Options(sortedRoots)

          if (existingSlug) {
            const cat = all.find((c: any) => c.slug === existingSlug)
            if (cat) {
              if (cat.level === 1) setSelectedL1(cat.slug)
              else if (cat.level === 2) {
                setSelectedL1(cat.slug.substring(0, cat.slug.lastIndexOf('/')))
                setSelectedL2(cat.slug)
              } else if (cat.level === 3) {
                const l2Slug = cat.slug.substring(0, cat.slug.lastIndexOf('/'))
                setSelectedL1(l2Slug.substring(0, l2Slug.lastIndexOf('/')))
                setSelectedL2(l2Slug)
                setSelectedL3(cat.slug)
              }
            }
          }
        }
      } catch (e) {
        console.error('Failed to fetch categories:', e)
      }
    }
    fetch()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const l2Options = useMemo(
    () => selectedL1
      ? (categoriesByParent[selectedL1] || []).sort((a, b) => a.name.localeCompare(b.name))
      : [],
    [selectedL1, categoriesByParent],
  )
  const l3Options = useMemo(
    () => selectedL2
      ? (categoriesByParent[selectedL2] || []).sort((a, b) => a.name.localeCompare(b.name))
      : [],
    [selectedL2, categoriesByParent],
  )

  const selectedSlug = selectedL3 || selectedL2 || selectedL1
  const selectedCategoryId = selectedSlug ? (slugToId.get(selectedSlug) || null) : null

  function handleL1Change(slug: string) {
    setSelectedL1(slug)
    setSelectedL2('')
    setSelectedL3('')
  }
  function handleL2Change(slug: string) {
    setSelectedL2(slug)
    setSelectedL3('')
  }
  function handleL3Change(slug: string) {
    setSelectedL3(slug)
  }

  return {
    selectedCategoryId, selectedSlug, l1Options, l2Options, l3Options,
    activeL1Slug: selectedL1,
    activeL2Slug: selectedL2,
    handleL1Change, handleL2Change, handleL3Change,
  }
}
