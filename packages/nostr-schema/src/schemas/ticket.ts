// Zod schemas + validators for ticket events (ADR-150). Validation is structural:
// the event carries the right kind family and the required tags are present. Tag-value
// shape checks (the Gamma tuple-union pattern) can be layered on later; the immediate
// value is catching missing/typo'd required tags before an event reaches a relay.
//
// These are available for opt-in use at the publish boundary; wiring rejection into the
// live path is a separate step (ADR-150 Implementation, deferred) to stay behavior-preserving.

import { z } from 'zod'
import { hasRequiredTags } from '../helpers.js'

const tagArray = z.array(z.array(z.string()))

// Kind 30018 (legacy) / 30407 (NIP-B) — Ticket Created.
export const TicketCreatedEventSchema = z
  .object({
    kind: z.union([z.literal(30018), z.literal(30407)]),
    content: z.string(),
    tags: tagArray,
  })
  .refine(e => hasRequiredTags(e.tags, 'd', 'ticket', 'offer', 'buyer', 'seller', 'status'), {
    message: 'Ticket Created event requires d, ticket, offer, buyer, seller, status tags',
  })
export const validateTicketCreated = (data: unknown) => TicketCreatedEventSchema.safeParse(data)

// Kind 30019 (legacy) / 30408 (NIP-B) — Ticket Status Update.
export const TicketStatusEventSchema = z
  .object({
    kind: z.union([z.literal(30019), z.literal(30408)]),
    content: z.string(),
    tags: tagArray,
  })
  .refine(e => hasRequiredTags(e.tags, 'd', 'ticket', 'status'), {
    message: 'Ticket Status event requires d, ticket, status tags',
  })
export const validateTicketStatus = (data: unknown) => TicketStatusEventSchema.safeParse(data)
