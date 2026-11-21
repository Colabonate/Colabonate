// Zod schemas + validators for cooperation events (NIP-C, ADR-150). Structural validation:
// correct kind family + required tags present. See schemas/ticket.ts for the rationale.

import { z } from 'zod'
import { hasRequiredTags } from '../helpers.js'

const tagArray = z.array(z.array(z.string()))

// Kind 30028 (legacy) / 30414 (NIP-C) — Cooperation Proposal.
export const CooperationProposalEventSchema = z
  .object({
    kind: z.union([z.literal(30028), z.literal(30414)]),
    content: z.string(),
    tags: tagArray,
  })
  .refine(e => hasRequiredTags(e.tags, 'd', 'type', 'cooperation', 'initiator', 'partner', 'title', 'status'), {
    message: 'Cooperation Proposal event requires d, type, cooperation, initiator, partner, title, status tags',
  })
export const validateCooperationProposal = (data: unknown) => CooperationProposalEventSchema.safeParse(data)

// Kind 30029 (legacy) / 30415 (NIP-C) — Milestone Event.
export const MilestoneEventSchema = z
  .object({
    kind: z.union([z.literal(30029), z.literal(30415)]),
    content: z.string(),
    tags: tagArray,
  })
  .refine(e => hasRequiredTags(e.tags, 'd', 'cooperation', 'milestone', 'status'), {
    message: 'Milestone event requires d, cooperation, milestone, status tags',
  })
export const validateMilestone = (data: unknown) => MilestoneEventSchema.safeParse(data)
