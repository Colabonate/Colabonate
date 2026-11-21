import { describe, it, expect, vi } from 'vitest'
import { SubWalletService, SUB_WALLET_SOFT_LIMIT, SUB_WALLET_WARN_AT } from './subWallet.js'
import type { PaymentProvider } from '@col/payments'
import type { PrismaClient } from '@prisma/client'

// Mock Prisma: just the offer.count + offer.create paths we exercise.
function makeMockPrisma(opts: { existingCount?: number } = {}) {
  const existingCount = opts.existingCount ?? 0
  return {
    offer: {
      count: vi.fn(async () => existingCount),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'offer-1', ...data })),
    },
  } as unknown as ConstructorParameters<typeof SubWalletService>[0]
}

describe('SubWalletService (PROB-003 B-α)', () => {
  describe('provider capability', () => {
    it('returns ok=false when provider does not support createSubWallet', async () => {
      const provider = {} as PaymentProvider
      const svc = new SubWalletService(makeMockPrisma(), provider)
      const result = await svc.create({ label: 'test', ownerPubkey: 'a'.repeat(64) })
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/does not support sub-wallets/)
    })

    it('isPrivateModeSupported() returns true for providers with createSubWallet', () => {
      const provider = { createSubWallet: async () => null } as unknown as PaymentProvider
      const svc = new SubWalletService(makeMockPrisma(), provider)
      expect(svc.isPrivateModeSupported()).toBe(true)
    })

    it('isPrivateModeSupported() returns false for WebLN-only providers', () => {
      const provider = {} as PaymentProvider
      const svc = new SubWalletService(makeMockPrisma(), provider)
      expect(svc.isPrivateModeSupported()).toBe(false)
    })
  })

  describe('create()', () => {
    it('returns ok=true with config when sub-wallet is created', async () => {
      const provider = {
        createSubWallet: async (label: string) => ({
          walletId: 'sub-wallet-1',
          adminkey: 'adminkey-1',
          readonlyKey: 'readonly-1',
        }),
      } as unknown as PaymentProvider
      const svc = new SubWalletService(makeMockPrisma(), provider)
      const result = await svc.create({ label: 'test-label', ownerPubkey: 'a'.repeat(64) })
      expect(result.ok).toBe(true)
      expect(result.config).toEqual({
        walletId: 'sub-wallet-1',
        adminkey: 'adminkey-1',
        readonlyKey: 'readonly-1',
      })
    })

    it('returns ok=false with error when provider returns null', async () => {
      const provider = {
        createSubWallet: async () => null,
      } as unknown as PaymentProvider
      const svc = new SubWalletService(makeMockPrisma(), provider)
      const result = await svc.create({ label: 'test', ownerPubkey: 'a'.repeat(64) })
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/returned null/)
    })

    it('returns ok=false with soft-limit error when user is at the cap', async () => {
      const provider = {
        createSubWallet: async () => null,
      } as unknown as PaymentProvider
      const svc = new SubWalletService(makeMockPrisma({ existingCount: SUB_WALLET_SOFT_LIMIT }), provider)
      const result = await svc.create({ label: 'test', ownerPubkey: 'a'.repeat(64) })
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/soft limit reached/)
    })
  })

  describe('countForUser()', () => {
    it('returns warning=false, limitReached=false for users with few sub-wallets', async () => {
      const provider = {} as PaymentProvider
      const svc = new SubWalletService(makeMockPrisma({ existingCount: 5 }), provider)
      const result = await svc.countForUser('a'.repeat(64))
      expect(result).toEqual({ total: 5, warning: false, limitReached: false })
    })

    it('returns warning=true at the warn threshold', async () => {
      const provider = {} as PaymentProvider
      const svc = new SubWalletService(makeMockPrisma({ existingCount: SUB_WALLET_WARN_AT }), provider)
      const result = await svc.countForUser('a'.repeat(64))
      expect(result.warning).toBe(true)
      expect(result.limitReached).toBe(false)
    })

    it('returns limitReached=true at the cap', async () => {
      const provider = {} as PaymentProvider
      const svc = new SubWalletService(makeMockPrisma({ existingCount: SUB_WALLET_SOFT_LIMIT }), provider)
      const result = await svc.countForUser('a'.repeat(64))
      expect(result.warning).toBe(true)
      expect(result.limitReached).toBe(true)
    })
  })

  describe('createForOffer / createForCooperation', () => {
    it('trims offer id and cooperation id to 12 chars in the label', async () => {
      const createSubWallet = vi.fn(async (label: string) => ({
        walletId: 'sub-1',
        adminkey: 'a',
        readonlyKey: 'r',
        _label: label,
      }))
      const provider = { createSubWallet } as unknown as PaymentProvider
      const svc = new SubWalletService(makeMockPrisma(), provider)
      await svc.createForOffer('this-is-a-very-long-offer-id-1234567890', 'a'.repeat(64))
      const offerLabel = createSubWallet.mock.calls[0][0]
      expect(offerLabel).toMatch(/^colabonate-offer-this-is-a-ve$/)
      expect(offerLabel.length).toBeLessThanOrEqual('colabonate-offer-'.length + 12)
    })
  })

  // --- ADR-164 / B-α wiring: provisionPrivateTrade ---
  // Extended mock supporting user.findUnique + offer/cooperation.update.
  function makeProvisionMockPrisma(opts: {
    strategy?: 'HYBRID' | 'CUSTODIAL_ONLY' | 'NONCUSTODIAL_ONLY' | null
    userExists?: boolean
  } = {}) {
    const userExists = opts.userExists ?? true
    const strategy = opts.strategy ?? 'HYBRID'
    const updateCalls: Record<string, unknown>[] = []
    return {
      _updateCalls: updateCalls,
      user: {
        findUnique: vi.fn(async () =>
          userExists ? { walletModeStrategy: strategy } : null,
        ),
      },
      offer: {
        count: vi.fn(async () => 0),
        update: vi.fn(async (args: Record<string, unknown>) => {
          updateCalls.push({ kind: 'offer', ...args })
          return {}
        }),
      },
      cooperation: {
        update: vi.fn(async (args: Record<string, unknown>) => {
          updateCalls.push({ kind: 'cooperation', ...args })
          return {}
        }),
      },
    } as unknown as PrismaClient & { _updateCalls: Record<string, unknown>[] }
  }

  describe('provisionPrivateTrade() (ADR-164 / B-α wiring)', () => {
    it('provisions + persists offer.lightningSubWalletId when strategy resolves to CUSTODIAL (HYBRID)', async () => {
      const provider = {
        createSubWallet: async () => ({ walletId: 'sub-wallet-X', adminkey: 'a', readonlyKey: 'r' }),
      } as unknown as PaymentProvider
      const prisma = makeProvisionMockPrisma({ strategy: 'HYBRID' })
      const svc = new SubWalletService(prisma, provider)
      const r = await svc.provisionPrivateTrade({ kind: 'offer', tradeId: 'offer-1', ownerPubkey: 'a'.repeat(64) })
      expect(r.provisioned).toBe(true)
      expect(r.walletId).toBe('sub-wallet-X')
      expect(prisma._updateCalls).toHaveLength(1)
      expect(prisma._updateCalls[0]).toMatchObject({
        kind: 'offer',
        where: { id: 'offer-1' },
        data: { lightningSubWalletId: 'sub-wallet-X' },
      })
    })

    it('provisions + persists cooperation.escrowSubWalletId for CUSTODIAL_ONLY', async () => {
      const provider = {
        createSubWallet: async () => ({ walletId: 'coop-sub-1', adminkey: 'a', readonlyKey: 'r' }),
      } as unknown as PaymentProvider
      const prisma = makeProvisionMockPrisma({ strategy: 'CUSTODIAL_ONLY' })
      const svc = new SubWalletService(prisma, provider)
      const r = await svc.provisionPrivateTrade({ kind: 'cooperation', tradeId: 'coop-1', ownerPubkey: 'b'.repeat(64) })
      expect(r.provisioned).toBe(true)
      expect(prisma._updateCalls[0]).toMatchObject({
        kind: 'cooperation',
        data: { escrowSubWalletId: 'coop-sub-1' },
      })
    })

    it('skips provisioning (no isolation) for NONCUSTODIAL_ONLY — user chose sovereignty', async () => {
      const createSubWallet = vi.fn(async () => ({ walletId: 'x', adminkey: 'a', readonlyKey: 'r' }))
      const provider = { createSubWallet } as unknown as PaymentProvider
      const prisma = makeProvisionMockPrisma({ strategy: 'NONCUSTODIAL_ONLY' })
      const svc = new SubWalletService(prisma, provider)
      const r = await svc.provisionPrivateTrade({ kind: 'offer', tradeId: 'offer-1', ownerPubkey: 'a'.repeat(64) })
      expect(r.provisioned).toBe(false)
      expect(r.walletId).toBeNull()
      expect(r.reason).toMatch(/NON_CUSTODIAL/)
      expect(createSubWallet).not.toHaveBeenCalled()
      expect(prisma._updateCalls).toHaveLength(0)
    })

    it('defaults to HYBRID (→ CUSTODIAL) when the User row does not exist yet', async () => {
      const provider = {
        createSubWallet: async () => ({ walletId: 'sub-default', adminkey: 'a', readonlyKey: 'r' }),
      } as unknown as PaymentProvider
      const prisma = makeProvisionMockPrisma({ userExists: false })
      const svc = new SubWalletService(prisma, provider)
      const r = await svc.provisionPrivateTrade({ kind: 'offer', tradeId: 'offer-1', ownerPubkey: 'a'.repeat(64) })
      expect(r.provisioned).toBe(true)
      expect(prisma._updateCalls).toHaveLength(1)
    })

    it('returns provisioned=false (best-effort) when the provider lacks createSubWallet', async () => {
      const provider = {} as PaymentProvider
      const prisma = makeProvisionMockPrisma({ strategy: 'HYBRID' })
      const svc = new SubWalletService(prisma, provider)
      const r = await svc.provisionPrivateTrade({ kind: 'offer', tradeId: 'offer-1', ownerPubkey: 'a'.repeat(64) })
      expect(r.provisioned).toBe(false)
      expect(r.reason).toMatch(/does not support sub-wallets/)
      expect(prisma._updateCalls).toHaveLength(0)
    })

    it('returns provisioned=false when the provider returns null (best-effort)', async () => {
      const provider = { createSubWallet: async () => null } as unknown as PaymentProvider
      const prisma = makeProvisionMockPrisma({ strategy: 'HYBRID' })
      const svc = new SubWalletService(prisma, provider)
      const r = await svc.provisionPrivateTrade({ kind: 'offer', tradeId: 'offer-1', ownerPubkey: 'a'.repeat(64) })
      expect(r.provisioned).toBe(false)
      expect(prisma._updateCalls).toHaveLength(0) // nothing persisted on failure
    })
  })
})
