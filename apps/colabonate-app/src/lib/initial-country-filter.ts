import { COUNTRIES } from '../components/offers/offerFormConstants'

// ADR-418 D6 (FU-1019): the Search / Buy country filter starts on "All
// countries". Most listings carry no country (94 % on production), so a silent
// profile-country default hid almost everything and the userCountry pref is
// auto-derived from the browser locale for every new visitor. The scope is only
// applied when the visitor explicitly asked for it: Home's Nearby / Region
// links (`?proximity=nearby|region`). A stale or free-text pref never scopes.
export function initialCountryFilter(userCountry: string, proximity: string | null): string {
  if (proximity !== 'nearby' && proximity !== 'region') return ''
  return COUNTRIES.some(c => c.code === userCountry) ? userCountry : ''
}
