// Product variations and collections — Kind 30402 enrichment + Kind 30405
// Product Collection (ADR-156).
//
// Additive tags for multi-SKU listings (simple/variable/variation), specs,
// stock, weight/dim, and collection grouping via NIP-51 lists.

export const PRODUCT_TYPES = ['simple', 'variable', 'variation'] as const
export type ProductType = (typeof PRODUCT_TYPES)[number]

export const PHYSICAL_TYPES = ['digital', 'physical'] as const
export type PhysicalType = (typeof PHYSICAL_TYPES)[number]

export const LISTING_VISIBILITIES = ['hidden', 'on-sale', 'pre-order'] as const
export type ListingVisibility = (typeof LISTING_VISIBILITIES)[number]

export interface ProductSpec {
  key: string
  value: string
}

export interface VariantAxis {
  name: string
  values: string[]
}

export type VariantValues = Record<string, string>

/**
 * Format a frozen human-readable variant label (e.g. "Size: M · Colour: Blue")
 * for orders and tickets (ADR-270 D6).
 */
export function formatVariantLabel(values?: VariantValues | null): string {
  if (!values || Object.keys(values).length === 0) return ''
  return Object.entries(values)
    .filter(([k, v]) => Boolean(k) && Boolean(v))
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ')
}

/**
 * Normalize a single Gamma `t` tag (ADR-277 D3): lowercase, trim, collapse
 * inner whitespace to `-`, strip a leading `#`, drop empties. Used at every
 * write path (publish, ingest, wizard input) so the axis never drifts.
 */
export function normalizeGammaTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
}

/** Normalize + dedupe a list of Gamma `t` tags, dropping empties. */
export function normalizeGammaTags(raw: string[]): string[] {
  const seen = new Set<string>()
  for (const tag of raw) {
    const normalized = normalizeGammaTag(tag)
    if (normalized) seen.add(normalized)
  }
  return Array.from(seen)
}

export interface ProductListingTagInput {
  d: string
  title: string
  price: string
  currency: string
  type?: ProductType
  physicalType?: PhysicalType
  parentRef?: { pubkey: string; d: string }
  specs?: ProductSpec[]
  variantAxes?: VariantAxis[]
  variantValues?: VariantValues
  stock?: number
  images?: Array<{ url: string; dims?: string; sort?: string }>
  summary?: string
  weight?: string
  weightUnit?: string
  dim?: string
  dimUnit?: string
  location?: string
  geohash?: string
  listingVisibility?: ListingVisibility
  collectionRefs?: Array<{ pubkey: string; d: string }>
  shippingOptionRefs?: Array<{ kind: 30406 | 30405; pubkey: string; d: string; extraCost?: string }>
  category?: string
  categoryCode?: string
}

export function buildProductListingTags(input: ProductListingTagInput): string[][] {
  const tags: string[][] = [
    ['d', input.d],
    ['title', input.title],
    ['price', input.price, input.currency],
  ]

  if (input.type && input.physicalType) {
    tags.push(['type', input.type, input.physicalType])
  }

  if (input.parentRef) {
    tags.push(['a', `30402:${input.parentRef.pubkey}:${input.parentRef.d}`])
  }

  if (input.specs) {
    for (const spec of input.specs) {
      tags.push(['spec', spec.key, spec.value])
    }
  }

  if (input.variantValues) {
    const existingKeys = new Set((input.specs || []).map(s => s.key))
    for (const [key, value] of Object.entries(input.variantValues)) {
      if (!existingKeys.has(key) && value) {
        tags.push(['spec', key, value])
      }
    }
  }

  if (input.stock != null) {
    tags.push(['stock', String(input.stock)])
  }

  if (input.images) {
    for (const img of input.images) {
      const imgTag = ['image', img.url]
      if (img.dims) imgTag.push(img.dims)
      if (img.sort) imgTag.push(img.sort)
      tags.push(imgTag)
    }
  }

  if (input.summary) tags.push(['summary', input.summary])
  if (input.weight && input.weightUnit) tags.push(['weight', input.weight, input.weightUnit])
  if (input.dim && input.dimUnit) tags.push(['dim', input.dim, input.dimUnit])
  if (input.location) tags.push(['location', input.location])
  if (input.geohash) tags.push(['g', input.geohash])
  if (input.listingVisibility) tags.push(['visibility', input.listingVisibility])

  if (input.collectionRefs) {
    for (const ref of input.collectionRefs) {
      tags.push(['a', `30405:${ref.pubkey}:${ref.d}`])
    }
  }

  if (input.shippingOptionRefs) {
    for (const ref of input.shippingOptionRefs) {
      const coord = `${ref.kind}:${ref.pubkey}:${ref.d}`
      if (ref.extraCost) {
        tags.push(['shipping_option', coord, ref.extraCost])
      } else {
        tags.push(['shipping_option', coord])
      }
    }
  }

  if (input.category) tags.push(['t', input.category])
  if (input.categoryCode) tags.push(['category', input.categoryCode])

  return tags
}

export interface ProductCollectionTagInput {
  d: string
  title: string
  productRefs: Array<{ pubkey: string; d: string }>
  image?: string
  summary?: string
  location?: string
  geohash?: string
  shippingOptionRefs?: Array<{ pubkey: string; d: string }>
}

export function buildCollectionTags(input: ProductCollectionTagInput): string[][] {
  const tags: string[][] = [
    ['d', input.d],
    ['title', input.title],
  ]

  for (const ref of input.productRefs) {
    tags.push(['a', `30402:${ref.pubkey}:${ref.d}`])
  }

  if (input.image) tags.push(['image', input.image])
  if (input.summary) tags.push(['summary', input.summary])
  if (input.location) tags.push(['location', input.location])
  if (input.geohash) tags.push(['g', input.geohash])

  if (input.shippingOptionRefs) {
    for (const ref of input.shippingOptionRefs) {
      tags.push(['shipping_option', `30406:${ref.pubkey}:${ref.d}`])
    }
  }

  return tags
}

export function parseSpecs(tags: string[][]): ProductSpec[] {
  return tags.filter(t => t[0] === 'spec' && t[1] && t[2]).map(t => ({ key: t[1], value: t[2] }))
}

export function parseProductImages(tags: string[][]): Array<{ url: string; dims?: string; sort?: string }> {
  return tags
    .filter(t => t[0] === 'image' && t[1])
    .map(t => ({ url: t[1], dims: t[2] || undefined, sort: t[3] || undefined }))
}

export function parseShippingOptionRefs(tags: string[][]): Array<{ kind: 30406 | 30405; pubkey: string; d: string; extraCost?: string }> {
  return tags
    .filter(t => t[0] === 'shipping_option' && t[1])
    .map(t => {
      const parts = t[1].split(':')
      if (parts.length !== 3) return null
      const kind = parseInt(parts[0], 10)
      if (kind !== 30406 && kind !== 30405) return null
      return { kind: kind as 30406 | 30405, pubkey: parts[1], d: parts[2], extraCost: t[2] }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
}
