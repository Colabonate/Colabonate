import { toCountryIso, deriveCountryIsoFromLocation } from '../services/nostr-normalizer.js'

// ADR-420: `Offer.country` is the column every country filter, facet and
// search index reads, and it must hold an ISO 3166-1 alpha-2 code. Clients
// differ in what they send (an ISO code from the wizard, a free-text name
// like "Germany" from the service/listing forms, or only the `location` text),
// so the server normalizes instead of trusting each form.
//
// Result semantics (mirrors resolveCategoryCode: undefined = leave alone):
//  - country undefined, location resolvable  → the derived ISO code
//  - country undefined, nothing derivable    → undefined (skip)
//  - country null or ''                      → null (explicit clear)
//  - country a resolvable string             → ISO code
//  - anything else                           → error (stored raw it would be
//                                              invisible to every country filter)
export type OfferCountryResolution =
  | { ok: true; country: string | null | undefined }
  | { ok: false; message: string }

export function resolveOfferCountry(country: unknown, location: unknown): OfferCountryResolution {
  if (country === undefined) {
    const derived = typeof location === 'string' ? deriveCountryIsoFromLocation(location) : null
    return { ok: true, country: derived ?? undefined }
  }
  if (country === null) return { ok: true, country: null }
  if (typeof country !== 'string') {
    return { ok: false, message: 'country must be a string (ISO 3166-1 alpha-2 code or country name)' }
  }
  if (country.trim() === '') return { ok: true, country: null }
  const iso = toCountryIso(country)
  if (!iso) {
    return { ok: false, message: `Unknown country "${country.trim().slice(0, 60)}". Use an ISO 3166-1 alpha-2 code (e.g. DE) or the English country name.` }
  }
  return { ok: true, country: iso }
}
