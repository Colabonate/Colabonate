import type { PrismaClient } from '@prisma/client'
import { canBuildReputation } from './tradeVisibility.js'

export type ColPointsReason =
  | 'TICKET_COMPLETED_SELLER'
  | 'TICKET_COMPLETED_BUYER'
  | 'MUTUAL_REVIEW'
  | 'HID_L2_UPGRADE'
  | 'HID_L3_UPGRADE'

export class ColPointsService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Award COL-Points to a user. If a ticketId is provided, the ticket's
   * visibility is checked: private trades do not earn COL-Points
   * (ADR-152 §A3 — reputation is public-only). Returns true if the award
   * was applied, false if it was skipped due to a private ticket.
   */
  async awardPoints(
    pubkey: string,
    delta: number,
    reason: ColPointsReason,
    ticketId?: string
  ): Promise<{ awarded: boolean; reason?: string }> {
    if (ticketId) {
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { visibility: true },
      })
      if (!canBuildReputation(ticket?.visibility)) {
        return { awarded: false, reason: 'PRIVATE_TRADE_NO_REPUTATION' }
      }
    }

    await this.prisma.$transaction([
      this.prisma.colPointsEvent.create({
        data: { pubkey, delta, reason, ticketId },
      }),
      this.prisma.user.update({
        where: { pubkey },
        data: { colPoints: { increment: delta } },
      }),
    ])
    return { awarded: true }
  }

  async getBalance(pubkey: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { pubkey },
      select: { colPoints: true },
    })
    return user?.colPoints ?? 0
  }

  async getHistory(pubkey: string) {
    return this.prisma.colPointsEvent.findMany({
      where: { pubkey },
      orderBy: { createdAt: 'desc' },
    })
  }
}
