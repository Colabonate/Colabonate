/**
 * Standard Category seeding logic (ADR-078 v2).
 * Shared between prisma/seed.ts and the API seed endpoint.
 */
import type { PrismaClient } from '@prisma/client'

interface CategorySeedItem {
  id: string
  slug: string
  nameKey: string
  unspscCode?: string
  name: string
  offerType?: string
  level: number
  subcategories?: CategorySeedItem[]
}

const CATEGORIES_DATA: CategorySeedItem[] = [
  // ── GOODS ────────────────────────────────────────────────────────────────
  {
    id: 'goods', slug: 'goods', nameKey: 'goods', unspscCode: '51000000',
    name: 'Goods', offerType: 'PRODUCT', level: 1,
    subcategories: [
      {
        id: 'food-beverages', slug: 'goods/food-beverages', nameKey: 'goods.food-beverages',
        unspscCode: '50200000', name: 'Food & Beverages', offerType: 'PRODUCT', level: 2,
        subcategories: [
          { id: 'organic-food', slug: 'goods/food-beverages/organic', nameKey: 'goods.food-beverages.organic', unspscCode: '50221100', name: 'Organic Food', offerType: 'PRODUCT', level: 3 },
          { id: 'snacks', slug: 'goods/food-beverages/snacks', nameKey: 'goods.food-beverages.snacks', unspscCode: '50221200', name: 'Snacks & Confectionery', offerType: 'PRODUCT', level: 3 },
          { id: 'beverages', slug: 'goods/food-beverages/beverages', nameKey: 'goods.food-beverages.beverages', unspscCode: '50221300', name: 'Beverages', offerType: 'PRODUCT', level: 3 },
          { id: 'specialty-food', slug: 'goods/food-beverages/specialty', nameKey: 'goods.food-beverages.specialty', unspscCode: '50221400', name: 'Specialty & Gourmet', offerType: 'PRODUCT', level: 3 },
        ],
      },
      {
        id: 'electronics', slug: 'goods/electronics', nameKey: 'goods.electronics',
        unspscCode: '43210000', name: 'Electronics', offerType: 'PRODUCT', level: 2,
        subcategories: [
          { id: 'smartphones', slug: 'goods/electronics/smartphones', nameKey: 'goods.electronics.smartphones', unspscCode: '43211509', name: 'Smartphones', offerType: 'PRODUCT', level: 3 },
          { id: 'laptops', slug: 'goods/electronics/laptops', nameKey: 'goods.electronics.laptops', unspscCode: '43211500', name: 'Laptops & Computers', offerType: 'PRODUCT', level: 3 },
          { id: 'tablets', slug: 'goods/electronics/tablets', nameKey: 'goods.electronics.tablets', unspscCode: '43211510', name: 'Tablets & E-Readers', offerType: 'PRODUCT', level: 3 },
          { id: 'audio-video', slug: 'goods/electronics/audio-video', nameKey: 'goods.electronics.audio-video', unspscCode: '43211600', name: 'Audio & Video', offerType: 'PRODUCT', level: 3 },
          { id: 'cameras', slug: 'goods/electronics/cameras', nameKey: 'goods.electronics.cameras', unspscCode: '43211601', name: 'Cameras & Optics', offerType: 'PRODUCT', level: 3 },
          { id: 'accessories', slug: 'goods/electronics/accessories', nameKey: 'goods.electronics.accessories', unspscCode: '43211700', name: 'Accessories & Peripherals', offerType: 'PRODUCT', level: 3 },
        ],
      },
      {
        id: 'clothing', slug: 'goods/clothing', nameKey: 'goods.clothing',
        unspscCode: '51100000', name: 'Clothing & Apparel', offerType: 'PRODUCT', level: 2,
        subcategories: [
          { id: 'mens-clothing', slug: 'goods/clothing/mens', nameKey: 'goods.clothing.mens', unspscCode: '51101100', name: "Men's Clothing", offerType: 'PRODUCT', level: 3 },
          { id: 'womens-clothing', slug: 'goods/clothing/womens', nameKey: 'goods.clothing.womens', unspscCode: '51101200', name: "Women's Clothing", offerType: 'PRODUCT', level: 3 },
          { id: 'footwear', slug: 'goods/clothing/footwear', nameKey: 'goods.clothing.footwear', unspscCode: '51101300', name: 'Footwear', offerType: 'PRODUCT', level: 3 },
          { id: 'accessories-clothing', slug: 'goods/clothing/accessories', nameKey: 'goods.clothing.accessories', unspscCode: '51101400', name: 'Accessories', offerType: 'PRODUCT', level: 3 },
        ],
      },
      {
        id: 'home-garden', slug: 'goods/home-garden', nameKey: 'goods.home-garden',
        unspscCode: '51110000', name: 'Home & Garden', offerType: 'PRODUCT', level: 2,
        subcategories: [
          { id: 'furniture', slug: 'goods/home-garden/furniture', nameKey: 'goods.home-garden.furniture', unspscCode: '51101500', name: 'Furniture', offerType: 'PRODUCT', level: 3 },
          { id: 'kitchen', slug: 'goods/home-garden/kitchen', nameKey: 'goods.home-garden.kitchen', unspscCode: '51101600', name: 'Kitchen & Dining', offerType: 'PRODUCT', level: 3 },
          { id: 'decor', slug: 'goods/home-garden/decor', nameKey: 'goods.home-garden.decor', unspscCode: '51101700', name: 'Decor & Lighting', offerType: 'PRODUCT', level: 3 },
          { id: 'garden-supplies', slug: 'goods/home-garden/garden', nameKey: 'goods.home-garden.garden', unspscCode: '51101800', name: 'Garden & Outdoor', offerType: 'PRODUCT', level: 3 },
        ],
      },
      {
        id: 'health-beauty', slug: 'goods/health-beauty', nameKey: 'goods.health-beauty',
        unspscCode: '51120000', name: 'Health & Beauty', offerType: 'PRODUCT', level: 2,
        subcategories: [
          { id: 'skincare', slug: 'goods/health-beauty/skincare', nameKey: 'goods.health-beauty.skincare', unspscCode: '51101900', name: 'Skincare', offerType: 'PRODUCT', level: 3 },
          { id: 'supplements', slug: 'goods/health-beauty/supplements', nameKey: 'goods.health-beauty.supplements', unspscCode: '51102000', name: 'Supplements', offerType: 'PRODUCT', level: 3 },
          { id: 'personal-care', slug: 'goods/health-beauty/personal-care', nameKey: 'goods.health-beauty.personal-care', unspscCode: '51102100', name: 'Personal Care', offerType: 'PRODUCT', level: 3 },
        ],
      },
      {
        id: 'books-media', slug: 'goods/books-media', nameKey: 'goods.books-media',
        unspscCode: '51130000', name: 'Books & Media', offerType: 'PRODUCT', level: 2,
        subcategories: [
          { id: 'books', slug: 'goods/books-media/books', nameKey: 'goods.books-media.books', unspscCode: '51102200', name: 'Books', offerType: 'PRODUCT', level: 3 },
          { id: 'music', slug: 'goods/books-media/music', nameKey: 'goods.books-media.music', unspscCode: '51102300', name: 'Music', offerType: 'PRODUCT', level: 3 },
          { id: 'digital-products', slug: 'goods/books-media/digital', nameKey: 'goods.books-media.digital', unspscCode: '51102400', name: 'Digital Products', offerType: 'PRODUCT', level: 3 },
        ],
      },
    ],
  },

  // ── DIGITAL ──────────────────────────────────────────────────────────────
  {
    id: 'digital', slug: 'digital', nameKey: 'digital', unspscCode: '43000000',
    name: 'Digital', offerType: 'PRODUCT', level: 1,
    subcategories: [
      {
        id: 'software', slug: 'digital/software', nameKey: 'digital.software',
        unspscCode: '43230000', name: 'Software', offerType: 'PRODUCT', level: 2,
        subcategories: [
          { id: 'productivity', slug: 'digital/software/productivity', nameKey: 'digital.software.productivity', unspscCode: '43230100', name: 'Productivity Tools', offerType: 'PRODUCT', level: 3 },
          { id: 'dev-tools', slug: 'digital/software/dev-tools', nameKey: 'digital.software.dev-tools', unspscCode: '43230200', name: 'Development Tools', offerType: 'PRODUCT', level: 3 },
          { id: 'security', slug: 'digital/software/security', nameKey: 'digital.software.security', unspscCode: '43230300', name: 'Security Software', offerType: 'PRODUCT', level: 3 },
        ],
      },
      {
        id: 'online-courses', slug: 'digital/online-courses', nameKey: 'digital.online-courses',
        unspscCode: '85000000', name: 'Online Courses', offerType: 'PRODUCT', level: 2,
        subcategories: [
          { id: 'programming', slug: 'digital/online-courses/programming', nameKey: 'digital.online-courses.programming', unspscCode: '85101100', name: 'Programming', offerType: 'PRODUCT', level: 3 },
          { id: 'design', slug: 'digital/online-courses/design', nameKey: 'digital.online-courses.design', unspscCode: '85101200', name: 'Design', offerType: 'PRODUCT', level: 3 },
          { id: 'business', slug: 'digital/online-courses/business', nameKey: 'digital.online-courses.business', unspscCode: '85101300', name: 'Business', offerType: 'PRODUCT', level: 3 },
          { id: 'language', slug: 'digital/online-courses/language', nameKey: 'digital.online-courses.language', unspscCode: '85101400', name: 'Language Learning', offerType: 'PRODUCT', level: 3 },
        ],
      },
      {
        id: 'templates', slug: 'digital/templates', nameKey: 'digital.templates',
        unspscCode: '43240000', name: 'Templates & Assets', offerType: 'PRODUCT', level: 2,
        subcategories: [
          { id: 'web-templates', slug: 'digital/templates/web', nameKey: 'digital.templates.web', unspscCode: '43240100', name: 'Web Templates', offerType: 'PRODUCT', level: 3 },
          { id: 'graphics', slug: 'digital/templates/graphics', nameKey: 'digital.templates.graphics', unspscCode: '43240200', name: 'Graphics & Icons', offerType: 'PRODUCT', level: 3 },
          { id: 'documents', slug: 'digital/templates/documents', nameKey: 'digital.templates.documents', unspscCode: '43240300', name: 'Documents & Forms', offerType: 'PRODUCT', level: 3 },
        ],
      },
    ],
  },

  // ── SERVICES ─────────────────────────────────────────────────────────────
  {
    id: 'services', slug: 'services', nameKey: 'services', unspscCode: '81000000',
    name: 'Services', offerType: 'SERVICE', level: 1,
    subcategories: [
      {
        id: 'consulting', slug: 'services/consulting', nameKey: 'services.consulting',
        unspscCode: '81110000', name: 'Consulting', offerType: 'SERVICE', level: 2,
        subcategories: [
          { id: 'business-consulting', slug: 'services/consulting/business', nameKey: 'services.consulting.business', unspscCode: '81110100', name: 'Business Consulting', offerType: 'SERVICE', level: 3 },
          { id: 'tech-consulting', slug: 'services/consulting/tech', nameKey: 'services.consulting.tech', unspscCode: '81110200', name: 'Tech Consulting', offerType: 'SERVICE', level: 3 },
          { id: 'financial-consulting', slug: 'services/consulting/financial', nameKey: 'services.consulting.financial', unspscCode: '81110300', name: 'Financial Consulting', offerType: 'SERVICE', level: 3 },
          { id: 'legal-consulting', slug: 'services/consulting/legal', nameKey: 'services.consulting.legal', unspscCode: '81110400', name: 'Legal Consulting', offerType: 'SERVICE', level: 3 },
        ],
      },
      {
        id: 'freelance-work', slug: 'services/freelance-work', nameKey: 'services.freelance-work',
        unspscCode: '81120000', name: 'Freelance Work', offerType: 'SERVICE', level: 2,
        subcategories: [
          { id: 'writing', slug: 'services/freelance-work/writing', nameKey: 'services.freelance-work.writing', unspscCode: '81120100', name: 'Writing & Translation', offerType: 'SERVICE', level: 3 },
          { id: 'design-services', slug: 'services/freelance-work/design', nameKey: 'services.freelance-work.design', unspscCode: '81120200', name: 'Design & Creative', offerType: 'SERVICE', level: 3 },
          { id: 'programming-services', slug: 'services/freelance-work/programming', nameKey: 'services.freelance-work.programming', unspscCode: '81120300', name: 'Programming & Dev', offerType: 'SERVICE', level: 3 },
          { id: 'marketing', slug: 'services/freelance-work/marketing', nameKey: 'services.freelance-work.marketing', unspscCode: '81120400', name: 'Marketing & SEO', offerType: 'SERVICE', level: 3 },
          { id: 'video-photo', slug: 'services/freelance-work/video-photo', nameKey: 'services.freelance-work.video-photo', unspscCode: '81120500', name: 'Video & Photography', offerType: 'SERVICE', level: 3 },
        ],
      },
      {
        id: 'cleaning-maintenance', slug: 'services/cleaning-maintenance', nameKey: 'services.cleaning-maintenance',
        unspscCode: '81130000', name: 'Cleaning & Maintenance', offerType: 'SERVICE', level: 2,
        subcategories: [
          { id: 'commercial-cleaning', slug: 'services/cleaning-maintenance/commercial', nameKey: 'services.cleaning-maintenance.commercial', unspscCode: '81181500', name: 'Commercial Cleaning', offerType: 'SERVICE', level: 3 },
          { id: 'residential-cleaning', slug: 'services/cleaning-maintenance/residential', nameKey: 'services.cleaning-maintenance.residential', unspscCode: '81181600', name: 'Residential Cleaning', offerType: 'SERVICE', level: 3 },
          { id: 'property-maintenance', slug: 'services/cleaning-maintenance/property', nameKey: 'services.cleaning-maintenance.property', unspscCode: '81181700', name: 'Property Maintenance', offerType: 'SERVICE', level: 3 },
          { id: 'landscaping', slug: 'services/cleaning-maintenance/landscaping', nameKey: 'services.cleaning-maintenance.landscaping', unspscCode: '81181800', name: 'Landscaping & Grounds', offerType: 'SERVICE', level: 3 },
        ],
      },
      {
        id: 'events-entertainment', slug: 'services/events-entertainment', nameKey: 'services.events-entertainment',
        unspscCode: '81190000', name: 'Events & Entertainment', offerType: 'SERVICE', level: 2,
        subcategories: [
          { id: 'event-planning', slug: 'services/events-entertainment/planning', nameKey: 'services.events-entertainment.planning', unspscCode: '81191500', name: 'Event Planning', offerType: 'SERVICE', level: 3 },
          { id: 'catering', slug: 'services/events-entertainment/catering', nameKey: 'services.events-entertainment.catering', unspscCode: '81191600', name: 'Catering', offerType: 'SERVICE', level: 3 },
          { id: 'dj-music', slug: 'services/events-entertainment/dj-music', nameKey: 'services.events-entertainment.dj-music', unspscCode: '81191700', name: 'DJ & Live Music', offerType: 'SERVICE', level: 3 },
          { id: 'venue-rental', slug: 'services/events-entertainment/venue', nameKey: 'services.events-entertainment.venue', unspscCode: '81191800', name: 'Venue Rental', offerType: 'SERVICE', level: 3 },
        ],
      },
      {
        id: 'other-services', slug: 'services/other', nameKey: 'services.other',
        unspscCode: '81990000', name: 'Other Services', offerType: 'SERVICE', level: 2,
      },
    ],
  },
]

export async function seedStandardCategories(prisma: PrismaClient): Promise<{ count: number; byLevel: Record<number, number> }> {
  let count = 0

  async function upsertCategory(item: CategorySeedItem, parentId: string | null, sortOrder: number) {
    const dbCategory = await prisma.standardCategory.upsert({
      where: { slug: item.slug },
      update: {},
      create: {
        slug: item.slug,
        name: item.name,
        nameKey: item.nameKey,
        unspscCode: item.unspscCode,
        offerType: (item.offerType || 'SERVICE') as 'PRODUCT' | 'SERVICE',
        level: item.level,
        parentId,
        sortOrder,
      },
    })
    count++

    if (item.subcategories) {
      for (let i = 0; i < item.subcategories.length; i++) {
        await upsertCategory(item.subcategories[i], dbCategory.id, i)
      }
    }
  }

  for (let i = 0; i < CATEGORIES_DATA.length; i++) {
    await upsertCategory(CATEGORIES_DATA[i], null, i)
  }

  // Verify
  const all = await prisma.standardCategory.findMany()
  const byLevel: Record<number, number> = {}
  all.forEach(c => { byLevel[c.level] = (byLevel[c.level] || 0) + 1 })

  return { count, byLevel }
}

export { CATEGORIES_DATA }
export type { CategorySeedItem }
