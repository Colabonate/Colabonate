/**
 * NIP-P / NIP-89 (Phase 5) — smoke verification.
 *
 * Two independent checks (no live relay, no DB):
 *   A) The NIP-89 app-handler template builder produces a kind:31990 event
 *      shape that matches the spec (docs/nip-publications/NIP-P-private-commerce.md
 *      §"Cross-client interop") — correct kind, d-tag, supports tags.
 *   B) The Zod envelope schemas accept the spec's own JSON examples (5.2).
 *
 * Run: DATABASE_URL=… tsx scripts/phase5-nip-p-smoke-test.ts
 */
import { strict as assert } from 'node:assert'
import { buildAppHandlerTemplate, COLABONATE_SUPPORTED_KINDS } from '../../colabonate-app/src/lib/nip89'
import { PrivateCommerceEnvelopeSchema } from '../lib/enums'

const PK = 'a'.repeat(64)

let passed = 0
function check(name: string, cond: boolean, detail = ''): void {
  if (!cond) throw new Error(`FAIL: ${name} ${detail}`)
  passed++
  console.log(`  ✓ ${name}`)
}

// ── A) NIP-89 handler template ───────────────────────────────────────────────
console.log('A) NIP-89 app-handler template (kind:31990)')
const tpl = buildAppHandlerTemplate({
  name: 'Colabonate',
  web: 'https://app.colabonate.org',
  picture: 'https://app.colabonate.org/logo.png',
  about: 'Bitcoin-native private commerce over NIP-17',
})
check('kind is 31990', tpl.kind === 31990)
const dTag = tpl.tags.find(t => t[0] === 'd')
check('has d:colabonate (addressable)', dTag?.[1] === 'colabonate')
const supports = tpl.tags.filter(t => t[0] === 'supports').map(t => t[1])
check('declares all Colabonate kinds', supports.length === COLABONATE_SUPPORTED_KINDS.length && COLABONATE_SUPPORTED_KINDS.every(k => supports.includes(k)))
check('includes 14, 1059, 10050', ['14', '1059', '10050'].every(k => supports.includes(k)))
check('carries web redirect tag', tpl.tags.some(t => t[0] === 'web'))

// Re-building is idempotent in shape (addressable replaces on re-publish).
const tpl2 = buildAppHandlerTemplate()
check('rebuild keeps d:colabonate', tpl2.tags.find(t => t[0] === 'd')?.[1] === 'colabonate')

// ── B) Spec envelopes round-trip through the Zod schemas (5.2) ───────────────
console.log('B) NIP-P envelope schemas accept spec examples')
const examples: { label: string; env: unknown }[] = [
  { label: 'offer', env: { type: 'offer', offerId: 'o', title: 't', priceSats: 50000, creatorPubkey: PK, timestamp: 1 } },
  { label: 'cooperation_proposal', env: { type: 'cooperation_proposal', subType: 'proposal', cooperationId: 'c', title: 't', budgetSats: 250000, initiatorPubkey: PK, partnerPubkey: PK, nip_c: { kind: 30414, tags: [['d', 'c']], content: '' }, timestamp: 1 } },
  { label: 'milestone', env: { type: 'milestone', t: 'colabonate-milestone', cooperationId: 'c', milestoneId: 'm', milestoneIndex: 0, status: 'COMPLETED', amountSats: 1000, released: false, nip_c: { kind: 30415, tags: [], content: '' }, timestamp: 1 } },
  { label: 'verdict RELEASE', env: { type: 'verdict', ticketId: 't', outcome: 'RELEASE', reasoning: 'ok', arbiterPubkey: PK, verdictNostrEventId: 'e', timestamp: 1 } },
  { label: 'counter', env: { type: 'counter', offerId: 'o', counterPriceSats: 45000 } },
  { label: 'message', env: { type: 'message', message: 'hi' } },
]
for (const { label, env } of examples) {
  const parsed = PrivateCommerceEnvelopeSchema.safeParse(env)
  check(`parses ${label}`, parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues))
}

console.log(`\n=== ${passed} assertions passed ===`)
console.log('✅ All Phase-5 (NIP-P + NIP-89) smoke assertions passed')
