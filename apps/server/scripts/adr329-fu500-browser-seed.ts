// ADR-329 FU-500 browser seed: mirrors the adr329-tickettype-smoke prisma
// pattern, creates one SMART_ORDER and one MILESTONE cooperation, prints
// their IDs. No cleanup — the Python verify script handles it.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const prisma = new PrismaClient({ adapter })

  const pubkey = randomBytes(32).toString('hex')
  await prisma.user.create({ data: { pubkey } })
  console.log(`Seeding as pubkey=${pubkey}`)

  const smart = await prisma.cooperation.create({
    data: {
      title: 'FU-500 browser-verify SMART_ORDER',
      description: 'Seeded by FU-500 browser-verify.',
      initiatorPubkey: pubkey,
      cooperationType: 'SERVICE',
      budgetSats: 100000,
      partnerMode: 'WHOLE',
      status: 'OPEN',
      ticketType: 'SMART_ORDER',
      visibility: 'PUBLIC',
    },
  })
  const start = Math.round(100000 * 0.25)
  const progress = Math.round(100000 * 0.5)
  await prisma.coopMilestone.createMany({
    data: [
      { cooperationId: smart.id, milestoneIndex: 1, title: 'Start', amountSats: start, status: 'PENDING' },
      { cooperationId: smart.id, milestoneIndex: 2, title: 'Progress', amountSats: progress, status: 'PENDING' },
      { cooperationId: smart.id, milestoneIndex: 3, title: 'Completion', amountSats: 100000 - start - progress, status: 'PENDING' },
    ],
  })

  const milestone = await prisma.cooperation.create({
    data: {
      title: 'FU-500 browser-verify MILESTONE',
      description: 'Seeded by FU-500 browser-verify.',
      initiatorPubkey: pubkey,
      cooperationType: 'SERVICE',
      budgetSats: 100000,
      partnerMode: 'WHOLE',
      status: 'OPEN',
      ticketType: 'MILESTONE',
      visibility: 'PUBLIC',
    },
  })
  await prisma.coopMilestone.createMany({
    data: [
      { cooperationId: milestone.id, milestoneIndex: 1, title: 'Design', amountSats: 40000, status: 'PENDING' },
      { cooperationId: milestone.id, milestoneIndex: 2, title: 'Build', amountSats: 60000, status: 'PENDING' },
    ],
  })

  writeFileSync('/tmp/kilo/adr329-fu500-seed.json', JSON.stringify({ smartId: smart.id, milestoneId: milestone.id, pubkey }))
  console.log(`SMART_ORDER coop=${smart.id}`)
  console.log(`MILESTONE  coop=${milestone.id}`)
  await prisma.$disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })