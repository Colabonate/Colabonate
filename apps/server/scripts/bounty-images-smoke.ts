// Bounty images smoke: POST /api/agent-tasks with `images` (Offer.images
// contract — data-URL array, first = cover), validation rejections, and the
// read-back on GET / (list) + GET /:id (detail). Mirrors the
// adr319-task-allocation-smoke.ts setup pattern (minted user + session).
// Run with a server that has the bounty-images routes loaded:
//   APP_PORT=4101 npx tsx apps/server/index.ts   (throwaway instance)
//   BASE_URL=http://localhost:4101 npx tsx apps/server/scripts/bounty-images-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4101'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, detail ?? '') }
}

// 1×1 transparent PNG data URL — same shape MultiImageUploadInput emits.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function main() {
  const pubkey = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')
  await prisma.user.create({ data: { pubkey, identityLevel: 2, wallets: { create: { provider: 'WEBLN', mode: 'NON_CUSTODIAL', status: 'ACTIVE' } } } })
  await prisma.session.create({ data: { pubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 3600_000) } })
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  let taskId = ''
  try {
    let r = await fetch(`${BASE_URL}/api/agent-tasks`, {
      method: 'POST', headers,
      body: JSON.stringify({
        title: 'Bounty Images Smoke', description: 'cover photos on bounties, like an offer',
        requiredCapabilities: ['research'], budgetSats: 1000,
        images: [TINY_PNG, TINY_PNG],
      }),
    })
    const body = await r.json()
    taskId = body?.task?.id
    check('POST with 2 images -> 201', r.status === 201, body)
    check('stored images echo back as array of 2', Array.isArray(body?.task?.images) && body.task.images.length === 2, body?.task?.images)

    r = await fetch(`${BASE_URL}/api/agent-tasks?creatorPubkey=${pubkey}`)
    const listBody = await r.json()
    const listed = (listBody?.tasks ?? []).find((t: { id: string }) => t.id === taskId)
    // FU-870: list rows carry the derived thumbnail (not the original photo).
    check('GET / list row carries an images[0] thumbnail cover', r.status === 200 && Array.isArray(listed?.images) && listed.images.length === 2 && String(listed.images[0]).startsWith('data:image/'), listed?.images)

    r = await fetch(`${BASE_URL}/api/agent-tasks/${taskId}`)
    const detailBody = await r.json()
    check('GET /:id detail carries images', r.status === 200 && Array.isArray(detailBody?.task?.images) && detailBody.task.images.length === 2)

    r = await fetch(`${BASE_URL}/api/agent-tasks`, {
      method: 'POST', headers,
      body: JSON.stringify({
        title: 'Too many', description: 'over the cap', requiredCapabilities: ['research'], budgetSats: 1000,
        images: Array.from({ length: 6 }, () => TINY_PNG),
      }),
    })
    check('POST with 6 images -> 400 VALIDATION_ERROR', r.status === 400 && (await r.json())?.error === 'VALIDATION_ERROR')

    r = await fetch(`${BASE_URL}/api/agent-tasks`, {
      method: 'POST', headers,
      body: JSON.stringify({
        title: 'Bad url', description: 'not a data url', requiredCapabilities: ['research'], budgetSats: 1000,
        images: ['https://evil.example/pic.png'],
      }),
    })
    check('POST with non-data-URL image -> 400 VALIDATION_ERROR', r.status === 400 && (await r.json())?.error === 'VALIDATION_ERROR')

    r = await fetch(`${BASE_URL}/api/agent-tasks`, {
      method: 'POST', headers,
      body: JSON.stringify({ title: 'No images', description: 'omitted field stays legal', requiredCapabilities: ['research'], budgetSats: 1000 }),
    })
    const noImgBody = await r.json()
    check('POST without images still works (null column)', r.status === 201 && noImgBody?.task?.images === null)
    await prisma.agentTask.delete({ where: { id: noImgBody.task.id } })
  } finally {
    await prisma.agentTask.deleteMany({ where: { creatorPubkey: pubkey } })
    await prisma.session.deleteMany({ where: { pubkey } })
    // ADR-397 D2-B: the poster's paying wallet (Wallet has no cascade).
    await prisma.wallet.deleteMany({ where: { user: { pubkey: pubkey } } })
    await prisma.user.deleteMany({ where: { pubkey } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
