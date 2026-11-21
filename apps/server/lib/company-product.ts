// ADR-395: maps the fields of a PRODUCT offer created via POST /api/offers
// (`createProduct: true`) onto the Product row it belongs to. Product keeps its
// legacy JSON-string columns (images/specs/variantAxes), so arrays/objects are
// serialized here — one place, instead of ad-hoc per call site.

export interface CompanyProductInput {
  companyId: string
  catalogId: string | null
  standardCategoryId: string | null
  name: string
  description?: unknown
  priceSats?: unknown
  stock?: unknown
  images?: unknown
  gammaTags?: string[]
  productType?: unknown
  physicalType?: unknown
  specs?: unknown
  variantAxes?: unknown
  weight?: unknown
  weightUnit?: unknown
  dimensions?: unknown
  dimensionsUnit?: unknown
  listingVisibility?: unknown
}

export interface CompanyProductData {
  companyId: string
  catalogId: string | null
  standardCategoryId: string | null
  name: string
  description: string | null
  priceSats: number
  stock: number | null
  isAvailable: boolean
  images: string | null
  gammaTags: string[]
  productType: string | null
  physicalType: string | null
  specs: string | null
  variantAxes: string | null
  weight: string | null
  weightUnit: string | null
  dimensions: string | null
  dimensionsUnit: string | null
  listingVisibility: string
}

function optionalString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

function jsonArrayOrNull(v: unknown): string | null {
  return Array.isArray(v) && v.length > 0 ? JSON.stringify(v) : null
}

export function buildCompanyProductData(input: CompanyProductInput): CompanyProductData {
  const price = typeof input.priceSats === 'number' ? input.priceSats : Number(input.priceSats)
  const stock = typeof input.stock === 'number' ? input.stock : input.stock == null || input.stock === '' ? NaN : Number(input.stock)
  return {
    companyId: input.companyId,
    catalogId: input.catalogId,
    standardCategoryId: input.standardCategoryId,
    name: input.name,
    description: optionalString(input.description),
    priceSats: Number.isFinite(price) && price > 0 ? Math.floor(price) : 0,
    stock: Number.isInteger(stock) && stock >= 0 ? stock : null,
    isAvailable: true,
    images: jsonArrayOrNull(input.images),
    gammaTags: input.gammaTags ?? [],
    productType: optionalString(input.productType),
    physicalType: optionalString(input.physicalType),
    specs: jsonArrayOrNull(input.specs),
    variantAxes: jsonArrayOrNull(input.variantAxes),
    weight: optionalString(input.weight),
    weightUnit: optionalString(input.weightUnit),
    dimensions: optionalString(input.dimensions),
    dimensionsUnit: optionalString(input.dimensionsUnit),
    listingVisibility: optionalString(input.listingVisibility) ?? 'on-sale',
  }
}
