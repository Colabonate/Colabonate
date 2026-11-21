// Shared StandardCategory-slug validation for every write path that accepts a
// `categoryCode` from the client (offers POST/PATCH, catalog product→offer
// publishing, cooperation + cooperation-template create/PATCH). Before this
// helper only POST /api/catalog/:catalogId/products validated the category —
// the direct offer path accepted any free string (defaulting to
// 'services/other') and the cooperation paths passed client values straight
// through, so typos silently created listings that no standard category
// filter or badge count could ever surface (ADR-380 invariant: Badge sums =
// distinct results only holds when categoryCodes are real slugs).
//
// Semantics preserved per call site:
// - `undefined`  → "not provided" (PATCH sites keep skipping the field)
// - `null` / `''`→ explicit clear → null (offer create maps falsy to its
//   'services/other' default exactly as before)
// - valid slug   → canonicalized to the stored slug (trimmed)
// - anything else→ { ok: false } → route answers 400 INVALID_CATEGORY_CODE

export const DEFAULT_OFFER_CATEGORY_CODE = 'services/other'

type StandardCategoryLookup = {
  standardCategory: {
    findUnique(args: { where: { slug: string } }): Promise<{ slug: string } | null>
  }
}

export type CategoryCodeResolution =
  | { ok: true; categoryCode: string | null | undefined }
  | { ok: false; message: string }

export async function resolveCategoryCode(
  prisma: StandardCategoryLookup,
  categoryCode: unknown,
): Promise<CategoryCodeResolution> {
  if (categoryCode === undefined) return { ok: true, categoryCode: undefined }
  if (categoryCode === null) return { ok: true, categoryCode: null }
  if (typeof categoryCode !== 'string') {
    return { ok: false, message: 'categoryCode must be a string (StandardCategory slug)' }
  }
  const trimmed = categoryCode.trim()
  if (!trimmed) return { ok: true, categoryCode: null }
  const category = await prisma.standardCategory.findUnique({ where: { slug: trimmed } })
  if (!category) {
    return {
      ok: false,
      message: `Unknown categoryCode "${trimmed}" — must be a StandardCategory slug (see GET /api/standard-categories/tree/flat)`,
    }
  }
  return { ok: true, categoryCode: category.slug }
}
