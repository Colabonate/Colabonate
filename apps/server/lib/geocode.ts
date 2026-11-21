// ADR-199: best-effort Nominatim geocoding at write time — no runtime latency on the map view.
// Returns null on any error or empty result; caller stores null silently.

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'Colabonate/1.0 (https://colabonate.app)'
const TIMEOUT_MS = 2000

export async function geocodeCity(
  city: string | null | undefined,
  country: string | null | undefined,
): Promise<{ lat: number; lng: number } | null> {
  if (!city && !country) return null
  const q = [city, country].filter(Boolean).join(', ')
  try {
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(q)}&format=json&limit=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = await res.json() as Array<{ lat: string; lon: string }>
    if (!data.length) return null
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
  } catch {
    return null
  }
}
