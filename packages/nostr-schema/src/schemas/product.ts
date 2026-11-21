// Zod schemas for Kind 30402 Product Listing (variations) + Kind 30405
// Product Collection (ADR-156).

import { z } from 'zod'

const decimalAmount = z.string().regex(/^\d+(\.\d+)?$/)
const iso4217Currency = z.string().regex(/^[A-Z]{3}$/)
const geohash = z.string().regex(/^[0-9a-z]{1,12}$/)
const dimensionsLxWxH = z.string().regex(/^\d+(\.\d+)?x\d+(\.\d+)?x\d+(\.\d+)?$/)
const integerString = z.string().regex(/^\d+$/)
const addressableFormat = z.string().regex(/^\d+:[0-9a-f]{64}:[a-zA-Z0-9_-]+$/)

const ProductTypeEnum = z.enum(['simple', 'variable', 'variation'])
const PhysicalTypeEnum = z.enum(['digital', 'physical'])
const ListingVisibilityEnum = z.enum(['hidden', 'on-sale', 'pre-order'])

export const ProductListingEventSchema = z.object({
  kind: z.literal(30402),
  content: z.string().optional(),
  tags: z.array(z.array(z.string())).refine(
    tags => {
      const has = (name: string) => tags.some(t => t[0] === name)
      return has('d') && has('title') && has('price')
    },
    { message: 'Missing required tags: d, title, price' },
  ).superRefine((tags, ctx) => {
    const findFirst = (name: string) => tags.find(t => t[0] === name)
    const findAll = (name: string) => tags.filter(t => t[0] === name)

    const price = findFirst('price')
    if (price) {
      if (!decimalAmount.safeParse(price[1]).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'price amount must be decimal', path: ['price'] })
      }
      if (!iso4217Currency.safeParse(price[2]).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'price currency must be ISO-4217', path: ['price'] })
      }
    }

    const type = findFirst('type')
    if (type) {
      if (!ProductTypeEnum.safeParse(type[1]).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'type must be simple|variable|variation', path: ['type'] })
      }
      if (type[2] && !PhysicalTypeEnum.safeParse(type[2]).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'physical type must be digital|physical', path: ['type'] })
      }
    }

    const variation = type && type[1] === 'variation'
    const parentRefs = findAll('a').filter(t => t[1]?.startsWith('30402:'))
    if (variation && parentRefs.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'variation products must have a parent 30402 a-tag ref', path: ['a'] })
    }

    for (const aTag of findAll('a')) {
      if (aTag[1] && !addressableFormat.safeParse(aTag[1]).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `a-tag "${aTag[1]}" must be addressable format`, path: ['a'] })
      }
    }

    const stock = findFirst('stock')
    if (stock && !integerString.safeParse(stock[1]).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'stock must be integer string', path: ['stock'] })
    }

    const vis = findFirst('visibility')
    if (vis && !ListingVisibilityEnum.safeParse(vis[1]).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'visibility must be hidden|on-sale|pre-order', path: ['visibility'] })
    }

    const weight = findFirst('weight')
    if (weight && !decimalAmount.safeParse(weight[1]).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'weight must be decimal', path: ['weight'] })
    }

    const dim = findFirst('dim')
    if (dim && !dimensionsLxWxH.safeParse(dim[1]).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'dim must be LxWxH format', path: ['dim'] })
    }

    const g = findFirst('g')
    if (g && !geohash.safeParse(g[1]).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'geohash must be 1-12 lowercase alphanum', path: ['g'] })
    }

    for (const soTag of findAll('shipping_option')) {
      if (soTag[1]) {
        const parts = soTag[1].split(':')
        if (parts.length !== 3 || (parts[0] !== '30406' && parts[0] !== '30405')) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `shipping_option "${soTag[1]}" must be 30406|30405:pk:d`, path: ['shipping_option'] })
        }
      }
      if (soTag[2] && !decimalAmount.safeParse(soTag[2]).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'shipping_option extra_cost must be decimal', path: ['shipping_option'] })
      }
    }
  }),
})

export const ProductCollectionEventSchema = z.object({
  kind: z.literal(30405),
  content: z.string().optional(),
  tags: z.array(z.array(z.string())).refine(
    tags => {
      const has = (name: string) => tags.some(t => t[0] === name)
      const hasProductRef = tags.some(t => t[0] === 'a' && t[1]?.startsWith('30402:'))
      return has('d') && has('title') && hasProductRef
    },
    { message: 'Missing required tags: d, title, and at least one 30402 a-tag product ref' },
  ).superRefine((tags, ctx) => {
    const findFirst = (name: string) => tags.find(t => t[0] === name)
    const findAll = (name: string) => tags.filter(t => t[0] === name)

    for (const aTag of findAll('a')) {
      if (aTag[1] && !addressableFormat.safeParse(aTag[1]).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `a-tag "${aTag[1]}" must be addressable format`, path: ['a'] })
      }
    }

    const image = findFirst('image')
    if (image && image[1]) {
      if (!z.string().url().safeParse(image[1]).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'image must be valid URL', path: ['image'] })
      }
    }

    const g = findFirst('g')
    if (g && !geohash.safeParse(g[1]).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'geohash must be 1-12 lowercase alphanum', path: ['g'] })
    }

    for (const soTag of findAll('shipping_option')) {
      if (soTag[1] && !addressableFormat.safeParse(soTag[1].replace('30406:', '30406:')).success) {
        const parts = soTag[1].split(':')
        if (parts.length !== 3 || parts[0] !== '30406') {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `shipping_option must be 30406:pk:d format`, path: ['shipping_option'] })
        }
      }
    }
  }),
})

export function validateProductListing(event: unknown) {
  return ProductListingEventSchema.safeParse(event)
}

export function validateProductCollection(event: unknown) {
  return ProductCollectionEventSchema.safeParse(event)
}
