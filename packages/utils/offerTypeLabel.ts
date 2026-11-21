// ADR-366 D6: single source of truth for the Offer.offerType display label,
// replacing five-plus hard-coded duplicates that had drifted (e.g. 'Product'
// vs. German 'Produkt' in packages/ui/slider-list). Icon/color choices stay
// per-surface — those legitimately differ across contexts — only the label
// text is unified here.
export const OFFER_TYPE_LABELS: Record<string, string> = {
  ITEM: 'Item',
  PRODUCT: 'Product',
  SERVICE: 'Service',
  AGENT_SETUP: 'Agent',
  COOP: 'Collaboration',
};

export function getOfferTypeLabel(offerType?: string | null, fallback = 'Product'): string {
  if (!offerType) return fallback;
  return OFFER_TYPE_LABELS[offerType] ?? fallback;
}
