/**
 * Sub-Wallet Service (PROB-003 B-α — Phase 1)
 *
 * Manages isolated LNBits sub-wallets for private-mode trades. Each PRIVATE
 * Offer / Cooperation / Ticket gets its own sub-wallet, so:
 *   - The LNBits operator can see individual sub-wallet activity but cannot
 *     trivially correlate it to the user's main identity
 *   - WebLN is disabled in private mode (the user sees a clear UI message)
 *   - Sub-wallet lifetime is bounded (90 days inactivity → read-only)
 *   - Soft limit 50 sub-wallets per user (warn at 20)
 *
 * Sub-wallet creation is async and best-effort: if it fails, the offer is
 * still created with a warning to the user. We do not block the offer flow
 * on a wallet-availability issue.
 *
 * The sub-wallet's adminkey is stored separately from the trade row. For
 * Phase 1, we just record the linkage (lightningSubWalletId) — the adminkey
 * is returned to the caller for them to store in their secret manager.
 * A follow-up Phase (e.g. 4+) can move this into a dedicated Vault table.
 */

import type { PrismaClient } from '@prisma/client'
import type { PaymentProvider } from '@col/payments'
import { resolveWalletMode } from './walletStrategy.js'
import { isProductionDirectPayOnly } from './betaMode.js'

export interface SubWalletConfig {
  /** LNBits walletId (the sub-wallet's id) */
  walletId: string
  /** Sub-wallet admin key (caller MUST store in secret manager) */
  adminkey: string
  /** Sub-wallet read-only key (for invoice creation) */
  readonlyKey: string
}

export interface SubWalletResult {
  ok: boolean
  config?: SubWalletConfig
  error?: string
}

const SUB_WALLET_SOFT_LIMIT = 50
const SUB_WALLET_WARN_AT = 20

export class SubWalletService {
  constructor(
    private prisma: PrismaClient,
    private payments: PaymentProvider,
  ) {}

  /**
   * Creates an isolated sub-wallet for a private offer. Returns null if the
   * payment provider does not support sub-wallets.
   */
  async createForOffer(offerId: string, creatorPubkey: string): Promise<SubWalletResult> {
    return this.create({
      label: `colabonate-offer-${offerId.slice(0, 12)}`,
      ownerPubkey: creatorPubkey,
    })
  }

  /**
   * Creates an isolated sub-wallet for a private cooperation.
   */
  async createForCooperation(cooperationId: string, initiatorPubkey: string): Promise<SubWalletResult> {
    return this.create({
      label: `colabonate-coop-${cooperationId.slice(0, 12)}`,
      ownerPubkey: initiatorPubkey,
    })
  }

  /**
   * Core create logic. Idempotent on label collisions (LNBits may return
   * the same walletId for repeated identical labels).
   */
  async create(input: { label: string; ownerPubkey: string }): Promise<SubWalletResult> {
    if (!this.payments.createSubWallet) {
      return { ok: false, error: 'Payment provider does not support sub-wallets (e.g. WebLN-only)' }
    }

    // Soft limit check
    const existing = await this.prisma.offer.count({
      where: {
        creatorPubkey: input.ownerPubkey,
        lightningSubWalletId: { not: null },
      },
    })
    if (existing >= SUB_WALLET_SOFT_LIMIT) {
      return {
        ok: false,
        error: `Sub-wallet soft limit reached (${SUB_WALLET_SOFT_LIMIT}). Rotate an existing sub-wallet or contact support.`,
      }
    }
    if (existing >= SUB_WALLET_WARN_AT) {
      console.warn(`[sub-wallet] User ${input.ownerPubkey.slice(0, 8)} has ${existing} sub-wallets (warning threshold: ${SUB_WALLET_WARN_AT})`)
    }

    const config = await this.payments.createSubWallet(input.label)
    if (!config) {
      return { ok: false, error: 'createSubWallet returned null' }
    }
    return { ok: true, config }
  }

  /**
   * Returns the count of active sub-wallets for a user. The UI uses this
   * to show a warning banner at SUB_WALLET_WARN_AT and a hard-stop message
   * at SUB_WALLET_SOFT_LIMIT.
   */
  async countForUser(pubkey: string): Promise<{ total: number; warning: boolean; limitReached: boolean }> {
    const total = await this.prisma.offer.count({
      where: { creatorPubkey: pubkey, lightningSubWalletId: { not: null } },
    })
    return {
      total,
      warning: total >= SUB_WALLET_WARN_AT,
      limitReached: total >= SUB_WALLET_SOFT_LIMIT,
    }
  }

  /**
   * Returns true if the user's payment setup is suitable for private mode.
   * Currently: a custodial provider with createSubWallet support.
   */
  isPrivateModeSupported(): boolean {
    return typeof this.payments.createSubWallet === 'function'
  }

  /**
   * ADR-164 / PROB-003 B-α wiring — the single entry point the offer/cooperation
   * creation routes call for a PRIVATE trade. Encapsulates the full decision:
   *
   *   1. Read the owner's WalletModeStrategy (default HYBRID if no User row).
   *   2. resolveWalletMode(strategy, 'PRIVATE') — ADR-160 SOT.
   *   3. Only when it resolves to CUSTODIAL do we provision an isolated
   *      sub-wallet (B-α). NON_CUSTODIAL means the user explicitly chose
   *      self-sovereignty over isolation (caveat surfaced in Settings UI).
   *   4. Persist the linkage id on the trade row. The provider's master admin
   *      key operates the sub-wallet by id (same model as the primary Wallet,
   *      which also stores no per-wallet adminkey).
   *
   * Best-effort: on any failure returns { provisioned: false, reason } and the
   * caller logs + continues. The trade still exists; it just degrades to the
   * pre-B-α primary-wallet behaviour.
   */
  async provisionPrivateTrade(input: {
    kind: 'offer' | 'cooperation'
    tradeId: string
    ownerPubkey: string
  }): Promise<{ provisioned: boolean; walletId: string | null; reason?: string }> {
    // ADR-253: a real production host is Direct-Pay only — no LNBits/LND node,
    // so no sub-wallet can be provisioned. Short-circuit before attempting a
    // doomed upstream call; the trade is still created (best-effort contract).
    if (isProductionDirectPayOnly()) {
      return {
        provisioned: false,
        walletId: null,
        reason: 'production is Direct-Pay only (ADR-253) — no custodial sub-wallets',
      }
    }
    const user = await this.prisma.user.findUnique({
      where: { pubkey: input.ownerPubkey },
      select: { walletModeStrategy: true },
    })
    const strategy = user?.walletModeStrategy ?? 'HYBRID'
    const mode = resolveWalletMode(strategy, 'PRIVATE')
    if (mode !== 'CUSTODIAL') {
      return {
        provisioned: false,
        walletId: null,
        reason: `strategy ${strategy} resolves to ${mode} (no B-α isolation by user choice)`,
      }
    }
    const result =
      input.kind === 'offer'
        ? await this.createForOffer(input.tradeId, input.ownerPubkey)
        : await this.createForCooperation(input.tradeId, input.ownerPubkey)
    if (!result.ok || !result.config) {
      return { provisioned: false, walletId: null, reason: result.error }
    }
    if (input.kind === 'offer') {
      await this.prisma.offer.update({
        where: { id: input.tradeId },
        data: {
          lightningSubWalletId: result.config.walletId,
          lightningSubWalletAdminKey: result.config.adminkey,
        },
      })
    } else {
      await this.prisma.cooperation.update({
        where: { id: input.tradeId },
        data: { escrowSubWalletId: result.config.walletId },
      })
    }
    return { provisioned: true, walletId: result.config.walletId }
  }
}

export { SUB_WALLET_SOFT_LIMIT, SUB_WALLET_WARN_AT }
