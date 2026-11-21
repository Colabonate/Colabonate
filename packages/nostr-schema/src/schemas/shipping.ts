// Zod schemas for Kind 30406 Shipping Option event (ADR-155).

import { z } from 'zod'

const decimalAmount = z.string().regex(/^\d+(\.\d+)?$/)
const iso4217Currency = z.string().regex(/^[A-Z]{3}$/)
const iso3166Country = z.string().regex(/^[A-Z]{2}$/)
const iso3166Region = z.string().regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/)
const geohash = z.string().regex(/^[0-9a-z]{1,12}$/)
const dimensionsLxWxH = z.string().regex(/^\d+(\.\d+)?x\d+(\.\d+)?x\d+(\.\d+)?$/)
const integerString = z.string().regex(/^\d+$/)

const ShippingServiceTypeEnum = z.enum(['standard', 'express', 'overnight', 'pickup'])
const DurationUnitEnum = z.enum(['H', 'D', 'W', 'M', 'Y'])

export const ShippingOptionEventSchema = z.object({
  kind: z.literal(30406),
  content: z.string().optional(),
  tags: z.array(z.array(z.string())).refine(
    tags => {
      const has = (name: string) => tags.some(t => t[0] === name)
      return has('d') && has('title') && has('price') && has('country') && has('service')
    },
    { message: 'Missing required tags: d, title, price, country, service' },
  ).superRefine((tags, ctx) => {
    const findFirst = (name: string) => tags.find(t => t[0] === name)

    const price = findFirst('price')
    if (price) {
      if (!decimalAmount.safeParse(price[1]).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'price amount must be decimal', path: ['price'] })
      }
      if (!iso4217Currency.safeParse(price[2]).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'price currency must be ISO-4217', path: ['price'] })
      }
    }

    const country = findFirst('country')
    if (country) {
      for (let i = 1; i < country.length; i++) {
        if (!iso3166Country.safeParse(country[i]).success) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `country[${i}] must be ISO-3166-1 alpha-2`, path: ['country'] })
        }
      }
    }

    const service = findFirst('service')
    if (service && !ShippingServiceTypeEnum.safeParse(service[1]).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'service must be standard|express|overnight|pickup', path: ['service'] })
    }

    const duration = findFirst('duration')
    if (duration) {
      if (!integerString.safeParse(duration[1]).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duration min must be integer string', path: ['duration'] })
      }
      if (!integerString.safeParse(duration[2]).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duration max must be integer string', path: ['duration'] })
      }
      if (!DurationUnitEnum.safeParse(duration[3]).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duration unit must be H|D|W|M|Y', path: ['duration'] })
      }
    }

    const region = findFirst('region')
    if (region) {
      for (let i = 1; i < region.length; i++) {
        if (!iso3166Region.safeParse(region[i]).success) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `region[${i}] must be ISO-3166-2`, path: ['region'] })
        }
      }
    }

    const g = findFirst('g')
    if (g && !geohash.safeParse(g[1]).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'geohash must be 1-12 lowercase alphanum', path: ['g'] })
    }

    for (const name of ['weight-min', 'weight-max'] as const) {
      const tag = findFirst(name)
      if (tag && !decimalAmount.safeParse(tag[1]).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${name} must be decimal`, path: [name] })
      }
    }

    for (const name of ['dim-min', 'dim-max'] as const) {
      const tag = findFirst(name)
      if (tag && !dimensionsLxWxH.safeParse(tag[1]).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${name} must be LxWxH format`, path: [name] })
      }
    }

    for (const name of ['price-weight', 'price-volume', 'price-distance'] as const) {
      const tag = findFirst(name)
      if (tag) {
        if (!decimalAmount.safeParse(tag[1]).success) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${name} amount must be decimal`, path: [name] })
        }
        if (!iso4217Currency.safeParse(tag[2]).success) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${name} currency must be ISO-4217`, path: [name] })
        }
      }
    }
  }),
})

export function validateShippingOption(event: unknown) {
  return ShippingOptionEventSchema.safeParse(event)
}
