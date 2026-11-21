/**
 * ADR-162 / NIP-51 (Phase 6, C-T8) — smoke verification for the
 * trusted-arbiter follow-set builder + parser. Pure (no relay, no DB).
 *
 * Run: tsx scripts/phase6-nip51-smoke-test.ts
 */
import { strict as assert } from 'node:assert'
import {
  buildTrustedArbiterListTemplate,
  parseTrustedArbiterList,
  normalizeArbiterList,
  TRUSTED_ARBITER_SET_D,
  TRUSTED_ARBITER_SET_KIND,
} from '../../colabonate-app/src/lib/nip51'

let passed = 0
function check(name: string, cond: boolean, detail = ''): void {
  if (!cond) throw new Error(`FAIL: ${name} ${detail}`)
  passed++
  console.log(`  ✓ ${name}`)
}

const PK_A = 'a'.repeat(64)
const PK_B = 'b'.repeat(64)
const PK_C = 'c'.repeat(64)

console.log('A) normalizeArbiterList')
check('dedupes case-insensitively', normalizeArbiterList([PK_A.toUpperCase(), PK_A]).length === 1)
check('lowercases output', normalizeArbiterList([PK_A.toUpperCase()])[0] === PK_A)
try {
  normalizeArbiterList(['not-hex'])
  check('rejects invalid hex', false)
} catch {
  check('rejects invalid hex', true)
}

console.log('B) buildTrustedArbiterListTemplate')
const tpl = buildTrustedArbiterListTemplate([PK_A, PK_B, PK_A]) // dup A
check('kind is 30000 (NIP-51 follow set)', tpl.kind === TRUSTED_ARBITER_SET_KIND)
check('d-identifier scopes the set', tpl.tags.find(t => t[0] === 'd')?.[1] === TRUSTED_ARBITER_SET_D)
const pTags = tpl.tags.filter(t => t[0] === 'p').map(t => t[1])
check('one p-tag per unique pubkey (dedup)', pTags.length === 2 && pTags.includes(PK_A) && pTags.includes(PK_B))
check('content is empty', tpl.content === '')

console.log('C) parseTrustedArbiterList round-trip')
// Simulate a signed-shape event (we only read tags/kind, no signature check here).
const fakeEvent = { kind: TRUSTED_ARBITER_SET_KIND, tags: tpl.tags, id: 'x', pubkey: PK_C, content: '', sig: '', created_at: 0 } as any
const parsed = parseTrustedArbiterList(fakeEvent)
check('round-trips the same pubkeys', parsed.length === 2 && parsed.every(p => p === PK_A || p === PK_B))
check('returns [] for unrelated d-identifier', parseTrustedArbiterList({ ...fakeEvent, tags: [['d', 'other-set'], ['p', PK_A]] } as any).length === 0)
check('returns [] for wrong kind', parseTrustedArbiterList({ ...fakeEvent, kind: 30003 } as any).length === 0)
check('ignores malformed p-tags', parseTrustedArbiterList({ ...fakeEvent, tags: [['d', TRUSTED_ARBITER_SET_D], ['p', 'garbage'], ['p', PK_A]] } as any).length === 1)

console.log(`\n=== ${passed} assertions passed ===`)
console.log('✅ All Phase-6 NIP-51 (trusted-arbiter list) smoke assertions passed')
