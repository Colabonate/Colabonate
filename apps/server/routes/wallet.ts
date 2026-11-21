import { Router, type Request, type Response } from 'express'
import { createHash } from 'crypto'
import type { PrismaClient } from '@prisma/client'
import type { PaymentProvider } from '@col/payments'
import { resolveWalletMode } from '../services/walletStrategy.js'
import { SUB_WALLET_SOFT_LIMIT, SUB_WALLET_WARN_AT } from '../services/subWallet.js'
import { isBetaMode, demoConfig, isProductionDirectPayOnly } from '../services/betaMode.js'
import { NwcClient, parseNwcUri } from '../services/nwcClient.js'
import { sanitiseUpstreamError } from '../lib/sanitise-error.js'
import { encrypt, decrypt, hasSecretKey } from '../lib/secretbox.js'
import { getActiveWallet, setActiveWalletId, deactivateAndPromote } from '../services/walletActive.js'
import { createAlbyOauthProviderForUser } from '../services/albyOauthProvider.js'
import { acquireDispatchLock } from '../lib/dispatch-lock.js'
import { readLnurlpDomain, validateHandle } from '../lib/lnAddressHandle.js'
import type { Wallet } from '@prisma/client'

/**
 * ADR-208 D3 / ADR-228 D3: the browser must never receive key material.
 * A `Wallet` row carries `nwcConnectionUriEnc` — the AES-256-GCM ciphertext of
 * a spend-capable `nostr+walletconnect://` URI — so every endpoint that returns
 * a wallet passes it through this projection. The client's `Wallet` type
 * documents exactly these fields (plus the fetched `balance`); everything else
 * (ciphertext, derived columns) stays server-side.
 */
function toClientWallet(wallet: Wallet) {
  return {
    id: wallet.id,
    provider: wallet.provider,
    mode: wallet.mode,
    walletId: wallet.walletId,
    accountId: wallet.accountId,
    status: wallet.status,
    balanceSats: wallet.balanceSats,
    isActive: wallet.isActive,
    lastSyncedAt: wallet.lastSyncedAt,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
    nwcWalletPubkey: wallet.nwcWalletPubkey,
    nwcRelayUrls: wallet.nwcRelayUrls,
    nwcConnectedAt: wallet.nwcConnectedAt,
    nwcLastSyncedAt: wallet.nwcLastSyncedAt,
  }
}
import { isRoutableLnAddress, hasSellerPaymentMethodConfigured } from '../services/sellerPaymentResolver.js'

export function createWalletRouter(prisma: PrismaClient, payments?: PaymentProvider) {
  const router = Router()

  // FU-28-B: every wallet endpoint operates on the authenticated user's own
  // wallet only. Legacy callers still send pubkey/userId in query/body; those
  // are accepted solely as a consistency check — a mismatch with the session
  // identity is rejected with 403 instead of being honored (IDOR fix).
  async function resolveOwnUser(
    req: Request,
    res: Response,
    claimed: { userId?: unknown; pubkey?: unknown }
  ) {
    const authPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!authPubkey) {
      res.status(401).json({ error: 'UNAUTHORIZED' })
      return null
    }
    const user = await prisma.user.findUnique({ where: { pubkey: authPubkey } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return null
    }
    if (typeof claimed.pubkey === 'string' && claimed.pubkey && claimed.pubkey !== user.pubkey) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'pubkey does not match authenticated user' })
      return null
    }
    if (typeof claimed.userId === 'string' && claimed.userId && claimed.userId !== user.id) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'userId does not match authenticated user' })
      return null
    }
    return user
  }

  router.post('/create', async (req: Request, res: Response) => {
    try {
      const { provider } = req.body as { provider?: string }
      // authPubkey is set by requireAuth middleware on the parent router
      const authPubkey = (req as Request & { authPubkey?: string }).authPubkey
      if (!authPubkey) {
        return res.status(401).json({ error: 'Unauthorized' })
      }

      const user = await prisma.user.findUnique({ where: { pubkey: authPubkey } })
      if (!user) {
        return res.status(404).json({ error: 'User not found' })
      }
      const resolvedUserId = user.id

      // ADR-228: /create provisions the user's first wallet — if they already
      // hold any wallet (any provider), it's a no-op that returns the active one.
      const existing = await getActiveWallet(prisma, resolvedUserId)
      if (existing) {
        return res.json({ success: true, wallet: toClientWallet(existing), alreadyExists: true })
      }

      // ADR-253: a real production host is Stage-1 Direct-Pay only — there is
      // no LNBits/LND node, hence no platform-held wallet to provision. Refuse
      // to mint a dead LNBITS row; the user connects a non-custodial rail
      // (WebLN / NWC / Alby / Cashu) instead. Explicit no-op, not an error:
      // login/onboarding bootstrap calls this and must keep proceeding.
      if (isProductionDirectPayOnly()) {
        return res.json({ success: true, wallet: null, custodialUnavailable: true })
      }

      // ADR-197: Beta mode auto-provisions a demo wallet (simulated ledger, no external call)
      if (isBetaMode()) {
        const cfg = demoConfig()
        const demoWallet = await prisma.wallet.create({
          data: {
            userId: resolvedUserId,
            provider: 'DEMO',
            mode: 'CUSTODIAL',
            status: 'ACTIVE',
            balanceSats: cfg.startBalance,
          },
        })
        console.log(`[Wallet/Beta] Created DEMO wallet for user ${resolvedUserId} (${cfg.startBalance} sats)`)
        return res.json({ success: true, wallet: toClientWallet(demoWallet) })
      }

      let walletId: string | null = null
      let accountId: string | null = null
      const walletProvider = (provider || 'LNBITS') as 'LIGHTSPARK' | 'LNBITS' | 'WEBLN' | 'MOCK'

      if (walletProvider === 'LIGHTSPARK' && payments?.createWallet) {
        const result = await payments.createWallet(resolvedUserId)
        walletId = result.walletId
        accountId = result.accountId ?? null
      }

      // ADR-160 (PROB-003 B-γ): pick the primary wallet mode from the user's
      // strategy. Provisioning has no trade context, so we resolve against the
      // PUBLIC branch (the everyday wallet). Trade-time sub-wallet selection
      // (B-α wiring) consults the PRIVATE branch separately.
      const strategy = (user.walletModeStrategy as 'HYBRID' | 'CUSTODIAL_ONLY' | 'NONCUSTODIAL_ONLY') ?? 'HYBRID'
      const resolvedMode = resolveWalletMode(strategy, 'PUBLIC')

      const wallet = await prisma.wallet.create({
        data: {
          userId: resolvedUserId,
          provider: walletProvider,
          mode: resolvedMode,
          walletId,
          accountId,
          status: 'ACTIVE',
          balanceSats: 0,
        },
      })

      console.log(`[Wallet] Created ${walletProvider} wallet for user ${resolvedUserId}`)

      res.json({ success: true, wallet: toClientWallet(wallet) })
    } catch (error) {
      console.error('Failed to create wallet:', error)
      res.status(500).json({ error: 'Failed to create wallet' })
    }
  })

  router.get('/', async (req: Request, res: Response) => {
    try {
      const { userId, pubkey } = req.query as { userId?: string; pubkey?: string }

      const user = await resolveOwnUser(req, res, { userId, pubkey })
      if (!user) return

      // Data hygiene on the read path, two independent rules:
      //  · LNBits/Lightspark/mock rows have no backend on a real production host
      //    (ADR-253 Direct-Pay only) — hidden there and only there, because dev
      //    and beta do have a provider behind them.
      //  · DEMO is the beta simulation ledger (ADR-197): never a real rail, so
      //    it must not surface outside beta at all — a row inherited from a beta
      //    DB restore or a stale dev row would otherwise render as a
      //    "Demo Wallet" in the switcher.
      const directPayOnly = isProductionDirectPayOnly()
      const beta = isBetaMode()
      const UNUSABLE_IN_DIRECT_PAY = ['LNBITS', 'LIGHTSPARK', 'MOCK']
      const isUnusable = (provider: string) =>
        (directPayOnly && UNUSABLE_IN_DIRECT_PAY.includes(provider)) ||
        (!beta && provider === 'DEMO')

      let wallet = await getActiveWallet(prisma, user.id)
      if (wallet && isUnusable(wallet.provider)) wallet = null

      // ADR-228: expose the full peer list too (id/provider/isActive only —
      // no per-wallet balance fetch here, that stays lazy/on-demand per
      // provider) so the frontend can offer a wallet switcher.
      const allWallets = (
        await prisma.wallet.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: 'asc' },
          select: { id: true, provider: true, mode: true, status: true, isActive: true },
        })
      ).filter(w => !isUnusable(w.provider))

      if (!wallet) {
        return res.json({ wallet: null, wallets: allWallets })
      }

      let balance = { confirmedSats: wallet.balanceSats, unconfirmedSats: 0, pendingSats: 0 }

      // Only custodial master-wallet providers proxy their balance through the
      // global payment provider. DEMO (ADR-197 simulated ledger), NWC (ADR-208,
      // synced via /nwc/info), CASHU (ADR-187 metadata-only) and WEBLN keep
      // their own balanceSats — syncing would overwrite them with the master
      // LNBits balance.
      const MASTER_SYNCED_PROVIDERS = ['LNBITS', 'LIGHTSPARK', 'MOCK']
      if (payments && MASTER_SYNCED_PROVIDERS.includes(wallet.provider)) {
        try {
          balance = await payments.getBalance()
          await prisma.wallet.update({
            where: { id: wallet.id },
            data: { balanceSats: balance.confirmedSats, lastSyncedAt: new Date() },
          })
        } catch {
          console.warn(`[Wallet] Failed to sync balance for wallet ${wallet.id}, returning cached`)
        }
      } else if (wallet.provider === 'ALBY_OAUTH') {
        // ADR-228: constructed fresh per request, per D4's lifetime invariant.
        try {
          const albyProvider = await createAlbyOauthProviderForUser(prisma, user.id)
          balance = await albyProvider.getBalance()
          await prisma.wallet.update({
            where: { id: wallet.id },
            data: { balanceSats: balance.confirmedSats, lastSyncedAt: new Date() },
          })
        } catch (err) {
          console.warn(`[Wallet] Failed to sync Alby balance for wallet ${wallet.id}, returning cached:`, err instanceof Error ? err.message : err)
        }
      }

      res.json({
        wallet: {
          ...toClientWallet(wallet),
          balance,
        },
        wallets: allWallets,
      })
    } catch (error) {
      console.error('Failed to fetch wallet:', error)
      res.status(500).json({ error: 'Failed to fetch wallet' })
    }
  })

  // FU-801: the Wallet tab needs to know whether the CURRENT configuration
  // would actually pass the offer-publish gate — reuses the exact check
  // publish uses (hasSellerPaymentMethodConfigured) so the Settings UI can
  // never drift from what the publish gate actually enforces.
  router.get('/payout-readiness', async (req: Request, res: Response) => {
    try {
      const authPubkey = (req as Request & { authPubkey?: string }).authPubkey
      if (!authPubkey) return void res.status(401).json({ error: 'UNAUTHORIZED' })
      const ready = await hasSellerPaymentMethodConfigured(prisma, authPubkey)
      res.json({ ready })
    } catch (error) {
      console.error('Failed to compute payout readiness:', error)
      res.status(500).json({ error: 'Failed to compute payout readiness' })
    }
  })

  router.post('/connect', async (req: Request, res: Response) => {
    try {
      const { userId, pubkey, provider } = req.body as { userId?: string; pubkey?: string; provider?: string }

      if (!provider) {
        return res.status(400).json({ error: 'provider is required' })
      }

      // Only user-owned, non-custodial rails can be "connected" from the app.
      // Server-owned providers (LNBITS/LIGHTSPARK/MOCK) and the beta-only DEMO
      // simulation must never be creatable through this endpoint — otherwise a
      // client could mint a platform/custodial wallet row on production (the
      // DEMO one would even render as a "Demo Wallet" in the switcher).
      // NWC/CASHU have dedicated endpoints but are harmless here (mode
      // NON_CUSTODIAL).
      const CONNECTABLE_PROVIDERS = ['WEBLN', 'NWC', 'CASHU'] as const
      if (!(CONNECTABLE_PROVIDERS as readonly string[]).includes(provider)) {
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: `provider must be one of: ${CONNECTABLE_PROVIDERS.join(', ')}`,
        })
      }

      const user = await resolveOwnUser(req, res, { userId, pubkey })
      if (!user) return
      const resolvedUserId = user.id

      // ADR-228: one Wallet row per provider now — connecting a provider the
      // user already has re-activates/updates that row instead of switching
      // the single row in place; every other wallet is deactivated in the
      // same transaction so exactly one stays "active".
      const upserted = await prisma.wallet.upsert({
        where: { userId_provider: { userId: resolvedUserId, provider: provider as any } },
        update: { mode: 'NON_CUSTODIAL', status: 'ACTIVE' },
        create: {
          userId: resolvedUserId,
          provider: provider as any,
          mode: 'NON_CUSTODIAL',
          status: 'ACTIVE',
          balanceSats: 0,
        },
      })
      await setActiveWalletId(prisma, resolvedUserId, upserted.id)

      console.log(`[Wallet] User ${resolvedUserId} switched active wallet to non-custodial (${provider})`)
      res.json({ success: true, wallet: toClientWallet(upserted) })
    } catch (error) {
      console.error('Failed to connect wallet:', error)
      res.status(500).json({ error: 'Failed to connect wallet' })
    }
  })

  // POST /api/wallet/active — ADR-228: switch which of the user's existing
  // Wallet rows is active, without reconnecting/re-authenticating anything.
  router.post('/active', async (req: Request, res: Response) => {
    try {
      const { walletId } = req.body as { walletId?: string }
      if (!walletId) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'walletId is required' })

      const user = await resolveOwnUser(req, res, {})
      if (!user) return

      const target = await prisma.wallet.findUnique({ where: { id: walletId } })
      if (!target || target.userId !== user.id) {
        return res.status(404).json({ error: 'Wallet not found' })
      }

      await setActiveWalletId(prisma, user.id, walletId)
      res.json({ success: true })
    } catch (error) {
      console.error('Failed to switch active wallet:', error)
      res.status(500).json({ error: 'Failed to switch active wallet' })
    }
  })

  router.delete('/connection', async (req: Request, res: Response) => {
    try {
      const { userId, pubkey } = req.body as { userId?: string; pubkey?: string }

      const user = await resolveOwnUser(req, res, { userId, pubkey })
      if (!user) return
      const resolvedUserId = user.id

      const wallet = await getActiveWallet(prisma, resolvedUserId)
      if (!wallet) {
        return res.status(404).json({ error: 'Wallet not found' })
      }

      // ADR-253/381: a Direct-Pay-only host has no custodial fallback — drop
      // the disconnected connection instead of minting a dead LNBITS row. The
      // user reconnects whenever they want (POST /connect re-creates the row).
      if (isProductionDirectPayOnly()) {
        await prisma.wallet.delete({ where: { id: wallet.id } })
        console.log(`[Wallet] Disconnected ${wallet.provider} wallet for user ${resolvedUserId} (Direct-Pay only, no custodial fallback)`)
        return res.json({ success: true })
      }

      // Re-provision (or reuse) the CUSTODIAL LNBITS wallet as the fallback —
      // mirrors the pre-ADR-228 behavior of always leaving the user with a
      // usable custodial wallet after disconnecting a non-custodial one.
      const custodial = await prisma.wallet.upsert({
        where: { userId_provider: { userId: resolvedUserId, provider: 'LNBITS' } },
        update: {},
        create: { userId: resolvedUserId, provider: 'LNBITS', mode: 'CUSTODIAL', status: 'ACTIVE', balanceSats: 0 },
      })

      if (custodial.id !== wallet.id) {
        await deactivateAndPromote(prisma, resolvedUserId, wallet.id, custodial.id)
      }

      console.log(`[Wallet] Disconnected ${wallet.provider} wallet for user ${resolvedUserId}`)
      res.json({ success: true })
    } catch (error) {
      console.error('Failed to disconnect wallet:', error)
      res.status(500).json({ error: 'Failed to disconnect wallet' })
    }
  })

  // ADR-240 D1/D2 — self-serve `<handle>@<domain>` Lightning Address.
  // The handle is what we serve publicly; the mode picks the owner's own rail
  // that mints the invoice (EXTERNAL LUD-16 address, or their NWC wallet).
  router.get('/ln-address', async (req: Request, res: Response) => {
    try {
      const user = await resolveOwnUser(req, res, {})
      if (!user) return
      const nwc = await prisma.wallet.findFirst({
        where: { userId: user.id, provider: 'NWC', nwcConnectionUriEnc: { not: null } },
        select: { id: true },
      })
      const domain = readLnurlpDomain()
      res.json({
        handle: user.lnAddressHandle ?? null,
        mode: user.lnAddressMode ?? null,
        address: user.lnAddressHandle ? `${user.lnAddressHandle}@${domain}` : null,
        domain,
        lnAddress: user.lnAddress ?? null,
        nwcConnected: Boolean(nwc),
      })
    } catch (error) {
      console.error('Failed to read Lightning address settings:', error)
      res.status(500).json({ error: 'Failed to read Lightning address settings' })
    }
  })

  router.put('/ln-address', async (req: Request, res: Response) => {
    try {
      const user = await resolveOwnUser(req, res, {})
      if (!user) return

      const { handle, mode, address } = req.body as { handle?: string; mode?: string; address?: string }
      const validation = validateHandle(handle)
      if (!validation.ok) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: validation.reason })
      }
      if (mode !== 'EXTERNAL' && mode !== 'NWC') {
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'mode must be EXTERNAL or NWC (Cashu receiving is not available yet)',
        })
      }
      // ADR-240 D2: EXTERNAL mode needs the user's own LUD-16 address. It can be
      // supplied here (there is no other user-facing write path for
      // `User.lnAddress`) or already exist from an auth flow. FU-754 discipline:
      // a synthetic placeholder (`@demo.local`, `@metamask.local`,
      // `@colabonate.local`) is never a rail, so it is rejected as a source.
      let externalAddress = user.lnAddress
      if (mode === 'EXTERNAL') {
        if (typeof address === 'string' && address.trim()) {
          if (!isRoutableLnAddress(address)) {
            return res.status(400).json({
              error: 'VALIDATION_ERROR',
              message: 'That is not a usable Lightning address — expected user@domain',
            })
          }
          externalAddress = address.trim()
        }
        if (!isRoutableLnAddress(externalAddress)) {
          return res.status(400).json({
            error: 'VALIDATION_ERROR',
            message: 'Enter your Lightning address (user@domain), or choose the NWC mode',
          })
        }
      }
      if (mode === 'NWC') {
        const nwc = await prisma.wallet.findFirst({
          where: { userId: user.id, provider: 'NWC', nwcConnectionUriEnc: { not: null } },
          select: { id: true },
        })
        if (!nwc) {
          return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Connect a Nostr Wallet (NWC) first' })
        }
      }

      const taken = await prisma.user.findFirst({
        where: { lnAddressHandle: validation.handle, NOT: { id: user.id } },
        select: { id: true },
      })
      if (taken) {
        return res.status(409).json({ error: 'HANDLE_TAKEN', message: 'This handle is already taken' })
      }

      let updated: { lnAddressHandle: string | null; lnAddressMode: string | null }
      try {
        updated = await prisma.user.update({
          where: { id: user.id },
          data: {
            lnAddressHandle: validation.handle,
            lnAddressMode: mode,
            // Persist a newly supplied EXTERNAL address alongside the handle.
            ...(mode === 'EXTERNAL' && externalAddress ? { lnAddress: externalAddress } : {}),
          },
          select: { lnAddressHandle: true, lnAddressMode: true },
        })
      } catch (err) {
        // The findFirst pre-check above races a concurrent claim of the same
        // handle; the DB unique constraint on `lnAddressHandle` is the
        // authority, so a P2002 must surface as the same 409 the pre-check
        // produces — not a 500.
        if ((err as { code?: string })?.code === 'P2002') {
          return res.status(409).json({ error: 'HANDLE_TAKEN', message: 'This handle is already taken' })
        }
        throw err
      }
      res.json({
        success: true,
        handle: updated.lnAddressHandle,
        mode: updated.lnAddressMode,
        address: `${updated.lnAddressHandle}@${readLnurlpDomain()}`,
      })
    } catch (error) {
      console.error('Failed to save Lightning address settings:', error)
      res.status(500).json({ error: 'Failed to save Lightning address settings' })
    }
  })

  router.delete('/ln-address', async (req: Request, res: Response) => {
    try {
      const user = await resolveOwnUser(req, res, {})
      if (!user) return
      await prisma.user.update({
        where: { id: user.id },
        data: { lnAddressHandle: null, lnAddressMode: null },
      })
      res.json({ success: true })
    } catch (error) {
      console.error('Failed to clear Lightning address settings:', error)
      res.status(500).json({ error: 'Failed to clear Lightning address settings' })
    }
  })

  router.get('/transactions', async (req: Request, res: Response) => {
    try {
      const user = await resolveOwnUser(req, res, { pubkey: req.query.pubkey })
      if (!user) return
      const pubkey = user.pubkey

      const tickets = await prisma.ticket.findMany({
        where: {
          OR: [
            { buyerPubkey: pubkey },
            { sellerPubkey: pubkey },
          ],
          // ADR-197/ADR-253: the DEMO rail is the beta simulation ledger. Its
          // tickets are account history, not wallet history (the list is derived
          // from Tickets — see below), so they must be excluded whenever the
          // host is not in beta: production, or a prod-like local/dev run. Same
          // rule that hides the DEMO wallet from the switcher. Rows written
          // before `directPayRail` was denormalized have no marker and are left
          // as-is (on production no demo tickets exist at all).
          ...(isBetaMode() ? {} : { NOT: { directPayRail: 'DEMO' } }),
        },
        include: { offer: true },
        orderBy: { createdAt: 'desc' },
      })

      const ticketTransactions = tickets.map(ticket => {
        const isBuyer = ticket.buyerPubkey === pubkey
        const isSeller = ticket.sellerPubkey === pubkey
        const amountSats = ticket.amountSats ?? ticket.offer?.priceSats
        const escrowStatus = ticket.escrowStatus

        let type: 'SENT' | 'RECEIVED' | 'ESCROW_HOLD' | 'ESCROW_RELEASE' | 'ESCROW_REFUND'
        let status: 'COMPLETED' | 'PENDING' | 'REFUNDED' = 'COMPLETED'

        if (!escrowStatus || escrowStatus === 'NONE') {
          if (isBuyer) {
            type = 'SENT'
            status = ticket.status === 'CANCELLED' ? 'REFUNDED' : ticket.status === 'COMPLETED' ? 'COMPLETED' : 'PENDING'
          } else if (isSeller) {
            type = 'RECEIVED'
            status = ticket.status === 'CANCELLED' ? 'REFUNDED' : ticket.status === 'COMPLETED' ? 'COMPLETED' : 'PENDING'
          } else {
            type = 'SENT'
            status = 'PENDING'
          }
        } else if (escrowStatus === 'REFUNDED') {
          type = 'ESCROW_REFUND'
          status = 'REFUNDED'
        } else if (escrowStatus === 'RELEASE_PHASE_1' || escrowStatus === 'RELEASE_PHASE_2' || escrowStatus === 'RELEASE_PHASE_3' || escrowStatus === 'RELEASED_FULL' || escrowStatus === 'RELEASED') {
          type = 'ESCROW_RELEASE'
          status = 'COMPLETED'
        } else if (escrowStatus === 'FUNDED' || escrowStatus === 'PHASE_1_PENDING' || escrowStatus === 'PHASE_2_PENDING' || escrowStatus === 'PHASE_3_PENDING' || escrowStatus === 'RESERVED' || escrowStatus === 'INITIATED' || escrowStatus === 'DELIVERY_STARTED' || escrowStatus === 'DELIVERY_CONFIRMED') {
          type = 'ESCROW_HOLD'
          status = 'PENDING'
        } else if (isBuyer) {
          type = 'SENT'
          status = ticket.status === 'CANCELLED' ? 'REFUNDED' : ticket.status === 'COMPLETED' ? 'COMPLETED' : 'PENDING'
        } else if (isSeller) {
          type = 'RECEIVED'
          status = ticket.status === 'CANCELLED' ? 'REFUNDED' : ticket.status === 'COMPLETED' ? 'COMPLETED' : 'PENDING'
        } else {
          type = 'SENT'
          status = 'PENDING'
        }

        return {
          id: ticket.id,
          type,
          amountSats,
          offerTitle: ticket.offer?.title ?? 'Unknown offer',
          ticketId: ticket.id,
          status,
          paymentHash: ticket.paymentHash ?? null,
          createdAt: ticket.createdAt.toISOString(),
          visibility: ticket.visibility ?? 'PUBLIC',
          // The history is ticket-derived, so the UI needs the ticket's own
          // dimensions to render it honestly: which rail paid (LN / eCash /
          // DEMO-beta), the raw ticket state and the escrow phase. Added for the
          // ticket-aware wallet UX (rail badge + status wording + "Open" filter).
          directPayRail: ticket.directPayRail ?? null,
          escrowEnabled: ticket.escrowEnabled,
          escrowStatus: ticket.escrowStatus ?? null,
          ticketStatus: ticket.status,
        }
      })

      // Platform payments that are NOT marketplace tickets live in their own
      // tables (AI credit packs, MCP passes, workspace funding, support tips).
      // Union them into the same history shape so the wallet shows every
      // transfer, not only tickets. PAID rows only; the DEMO rail is beta-only,
      // matching the ticket filter above.
      const betaMode = isBetaMode()
      const railWhere = betaMode ? {} : { NOT: { rail: 'DEMO' } }
      const [aiPurchases, mcpPasses, workspaceRecharges, supportTips] = await Promise.all([
        prisma.aiCreditPurchase.findMany({
          where: { pubkey, status: 'PAID', ...railWhere },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.mcpAccessPass.findMany({
          where: { pubkey, status: 'PAID', ...railWhere },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.workspaceRecharge.findMany({
          where: { status: 'PAID', ...railWhere, workspace: { buyerPubkey: pubkey } },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.supportTip.findMany({
          where: { pubkey },
          orderBy: { createdAt: 'desc' },
        }),
      ])

      const asRail = (rail: string): 'LN' | 'CASHU' | 'DEMO' =>
        rail === 'DEMO' ? 'DEMO' : rail === 'CASHU' ? 'CASHU' : 'LN'

      // Non-ticket rows carry `ticketId: null` so the client renders them as
      // plain history (no ticket link) — they are completed outbound payments.
      const platformTransactions = [
        ...aiPurchases.map((p) => ({
          id: `ai-${p.id}`,
          type: 'SENT' as const,
          amountSats: p.amountSats,
          offerTitle: `Colabonate AI: ${p.requests} requests`,
          ticketId: null,
          status: 'COMPLETED' as const,
          paymentHash: p.paymentHash ?? null,
          createdAt: p.createdAt.toISOString(),
          directPayRail: asRail(p.rail),
          escrowEnabled: false,
          escrowStatus: null,
          ticketStatus: null,
          source: 'ai-credits' as const,
        })),
        ...mcpPasses.map((p) => ({
          id: `mcp-${p.id}`,
          type: 'SENT' as const,
          amountSats: p.amountSats,
          offerTitle: `MCP access: ${p.tier} pass`,
          ticketId: null,
          status: 'COMPLETED' as const,
          paymentHash: p.paymentHash ?? null,
          createdAt: p.createdAt.toISOString(),
          directPayRail: asRail(p.rail),
          escrowEnabled: false,
          escrowStatus: null,
          ticketStatus: null,
          source: 'mcp-pass' as const,
        })),
        ...workspaceRecharges.map((r) => ({
          id: `wsr-${r.id}`,
          type: 'SENT' as const,
          amountSats: r.amountSats,
          offerTitle: 'Workspace funding',
          ticketId: null,
          status: 'COMPLETED' as const,
          paymentHash: r.paymentHash,
          createdAt: r.createdAt.toISOString(),
          directPayRail: asRail(r.rail),
          escrowEnabled: false,
          escrowStatus: null,
          ticketStatus: null,
          source: 'workspace-recharge' as const,
        })),
        ...supportTips.map((t) => ({
          id: `tip-${t.id}`,
          type: 'SENT' as const,
          amountSats: t.amountSats,
          offerTitle: 'Support Colabonate',
          ticketId: null,
          status: 'COMPLETED' as const,
          paymentHash: null,
          createdAt: t.createdAt.toISOString(),
          directPayRail: 'LN' as const,
          escrowEnabled: false,
          escrowStatus: null,
          ticketStatus: null,
          source: 'support-tip' as const,
        })),
      ]

      const transactions = [...ticketTransactions, ...platformTransactions].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1,
      )

      res.json({ transactions })
    } catch (error) {
      console.error('Failed to fetch wallet transactions:', error)
      res.status(500).json({ error: 'Failed to fetch transactions' })
    }
  })

  // Resolves a Lightning Address (LUD-16) to a bolt11 invoice server-side —
  // the client can't do this fetch itself because the app's CSP connect-src
  // only allowlists known origins (our API, relays, coingecko, ollama), not
  // arbitrary third-party LN wallet domains. Used by the "Support Colabonate"
  // tip flow (useSupportTip); not tied to any specific user/wallet data.
  router.get('/lnurl-invoice', async (req: Request, res: Response) => {
    try {
      const address = String(req.query.address || '')
      const amountSats = Number(req.query.amountSats)
      const [name, domain] = address.split('@')
      if (!name || !domain) {
        return res.status(400).json({ error: 'Invalid Lightning Address' })
      }
      if (!Number.isFinite(amountSats) || amountSats <= 0) {
        return res.status(400).json({ error: 'Invalid amount' })
      }

      const metaRes = await fetch(`https://${domain}/.well-known/lnurlp/${name}`)
      if (!metaRes.ok) {
        return res.status(502).json({ error: 'Lightning Address not reachable' })
      }
      const meta = await metaRes.json()
      if (meta.tag !== 'payRequest' || !meta.callback) {
        return res.status(502).json({ error: 'Not a valid LNURL-pay address' })
      }

      const amountMsats = amountSats * 1000
      if (meta.minSendable && amountMsats < meta.minSendable) {
        return res.status(400).json({ error: 'Amount below the minimum this address accepts' })
      }
      if (meta.maxSendable && amountMsats > meta.maxSendable) {
        return res.status(400).json({ error: 'Amount above the maximum this address accepts' })
      }

      const sep = (meta.callback as string).includes('?') ? '&' : '?'
      const invRes = await fetch(`${meta.callback}${sep}amount=${amountMsats}`)
      if (!invRes.ok) {
        return res.status(502).json({ error: 'Failed to fetch invoice' })
      }
      const inv = await invRes.json()
      if (!inv.pr) {
        // FU-26/ADR-179: inv.reason is the remote LNURL server's own text —
        // never echo it verbatim (it's a third-party host we don't control).
        return res.status(502).json({ error: inv.reason ? sanitiseUpstreamError(inv.reason) : 'No invoice returned' })
      }

      res.json({ bolt11: inv.pr })
    } catch (error) {
      console.error('Failed to resolve LNURL invoice:', error)
      res.status(500).json({ error: 'Failed to resolve Lightning Address' })
    }
  })

  router.post('/payments/send', async (req: Request, res: Response) => {
    try {
      const { bolt11, pubkey, escrow } = req.body as { bolt11?: string; pubkey?: string; escrow?: boolean }

      if (!bolt11) {
        return res.status(400).json({ error: 'bolt11 invoice is required' })
      }

      if (!payments) {
        return res.status(503).json({ error: 'Payment provider not configured' })
      }

      const user = await resolveOwnUser(req, res, { pubkey })
      if (!user) return

      const wallet = await prisma.wallet.findFirst({
        where: {
          user: { pubkey: user.pubkey },
          mode: 'CUSTODIAL',
          status: 'ACTIVE',
        },
      })

      if (!wallet) {
        return res.status(404).json({ error: 'No active custodial wallet found' })
      }

      // Hold-invoice path (ADR-209 FU-209-A): paying a hold invoice puts the
      // HTLC into ACCEPTED; the LNBits payment call may not resolve until
      // settle/cancel. Dispatch fire-and-forget and return immediately —
      // mirrors the NWC escrow branch in /nwc/pay. Held state is confirmed by
      // the hold-invoice polling (getHoldState fallback in the invoice poll).
      if (escrow) {
        if (!acquireDispatchLock(`custodial:${bolt11}`)) {
          return res.status(409).json({ error: 'DISPATCH_IN_PROGRESS', message: 'This invoice is already being dispatched — do not retry.' })
        }
        payments
          .payInvoice(bolt11)
          .catch(err => console.error('[Wallet/Custodial] Escrow pay dispatch failed:', err))
        return res.json({ ok: true, dispatched: true, status: 'DISPATCHED' })
      }

      const result = await payments.payInvoice(bolt11)
      res.json({ success: true, ...result })
    } catch (error) {
      console.error('Failed to send payment:', error)
      res.status(500).json({ error: 'Failed to send payment' })
    }
  })

  router.get('/sub-wallets', async (req: Request, res: Response) => {
    try {
      const user = await resolveOwnUser(req, res, { pubkey: req.query.pubkey })
      if (!user) return

      const offers = await prisma.offer.findMany({
        where: {
          creatorPubkey: user.pubkey,
          lightningSubWalletId: { not: null },
        },
        select: {
          id: true,
          title: true,
          lightningSubWalletId: true,
          tickets: {
            select: {
              id: true,
              escrowStatus: true,
              visibility: true,
              status: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      const subWallets = offers.map(o => ({
        offerId: o.id,
        offerTitle: o.title,
        subWalletId: o.lightningSubWalletId,
        latestTicket: o.tickets[0] ?? null,
      }))

      const total = subWallets.length
      res.json({
        subWallets,
        total,
        warning: total >= SUB_WALLET_WARN_AT,
        limitReached: total >= SUB_WALLET_SOFT_LIMIT,
      })
    } catch (error) {
      console.error('Failed to fetch sub-wallets:', error)
      res.status(500).json({ error: 'Failed to fetch sub-wallets' })
    }
  })

  router.post('/validate-lnbits-demo', async (req: Request, res: Response) => {
    try {
      const apiKey = process.env.VITE_LNBITS_DEMO_API_KEY
      const demoUrl = process.env.VITE_LNBITS_DEMO_URL || 'https://demo.lnbits.com'

      if (!apiKey) {
        return res.json({ valid: false, error: 'Demo API key not configured' })
      }

      const response = await fetch(`${demoUrl}/api/v1/wallet`, {
        headers: { 'X-Api-Key': apiKey },
      })

      if (!response.ok) {
        return res.json({ valid: false, error: 'Demo account expired or invalid' })
      }

      const data = await response.json() as { balance?: number } | Record<string, unknown>
      const balanceSats = typeof data === 'object' && 'balance' in data ? (data.balance as number) / 1000 : 0

      res.json({ valid: true, balance: Math.round(balanceSats) })
    } catch (error) {
      console.error('Failed to validate LNBits demo account:', error)
      res.json({ valid: false, error: 'Connection failed' })
    }
  })

  // ---------------------------------------------------------------------------
  // ADR-208: Nostr Wallet Connect (NIP-47) — non-custodial user spending wallet.
  // All four endpoints sit behind the parent router's requireAuth middleware
  // and resolve the user via req.authPubkey. NWC is NOT a PaymentProvider and
  // never touches createProvider(); it only pays invoices the user presents.
  // ---------------------------------------------------------------------------

  function nwcEnabled(): boolean {
    return process.env.NWC_ENABLED === '1'
  }

  function requireNwc(res: Response): boolean {
    if (!nwcEnabled()) {
      res.status(503).json({ error: 'NWC_NOT_ENABLED', message: 'Nostr Wallet Connect is not enabled on this server' })
      return false
    }
    if (!hasSecretKey()) {
      res.status(500).json({ error: 'NWC_MISCONFIGURED', message: 'NWC_SECRET_KEY is required when NWC_ENABLED=1' })
      return false
    }
    return true
  }

  // POST /api/wallet/nwc/connect
  //   Body: { nwcConnectionUri }
  //   → validate URI, prove reachability via getInfo(), store encrypted URI,
  //     set provider=NWC, mode=NON_CUSTODIAL.
  router.post('/nwc/connect', async (req: Request, res: Response) => {
    try {
      if (!requireNwc(res)) return
      const { nwcConnectionUri } = req.body as { nwcConnectionUri?: string }
      const authPubkey = (req as Request & { authPubkey?: string }).authPubkey
      if (!authPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
      if (!nwcConnectionUri || typeof nwcConnectionUri !== 'string') {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'nwcConnectionUri is required' })
      }

      let parsed
      try {
        parsed = parseNwcUri(nwcConnectionUri)
      } catch (e) {
        return res.status(400).json({ error: 'INVALID_NWC_URI', message: e instanceof Error ? e.message : 'Malformed NWC URI' })
      }

      // Prove the wallet is reachable + capture its capabilities and balance
      // (best-effort — balance is informational at connect time) over one
      // relay connection.
      let info
      let balanceSats: number | undefined
      const client = new NwcClient(nwcConnectionUri)
      try {
        info = await client.getInfo()
      } catch (e) {
        client.close()
        // FU-26 (ADR-179): never echo the raw NWC relay error — it can contain
        // internal relay URLs or connection detail. Full error stays in the logs.
        console.error('[Wallet/connect-nwc] NWC unreachable:', e)
        return res.status(502).json({ error: 'NWC_UNREACHABLE', message: sanitiseUpstreamError(e) })
      }
      try {
        balanceSats = (await client.getBalance()).balanceSats
      } catch {
        // silent — balance is informational at connect time
      } finally {
        client.close()
      }

      const user = await prisma.user.findUnique({ where: { pubkey: authPubkey } })
      if (!user) return res.status(404).json({ error: 'User not found' })

      const encryptedUri = encrypt(nwcConnectionUri)
      const now = new Date()
      // ADR-228: NWC is a peer wallet row (userId, provider='NWC'), not the
      // user's only row — upsert it and make it the active wallet.
      const nwcWallet = await prisma.wallet.upsert({
        where: { userId_provider: { userId: user.id, provider: 'NWC' } },
        update: {
          mode: 'NON_CUSTODIAL',
          nwcConnectionUriEnc: encryptedUri,
          nwcWalletPubkey: parsed.walletPubkey,
          nwcRelayUrls: parsed.relayUrls.join(','),
          nwcConnectedAt: now,
          nwcLastSyncedAt: now,
          ...(balanceSats !== undefined ? { balanceSats } : {}),
        },
        create: {
          userId: user.id,
          provider: 'NWC',
          mode: 'NON_CUSTODIAL',
          status: 'ACTIVE',
          balanceSats: balanceSats ?? 0,
          nwcConnectionUriEnc: encryptedUri,
          nwcWalletPubkey: parsed.walletPubkey,
          nwcRelayUrls: parsed.relayUrls.join(','),
          nwcConnectedAt: now,
          nwcLastSyncedAt: now,
        },
      })
      await setActiveWalletId(prisma, user.id, nwcWallet.id)

      console.log(`[Wallet/NWC] Connected NWC wallet for user ${user.id} (alias: ${info.alias})`)
      res.json({
        ok: true,
        walletPubkey: parsed.walletPubkey,
        alias: info.alias,
        methods: info.methods,
        lud16: info.lud16,
        ...(balanceSats !== undefined ? { balanceSats } : {}),
      })
    } catch (error) {
      console.error('Failed to connect NWC wallet:', error)
      res.status(500).json({ error: 'Failed to connect NWC wallet' })
    }
  })

  // POST /api/wallet/cashu/receive-preference
  //   Body: { pubkey, mintUrl }
  //   ADR-253: lets a seller opt in to Cashu as a direct-pay receiving rail.
  //   pubkey is the user's own NIP-60 wallet pubkey (client already computed
  //   it via useCashuWallet().walletPubkey — this route does not derive or
  //   verify it, the wallet itself lives entirely in Nostr events, not here).
  //   No reachability check like nwc/connect: there's nothing to reach —
  //   this just stores where resolveSellerInvoice() should lock a token to.
  router.post('/cashu/receive-preference', async (req: Request, res: Response) => {
    try {
      const authPubkey = (req as Request & { authPubkey?: string }).authPubkey
      if (!authPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const { pubkey, mintUrl } = req.body as { pubkey?: string; mintUrl?: string }
      if (!pubkey || typeof pubkey !== 'string') {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'pubkey is required' })
      }
      if (!mintUrl || typeof mintUrl !== 'string') {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'mintUrl is required' })
      }

      const user = await prisma.user.findUnique({ where: { pubkey: authPubkey } })
      if (!user) return res.status(404).json({ error: 'User not found' })

      await prisma.wallet.upsert({
        where: { userId_provider: { userId: user.id, provider: 'CASHU' } },
        update: { mode: 'NON_CUSTODIAL', cashuReceivePubkey: pubkey, cashuReceiveMintUrl: mintUrl },
        create: {
          userId: user.id,
          provider: 'CASHU',
          mode: 'NON_CUSTODIAL',
          status: 'ACTIVE',
          cashuReceivePubkey: pubkey,
          cashuReceiveMintUrl: mintUrl,
        },
      })

      res.json({ ok: true })
    } catch (error) {
      console.error('Failed to save Cashu receive preference:', error)
      res.status(500).json({ error: 'Failed to save Cashu receive preference' })
    }
  })

  // DELETE /api/wallet/cashu/receive-preference — turns the toggle back off.
  // A CASHU-provider Wallet row exists only to hold this preference (the
  // actual wallet state lives in NIP-60 Nostr events) — deleting the row is
  // safe and complete, unlike NWC disconnect there's no "active wallet" to
  // re-promote.
  router.delete('/cashu/receive-preference', async (req: Request, res: Response) => {
    try {
      const authPubkey = (req as Request & { authPubkey?: string }).authPubkey
      if (!authPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const user = await prisma.user.findUnique({ where: { pubkey: authPubkey } })
      if (!user) return res.status(404).json({ error: 'User not found' })

      await prisma.wallet.deleteMany({ where: { userId: user.id, provider: 'CASHU' } })
      res.json({ ok: true })
    } catch (error) {
      console.error('Failed to remove Cashu receive preference:', error)
      res.status(500).json({ error: 'Failed to remove Cashu receive preference' })
    }
  })

  // POST /api/wallet/nwc/disconnect
  //   → ADR-228: NWC is its own peer row now; disconnect deletes that row and
  //     promotes/creates the CUSTODIAL LNBITS wallet as active (mirrors DELETE /connection).
  router.post('/nwc/disconnect', async (req: Request, res: Response) => {
    try {
      const authPubkey = (req as Request & { authPubkey?: string }).authPubkey
      if (!authPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const wallet = await prisma.wallet.findFirst({
        where: { user: { pubkey: authPubkey }, provider: 'NWC' },
      })
      if (!wallet) return res.status(404).json({ error: 'WALLET_NOT_CONNECTED', message: 'No NWC wallet connected' })

      // ADR-253/381: no custodial fallback on a Direct-Pay-only host — just
      // drop the NWC row (same as DELETE /connection's prod branch).
      if (isProductionDirectPayOnly()) {
        await prisma.wallet.delete({ where: { id: wallet.id } })
        console.log(`[Wallet/NWC] Disconnected NWC wallet for ${authPubkey} (Direct-Pay only, no custodial fallback)`)
        return res.json({ ok: true })
      }

      const custodial = await prisma.wallet.upsert({
        where: { userId_provider: { userId: wallet.userId, provider: 'LNBITS' } },
        update: {},
        create: { userId: wallet.userId, provider: 'LNBITS', mode: 'CUSTODIAL', status: 'ACTIVE', balanceSats: 0 },
      })

      await prisma.$transaction([
        prisma.wallet.delete({ where: { id: wallet.id } }),
        prisma.wallet.update({ where: { id: custodial.id }, data: { isActive: true } }),
      ])

      console.log(`[Wallet/NWC] Disconnected NWC wallet for ${authPubkey}`)
      res.json({ ok: true })
    } catch (error) {
      console.error('Failed to disconnect NWC wallet:', error)
      res.status(500).json({ error: 'Failed to disconnect NWC wallet' })
    }
  })

  // GET /api/wallet/nwc/info
  //   → decrypt URI, getInfo()+getBalance(), update nwcLastSyncedAt.
  router.get('/nwc/info', async (req: Request, res: Response) => {
    try {
      if (!requireNwc(res)) return
      const authPubkey = (req as Request & { authPubkey?: string }).authPubkey
      if (!authPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const wallet = await prisma.wallet.findFirst({
        where: { user: { pubkey: authPubkey }, provider: 'NWC' },
      })
      if (!wallet?.nwcConnectionUriEnc) {
        return res.status(400).json({ error: 'WALLET_NOT_CONNECTED', message: 'No NWC wallet connected' })
      }

      let uri: string
      try {
        uri = decrypt(wallet.nwcConnectionUriEnc)
      } catch {
        return res.status(500).json({ error: 'NWC_DECRYPT_FAILED', message: 'Could not decrypt stored NWC connection' })
      }

      const client = new NwcClient(uri)
      try {
        const [info, balance] = await Promise.all([client.getInfo(), client.getBalance()])
        await prisma.wallet.update({
          where: { id: wallet.id },
          data: { balanceSats: balance.balanceSats, nwcLastSyncedAt: new Date() },
        })
        res.json({
          ok: true,
          walletPubkey: wallet.nwcWalletPubkey,
          alias: info.alias,
          methods: info.methods,
          lud16: info.lud16,
          balanceSats: balance.balanceSats,
        })
      } finally {
        client.close()
      }
    } catch (error) {
      console.error('Failed to fetch NWC info:', error)
      res.status(500).json({ error: 'Failed to fetch NWC info' })
    }
  })

  // POST /api/wallet/nwc/pay
  //   Body: { bolt11, escrow?: boolean }
  //   → escrow=true  (hold invoice): dispatch payInvoice WITHOUT awaiting settle.
  //   → escrow=false (normal):       await payInvoice(); return preimage + fees.
  router.post('/nwc/pay', async (req: Request, res: Response) => {
    try {
      if (!requireNwc(res)) return
      const { bolt11, escrow } = req.body as { bolt11?: string; escrow?: boolean }
      const authPubkey = (req as Request & { authPubkey?: string }).authPubkey
      if (!authPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
      if (!bolt11) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'bolt11 is required' })

      const wallet = await prisma.wallet.findFirst({
        where: { user: { pubkey: authPubkey }, provider: 'NWC' },
      })
      if (!wallet?.nwcConnectionUriEnc) {
        return res.status(400).json({ error: 'WALLET_NOT_CONNECTED', message: 'No NWC wallet connected' })
      }

      let uri: string
      try {
        uri = decrypt(wallet.nwcConnectionUriEnc)
      } catch {
        return res.status(500).json({ error: 'NWC_DECRYPT_FAILED', message: 'Could not decrypt stored NWC connection' })
      }

      // Hold-invoice path (ADR-193/208): paying a hold invoice puts the HTLC
      // into ACCEPTED; the NIP-47 response only resolves on settle/cancel. So
      // we dispatch and return immediately — held state is confirmed by the
      // existing hold-invoice polling, not by this promise.
      if (escrow) {
        if (!acquireDispatchLock(`nwc:${bolt11}`)) {
          return res.status(409).json({ error: 'DISPATCH_IN_PROGRESS', message: 'This invoice is already being dispatched — do not retry.' })
        }
        const escrowClient = new NwcClient(uri)
        escrowClient
          .payInvoice(bolt11)
          .catch(err => console.error('[Wallet/NWC] Escrow pay dispatch failed:', err))
          .finally(() => escrowClient.close())
        return res.json({ ok: true, dispatched: true, status: 'DISPATCHED' })
      }

      // Normal invoice: block until settled.
      const client = new NwcClient(uri)
      try {
        const result = await client.payInvoice(bolt11)
        // NIP-47 payInvoice returns only the preimage; payment_hash = sha256(preimage)
        // (BOLT11 convention), matching the PaymentResult.paymentHash contract used
        // by every other payment path (WEBLN, custodial) in the codebase.
        const paymentHash = createHash('sha256').update(Buffer.from(result.preimage, 'hex')).digest('hex')
        res.json({ ok: true, preimage: result.preimage, paymentHash, feesPaidSats: result.feesPaidSats, status: 'SUCCESS' })
      } finally {
        client.close()
      }
    } catch (error) {
      console.error('Failed to pay via NWC:', error)
      res.status(500).json({ error: 'Failed to pay via NWC' })
    }
  })

  // ---------------------------------------------------------------------------
  // ADR-228: Alby OAuth — normal-invoice payments only from the user's Alby
  // account balance. `escrow: true` is explicitly rejected here (D5) — Alby's
  // OAuth API cannot create hold invoices, and this route is the one real
  // place a "pay with connected wallet" dispatch exists today (mirrors
  // /nwc/pay's escrow branch), so this is where that exclusion is enforced.
  // ---------------------------------------------------------------------------

  // POST /api/wallet/alby/pay
  //   Body: { bolt11 }
  router.post('/alby/pay', async (req: Request, res: Response) => {
    try {
      const { bolt11, escrow } = req.body as { bolt11?: string; escrow?: boolean }
      const authPubkey = (req as Request & { authPubkey?: string }).authPubkey
      if (!authPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
      if (!bolt11) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'bolt11 is required' })
      if (escrow) {
        return res.status(400).json({
          error: 'NOT_SUPPORTED_BY_ALBY_OAUTH',
          message: 'Escrow funding is not available from an Alby OAuth wallet — use the platform wallet or NWC.',
        })
      }

      const user = await prisma.user.findUnique({ where: { pubkey: authPubkey } })
      if (!user) return res.status(404).json({ error: 'User not found' })

      let albyProvider
      try {
        albyProvider = await createAlbyOauthProviderForUser(prisma, user.id)
      } catch {
        return res.status(400).json({ error: 'WALLET_NOT_CONNECTED', message: 'No Alby OAuth wallet connected' })
      }

      const result = await albyProvider.payInvoice(bolt11)
      res.json({ ok: result.status === 'SUCCESS', ...result })
    } catch (error) {
      console.error('Failed to pay via Alby OAuth:', error)
      res.status(500).json({ error: 'Failed to pay via Alby OAuth' })
    }
  })

  return router
}
