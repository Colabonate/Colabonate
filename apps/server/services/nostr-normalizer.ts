/**
 * NostrNormalizer — Parse NIP-99 Kind 30402 events into NormalizedRemoteOffer
 *
 * ADR-139 Phase 5: Two-stage Nostr passive ingestion
 * Remote events are normalized → RemoteOfferCandidate → (admin approve) → Offer
 */

import type { Event } from 'nostr-tools'
import { normalizeGammaTags, parseSpecs, parseProductImages, PRODUCT_TYPES, PHYSICAL_TYPES, type ProductSpec } from '@col/nostr-schema'
import { deriveCategoryCodeFromGammaTags, offerTypeForCategoryCode } from './gamma-category-map.js'

const SATS_CURRENCY_ALIASES = new Set(['sats', 'sat', 'msat'])

// ── Country ISO derivation (ADR-277 D9.5, amended 2026-08-16) ────────────────
// Foreign NIP-99 listings carry free-text `location` ("Berlin, Germany") and
// Colabonate-agnostic `country` tags (ISO code or full name). The marketplace
// country scope (ADR-222) matches Offer.country against ISO alpha-2 codes —
// without derivation every foreign listing without a Colabonate-native country
// tag falls out of every scoped search. Names come from Intl.DisplayNames
// (full-icu ships with Node 22) — no external dependency.

const ISO_ALPHA2_CODES = ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ ' +
  'NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ ' +
  'TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' ')

const ISO_CODE_SET = new Set(ISO_ALPHA2_CODES)

// Common aliases that DisplayNames does not cover ("USA", "UK", …).
const COUNTRY_NAME_ALIASES: Record<string, string> = {
  usa: 'US',
  uk: 'GB',
  'great britain': 'GB',
  uae: 'AE',
  holland: 'NL',
}

// Bare two-letter segments in a `location` tag are read as ISO alpha-2
// ("Lisbon, PT"). US/Canadian subnational abbreviations ("Sodus, MI",
// "Toronto, ON") are NOT ISO codes (Myanmar is MM, not MI) and are mapped to
// their country instead — 52 of 557 ingested candidates use the US
// "City, ST" form. Codes that collide with ISO (DE = Germany/Delaware,
// MO = Macau/Missouri, NL = Netherlands/Newfoundland) resolve ISO-first:
// the international "City, CC" convention wins over the domestic reading.
const US_STATE_TO_US = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR GU VI MP AS'.split(' '))
const CA_PROVINCE_TO_CA = new Set('ON QC BC AB MB SK NS NB NL PE YT NT NU'.split(' '))

let countryNameToCodeCache: Map<string, string> | null = null

function getCountryNameToCode(): Map<string, string> {
  if (countryNameToCodeCache) return countryNameToCodeCache
  const displayNames = new Intl.DisplayNames(['en'], { type: 'region' })
  const map = new Map<string, string>()
  for (const code of ISO_ALPHA2_CODES) {
    const name = displayNames.of(code)
    if (name && name !== code) map.set(name.toLowerCase(), code)
  }
  for (const [alias, code] of Object.entries(COUNTRY_NAME_ALIASES)) {
    map.set(alias, code)
  }
  countryNameToCodeCache = map
  return map
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Normalize an explicit country value ("de", "DE", "Germany") to ISO alpha-2. */
export function toCountryIso(value: string | null | undefined): string | null {
  const v = value?.trim()
  if (!v) return null
  if (/^[A-Za-z]{2}$/.test(v) && ISO_CODE_SET.has(v.toUpperCase())) return v.toUpperCase()
  return getCountryNameToCode().get(v.toLowerCase()) ?? null
}

/**
 * Best-effort ISO alpha-2 derivation from a free-text `location` tag.
 * Pass 1: exact comma-segment match, last segment first ("Berlin, Germany",
 * "Lisbon, PT") — exact equality avoids English-stopword false positives
 * ("shop at 5th Ave" must not yield AT). Pass 2: longest country name at word
 * boundaries anywhere in the string ("Ships from Germany").
 */
export function deriveCountryIsoFromLocation(location: string | null | undefined): string | null {
  const v = location?.trim()
  if (!v) return null

  const segments = v.split(',').map(s => s.trim()).filter(Boolean)
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]
    if (/^[A-Za-z]{2}$/.test(seg)) {
      const upper = seg.toUpperCase()
      if (ISO_CODE_SET.has(upper)) return upper
      if (US_STATE_TO_US.has(upper)) return 'US'
      if (CA_PROVINCE_TO_CA.has(upper)) return 'CA'
      continue
    }
    const hit = getCountryNameToCode().get(seg.toLowerCase())
    if (hit) return hit
  }

  const names = Array.from(getCountryNameToCode().entries())
    .sort((a, b) => b[0].length - a[0].length)
  for (const [name, code] of names) {
    if (new RegExp(`(^|[^A-Za-z])${escapeRegExp(name)}([^A-Za-z]|$)`, 'i').test(v)) return code
  }
  return null
}

// ADR-417 D1: bridge/organisation publishers name the actual seller in a
// `["p", <pubkey>, "", "seller"]` tag. Returns the first valid one, lowercased.
const HEX_PUBKEY_RE = /^[0-9a-fA-F]{64}$/
export function extractSellerPubkey(tags: string[][]): string | null {
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag[0] !== 'p' || tag[3] !== 'seller') continue
    const value = tag[1]
    if (typeof value === 'string' && HEX_PUBKEY_RE.test(value)) return value.toLowerCase()
  }
  return null
}

export interface NormalizedRemoteOffer {
  title: string
  description: string
  // ADR-277 D9.1/R2: only populated when the listing's price currency is sats/sat/msat.
  // Non-sats listings (Gamma's `price` = [amount, currency, freq?]) carry priceAmount/
  // priceCurrency instead — never coerced into priceSats, which would silently mis-price by
  // orders of magnitude (e.g. ["price","49.99","USD"] is not 49 sats).
  priceSats: number | null
  priceAmount: string | null
  priceCurrency: string | null
  // ADR-415: origin URL of the listing (first valid http(s) `r` tag), null if none.
  originUrl: string | null
  // ADR-417 D1: seller pubkey named by a `p` tag with the `seller` role, null if none.
  remoteSellerPubkey: string | null
  categoryCode: string
  gammaTags: string[]
  country: string | null
  region: string | null
  city: string | null
  offerType: string
  language: string | null
  images: string[]
  remoteRelay: string
  remoteEventId: string
  remoteAuthor: string
  fetchedAt: Date
  // ADR-277 D9.2-D9.8 (Phase R)
  productType: string | null
  physicalType: string | null
  visibility: string
  stock: number | null
  location: string | null
  geohash: string | null
  summary: string | null
  specs: ProductSpec[]
  weight: string | null
  dim: string | null
}

// ── Origin URL (ADR-415) ─────────────────────────────────────────────────────
// Merchant listings often carry the merchant's own product page as an `r` tag.
// Only http(s) URLs of sane length qualify; relay-style `wss://` tags and
// garbage are skipped. The description text is never mined for URLs.
const ORIGIN_URL_MAX_LENGTH = 2048

/** First `r` tag whose value is a valid http(s) URL (≤ 2048 chars), else null. */
export function extractOriginUrl(tags: string[][]): string | null {
  for (const tag of tags) {
    if (tag[0] !== 'r') continue
    const value = tag[1]
    if (typeof value !== 'string' || value.length > ORIGIN_URL_MAX_LENGTH) continue
    try {
      const url = new URL(value)
      if (url.protocol === 'http:' || url.protocol === 'https:') return value
    } catch {
      // Not an absolute URL — skip and continue with the next `r` tag.
    }
  }
  return null
}

/** Required tags that must be present for a valid offer */
const REQUIRED_FIELDS = ['title', 'price'] as const

/**
 * Parse a NIP-99 Kind 30402 event into a normalized offer shape.
 * Returns null if the event is missing required fields.
 */
export function normalizeOfferEvent(
  event: Event,
  relayUrl: string,
): NormalizedRemoteOffer | null {
  // Only accept Kind 30402 (NIP-99 classified listing)
  if (event.kind !== 30402) return null

  const tags = event.tags

  // Extract tag values — NIP-99 uses single-value tags
  const getTag = (name: string): string | null => {
    const tag = tags.find(t => t[0] === name)
    return tag?.[1] ?? null
  }

  const getFullTag = (name: string): string[] | null =>
    tags.find(t => t[0] === name) ?? null

  const getAllTags = (name: string): string[] =>
    tags.filter(t => t[0] === name).map(t => t[1])

  // Validate required fields
  const title = getTag('title') ?? getTag('d') // fallback to d-tag
  const priceTag = getFullTag('price')

  if (!title || !priceTag || !priceTag[1]) return null

  // ADR-277 D9.1/R2: `price` is [amount, currency, frequency?]. Only sats/sat/msat collapse
  // into priceSats — every other currency is display-only (priceAmount/priceCurrency) until
  // ADR-176 lands settlement-time conversion. Never parseInt a non-sats amount into priceSats.
  const priceAmountRaw = priceTag[1]
  const priceCurrencyRaw = priceTag[2]?.toLowerCase() || 'sats' // NIP-99 default when omitted
  if (isNaN(Number(priceAmountRaw))) return null
  let priceSats: number | null = null
  let priceAmount: string | null = null
  let priceCurrency: string | null = null
  if (SATS_CURRENCY_ALIASES.has(priceCurrencyRaw)) {
    const parsed = parseInt(priceAmountRaw, 10)
    if (isNaN(parsed) || parsed < 0) return null
    priceSats = parsed
  } else {
    priceAmount = priceAmountRaw
    priceCurrency = priceTag[2] || null
  }

  // ADR-277 D9.3: a merchant-delisted listing must not be (re-)ingested.
  const visibility = getTag('visibility') || 'on-sale'
  if (visibility === 'hidden') return null

  // Extract optional fields
  const description = event.content || getTag('description') || ''
  const summary = getTag('summary')
  // ADR-277 D2: categoryCode comes from `category` only — `t` is the
  // separate, free-form Gamma axis and must never leak into the UNSPSC slug.
  const gammaTags = normalizeGammaTags(getAllTags('t'))
  const categoryCode = getTag('category') || deriveCategoryCodeFromGammaTags(gammaTags)
  // ADR-277 D9.5 (amended 2026-08-16): foreign listings carry `location` (address)
  // + `g` (geohash), not the Colabonate-only country/region/city tags. An explicit
  // `country` tag is normalized to ISO alpha-2 ("de"/"Germany" → DE); when absent,
  // the country is derived best-effort from the free-text `location`. Geohash→country
  // is still NOT attempted (no geohash-decode/country-boundary dependency in this
  // repo) — listings with only a geohash keep country null, which is honest, not
  // silently wrong.
  const location = getTag('location')
  const country = toCountryIso(getTag('country')) ?? deriveCountryIsoFromLocation(location)
  const region = getTag('region')
  const city = getTag('city')
  const geohash = getTag('g')
  // ADR-380: a foreign Gamma listing has no Colabonate `offer_type` tag, so it
  // used to default to PRODUCT even when its tags/category place it in the
  // Services tree — invisible in the Services list and Home slider. Fall back
  // to the offerType implied by the resolved standard category. An explicit
  // `offer_type` tag always wins; a listing with no category stays PRODUCT, as
  // before (honest default, not a guess).
  const explicitOfferType = getTag('offer_type')?.toUpperCase()
  const offerType = explicitOfferType || offerTypeForCategoryCode(categoryCode)
  const language = getTag('language')

  // ADR-277 D9.7: image tag is [url, dimensions?, sort-order?] — preserve gallery order
  // instead of only ever reading position 1.
  const images = parseProductImages(tags)
    .map((img, index) => ({ ...img, sortNum: img.sort !== undefined ? Number(img.sort) : index }))
    .sort((a, b) => a.sortNum - b.sortNum)
    .map(img => img.url)

  // ADR-277 D9.2: Gamma `type` = [simple|variable|variation, digital|physical]. Map onto
  // Offer.productType/physicalType so the existing ADR-270 variation filter applies to foreign
  // listings the same way it already does for local ones.
  const typeTag = getFullTag('type')
  const productTypeRaw = typeTag?.[1]
  const physicalTypeRaw = typeTag?.[2]
  const productType = productTypeRaw && (PRODUCT_TYPES as readonly string[]).includes(productTypeRaw)
    ? productTypeRaw
    : null
  const physicalType = physicalTypeRaw && (PHYSICAL_TYPES as readonly string[]).includes(physicalTypeRaw)
    ? physicalTypeRaw
    : null

  // ADR-277 D9.4: stock: 0 must render as sold out, not as available.
  const stockStr = getTag('stock')
  const stock = stockStr !== null && !isNaN(parseInt(stockStr, 10)) ? parseInt(stockStr, 10) : null

  const specs = parseSpecs(tags)
  const weight = getTag('weight')
  const dim = getTag('dim')

  // Validate offerType
  if (offerType !== 'PRODUCT' && offerType !== 'SERVICE' && offerType !== 'ITEM') {
    // Unknown type — skip, don't ingest malformed offers
    return null
  }

  return {
    title,
    description,
    priceSats,
    priceAmount,
    priceCurrency,
    originUrl: extractOriginUrl(tags),
    remoteSellerPubkey: extractSellerPubkey(tags),
    categoryCode,
    gammaTags,
    country,
    region,
    city,
    offerType,
    language,
    images,
    remoteRelay: relayUrl,
    remoteEventId: event.id,
    remoteAuthor: event.pubkey,
    fetchedAt: new Date(),
    productType,
    physicalType,
    visibility,
    stock,
    location,
    geohash,
    summary,
    specs,
    weight,
    dim,
  }
}
