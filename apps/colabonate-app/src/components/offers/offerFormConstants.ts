// Category definitions derived from packages/data/categories/categories-v2.json (ADR-078)
// Single source of truth – consumed by Offers.tsx, Home.tsx, CreateOfferModal.tsx
//
// JSON import via @ds/data workspace package (Vite resolves JSON natively).
// CATEGORY_DEFS is auto-derived at module load — edit categories-v2.json to change.
//
// ADR-078: 3 root categories (Goods, Digital, Services). Cooperation is now services/cooperation (Level-2).

import categoriesJson from '@ds/data/categories'
import countriesJson from '@ds/data/countries'

// ─── JSON Schema Types ────────────────────────────────────────────────────────

interface SubcategoryEntry {
  id: string
  slug: string
  nameKey: string
  unspscCode: string
  name: string
  level: number
  subcategories?: SubcategoryEntry[]
}

interface CategoryEntry {
  id: string
  slug: string
  nameKey: string
  unspscCode: string
  name: string
  offerType: 'PRODUCT' | 'SERVICE'
  level: number
  subcategories?: SubcategoryEntry[]
}

interface CategoriesData {
  version: string
  standard: string
  standardVersion: string
  maxLevel: number
  categories: CategoryEntry[]
}

const categoriesData = categoriesJson as unknown as CategoriesData

export interface MilestoneFormItem {
  title: string
  description: string
  percentage: number
  // FU-483 (ADR-328 D2): set when this milestone came from the Coop Guide's
  // Agent Orchestration Match-Preview step — POST /api/cooperations passes
  // it straight through onto CoopMilestone.assigneeAgentProfileId.
  assigneeAgentProfileId?: string
  // ADR-332 D2 (V2 nested pipeline): agent work steps INSIDE this milestone.
  // The milestone stays the escrow unit; steps carry capabilities + per-step
  // agent assignment. Absent/empty = human milestone (mixed flows allowed).
  // Only authored in the Coop Guide's agent flow — the plain offers flow
  // never touches it.
  steps?: MilestoneStepDraft[]
}

// ADR-332 D2: one unit of agent work inside a milestone. Client-side subset
// of the server's CoopMilestoneStep (no ids — order is array position).
export interface MilestoneStepDraft {
  title: string
  requiredCapabilities: string[]
  assigneeAgentProfileId?: string
  // ADR-352 D1a (FU-606): the specific Offer backing assigneeAgentProfileId
  // (AgentProfile<->Offer is many-to-one — the execution Workspace anchors to
  // an Offer, not just the profile). Set alongside assigneeAgentProfileId
  // whenever the Match-Preview step assigns a candidate.
  assigneeOfferId?: string
}

// ─── Category Definitions (derived from JSON) ─────────────────────────────────

export type OfferType = 'ITEM' | 'PRODUCT' | 'SERVICE'

/** Derived from categories-v1.json — single source of truth */
export const CATEGORY_DEFS = categoriesData.categories.map(c => ({
  id: c.id,
  name: c.name,
  nameKey: c.nameKey,
  unspscCode: c.unspscCode,
  offerType: c.offerType as OfferType,
  itemOfferType: (c.offerType === 'SERVICE' ? 'SERVICE' : 'ITEM') as 'ITEM' | 'SERVICE',
}))

export type OfferCategory = (typeof CATEGORY_DEFS)[number]['name']

/** Subcategories per parent category (flat level-2 map) */
export const SUBCATEGORY_MAP: Record<string, readonly { id: string; name: string; unspscCode: string }[]> =
  Object.fromEntries(
    categoriesData.categories.map(c => [
      c.name,
      (c.subcategories ?? []).map(sub => ({
        id: sub.id,
        name: sub.name,
        unspscCode: sub.unspscCode,
      })),
    ]),
  )

/** Category names as string array (DB-compatible values) */
export const CATEGORIES: readonly string[] = CATEGORY_DEFS.map(c => c.name)

/** Filter tabs including 'all' – for Offers.tsx / Home.tsx.
 *  Labels use nameKey for i18n (ADR-078). Consumers should call t(label) at render time. */
export const OFFER_FILTER_TABS = [
  { id: 'all', nameKey: 'common.all', label: 'All' },
  ...CATEGORY_DEFS.map(c => ({ id: c.name, nameKey: c.nameKey, label: c.name })),
]

/** MUI Chip color map – derived from categories-v2.json (ADR-078) */
export const CATEGORY_COLOR_MAP: Record<string, 'default' | 'primary' | 'secondary' | 'info' | 'success'> = {
  ...Object.fromEntries(
    categoriesData.categories
      .filter((c): c is CategoryEntry & { color: string } => 'color' in c && typeof c.color === 'string')
      .map(c => [c.name, c.color as 'default' | 'primary' | 'secondary' | 'info' | 'success']),
  ),
  all: 'default',
}

/**
 * Derive offerType from category + company context (ADR-078).
 *
 * | Category          | Private (no companyId) | Corporate (companyId set) |
 * |-------------------|------------------------|---------------------------|
 * | Goods, Digital     | ITEM                   | PRODUCT                   |
 * | Services           | SERVICE                | SERVICE                   |
 *
 * Note: ADR-078 merged Cooperation into services/cooperation (Level-2).
 *       At the root level there are only 3 categories: Goods, Digital, Services.
 *
 * @param category  – Display name from CATEGORY_DEFS (e.g. 'Goods', 'Services')
 * @param companyId – When set → corporate context → PRODUCT for goods/digital
 */
export function deriveOfferType(
  category: string,
  companyId?: string | null,
): OfferType {
  const catDef = CATEGORY_DEFS.find(c => c.name === category)
  if (!catDef) return 'SERVICE' // safe fallback

  // Services → always SERVICE regardless of context (includes Cooperation per ADR-078)
  if (catDef.offerType === 'SERVICE') return 'SERVICE'

  // Goods & Digital → context-dependent
  return companyId ? 'PRODUCT' : 'ITEM'
}

/**
 * Get the offerType for a categoryCode slug (ADR-078).
 * Parses the first segment (e.g. 'goods' → PRODUCT, 'services' → SERVICE, 'digital' → PRODUCT).
 */
export function offerTypeFromCategoryCode(categoryCode: string): OfferType {
  const root = categoryCode.split('/')[0]
  if (root === 'services') return 'SERVICE'
  return 'PRODUCT' // goods, digital → PRODUCT (or ITEM if no companyId)
}

// ─── OfferType Badge Styles ──────────────────────────────────────────────────

export const OFFER_TYPE_BADGE_STYLES: Record<OfferType, string> = {
  ITEM:    'bg-[rgba(237,137,54,0.12)] text-[#C05621] border-[rgba(237,137,54,0.28)]',
  PRODUCT: 'bg-[rgba(72,187,120,0.12)] text-[#276749] border-[rgba(72,187,120,0.28)]',
  SERVICE: 'bg-[rgba(99,179,237,0.12)] text-(--color-primary-60) border-[rgba(99,179,237,0.28)]',
}

// ─── Milestone Defaults ───────────────────────────────────────────────────────

export const DEFAULT_MILESTONES: MilestoneFormItem[] = [
  { title: '', description: '', percentage: 50 },
  { title: '', description: '', percentage: 50 },
]

// ─── Country Reference Data (ADR-139) ────────────────────────────────────────

interface CountryEntry {
  code: string
  name: string
  nameDe: string
  region: string
}

export const COUNTRIES: readonly CountryEntry[] = countriesJson as CountryEntry[]

/**
 * Resolve a stored country value (ISO code like "DE" or a name like "Germany",
 * as the free-text location forms wrote it) to an ISO code, or '' when unknown (ADR-420).
 */
export function countryCodeFromText(value: string | null | undefined): string {
  const v = value?.trim()
  if (!v) return ''
  const upper = v.toUpperCase()
  const byCode = COUNTRIES.find(c => c.code === upper)
  if (byCode) return byCode.code
  const lower = v.toLowerCase()
  return COUNTRIES.find(c => c.name.toLowerCase() === lower || c.nameDe.toLowerCase() === lower)?.code ?? ''
}

export const COUNTRY_OPTIONS = COUNTRIES.map(c => ({
  value: c.code,
  label: c.name,
}))

// ─── Language Reference Data (ADR-139) ───────────────────────────────────────

export const LANGUAGE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'English' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'it', label: 'Italiano' },
  { value: 'pt', label: 'Português' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'pl', label: 'Polski' },
  { value: 'tr', label: 'Türkçe' },
  { value: 'ru', label: 'Русский' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'zh', label: '中文' },
  { value: 'ar', label: 'العربية' },
  { value: 'hi', label: 'हिन्दी' },
]

export function getBrowserLanguage(): string {
  const lang = navigator.language || 'en'
  const match = LANGUAGE_OPTIONS.find(o => o.value === lang)
  if (match) return match.value
  const prefix = lang.split('-')[0]
  const prefixMatch = LANGUAGE_OPTIONS.find(o => o.value === prefix)
  return prefixMatch ? prefixMatch.value : 'en'
}

/** Best-effort country code from the browser locale region subtag (e.g. "de-DE" → "DE"),
 * validated against the supported country list. Returns '' when no known region is present. */
export function getBrowserCountry(): string {
  if (typeof navigator === 'undefined') return ''
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const lang of langs) {
    if (!lang) continue
    for (const part of lang.split('-').slice(1)) {
      const region = part.toUpperCase()
      if (region.length === 2 && COUNTRIES.some(c => c.code === region)) return region
    }
  }
  return ''
}
