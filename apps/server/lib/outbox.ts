import type { PrismaClient, Prisma } from '@prisma/client'

export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

export async function writeWithOutbox<T extends { id: string }>(
  tx: PrismaTransactionClient,
  aggregate: 'offer' | 'company',
  aggregateId: string,
  eventType: 'upsert' | 'delete',
  payload: unknown,
  dbWrite: (id: string) => Promise<T>,
): Promise<T> {
  const id = aggregateId || crypto.randomUUID()
  const result = await dbWrite(id)
  await tx.outboxEvent.create({
    data: {
      aggregate,
      aggregateId: id,
      eventType,
      payload: payload as Prisma.InputJsonValue,
    },
  })
  return result
}