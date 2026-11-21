import { API_BASE } from '../config.js';
import type { CategorySlug } from './system-prompt.js';

// Assistant plan F8 — the offer-category slug list in the prompt used to be
// hardcoded and drifted from the taxonomy (create_offer then failed with
// INVALID_CATEGORY_CODE). Load the real level-2 slugs from the API once and
// cache them; the prompt builder falls back to a static list only when this
// fetch never succeeds.

const TTL_MS = 10 * 60 * 1000;
// The taxonomy only fills a cached slug list. Bound the fetch so a degraded API
// (connection open, no response) can never block a chat turn — the prompt
// builder falls back to its static list on timeout.
const FETCH_TIMEOUT_MS = 2500;

let cache: { at: number; slugs: CategorySlug[] } | null = null;
let inflight: Promise<CategorySlug[]> | null = null;

export async function getCategorySlugs(): Promise<CategorySlug[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.slugs;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/standard-categories/tree/flat`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return cache?.slugs ?? [];
      const data = (await res.json()) as {
        standardCategories?: Array<{ slug?: string; level?: number; offerType?: string }>;
      };
      const slugs = (data.standardCategories ?? [])
        .filter((c) => c.level === 2 && typeof c.slug === 'string')
        .map((c) => ({ slug: c.slug as string, offerType: c.offerType }));
      if (slugs.length > 0) cache = { at: Date.now(), slugs };
      return slugs.length > 0 ? slugs : (cache?.slugs ?? []);
    } catch {
      // Network/API failure: serve the stale cache; the builder falls back if empty.
      return cache?.slugs ?? [];
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
