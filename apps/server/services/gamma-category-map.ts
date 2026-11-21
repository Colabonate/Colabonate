// ADR-277 D3: loader for the UNSPSC <-> Gamma tag seed map.
//
// Forward direction (categoryCode -> tags) suggests `t` tags for our own
// listings (D8, wired in Phase E). Reverse direction (tag -> categoryCode)
// places a foreign Gamma listing with no `category` tag onto the standard
// axis (D2/D9) on a best-effort basis. Neither direction is authoritative —
// the map is a starting point, not a constraint (D3).
//
// ADR-380 (v2): the seed map was extended from level-1/2 generic tags to a
// level-3 + corpus-synonym vocabulary so a foreign Gamma listing (especially
// SERVICE) resolves to a precise standard category. The mapped category is
// PERSISTED on the offer at ingest and by the backfill (`categoryCode` stays
// the single authoritative axis, ADR-277 D1) — the standard list/count paths
// match that stored slug, keeping badges == results (ADR-233). A query-time
// OR-bridge over `gammaTags` was tried and reverted; see ADR-380 "Rejected
// Alternatives".
// See docs/decisions/380-gamma-tags-standard-category-mapping.md.

import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { PrismaClient } from '@prisma/client'

interface GammaMapFile {
  version: number
  map: Record<string, string[]>
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const MAP_PATH = resolve(__dirname, '../../../packages/data/categories/gamma-map-v2.json')

const raw: GammaMapFile = JSON.parse(readFileSync(MAP_PATH, 'utf-8'))

/** categoryCode -> idiomatic Gamma tags (seed suggestions, D8) — level-1/2 slugs only */
export const CATEGORY_TO_GAMMA_TAGS: Readonly<Record<string, string[]>> = raw.map

/**
 * Idiomatic Gamma tags for a categoryCode of any depth. The map is keyed by
 * level-1/2 slugs only (D3); an offer's categoryCode is usually level-3
 * (e.g. `goods/electronics/laptops`), so this walks up to the nearest mapped
 * ancestor (`goods/electronics`, then `goods`) and returns its tags.
 */
export function tagsForCategoryCode(categoryCode: string): string[] {
  let code = categoryCode
  while (code) {
    const tags = raw.map[code]
    if (tags) return tags
    const lastSlash = code.lastIndexOf('/')
    if (lastSlash === -1) break
    code = code.slice(0, lastSlash)
  }
  return []
}

/**
 * tag -> categoryCode (best-effort ingest fallback, D2). On collision, the
 * more specific (longer) categoryCode wins so a level-2 slug is preferred
 * over its level-1 parent.
 */
export const GAMMA_TAG_TO_CATEGORY: ReadonlyMap<string, string> = (() => {
  const reverse = new Map<string, string>()
  for (const [categoryCode, tags] of Object.entries(raw.map)) {
    for (const tag of tags) {
      const existing = reverse.get(tag)
      if (!existing || categoryCode.length > existing.length) {
        reverse.set(tag, categoryCode)
      }
    }
  }
  return reverse
})()

/**
 * Best-effort categoryCode for a foreign listing's gammaTags (ADR-277 D2).
 * Returns the categoryCode of the most specific (longest) mapped tag, or ''
 * if nothing matches — an empty categoryCode is honest; a wrong slug is not.
 *
 * ADR-380: v1 returned the first mapped tag in tag order, which could pick a
 * broad level-2 tag (`services`) over a precise level-3 tag
 * (`services/development/web`) declared later. Longest-slug-wins makes the
 * persisted primary category the most informative one.
 */
export function deriveCategoryCodeFromGammaTags(gammaTags: string[]): string {
  let best = ''
  for (const tag of gammaTags) {
    const categoryCode = GAMMA_TAG_TO_CATEGORY.get(tag)
    if (categoryCode && categoryCode.length > best.length) best = categoryCode
  }
  return best
}

/**
 * ADR-380: the `OfferType` implied by a resolved standard category. Only the
 * SERVICE root is distinguishable from the tag vocabulary — `goods` and
 * `digital` both map to PRODUCT, and ITEM/COOP have no Gamma equivalent of
 * their own and keep their explicit tag/default. Used at ingest when a
 * foreign Gamma listing carries no `offer_type` tag, so a listing tagged
 * `services/*` is browsable in the standard Services tree and Home slider.
 */
export function offerTypeForCategoryCode(categoryCode: string): 'SERVICE' | 'PRODUCT' {
  return categoryCode === 'services' || categoryCode.startsWith('services/')
    ? 'SERVICE'
    : 'PRODUCT'
}

/**
 * ADR-277 D-6: recompute Product.gammaTags as the deduped union of gammaTags across all of
 * the product's offers[] (ADR-066 bridge, 1:N). Called after a successful offer publish
 * (apps/server/routes/nostr.ts POST /offers) so the ProductsTab gamma-axis facet count stays
 * fresh without a separate backfill run for every new offer. Best-effort — a Prisma error here
 * must not fail the offer publish it's attached to; callers should catch around this call.
 */
export async function syncProductGammaTags(prisma: PrismaClient, productId: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { offers: { select: { gammaTags: true } } },
  })
  if (!product) return

  const union = Array.from(new Set(product.offers.flatMap(o => o.gammaTags)))
  await prisma.product.update({ where: { id: productId }, data: { gammaTags: union } })
}
