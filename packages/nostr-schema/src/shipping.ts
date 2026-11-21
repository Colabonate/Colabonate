// Structured Shipping — Kind 30406 Shipping Option (ADR-155).
//
// Tag vocabulary for shipping options with carriers, countries/regions,
// weight/dimension constraints, and dynamic pricing. Adopted verbatim
// from Gamma spec (Kind 30406).

export const SHIPPING_SERVICE_TYPES = ['standard', 'express', 'overnight', 'pickup'] as const
export type ShippingServiceType = (typeof SHIPPING_SERVICE_TYPES)[number]

export const DURATION_UNITS = ['H', 'D', 'W', 'M', 'Y'] as const
export type DurationUnit = (typeof DURATION_UNITS)[number]

export interface ShippingOptionTagInput {
  d: string
  title: string
  baseCost: string
  currency: string
  countries: string[]
  service: ShippingServiceType
  carrier?: string
  regions?: string[]
  durationMin?: string
  durationMax?: string
  durationUnit?: DurationUnit
  location?: string
  geohash?: string
  weightMin?: string
  weightMinUnit?: string
  weightMax?: string
  weightMaxUnit?: string
  dimMin?: string
  dimMinUnit?: string
  dimMax?: string
  dimMaxUnit?: string
  priceWeight?: string
  priceWeightCurrency?: string
  priceVolume?: string
  priceVolumeCurrency?: string
  priceDistance?: string
  priceDistanceCurrency?: string
}

export function buildShippingOptionTags(input: ShippingOptionTagInput): string[][] {
  const tags: string[][] = [
    ['d', input.d],
    ['title', input.title],
    ['price', input.baseCost, input.currency],
    ['country', ...input.countries],
    ['service', input.service],
  ]

  if (input.carrier) tags.push(['carrier', input.carrier])
  if (input.regions && input.regions.length > 0) tags.push(['region', ...input.regions])
  if (input.durationMin && input.durationMax && input.durationUnit) {
    tags.push(['duration', input.durationMin, input.durationMax, input.durationUnit])
  }
  if (input.location) tags.push(['location', input.location])
  if (input.geohash) tags.push(['g', input.geohash])
  if (input.weightMin && input.weightMinUnit) tags.push(['weight-min', input.weightMin, input.weightMinUnit])
  if (input.weightMax && input.weightMaxUnit) tags.push(['weight-max', input.weightMax, input.weightMaxUnit])
  if (input.dimMin && input.dimMinUnit) tags.push(['dim-min', input.dimMin, input.dimMinUnit])
  if (input.dimMax && input.dimMaxUnit) tags.push(['dim-max', input.dimMax, input.dimMaxUnit])
  if (input.priceWeight && input.priceWeightCurrency) {
    tags.push(['price-weight', input.priceWeight, input.priceWeightCurrency])
  }
  if (input.priceVolume && input.priceVolumeCurrency) {
    tags.push(['price-volume', input.priceVolume, input.priceVolumeCurrency])
  }
  if (input.priceDistance && input.priceDistanceCurrency) {
    tags.push(['price-distance', input.priceDistance, input.priceDistanceCurrency])
  }

  return tags
}

export interface ShippingOptionRef {
  kind: 30406 | 30405
  pubkey: string
  d: string
  extraCost?: string
}

export function buildShippingOptionRefTag(ref: ShippingOptionRef): string[] {
  const coord = `${ref.kind}:${ref.pubkey}:${ref.d}`
  if (ref.extraCost) return ['shipping_option', coord, ref.extraCost]
  return ['shipping_option', coord]
}

export function parseShippingOptionRef(tag: string[]): ShippingOptionRef | null {
  if (tag[0] !== 'shipping_option' || !tag[1]) return null
  const parts = tag[1].split(':')
  if (parts.length !== 3) return null
  const kind = parseInt(parts[0], 10)
  if (kind !== 30406 && kind !== 30405) return null
  return {
    kind: kind as 30406 | 30405,
    pubkey: parts[1],
    d: parts[2],
    extraCost: tag[2],
  }
}

export function calculateShippingPrice(
  baseCost: number,
  extraCost: number,
  priceWeight?: number,
  weight?: number,
  priceVolume?: number,
  volume?: number,
  priceDistance?: number,
  distance?: number,
): number {
  let total = baseCost + extraCost
  if (priceWeight && weight) total += priceWeight * weight
  if (priceVolume && volume) total += priceVolume * volume
  if (priceDistance && distance) total += priceDistance * distance
  return total
}
