import type { Dao, DaoMember } from '@prisma/client'

export interface CredentialRevocationTemplate {
  kind: 5
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
}

export function composeCredentialRevocation(
  credentialEventId: string,
  adminPubkey: string,
): CredentialRevocationTemplate {
  return {
    kind: 5,
    pubkey: adminPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['e', credentialEventId],
    ],
    content: 'Credential revocation due to membership revoke',
  }
}

export interface DaoCreationEventTemplate {
  kind: 30022
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
}

export interface ArbitratorCredentialTemplate {
  kind: 30021
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
}

export function composeDaoCreationEvent(
  dao: Dao,
  adminPubkey: string,
  signingPubkey: string
): DaoCreationEventTemplate {
  return {
    kind: 30022,
    pubkey: signingPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', `${dao.id}-dao-creation`],
      ['sub_type', 'dao_creation'],
      ['dao_id', dao.id],
      ['codex_hash', dao.codexHash],
      ['codex_version', dao.codexVersion],
      ['proposal', dao.id],
      ['vote', 'yes'],
      ['voting_model', '1p1v'],
    ],
    content: JSON.stringify({
      sub_type: 'dao_creation',
      dao_id: dao.id,
      name: dao.name,
      codex_hash: dao.codexHash,
      codex_version: dao.codexVersion,
      codex_url: dao.codexUrl,
      status: dao.status,
    }),
  }
}

export function composeArbitratorCredential(
  member: DaoMember,
  issuerPubkey: string,
  signingPubkey: string
): ArbitratorCredentialTemplate {
  return {
    kind: 30021,
    pubkey: signingPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', `${member.daoId}-arbitrator-${signingPubkey}`],
      ['credential_type', 'arbitrator'],
      ['dao_id', member.daoId],
      ['role', member.role],
      ['issued_by', issuerPubkey],
    ],
    content: JSON.stringify({
      credential_type: 'arbitrator',
      dao_id: member.daoId,
      role: member.role,
      issued_by: issuerPubkey,
      pubkey: signingPubkey,
    }),
  }
}

export interface DaoProposalEventTemplate {
  kind: 30420
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
}

export interface DaoVoteEventTemplate {
  kind: 30421
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
}

export interface DaoProposalOutcomeTemplate {
  kind: 30422
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
}

export function composeDaoProposal(
  daoId: string,
  authorPubkey: string,
  proposalId: string,
  title: string,
  content: string,
  executionStrategy: string,
  executionPayload: string | Record<string, unknown> | null,
  votingStart: number | null,
  votingEnd: number | null,
  snapshotTimestamp: number | null,
  proposalType?: string
): DaoProposalEventTemplate {
  const parsedPayload = typeof executionPayload === 'string'
    ? JSON.parse(executionPayload)
    : (executionPayload ?? {})

  const tags: string[][] = [
    ['d', proposalId],
    ['dao_id', daoId],
    ['title', title],
    ['execution_strategy', executionStrategy],
  ]

  if (proposalType) {
    tags.push(['proposal_type', proposalType])
  }

  if (votingStart !== null) {
    tags.push(['voting_start', String(votingStart)])
  }
  if (votingEnd !== null) {
    tags.push(['voting_end', String(votingEnd)])
  }
  if (snapshotTimestamp !== null) {
    tags.push(['snapshot', String(snapshotTimestamp)])
  }

  return {
    kind: 30420,
    pubkey: authorPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify({
      dao_id: daoId,
      proposal_id: proposalId,
      title,
      content,
      execution_strategy: executionStrategy,
      execution_payload: parsedPayload,
      proposal_type: proposalType ?? 'NORMAL_DECISION',
      ...(votingStart !== null ? { voting_start: votingStart } : {}),
      ...(votingEnd !== null ? { voting_end: votingEnd } : {}),
      ...(snapshotTimestamp !== null ? { snapshot: snapshotTimestamp } : {}),
    }),
  }
}

export function composeDaoVote(
  proposalEventId: string,
  voterPubkey: string,
  choice: 'FOR' | 'AGAINST' | 'ABSTAIN',
  votingPower: number,
  strategyUsed: string
): DaoVoteEventTemplate {
  return {
    kind: 30421,
    pubkey: voterPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', proposalEventId],
      ['vote', choice],
      ['voting_power', String(votingPower)],
      ['strategy_used', strategyUsed],
    ],
    content: JSON.stringify({
      proposal_event_id: proposalEventId,
      vote: choice,
      voting_power: votingPower,
      strategy_used: strategyUsed,
    }),
  }
}

export function composeDaoProposalOutcome(
  proposalEventId: string,
  authorPubkey: string,
  outcome: 'PASSED' | 'REJECTED' | 'EXECUTED',
  votesFor: number,
  votesAgainst: number,
  votesAbstain: number
): DaoProposalOutcomeTemplate {
  return {
    kind: 30422,
    pubkey: authorPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', proposalEventId],
      ['outcome', outcome],
      ['votes_for', String(votesFor)],
      ['votes_against', String(votesAgainst)],
      ['votes_abstain', String(votesAbstain)],
    ],
    content: JSON.stringify({
      proposal_event_id: proposalEventId,
      outcome,
      votes_for: votesFor,
      votes_against: votesAgainst,
      votes_abstain: votesAbstain,
    }),
  }
}

export interface CodexUpdateEventTemplate {
  kind: 30422
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
}

export function composeCodexUpdateEvent(
  daoId: string,
  signerPubkey: string,
  oldCodexHash: string,
  newCodexHash: string,
  newCodexVersion: string,
  codexUrl: string,
  proposalEventId: string
): CodexUpdateEventTemplate {
  return {
    kind: 30422,
    pubkey: signerPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', `${daoId}-codex-update-${Date.now()}`],
      ['sub_type', 'codex_update'],
      ['dao_id', daoId],
      ['old_codex_hash', oldCodexHash],
      ['new_codex_hash', newCodexHash],
      ['new_codex_version', newCodexVersion],
      ['proposal_event_id', proposalEventId],
    ],
    content: JSON.stringify({
      sub_type: 'codex_update',
      dao_id: daoId,
      old_codex_hash: oldCodexHash,
      new_codex_hash: newCodexHash,
      new_codex_version: newCodexVersion,
      codex_url: codexUrl,
      proposal_event_id: proposalEventId,
    }),
  }
}
