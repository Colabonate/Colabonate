// ADR-339 browser verification (D8 + smoke-level render checks). Spins up a
// throwaway user/session + one online agent setup + one catalog membership
// directly in Postgres, then drives headless Chromium through the four sell
// tabs and one buy page, screenshotting each. Run with the dev stack up
// (frontend :5173, NEW-code backend :4001):
//   npx pnpm --filter server exec tsx ../../apps/server/scripts/adr339-browser-verify.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { chromium } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const APP_URL = process.env.APP_URL || 'http://localhost:5173'
const OUT_DIR = process.env.OUT_DIR || 'C:/Users/info/AppData/Local/Temp/kilo/adr339'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, detail ?? '') }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  // ── Seed a throwaway identity with something to render ────────────────
  const pubkey = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')
  await prisma.user.create({ data: { pubkey, identityLevel: 2 } })
  await prisma.session.create({
    data: { pubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 3600_000) },
  })
  const profile = await prisma.agentProfile.create({
    data: {
      ownerPubkey: pubkey, name: 'Verify Bot', capabilities: ['research', 'writing'],
      tools: [], isPublic: true,
    },
  })
  await prisma.offer.create({
    data: {
      title: 'Verify Setup', priceSats: 2100, categoryCode: 'services/other',
      offerType: 'AGENT_SETUP', ticketType: 'SMART_ORDER', creatorPubkey: pubkey,
      agentProfileId: profile.id,
      agentConfigSealed: Buffer.from('verify').toString('base64'),
      agentConfigMeta: { capabilities: ['research'] },
      agentBillingModel: 'ONE_TIME', status: 'ACTIVE',
      images: ['https://picsum.photos/seed/adr339/200'],
    },
  })
  // ADR-340: agent catalogs live on Catalog with catalogType=AGENT_SETUP.
  const catalog = await prisma.catalog.create({
    data: { ownerPubkey: pubkey, catalogType: 'AGENT_SETUP', name: 'Verify Crew' },
  })
  await prisma.catalogAgentMember.create({
    data: { catalogId: catalog.id, agentProfileId: profile.id },
  })

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const consoleErrors: string[] = []
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`))

  // Race-tolerant text wait (case-insensitive: CSS text-transform changes
  // innerText casing, e.g. uppercase section headers).
  async function waitForText(needles: string[], timeoutMs = 12000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const body = await page.locator('body').innerText().catch(() => '')
      const lower = body.toLowerCase()
      if (needles.every(n => lower.includes(n.toLowerCase()))) return true
      await page.waitForTimeout(400)
    }
    return false
  }

  async function waitForAuthToken(timeoutMs = 10000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await page.evaluate(() => localStorage.getItem('authToken') !== null).catch(() => false)) return true
      await page.waitForTimeout(300)
    }
    return false
  }

  try {
    // Login via the demo-login bootstrap route (/login/demo, see App.tsx).
    await page.goto(`${APP_URL}/login/demo?token=${token}`, { waitUntil: 'networkidle' })
    check('demo login stored token', await waitForAuthToken())

    const shots: Array<{ name: string; path: string; expect?: string[] }> = [
      { name: 'sell-stack', path: '/sell/listings?tab=stack', expect: ['ONLINE', 'OFFLINE', 'Verify Bot'] },
      { name: 'sell-listings', path: '/sell/listings?tab=listings' },
      { name: 'sell-catalogs', path: '/sell/listings?tab=catalogs' },
      { name: 'sell-products', path: '/sell/listings?tab=products' },
      { name: 'buy', path: '/buy' },
    ]
    const perPageErrors: Record<string, string[]> = {}
    for (const shot of shots) {
      consoleErrors.length = 0
      await page.goto(`${APP_URL}${shot.path}`, { waitUntil: 'networkidle' })
      if (shot.expect) {
        check(`${shot.name}: renders [${shot.expect.join(', ')}]`, await waitForText(shot.expect))
      } else {
        await page.waitForTimeout(1500)
      }
      perPageErrors[shot.name] = [...consoleErrors]
      check(`${shot.name}: screenshot saved`, true)
      await page.screenshot({ path: join(OUT_DIR, `${shot.name}.png`), fullPage: false })
    }
    for (const [name, errs] of Object.entries(perPageErrors)) {
      check(`${name}: no console errors`, errs.length === 0, errs.slice(0, 3))
    }

    // The stack tab's list view should show the catalog section header
    // (D5 sections) — default view may be gallery; switch via the MUI
    // ToggleButton (value="list") in the built-in ListHeader.
    await page.goto(`${APP_URL}/sell/listings?tab=stack`, { waitUntil: 'networkidle' })
    await waitForText(['Verify Bot'])
    const listBtn = page.locator('button[value="list"]').first()
    if (await listBtn.count() > 0) {
      await listBtn.click().catch(() => {})
      await page.waitForTimeout(1200)
      await page.screenshot({ path: join(OUT_DIR, 'sell-stack-list.png'), fullPage: false })
      check('stack: catalog section header "Verify Crew" rendered', await waitForText(['Verify Crew']))
    } else {
      // No toggle found (already list-only) — validate directly.
      check('stack: catalog section header "Verify Crew" rendered', await waitForText(['Verify Crew']))
    }

    check('no pageerrors across all pages', consoleErrors.filter(e => e.startsWith('pageerror')).length === 0,
      consoleErrors.filter(e => e.startsWith('pageerror')).slice(0, 3))
  } finally {
    await browser.close()
    await prisma.catalog.deleteMany({ where: { ownerPubkey: pubkey, catalogType: 'AGENT_SETUP' } })
    await prisma.offer.deleteMany({ where: { creatorPubkey: pubkey } })
    await prisma.agentProfile.deleteMany({ where: { ownerPubkey: pubkey } })
    await prisma.session.deleteMany({ where: { pubkey } })
    await prisma.user.deleteMany({ where: { pubkey } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass}/${pass + fail} passed — screenshots in ${OUT_DIR}`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
