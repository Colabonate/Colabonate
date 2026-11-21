// ADR-402 D15/D16 — newsletter consent + self-service, live HTTP smoke.
//
// Covers: opt-in bound to the magic-link token (no row at /send, forged opt-in
// ignored), confirm on verify, /api/newsletter/me read/unsubscribe/subscribe,
// GET links never change state, POST unsubscribe, footer re-subscribe keeps
// the suppression marker, account deletion removes newsletter rows.
//
// Run against a throwaway server (dev mode, no mail transport, so /send
// returns a debugLink and no email leaves the machine):
//   APP_PORT=4098 RESEND_API_KEY= SMTP_HOST= NODE_ENV=development npx tsx index.ts
//   BASE_URL=http://localhost:4098 npx tsx scripts/adr402-newsletter-consent-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { randomBytes } from 'node:crypto'
import { deleteUserAccount } from '../services/account-deletion.js'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4098'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d?: unknown) => {
  ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${n}`, ok ? '' : JSON.stringify(d))
}

const tag = randomBytes(4).toString('hex')
const EMAIL_A = `adr402-a-${tag}@example.com`
const EMAIL_V = `adr402-victim-${tag}@example.com`
const EMAIL_F = `adr402-footer-${tag}@example.com`
const createdPubkeys: string[] = []

async function sendLink(email: string, newsletterOptIn?: boolean): Promise<string> {
  const pubkey = randomBytes(32).toString('hex')
  const r = await fetch(`${BASE_URL}/api/auth/email/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, pubkey, ...(newsletterOptIn !== undefined ? { newsletterOptIn } : {}) }),
  })
  const j = (await r.json()) as { debugLink?: string }
  const token = j.debugLink ? new URL(j.debugLink).searchParams.get('token') : null
  if (!token) throw new Error(`no debugLink for ${email} (status ${r.status}) — is the server in dev mode without mail transport?`)
  return token
}

async function verify(token: string): Promise<{ token: string; pubkey: string }> {
  const r = await fetch(`${BASE_URL}/api/auth/email/verify?token=${encodeURIComponent(token)}`)
  const j = (await r.json()) as { token: string; pubkey: string }
  createdPubkeys.push(j.pubkey)
  return j
}

const row = (email: string) => prisma.newsletterSubscriber.findUnique({ where: { email } })

async function me(session: string, path = '', body?: unknown) {
  const r = await fetch(`${BASE_URL}/api/newsletter/me${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: r.status, json: (await r.json()) as { addresses?: Array<{ email: string; status: string }> } }
}

async function main() {
  console.log('1) opt-in is bound to the magic-link token')
  await sendLink(EMAIL_A, true)
  check('/send with opt-in writes no subscriber row', (await row(EMAIL_A)) === null)
  const userA = await prisma.user.findUnique({ where: { email: EMAIL_A } })
  check('opt-in stored next to the token', userA?.magicLinkNewsletterOptIn === 'signup-email', userA?.magicLinkNewsletterOptIn)
  const tokA = await sendLink(EMAIL_A, true)
  const sessA = await verify(tokA)
  const rA = await row(EMAIL_A)
  check('verify of that token confirms the subscription', rA?.status === 'CONFIRMED', rA?.status)
  check('consent proof recorded', !!rA?.consentAt && rA?.consentSource === 'signup-email' && !!rA?.consentTextVersion, rA)
  const userA2 = await prisma.user.findUnique({ where: { email: EMAIL_A } })
  check('opt-in cleared after verify', userA2?.magicLinkNewsletterOptIn === null, userA2?.magicLinkNewsletterOptIn)

  console.log('2) forged opt-in by a third party is ignored')
  await sendLink(EMAIL_V, true) // attacker ticks the box for the victim's address
  const tokV = await sendLink(EMAIL_V) // victim requests an ordinary link
  await verify(tokV)
  check('victim sign-in without opt-in creates no subscription', (await row(EMAIL_V)) === null)

  console.log('3) /api/newsletter/me self-service')
  const m1 = await me(sessA.token)
  check('GET /me shows the account email as CONFIRMED', m1.json.addresses?.[0]?.status === 'CONFIRMED', m1.json)
  const m2 = await me(sessA.token, '/unsubscribe', {})
  check('POST /me/unsubscribe → UNSUBSCRIBED', m2.json.addresses?.[0]?.status === 'UNSUBSCRIBED', m2.json)
  const m3 = await me(sessA.token, '/subscribe', {})
  check('POST /me/subscribe for a verified account email → CONFIRMED', m3.json.addresses?.[0]?.status === 'CONFIRMED', m3.json)
  const rA3 = await row(EMAIL_A)
  check('re-subscribe records settings consent', rA3?.consentSource === 'settings', rA3?.consentSource)
  const m4 = await me(sessA.token, '/unsubscribe', { email: EMAIL_V })
  check('cannot unsubscribe an address that is not bound to the caller', m4.status === 403, m4)
  const anon = await fetch(`${BASE_URL}/api/newsletter/me`)
  check('GET /me without session → 401', anon.status === 401, anon.status)
  const sessV = (await prisma.session.findFirst({ where: { pubkey: createdPubkeys[1] }, orderBy: { createdAt: 'desc' } }))?.token
  const mV = sessV ? await me(sessV) : null
  check('account email without opt-in is shown as NOT_SUBSCRIBED', mV?.json.addresses?.[0]?.status === 'NOT_SUBSCRIBED', mV?.json)
  const mV2 = sessV ? await me(sessV, '/unsubscribe', {}) : null
  const rV = await row(EMAIL_V)
  check('opting out of an account-only email creates a suppression row', rV?.status === 'UNSUBSCRIBED' && mV2?.status === 200, rV)

  console.log('4) email links: GET never changes state, POST does')
  const tA = (await row(EMAIL_A))!.token
  const g = await fetch(`${BASE_URL}/api/newsletter/unsubscribe?token=${encodeURIComponent(tA)}`)
  const gHtml = await g.text()
  check('GET /unsubscribe renders a page with a POST button', g.status === 200 && gHtml.includes('method="post"'), g.status)
  check('GET /unsubscribe did not unsubscribe', (await row(EMAIL_A))?.status === 'CONFIRMED')
  const p = await fetch(`${BASE_URL}/api/newsletter/unsubscribe?token=${encodeURIComponent(tA)}`, { method: 'POST' })
  check('POST /unsubscribe unsubscribes', p.status === 200 && (await row(EMAIL_A))?.status === 'UNSUBSCRIBED', p.status)

  console.log('5) footer re-subscribe keeps the suppression marker until confirmed')
  const f1 = await fetch(`${BASE_URL}/api/newsletter`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL_A }),
  })
  const rF = await row(EMAIL_A)
  check('footer POST → PENDING with unsubscribedAt kept', f1.status === 201 && rF?.status === 'PENDING' && !!rF?.unsubscribedAt, rF)
  const c1 = await fetch(`${BASE_URL}/api/newsletter/confirm?token=${encodeURIComponent(rF!.token)}`)
  check('GET /confirm did not confirm', c1.status === 200 && (await row(EMAIL_A))?.status === 'PENDING')
  const c2 = await fetch(`${BASE_URL}/api/newsletter/confirm?token=${encodeURIComponent(rF!.token)}`, { method: 'POST' })
  const rC = await row(EMAIL_A)
  check('POST /confirm confirms and clears the marker', c2.status === 200 && rC?.status === 'CONFIRMED' && rC?.unsubscribedAt === null, rC)

  console.log('6) footer signup records consent')
  await fetch(`${BASE_URL}/api/newsletter`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL_F }),
  })
  const rFooter = await row(EMAIL_F)
  check('footer row is PENDING with footer consent', rFooter?.status === 'PENDING' && rFooter?.consentSource === 'footer', rFooter)

  console.log('7) account deletion removes newsletter rows')
  await deleteUserAccount(prisma, sessA.pubkey)
  check('newsletter row of the deleted account is gone', (await row(EMAIL_A)) === null)
}

main()
  .catch((e) => { fail++; console.error(e) })
  .finally(async () => {
    // cleanup — best effort
    await prisma.newsletterSubscriber.deleteMany({ where: { email: { in: [EMAIL_A, EMAIL_V, EMAIL_F] } } }).catch(() => {})
    for (const pk of createdPubkeys) {
      await prisma.session.deleteMany({ where: { pubkey: pk } }).catch(() => {})
      await prisma.user.deleteMany({ where: { pubkey: pk } }).catch(() => {})
    }
    await prisma.user.deleteMany({ where: { email: { in: [EMAIL_A, EMAIL_V] } } }).catch(() => {})
    await prisma.$disconnect()
    await pool.end()
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail ? 1 : 0)
  })
