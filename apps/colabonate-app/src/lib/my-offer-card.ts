// ADR-422: Home's "Tickets & Offers → My Offers" tab shows the viewer's own
// listings, fetched owner-scoped and slim (a thumbnail instead of the raw
// base64 `images`). This maps either row shape to the one card shape the
// slider renders: slim rows (owner query) or full rows (logged-out fallback
// that shows the public feed).
export interface MyOfferCard {
  id: string
  title: string
  categoryCode: string
  priceSats: number
  avatarUrl?: string
  createdAt?: string
}

interface MyOfferRow {
  id: string
  title: string
  categoryCode?: string | null
  priceSats: number
  imageThumbs?: string[] | null
  images?: string[] | string | null
  publishedAt?: string | null
  createdAt?: string | null
}

export function toMyOfferCard(o: MyOfferRow): MyOfferCard {
  const fullImage = Array.isArray(o.images) ? o.images[0] : (typeof o.images === 'string' ? o.images : undefined)
  return {
    id: o.id,
    title: o.title,
    categoryCode: o.categoryCode ?? '',
    priceSats: o.priceSats,
    // Thumbnail first: slim rows carry no `images`, and a thumb is what a card needs.
    avatarUrl: o.imageThumbs?.[0] ?? fullImage,
    createdAt: o.publishedAt ?? o.createdAt ?? undefined,
  }
}
