/**
 * Incident cleanup, 2026-11-20 (ADR-412 amendment follow-up): the first run of
 * `backfill-offer-nostr-publish.ts --all` had no LOCAL-only filter, so for
 * ~8 minutes it re-published REMOTE (foreign, ingested) listings under
 * Colabonate-custodied signing keys — each duplicate carrying our `client`
 * tag and overwriting `Offer.nostrEventId` (which had held the ORIGINAL
 * foreign event id). The run was killed; this script cleans up what shipped.
 *
 * For every affected offer (REMOTE, nostrEventId ≠ the RemoteOfferCandidate's
 * original remoteEventId, updated inside the incident window):
 *   1. publish one NIP-09 Kind-5 deletion — signed by the SAME signing key
 *      that signed the duplicates (resolveOfferSigningKey, same path as the
 *      accidental publish) — with an `e` tag for the stored 30402 event id
 *      and `a` tags for both coordinates (30402 + 30017 twin).
 *   2. restore `Offer.nostrEventId` to the candidate's `remoteEventId`.
 *
 * The original foreign listings (published by their real authors) are NOT
 * touched — only OUR duplicate coordinates are deleted.
 *
 * Dry-run by default; `--apply` executes. Runs against the DATABASE_URL in
 * .env (root):
 *   npx tsx apps/server/scripts/cleanup-remote-republish.ts [--apply]
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { finalizeEvent } from 'nostr-tools'

const __rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
dotenv.config({ path: resolve(__rootDir, '.env') })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { nostrService } from '../services/nostr-relay.js'
import { resolveOfferSigningKey, hasSigningIdentityKey } from '../services/nostr-signing-identity.js'

// Incident window: default covers the faulty run 2026-11-20T16:05Z–16:13Z
// (killed). `--since=<ISO>` / `--until=<ISO>` (or INCIDENT_SINCE /
// INCIDENT_UNTIL env) narrow it for a surgical re-run — DB evidence showed
// 5 rows outside the real incident minutes whose nostrEventId differs from
// the candidate for unrelated, historical reasons (foreign author
// re-publishes); those must not be "cleaned". Healthy rows always have
// nostrEventId == remoteEventId. Args beat env: passing env through
// `ssh … docker compose exec … sh -c` proved flaky on this host (2026-11-20).
const argFor = (name: string): string | undefined =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const INCIDENT_WINDOW_HOURS = 24
const since = argFor('since') ?? process.env.INCIDENT_SINCE
const until = argFor('until') ?? process.env.INCIDENT_UNTIL
const sinceAt = since ? new Date(since) : new Date(Date.now() - INCIDENT_WINDOW_HOURS * 60 * 60 * 1000)
const untilAt = until ? new Date(until) : new Date()

async function main() {
  const apply = process.argv.includes('--apply')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter })

  const candidates = await prisma.remoteOfferCandidate.findMany({
    where: { promotedOfferId: { not: null } },
    select: { promotedOfferId: true, remoteEventId: true },
  })
  const originalEventIdByOffer = new Map(
    candidates.flatMap(c => (c.promotedOfferId ? [[c.promotedOfferId, c.remoteEventId] as const] : [])),
  )

  const touched = await prisma.offer.findMany({
    where: { source: 'REMOTE', updatedAt: { gt: sinceAt, lt: untilAt }, nostrEventId: { not: null } },
    select: { id: true, title: true, nostrEventId: true, companyId: true, creatorPubkey: true },
  })
  let affected = touched.filter(o => originalEventIdByOffer.get(o.id) !== o.nostrEventId)

  // Re-publish pass: the first --apply run had 27/39 kind-5 events reach zero
  // relays (connection churn / rate limiting after the incident's own publish
  // storm). By then nostrEventId is already restored, so this pass deletes by
  // COORDINATE only (a-tags; no e-tag — the stored id is the original foreign
  // event, which must never be deleted) and skips the restore update.
  const idsArg = argFor('ids')
  let atagOnly = false
  if (idsArg) {
    const ids = idsArg.split(',').map(s => s.trim()).filter(Boolean)
    affected = await prisma.offer.findMany({
      where: { id: { in: ids }, source: 'REMOTE' },
      select: { id: true, title: true, nostrEventId: true, companyId: true, creatorPubkey: true },
    })
    atagOnly = true
    console.log(`[cleanup-remote-republish] --ids mode: ${affected.length}/${ids.length} offer(s) — a-tag-only deletions`)
  }

  console.log(
    `[cleanup-remote-republish] ${affected.length} affected offer(s)${atagOnly ? '' : ` of ${touched.length} REMOTE rows touched ${sinceAt.toISOString()} → ${untilAt.toISOString()}`}${apply ? '' : ' (DRY RUN)'}`,
  )
  if (affected.length === 0) {
    await prisma.$disconnect()
    await pool.end()
    return
  }
  if (!hasSigningIdentityKey()) {
    console.error('[cleanup-remote-republish] NWC_SECRET_KEY unset — cannot resolve the signing keys that signed the duplicates. Abort.')
    process.exit(1)
  }

  await nostrService.connect()

  let deleted = 0
  let restored = 0
  for (const offer of affected) {
    const originalEventId = originalEventIdByOffer.get(offer.id)
    try {
      if (apply) {
        // Same resolution path as the accidental publish → same key → the
        // Kind-5 shares the duplicate's author, as NIP-09 requires.
        const identity = await resolveOfferSigningKey(prisma, { companyId: offer.companyId, creatorPubkey: offer.creatorPubkey })
        const deletion = finalizeEvent(
          {
            kind: 5,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              // e-tag only on the first pass, when nostrEventId still holds
              // OUR duplicate event id (--ids re-publish pass: it holds the
              // restored ORIGINAL foreign id — never delete that one).
              ...(atagOnly ? [] : [['e', offer.nostrEventId!]]),
              ['a', `30402:${identity.pubkey}:${offer.id}`],
              ['a', `30017:${identity.pubkey}:${offer.id}`],
            ],
            content:
              'duplicate listing: re-published in error by a Colabonate backfill on 2026-11-20; ' +
              'the original listing by its real author is untouched',
          },
          identity.sk,
        )
        const published = await nostrService.publishEvent(deletion)
        if (!published) console.warn(`  WARN ${offer.id}: kind-5 reached zero relays (network?)`)
        deleted++
        if (!atagOnly && originalEventId) {
          await prisma.offer.update({ where: { id: offer.id }, data: { nostrEventId: originalEventId } })
          restored++
          console.log(`  DEL  ${offer.id} "${offer.title}" kind5=${deletion.id} nostrEventId restored -> ${originalEventId}`)
        } else {
          console.log(`  DEL  ${offer.id} "${offer.title}" kind5=${deletion.id} (a-tag only)`)
        }
      } else {
        console.log(`  WOULD-DEL ${offer.id} "${offer.title}" duplicate=${offer.nostrEventId} original=${originalEventId}`)
      }
    } catch (err) {
      console.error(`  FAIL ${offer.id} "${offer.title}":`, err)
    }
  }

  console.log(`[cleanup-remote-republish] done: ${deleted} deletion event(s) published, ${restored} nostrEventId(s) restored`)
  await prisma.$disconnect()
  await pool.end()
}

main().catch(err => {
  console.error('[cleanup-remote-republish] fatal:', err)
  process.exit(1)
})
