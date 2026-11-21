/**
 * Migration script: Create Offers for existing Products without linked Offers.
 * ADR-066 – Sell Company Context Consolidation
 *
 * This script finds all Products where offerId is null and creates a linked Offer.
 * Run: npx tsx scripts/migrate-products-to-offers.ts
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'

const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL || 'file:./dev.db' })
const prisma = new PrismaClient({ adapter })

async function main() {
  // Find all products without a linked offer
  const productsWithoutOffers = await prisma.product.findMany({
    where: { offerId: null },
    include: {
      category: {
        include: {
          catalog: {
            include: { company: true }
          }
        }
      }
    }
  })

  console.log(`Found ${productsWithoutOffers.length} Products without linked Offers`)

  let created = 0
  let skipped = 0

  for (const product of productsWithoutOffers) {
    const company = product.category.catalog.company

    if (!company) {
      console.warn(`  SKIP product=${product.id} — no company associated with catalog`)
      skipped++
      continue
    }

    // Get UNSPSC code from category if available
    const categoryCode = product.category.unspscCode || null

    try {
      // Create the Offer
      const offer = await prisma.offer.create({
        data: {
          title: product.name,
          description: product.description || null,
          priceSats: product.priceSats,
          category: product.category.name,
          categoryCode,
          creatorPubkey: company.ownerPubkey,
          companyId: company.id,
          offerType: 'PRODUCT',
          status: product.isAvailable ? 'ACTIVE' : 'DRAFT',
          productId: product.id
        }
      })

      // Update product with offerId
      await prisma.product.update({
        where: { id: product.id },
        data: { offerId: offer.id }
      })

      console.log(`  CREATED offer=${offer.id} for product=${product.id}`)
      created++
    } catch (error) {
      console.error(`  ERROR product=${product.id}:`, error)
      skipped++
    }
  }

  console.log(`\nDone: ${created} Offers created, ${skipped} skipped`)

  // Summary
  const totalProducts = await prisma.product.count()
  const productsWithOffers = await prisma.product.count({ where: { offerId: { not: null } } })
  console.log(`Total Products: ${totalProducts}, Products with Offers: ${productsWithOffers}`)
}

main()
  .catch(err => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
