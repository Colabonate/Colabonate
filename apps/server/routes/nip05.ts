// ADR-412 FU-947: NIP-05 identifier verification for marketplace listing
// identities (ADR-412 D2's per-Company/per-User persistent signing keys).
//
//   GET /.well-known/nostr.json?name=<companyId|userId>
//
// No chosen-handle feature exists yet (tracked separately if ever wanted), so
// the local-part is the owning Company's or User's row id: unglamorous but
// unique and already spec-compliant: NIP-05 only requires the local-part to
// resolve to a pubkey, not that it be a pretty username. Mounted at the site
// root (not under /api) because NIP-05 fixes the `/.well-known/nostr.json`
// path, mirroring the existing `/.well-known/lnurlp` router (ADR-240).
import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import { nostrService } from '../services/nostr-relay.js'

export function createNip05Router(prisma: PrismaClient) {
  const router = Router()

  // Public, cross-origin-readable by design (same rationale as lnurlp.ts).
  router.use((_req, res, next) => {
    res.set('Cross-Origin-Resource-Policy', 'cross-origin')
    res.set('Cache-Control', 'no-store')
    next()
  })

  router.get('/', async (req: Request, res: Response) => {
    const name = typeof req.query.name === 'string' ? req.query.name.trim() : ''
    if (!name) return res.json({ names: {} })

    try {
      const company = await prisma.company.findUnique({ where: { id: name }, select: { nostrListingPubkey: true } })
      const pubkey = company?.nostrListingPubkey
        ?? (await prisma.user.findUnique({ where: { id: name }, select: { nostrListingPubkey: true } }))?.nostrListingPubkey

      if (!pubkey) return res.json({ names: {} })
      return res.json({ names: { [name]: pubkey }, relays: { [pubkey]: nostrService.relays } })
    } catch (err) {
      console.error('[nip05] lookup failed:', err instanceof Error ? err.message : err)
      return res.json({ names: {} })
    }
  })

  return router
}
