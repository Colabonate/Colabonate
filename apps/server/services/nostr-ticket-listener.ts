import { SimplePool, verifyEvent, type Event, type Filter } from 'nostr-tools'
import type { PrismaClient } from '@prisma/client'
import type { ColPointsService } from './colPointsService.js'
import { enqueueCanvasLifecycleForTicket } from './canvas-lifecycle.js'
import { notifyTicketStatusChange } from './notifications.js'
import { remoteOfferPurchaseBlock } from '../lib/remote-offer-guard.js'

export class NostrTicketListener {
  private pool: SimplePool
  private relays: string[]
  private prisma: PrismaClient
  private colPointsService: ColPointsService
  private sub: any

  constructor(
    prisma: PrismaClient,
    colPointsService: ColPointsService,
    relayUrls: string[] = ['wss://ribo.nostria.app', 'wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']
  ) {
    this.pool = new SimplePool()
    this.relays = relayUrls
    this.prisma = prisma
    this.colPointsService = colPointsService
  }

  async start(): Promise<void> {
    const filter: any = {
      kinds: [30018, 30019, 30024, 30026, 30411, 30407, 30408, 30414], // Legacy + NIP-compliant: Review (30024/30411, ADR-277 D0 — was 30406), TicketCreated (30018/30407), TicketStatus (30019/30408), ProximityProof (30026), Cooperation (30414)
      since: Math.floor(Date.now() / 1000),
    }

    this.sub = this.pool.subscribeMany(this.relays, filter, {
      onevent: async (event: Event) => {
        await this.handleEvent(event)
      },
    })
    console.log('Nostr ticket listener started on relays:', this.relays)
  }

  stop(): void {
    if (this.sub) {
      this.sub.close()
    }
    this.pool.close(this.relays)
  }

  private async handleEvent(event: Event): Promise<void> {
    try {
      // SECURITY (pentest G3, 2026-09-17): subscribeMany() does not verify
      // signatures on received events — a malicious or compromised relay
      // could forward forged events (e.g. a fake TicketStatus 30408 marking
      // a ticket COMPLETED) and this listener would process them as if the
      // claimed pubkey had really signed them. "Don't trust, verify" is a
      // Nostr protocol invariant the client must enforce itself.
      if (!verifyEvent(event)) {
        console.error(`[SECURITY] Rejected event ${event.id} with invalid signature (kind ${event.kind}, claimed pubkey ${event.pubkey})`)
        return
      }
      console.log(`[DEBUG] Received event kind ${event.kind}: ${event.id}`)
      if (event.kind === 30018) {
        await this.handleTicketRequest(event)
      } else if (event.kind === 30019) {
        await this.handleStatusUpdate(event)
      } else if (event.kind === 30024 || event.kind === 30411) {
        await this.handleReviewEvent(event)
      } else if (event.kind === 30026) {
        await this.handleProximityProofEvent(event)
      } else if (event.kind === 30407) {
        await this.handleTicketCreatedNip(event)
      } else if (event.kind === 30408) {
        await this.handleTicketStatusNip(event)
      } else if (event.kind === 30414) {
        await this.handleCooperationProposal(event)
      }
    } catch (error) {
      console.error(`[ERROR] Error processing event ${event.id}:`, error)
    }
  }

  private async handleTicketRequest(event: Event): Promise<void> {
    const offerIdTag = event.tags.find(t => t[0] === 'd')
    const sellerTag = event.tags.find(t => t[0] === 'p')

    if (!offerIdTag || !sellerTag) {
      console.log(`[DEBUG] 30018 event ${event.id} missing 'd' (offerId) or 'p' (seller) tag. Tags:`, event.tags)
      return
    }

    const offerId = offerIdTag[1]
    const sellerPubkey = sellerTag[1]
    const buyerPubkey = event.pubkey

    console.log(`[DEBUG] 30018 event ${event.id} targets offer ${offerId} by seller ${sellerPubkey}`)

    // Verify offer exists
    const offerExists = await this.prisma.offer.findUnique({
      where: { id: offerId }
    })

    if (!offerExists) {
      console.warn(`[DEBUG] Ignored ticket request for unknown offer: ${offerId}`)
      return
    }

    // ADR-415: remote offers have no seller rail with Colabonate — never index orders for them.
    if (remoteOfferPurchaseBlock(offerExists)) {
      console.warn(`[DEBUG] Ignored ticket request for remote offer: ${offerId}`)
      return
    }

    // Ensure buyer exists in our DB (Nostr pubkeys can interact without local signup)
    await this.prisma.user.upsert({
      where: { pubkey: buyerPubkey },
      update: {},
      create: { pubkey: buyerPubkey }
    })

    // Check if ticket already exists
    const existing = await this.prisma.ticket.findUnique({
      where: { nostrEventId: event.id }
    })

    if (existing) {
      console.log(`[DEBUG] Ticket already exists for event ${event.id}`)
      return
    }

    const typeTag = event.tags.find(t => t[0] === 'type')
    const ticketType = typeTag ? typeTag[1] : 'SMART_ORDER'

    let milestonesToCreate: any[] = []
    if (ticketType === 'MILESTONE' && event.content) {
      try {
        const parsed = JSON.parse(event.content)
        if (Array.isArray(parsed)) {
          milestonesToCreate = parsed.map((m: any) => ({
            title: m.title || 'Milestone',
            amountSats: m.amountSats || 0,
            dueDate: m.dueDate ? new Date(m.dueDate) : null
          }))
        }
      } catch (e) {
        console.warn(`[DEBUG] Failed to parse MILESTONE content for event ${event.id}:`, e)
      }
    }

    try {
      await this.prisma.ticket.create({
        data: {
          offerId,
          buyerPubkey,
          sellerPubkey,
          status: 'PENDING',
          nostrEventId: event.id,
          ticketType: ticketType as any,
          createdAt: new Date(event.created_at * 1000),
          ...(milestonesToCreate.length > 0 && {
            milestones: {
              create: milestonesToCreate
            }
          })
        }
      })
      console.log(`Indexed new ticket request from Nostr: ${event.id}`)
    } catch (err) {
      console.error(`[DEBUG] Prisma error creating ticket:`, err)
    }
  }

  private async handleStatusUpdate(event: Event): Promise<void> {
    const refEventTag = event.tags.find(t => t[0] === 'e')
    const statusTag = event.tags.find(t => t[0] === 'status')
    const invoiceTag = event.tags.find(t => t[0] === 'invoice')
    const preimageTag = event.tags.find(t => t[0] === 'preimage')

    if (!refEventTag) return
    const refEventId = refEventTag[1]

    const ticket = await this.prisma.ticket.findUnique({
      where: { nostrEventId: refEventId }
    })

    if (!ticket) {
      console.warn(`Received status update for unknown ticket request: ${refEventId}`)
      return
    }

    // ADR-411: the event's pubkey must be a ticket party. Signature validity
    // alone proves nothing — nostrEventId is public on relays, so without this
    // check anyone could rewrite status/invoice/preimage of any ticket.
    if (event.pubkey !== ticket.buyerPubkey && event.pubkey !== ticket.sellerPubkey) {
      console.warn(`[NIP-A] 30019 status event ${event.id} from non-participant ${event.pubkey} for ticket ${ticket.id}; ignoring`)
      return
    }
    const actingPubkey = event.pubkey

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = { updatedAt: new Date(event.created_at * 1000) }

    if (statusTag) {
      const validStatuses = ['PENDING', 'ACCEPTED', 'PAID', 'IN_PROGRESS', 'COMPLETED', 'DISPUTED', 'CANCELLED']
      if (validStatuses.includes(statusTag[1])) {
        updateData.status = statusTag[1]
      }
    }

    if (invoiceTag) updateData.lightningInvoice = invoiceTag[1]
    if (preimageTag) updateData.preimage = preimageTag[1]

    await this.prisma.ticket.update({
      where: { nostrEventId: refEventId },
      data: updateData
    })

    console.log(`Updated ticket ${ticket.id} from Nostr status event: ${event.id}`)

    // ADR-411: relay-applied status changes must reach the counterparty's
    // feed too (parity with PATCH /api/tickets/:id).
    if (updateData.status && updateData.status !== ticket.status) {
      notifyTicketStatusChange(this.prisma, {
        ticketId: ticket.id,
        fromStatus: ticket.status,
        toStatus: updateData.status,
        buyerPubkey: ticket.buyerPubkey,
        sellerPubkey: ticket.sellerPubkey,
        actingPubkey,
        offerTitle: null,
      }).catch(err => console.error('[notifications] 30019 status notify failed:', err))
    }
  }

  private async handleReviewEvent(event: Event): Promise<void> {
    const reviewForTag = event.tags.find(t => t[0] === 'review_for')
    const ticketTag = event.tags.find(t => t[0] === 'ticket')
    const starsTag = event.tags.find(t => t[0] === 'stars')

    if (!reviewForTag || !ticketTag || !starsTag) {
      console.log(`[DEBUG] 30024 review event ${event.id} missing required tags`)
      return
    }

    const revieweePubkey = reviewForTag[1]
    const ticketId = ticketTag[1]
    const stars = parseInt(starsTag[1], 10)

    if (isNaN(stars) || stars < 1 || stars > 5) return

    // Duplicate guard
    const existing = await this.prisma.review.findUnique({ where: { nostrEventId: event.id } })
    if (existing) return

    // Validate ticket
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } })
    if (!ticket || ticket.status !== 'COMPLETED') return

    // 14-day window check
    const windowMs = 14 * 24 * 60 * 60 * 1000
    if (Date.now() - ticket.updatedAt.getTime() > windowMs) return

    // Participant check
    const reviewerPubkey = event.pubkey
    if (reviewerPubkey !== ticket.buyerPubkey && reviewerPubkey !== ticket.sellerPubkey) return

    await this.prisma.review.create({
      data: {
        ticketId,
        reviewerPubkey,
        revieweePubkey,
        stars,
        content: event.content.slice(0, 2048),
        nostrEventId: event.id,
      },
    })

    // Mutual review check → award COL-Points if both parties reviewed
    const otherPartyPubkey = reviewerPubkey === ticket.buyerPubkey ? ticket.sellerPubkey : ticket.buyerPubkey
    const otherReview = await this.prisma.review.findFirst({
      where: { ticketId, reviewerPubkey: otherPartyPubkey },
    })
    if (otherReview) {
      await this.colPointsService.awardPoints(reviewerPubkey, 3, 'MUTUAL_REVIEW', ticketId)
      await this.colPointsService.awardPoints(otherPartyPubkey, 3, 'MUTUAL_REVIEW', ticketId)
    }

    console.log(`Indexed review from Nostr: ${event.id}`)
  }

  private async handleProximityProofEvent(event: Event): Promise<void> {
    const subjectTag = event.tags.find(t => t[0] === 'p')
    const subjectPubkey = subjectTag?.[1]
    console.log(`[DEBUG] Received Kind 30026 proximity proof from ${event.pubkey} for subject ${subjectPubkey}. Logging only in Phase 3.`)
  }

  private async handleTicketCreatedNip(event: Event): Promise<void> {
    const dTag = event.tags.find(t => t[0] === 'd')
    const ticketTag = event.tags.find(t => t[0] === 'ticket')
    const ticketId = ticketTag?.[1] ?? dTag?.[1]

    if (!ticketId) {
      console.log(`[DEBUG] 30407 event ${event.id} missing 'ticket'/'d' tag`)
      return
    }

    const existing = await this.prisma.ticket.findUnique({ where: { id: ticketId } })
    if (!existing) {
      console.log(`[DEBUG] 30407 event ${event.id} references unknown ticket ${ticketId}; REST creation path expected to run first`)
      return
    }

    console.log(`[NIP-B] Observed Kind 30407 for ticket ${ticketId} from ${event.pubkey}`)
  }

  private async handleTicketStatusNip(event: Event): Promise<void> {
    const ticketTag = event.tags.find(t => t[0] === 'ticket')
    const dTag = event.tags.find(t => t[0] === 'd')
    const statusTag = event.tags.find(t => t[0] === 'status')
    const invoiceTag = event.tags.find(t => t[0] === 'invoice')
    const preimageTag = event.tags.find(t => t[0] === 'preimage')
    const ticketId = ticketTag?.[1] ?? dTag?.[1]

    if (!ticketId || !statusTag) {
      console.log(`[DEBUG] 30408 event ${event.id} missing 'ticket'/'status' tag`)
      return
    }

    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } })
    if (!ticket) {
      console.log(`[DEBUG] 30408 event ${event.id} references unknown ticket ${ticketId}`)
      return
    }

    const participants = [ticket.buyerPubkey, ticket.sellerPubkey]
    if (!participants.includes(event.pubkey)) {
      console.warn(`[NIP-B] 30408 event ${event.id} from non-participant ${event.pubkey} for ticket ${ticketId}; ignoring`)
      return
    }

    const validStatuses = ['PENDING', 'ACCEPTED', 'PAID', 'IN_PROGRESS', 'COMPLETED', 'DISPUTED', 'CANCELLED']
    if (!validStatuses.includes(statusTag[1])) {
      console.log(`[NIP-B] 30408 event ${event.id} unknown status '${statusTag[1]}'`)
      return
    }

    const eventTime = new Date(event.created_at * 1000)
    if (eventTime <= ticket.updatedAt) {
      console.log(`[NIP-B] 30408 event ${event.id} stale (event=${eventTime.toISOString()} <= ticket=${ticket.updatedAt.toISOString()}); skipping`)
      return
    }

    const updateData: Record<string, unknown> = {
      status: statusTag[1],
      updatedAt: eventTime,
    }
    if (invoiceTag) updateData.lightningInvoice = invoiceTag[1]
    if (preimageTag) updateData.preimage = preimageTag[1]

    await this.prisma.ticket.update({ where: { id: ticketId }, data: updateData })
    console.log(`[NIP-B] Applied Kind 30408 status '${statusTag[1]}' to ticket ${ticketId} from ${event.pubkey}`)

    // ADR-411: relay-applied status changes must reach the counterparty's
    // feed too (parity with PATCH /api/tickets/:id).
    if (statusTag[1] !== ticket.status) {
      notifyTicketStatusChange(this.prisma, {
        ticketId,
        fromStatus: ticket.status,
        toStatus: statusTag[1],
        buyerPubkey: ticket.buyerPubkey,
        sellerPubkey: ticket.sellerPubkey,
        actingPubkey: event.pubkey,
        offerTitle: null,
      }).catch(err => console.error('[notifications] 30408 status notify failed:', err))
    }

    // ADR-353: NIP-90 status events can move a ticket into a terminal state
    // (or reopen it) — mirror that onto the hosted canvas lifecycle. Async
    // via outbox, never blocks the listener loop.
    await enqueueCanvasLifecycleForTicket(this.prisma, ticketId, ticket.status, statusTag[1]).catch((err) =>
      console.error('[canvas-lifecycle] enqueue after 30408 status event failed:', err instanceof Error ? err.message : err),
    )
  }

  private async handleCooperationProposal(event: Event): Promise<void> {
    const dTag = event.tags.find(t => t[0] === 'd')
    const typeTag = event.tags.find(t => t[0] === 'type')
    const titleTag = event.tags.find(t => t[0] === 'title')
    const budgetTag = event.tags.find(t => t[0] === 'budget')
    const statusTag = event.tags.find(t => t[0] === 'status')
    const initiatorTag = event.tags.find(t => t[0] === 'initiator')
    const partnerTag = event.tags.find(t => t[0] === 'partner')
    const coopTypeTag = event.tags.find(t => t[0] === 'cooperation_type')

    if (!dTag) {
      console.log(`[DEBUG] 30414 event ${event.id} missing 'd' tag`)
      return
    }

    const cooperationId = dTag[1]
    const eventType = typeTag?.[1] ?? 'proposal'
    const initiatorPubkey = initiatorTag?.[1] ?? event.pubkey

    await this.prisma.user.upsert({
      where: { pubkey: initiatorPubkey },
      update: {},
      create: { pubkey: initiatorPubkey },
    })

    if (eventType === 'proposal') {
      const existing = await this.prisma.cooperation.findUnique({ where: { id: cooperationId } })
      if (existing) {
        console.log(`[DEBUG] Cooperation ${cooperationId} already exists locally`)
        return
      }

      const title = titleTag?.[1] ?? 'Untitled Cooperation'
      const budgetSats = budgetTag ? parseInt(budgetTag[1]) || 0 : 0

      await this.prisma.cooperation.create({
        data: {
          id: cooperationId,
          title,
          description: event.content || null,
          initiatorPubkey,
          partnerPubkey: partnerTag?.[1] || null,
          cooperationType: (coopTypeTag?.[1] as any) || null,
          budgetSats,
          status: (statusTag?.[1] as any) || 'OPEN',
        },
      }).catch(err => {
        console.warn(`[DEBUG] Could not create cooperation from Nostr event ${event.id}:`, err.message)
      })
      console.log(`Indexed cooperation proposal from Nostr: ${cooperationId}`)
    } else if (eventType === 'acceptance') {
      const existing = await this.prisma.cooperation.findUnique({ where: { id: cooperationId } })
      if (!existing) {
        console.log(`[DEBUG] Acceptance for unknown cooperation ${cooperationId}`)
        return
      }
      // The acceptance must record the partner pubkey, not the event signer pubkey.
      // Server-published events are signed with an ephemeral key, so event.pubkey
      // would overwrite the real partner with a 64-hex hash.
      const partnerPubkey = partnerTag?.[1] || event.pubkey
      await this.prisma.cooperation.update({
        where: { id: cooperationId },
        data: {
          partnerPubkey,
          status: 'ACCEPTED',
          nostrAcceptId: event.id,
        },
      })
      console.log(`Updated cooperation ${cooperationId} with acceptance from ${partnerPubkey}`)
    }
  }
}
