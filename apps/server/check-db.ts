import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'

const adapter = new PrismaLibSql({ url: 'file:../../dev.db' })
const prisma = new PrismaClient({ adapter })

async function checkTickets() {
  const tickets = await prisma.ticket.findMany()
  console.log(`Found ${tickets.length} tickets in local DB.`)
  if (tickets.length > 0) {
    console.log(tickets[tickets.length - 1])
  } else {
    console.log('No tickets found in the database at all.')
  }
}

checkTickets().catch(console.error).finally(() => prisma.$disconnect())
