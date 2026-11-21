export interface Dispute {
  id: string
  disputeId: string
  ticketId: string
  status: string
  outcome: string | null
  openedAt: string
  resolvedAt: string | null
  escalatedAt: string | null
  verdictIssuedAt: string | null
  disclosureDeadline: string | null
  quorumTypeSnapshot: string | null
  thresholdNSnapshot: number | null
  arbitratorPubkey: string | null
  daoId: string
  dao?: { id: string; name: string }
  appealRequest?: {
    appealRequestId: string
    appellantPubkey: string
    reason: string | null
    createdAt: string
  }
  ticket: {
    id: string
    status: string
    amountSats: number | null
    visibility: number
    offer: { id: string; title: string; priceSats: number }
    buyerPubkey: string
    sellerPubkey: string
    disputeReason?: string | null
  }
  verdicts: Array<{
    id: string
    verdictId: string
    outcome: string
    reasoning: string | null
    arbitratorPubkey: string
    createdAt: string
    round: number
  }>
  disclosures: Array<{
    id: string
    disclosedByPubkey: string
    method: string
    commitmentVerified: boolean
    payloadJson: string | null
    nostrEventId: string | null
    createdAt: string
  }>
}

export interface DisclosureSummary {
  required: boolean
  deadline?: string | null
  deadlineExpired?: boolean
  buyerDisclosed?: boolean
  sellerDisclosed?: boolean
}

export interface DaoMember {
  id: string
  pubkey: string
  role: string
  status: string
  credentialEventId: string | null
  invitedBy: string | null
  acceptedAt: string | null
  revokedAt: string | null
  addedAt: string
}
