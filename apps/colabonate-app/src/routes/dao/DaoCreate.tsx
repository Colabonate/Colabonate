import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { apiCall } from '../../lib/api'
import { SatsAmountInput } from '../../components/currency/SatsAmountInput'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import HowToVoteOutlined from '@mui/icons-material/HowToVoteOutlined'
import Close from '@mui/icons-material/Close'
import InfoOutlined from '@mui/icons-material/InfoOutlined'
import { Button, TextField, FormControl, InputLabel, Select, MenuItem, Typography, Box, Chip } from '@mui/material'
import {
  type ProposalType,
  CODEX_DEFAULTS,
  PROPOSAL_TYPE_LABELS,
  PHASE_4_TYPES,
} from './dao-types'

const FOUNDATION_DAO_ID = 'colabonate-foundation'

export function DaoCreate() {
  const navigate = useNavigate()
  const { id: daoId = FOUNDATION_DAO_ID } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const draftId = searchParams.get('draft')
  const queryType = searchParams.get('type') as ProposalType | null

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [proposalType, setProposalType] = useState<ProposalType>(queryType ?? 'NORMAL_DECISION')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDraft, setIsDraft] = useState(false)
  const [loadingDraft, setLoadingDraft] = useState(false)

  const [codexNewHash, setCodexNewHash] = useState('')
  const [codexNewVersion, setCodexNewVersion] = useState('')
  const [codexUrl, setCodexUrl] = useState('')
  const [codexDiffSummary, setCodexDiffSummary] = useState('')

  const [treasuryRecipient, setTreasuryRecipient] = useState('')
  const [treasuryAmount, setTreasuryAmount] = useState('')
  const [treasuryInvoice, setTreasuryInvoice] = useState('')
  const [treasuryJustification, setTreasuryJustification] = useState('')

  const [sanctionTarget, setSanctionTarget] = useState('')
  const [sanctionLevel, setSanctionLevel] = useState<number>(1)
  const [sanctionReason, setSanctionReason] = useState('')
  const [sanctionDuration, setSanctionDuration] = useState('')

  const containerRef = usePageAnimation([
    { selector: '.create-animate', from: { duration: 0.5, stagger: 0.12, y: 20 } },
  ])

  const govDefaults = useMemo(() => CODEX_DEFAULTS[proposalType], [proposalType])

  const prevProposalType = useRef(proposalType)

  useEffect(() => {
    if (queryType && queryType !== proposalType) {
      setProposalType(queryType)
    }
  }, [queryType])

  useEffect(() => {
    if (prevProposalType.current !== proposalType) {
      setCodexNewHash('')
      setCodexNewVersion('')
      setCodexUrl('')
      setCodexDiffSummary('')
      setTreasuryRecipient('')
      setTreasuryAmount('')
      setTreasuryInvoice('')
      setTreasuryJustification('')
      setSanctionTarget('')
      setSanctionLevel(1)
      setSanctionReason('')
      setSanctionDuration('')
      prevProposalType.current = proposalType
    }
  }, [proposalType])

  useEffect(() => {
    if (!draftId) return

    async function loadDraft() {
      setLoadingDraft(true)
      setError(null)
      try {
        const res = await apiCall(`/api/daos/${daoId}/proposals/${draftId}`)
        if (!res.ok) {
          setError('Draft proposal not found')
          return
        }
        const data = await res.json()
        const proposal = data.proposal
        if (!proposal) {
          setError('Draft proposal not found')
          return
        }
        if (proposal.status !== 'DRAFT') {
          setError('This proposal is no longer a draft')
          return
        }
        setTitle(proposal.title ?? '')
        setContent(proposal.content ?? '')
        if (proposal.proposalType) setProposalType(proposal.proposalType as ProposalType)

        const payload = proposal.executionPayload ?? {}
        if (proposal.proposalType === 'CODEX_AMENDMENT') {
          setCodexNewHash((payload as Record<string, unknown>).newCodexHash as string ?? '')
          setCodexNewVersion((payload as Record<string, unknown>).newCodexVersion as string ?? '')
          setCodexUrl((payload as Record<string, unknown>).codexUrl as string ?? '')
          setCodexDiffSummary((payload as Record<string, unknown>).diffSummary as string ?? '')
        } else if (proposal.proposalType === 'TREASURY_SPENDING') {
          setTreasuryRecipient((payload as Record<string, unknown>).recipientPubkey as string ?? '')
          setTreasuryAmount(String((payload as Record<string, unknown>).amountSats ?? ''))
          setTreasuryInvoice((payload as Record<string, unknown>).lightningInvoice as string ?? '')
          setTreasuryJustification((payload as Record<string, unknown>).justification as string ?? '')
        } else if (proposal.proposalType === 'SANCTION') {
          setSanctionTarget((payload as Record<string, unknown>).targetPubkey as string ?? '')
          setSanctionLevel(((payload as Record<string, unknown>).sanctionLevel as number) ?? 1)
          setSanctionReason((payload as Record<string, unknown>).reason as string ?? '')
          setSanctionDuration(String((payload as Record<string, unknown>).durationDays ?? ''))
        }

        setIsDraft(true)
      } catch (err) {
        console.error('Failed to load draft:', err)
        setError('Failed to load draft proposal')
      } finally {
        setLoadingDraft(false)
      }
    }

    loadDraft()
  }, [draftId, daoId])

  function buildExecutionPayload(): Record<string, unknown> {
    switch (proposalType) {
      case 'CODEX_AMENDMENT':
        return {
          newCodexHash: codexNewHash,
          newCodexVersion: codexNewVersion,
          codexUrl,
          diffSummary: codexDiffSummary,
        }
      case 'TREASURY_SPENDING':
        return {
          recipientPubkey: treasuryRecipient,
          amountSats: parseInt(treasuryAmount, 10) || 0,
          lightningInvoice: treasuryInvoice || null,
          justification: treasuryJustification,
        }
      case 'SANCTION':
        return {
          targetPubkey: sanctionTarget,
          sanctionLevel,
          reason: sanctionReason,
          durationDays: sanctionDuration ? parseInt(sanctionDuration, 10) : null,
        }
      default:
        return {}
    }
  }

  async function createProposal() {
    if (!title.trim() || !content.trim()) {
      setError('Title and content are required')
      return
    }

    setCreating(true)
    setError(null)

    try {
      const pubkey = localStorage.getItem('pubkey')
      if (!pubkey) {
        setError('Please sign in with Nostr first')
        return
      }

      const res = await apiCall(`/api/daos/${daoId}/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerPubkey: pubkey,
          title: title.trim(),
          content: content.trim(),
          executionStrategy: proposalType === 'TREASURY_SPENDING' ? 'treasury' : 'simple',
          executionPayload: buildExecutionPayload(),
          proposalType,
        }),
      })
      const data = await res.json()

      if (data.proposal) {
        navigate(`/dao/${daoId}/proposals/${data.proposal.id}`)
      } else {
        setError(data.error || 'Failed to create proposal')
      }
    } catch (err) {
      console.error('Failed to create proposal:', err)
      setError('Failed to create proposal')
    } finally {
      setCreating(false)
    }
  }

  async function saveDraft() {
    if (!title.trim() || !content.trim()) {
      setError('Title and content are required')
      return
    }

    setCreating(true)
    setError(null)

    try {
      const pubkey = localStorage.getItem('pubkey')
      if (!pubkey) {
        setError('Please sign in with Nostr first')
        return
      }

      const res = await apiCall(`/api/daos/${daoId}/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerPubkey: pubkey,
          title: title.trim(),
          content: content.trim(),
          executionStrategy: proposalType === 'TREASURY_SPENDING' ? 'treasury' : 'simple',
          executionPayload: buildExecutionPayload(),
          proposalType,
          status: 'DRAFT',
        }),
      })
      const data = await res.json()

      if (data.proposal) {
        navigate(`/dao/${daoId}/proposals/${data.proposal.id}`)
      } else {
        setError(data.error || 'Failed to save draft')
      }
    } catch (err) {
      console.error('Failed to save draft:', err)
      setError('Failed to save draft')
    } finally {
      setCreating(false)
    }
  }

  async function publishDraft() {
    if (!draftId) return

    setCreating(true)
    setError(null)

    try {
      const pubkey = localStorage.getItem('pubkey')
      if (!pubkey) {
        setError('Please sign in with Nostr first')
        return
      }

      const updateRes = await apiCall(`/api/daos/${daoId}/proposals/${draftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerPubkey: pubkey,
          title: title.trim(),
          content: content.trim(),
          proposalType,
          executionPayload: buildExecutionPayload(),
        }),
      })
      if (!updateRes.ok) {
        const updateData = await updateRes.json()
        setError(updateData.error || 'Failed to update draft')
        return
      }

      const res = await apiCall(`/api/daos/${daoId}/proposals/${draftId}/publish`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callerPubkey: pubkey }),
      })
      const data = await res.json()

      if (data.proposal) {
        searchParams.delete('draft')
        setSearchParams(searchParams, { replace: true })
        navigate(`/dao/${daoId}/proposals/${data.proposal.id}`)
      } else {
        setError(data.error || 'Failed to publish proposal')
      }
    } catch (err) {
      console.error('Failed to publish draft:', err)
      setError('Failed to publish proposal')
    } finally {
      setCreating(false)
    }
  }

  const handleSubmit = isDraft ? publishDraft : createProposal

  if (loadingDraft) {
    return (
      <PageContainer size="wide" spacing="lg" className="pt-0!">
        <div className="max-w-2xl mx-auto">
          <PageHeader
            icon={<HowToVoteOutlined sx={{ fontSize: 18 }} />}
            title="Loading Draft…"
            subtitle="Fetching your draft proposal"
            onBack={() => navigate(`/dao/${daoId}`)}
          />
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer size="wide" spacing="lg" className="pt-0!">
      <div ref={containerRef} className="max-w-2xl mx-auto space-y-6">
        <PageHeader
          icon={<HowToVoteOutlined sx={{ fontSize: 18 }} />}
          title={isDraft ? 'Edit Draft' : 'Create Proposal'}
          subtitle={isDraft ? 'Review and publish your draft proposal' : 'Submit a new governance proposal to the DAO'}
          onBack={() => navigate(`/dao/${daoId}`)}
        />

        <div
          className="p-6 rounded-xl create-animate"
          style={{
            border: '1px solid var(--theme-border)',
            background: 'var(--theme-surface)',
          }}
        >
          {error && (
            <div
              className="flex items-center justify-between gap-3 mb-4 p-4 rounded-lg"
              style={{
                background: 'rgba(245,101,101,0.08)',
                border: '1px solid rgba(245,101,101,0.2)',
              }}
            >
              <span
                className="text-[13px]"
                style={{ color: 'var(--color-status-error)', fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                {error}
              </span>
              <button
                onClick={() => setError(null)}
                className="p-1 rounded-full transition-colors hover:bg-[rgba(245,101,101,0.1)]"
                style={{ color: 'var(--color-status-error)' }}
              >
                <Close sx={{ fontSize: 14 }} />
              </button>
            </div>
          )}

          <div className="space-y-4">
            <FormControl fullWidth margin="normal">
              <InputLabel>Proposal Type</InputLabel>
              <Select
                value={proposalType}
                label="Proposal Type"
                onChange={e => setProposalType(e.target.value as ProposalType)}
                disabled={creating}
              >
                {Object.entries(PROPOSAL_TYPE_LABELS).map(([value, label]) => {
                  const phase4 = PHASE_4_TYPES.includes(value as ProposalType)
                  return (
                    <MenuItem
                      key={value}
                      value={value}
                      disabled={phase4}
                      sx={phase4 ? { opacity: 0.5 } : undefined}
                    >
                      <Box className="flex items-center gap-2 w-full">
                        <span className="flex-1">{label}</span>
                        {phase4 && (
                          <Chip
                            label="Phase 4"
                            size="small"
                            sx={{
                              fontSize: '10px',
                              height: '18px',
                              backgroundColor: 'rgba(255,192,57,0.15)',
                              color: 'var(--color-warning-primary)',
                              border: '1px solid rgba(255,192,57,0.3)',
                            }}
                          />
                        )}
                      </Box>
                    </MenuItem>
                  )
                })}
              </Select>
            </FormControl>

            <div
              className="flex items-center gap-3 p-3 rounded-lg"
              style={{
                background: 'rgba(99,179,237,0.06)',
                border: '1px solid rgba(99,179,237,0.15)',
              }}
            >
              <InfoOutlined sx={{ fontSize: 16, color: 'var(--color-primary-50)' }} />
              <div className="flex flex-wrap gap-3 text-[12px]" style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}>
                <span style={{ color: 'var(--theme-text-muted)' }}>
                  Voting: <strong style={{ color: 'var(--theme-text)' }}>{Math.round(govDefaults.votingPeriodSeconds / 86400)}d</strong>
                </span>
                <span style={{ color: 'var(--theme-text-muted)' }}>
                  Quorum: <strong style={{ color: 'var(--theme-text)' }}>{govDefaults.quorumPercent}%</strong>
                </span>
                <span style={{ color: 'var(--theme-text-muted)' }}>
                  Majority: <strong style={{ color: 'var(--theme-text)' }}>{govDefaults.majorityPercent}%</strong>
                </span>
                {govDefaults.hasCommentPeriod && (
                  <span style={{ color: 'var(--color-warning-primary)' }}>
                    + {Math.round(govDefaults.commentPeriodSeconds / 86400)}d comment period
                  </span>
                )}
              </div>
            </div>

            <TextField
              label="Proposal Title"
              fullWidth
              margin="normal"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="A clear, concise title for your proposal"
              disabled={creating}
            />

            <TextField
              label="Proposal Content"
              fullWidth
              multiline
              rows={6}
              margin="normal"
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Describe your proposal in detail"
              disabled={creating}
            />

            {proposalType === 'CODEX_AMENDMENT' && (
              <div className="space-y-3 p-4 rounded-lg" style={{ background: 'var(--theme-surface-secondary)', border: '1px solid var(--theme-border)' }}>
                <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  Codex Amendment Details
                </Typography>
                <TextField
                  label="New Codex Hash (SHA-256)"
                  fullWidth
                  margin="dense"
                  value={codexNewHash}
                  onChange={e => setCodexNewHash(e.target.value)}
                  placeholder="64-character hex hash"
                  disabled={creating}
                  slotProps={{ input: { readOnly: true } }}
                  helperText="Computed by the codex validator"
                />
                <TextField
                  label="New Version"
                  fullWidth
                  margin="dense"
                  value={codexNewVersion}
                  onChange={e => setCodexNewVersion(e.target.value)}
                  placeholder="e.g. 1.1.0"
                  disabled={creating}
                />
                <TextField
                  label="Codex URL"
                  fullWidth
                  margin="dense"
                  value={codexUrl}
                  onChange={e => setCodexUrl(e.target.value)}
                  placeholder="https://... or ipfs://..."
                  disabled={creating}
                />
                <TextField
                  label="Diff Summary"
                  fullWidth
                  multiline
                  rows={2}
                  margin="dense"
                  value={codexDiffSummary}
                  onChange={e => setCodexDiffSummary(e.target.value)}
                  placeholder="Brief summary of changes (max 500 chars)"
                  disabled={creating}
                  inputProps={{ maxLength: 500 }}
                />
              </div>
            )}

            {proposalType === 'TREASURY_SPENDING' && (
              <div className="space-y-3 p-4 rounded-lg" style={{ background: 'var(--theme-surface-secondary)', border: '1px solid var(--theme-border)' }}>
                <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  Treasury Spending Details
                </Typography>
                <TextField
                  label="Recipient Pubkey"
                  fullWidth
                  margin="dense"
                  value={treasuryRecipient}
                  onChange={e => setTreasuryRecipient(e.target.value)}
                  placeholder="Nostr hex pubkey"
                  disabled={creating}
                />
                <SatsAmountInput
                  label="Amount"
                  valueSats={treasuryAmount === '' ? '' : Number(treasuryAmount)}
                  onChangeSats={sats => setTreasuryAmount(sats === '' ? '' : String(sats))}
                  disabled={creating}
                />
                <TextField
                  label="Lightning Invoice (optional)"
                  fullWidth
                  margin="dense"
                  value={treasuryInvoice}
                  onChange={e => setTreasuryInvoice(e.target.value)}
                  placeholder="BOLT11 invoice"
                  disabled={creating}
                />
                <TextField
                  label="Justification"
                  fullWidth
                  multiline
                  rows={2}
                  margin="dense"
                  value={treasuryJustification}
                  onChange={e => setTreasuryJustification(e.target.value)}
                  placeholder="Why this spending is needed (max 1000 chars)"
                  disabled={creating}
                  inputProps={{ maxLength: 1000 }}
                />
              </div>
            )}

            {proposalType === 'SANCTION' && (
              <div className="space-y-3 p-4 rounded-lg" style={{ background: 'var(--theme-surface-secondary)', border: '1px solid var(--theme-border)' }}>
                <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                  Sanction Details
                </Typography>
                <TextField
                  label="Target Pubkey"
                  fullWidth
                  margin="dense"
                  value={sanctionTarget}
                  onChange={e => setSanctionTarget(e.target.value)}
                  placeholder="Nostr hex pubkey"
                  disabled={creating}
                />
                <FormControl fullWidth margin="dense">
                  <InputLabel>Sanction Level</InputLabel>
                  <Select
                    value={sanctionLevel}
                    label="Sanction Level"
                    onChange={e => setSanctionLevel(e.target.value as number)}
                    disabled={creating}
                  >
                    <MenuItem value={1}>Level 1 — Warning</MenuItem>
                    <MenuItem value={2}>Level 2 — Restriction</MenuItem>
                    <MenuItem value={3}>Level 3 — Ban</MenuItem>
                  </Select>
                </FormControl>
                {sanctionLevel === 2 && (
                  <TextField
                    label="Duration (days)"
                    fullWidth
                    margin="dense"
                    type="number"
                    value={sanctionDuration}
                    onChange={e => setSanctionDuration(e.target.value)}
                    placeholder="Restriction duration in days"
                    disabled={creating}
                  />
                )}
                <TextField
                  label="Reason"
                  fullWidth
                  multiline
                  rows={2}
                  margin="dense"
                  value={sanctionReason}
                  onChange={e => setSanctionReason(e.target.value)}
                  placeholder="Reason for sanction (max 1000 chars)"
                  disabled={creating}
                  inputProps={{ maxLength: 1000 }}
                />
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <Button
                variant="outlined"
                onClick={() => navigate(`/dao/${daoId}`)}
                disabled={creating}
                fullWidth
                sx={{
                  py: 1.5,
                  borderRadius: '12px',
                  fontSize: '12px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  fontFamily: 'var(--typography-fontfamily-sans)',
                  color: 'var(--theme-text)',
                  borderColor: 'var(--theme-border)',
                  backgroundColor: 'var(--theme-surface-secondary)',
                  '&:hover': {
                    borderColor: 'var(--theme-border)',
                    backgroundColor: 'var(--theme-surface-secondary)',
                    opacity: 0.9,
                  },
                  '&:active': { transform: 'scale(0.95)' },
                }}
              >
                Cancel
              </Button>
              {!isDraft && (
                <Button
                  variant="outlined"
                  onClick={saveDraft}
                  disabled={creating || !title.trim() || !content.trim()}
                  fullWidth
                  sx={{
                    py: 1.5,
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    fontFamily: 'var(--typography-fontfamily-sans)',
                    color: 'var(--theme-text)',
                    borderColor: 'var(--theme-border)',
                    backgroundColor: 'var(--theme-surface-secondary)',
                    '&:hover': {
                      borderColor: 'var(--theme-border)',
                      backgroundColor: 'var(--theme-surface-secondary)',
                      opacity: 0.9,
                    },
                    '&:active': { transform: 'scale(0.95)' },
                  }}
                >
                  {creating ? 'Saving...' : 'Save Draft'}
                </Button>
              )}
              <Button
                variant="contained"
                onClick={handleSubmit}
                disabled={creating || !title.trim() || !content.trim()}
                fullWidth
                sx={{
                  py: 1.5,
                  borderRadius: '12px',
                  fontSize: '12px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  fontFamily: 'var(--typography-fontfamily-sans)',
                  backgroundColor: 'var(--color-primary-50)',
                  color: 'white',
                  '&:hover': {
                    backgroundColor: 'var(--color-primary-50)',
                    opacity: 0.9,
                  },
                  '&:active': { transform: 'scale(0.95)' },
                  '&.Mui-disabled': {
                    backgroundColor: 'var(--color-primary-50)',
                    color: 'white',
                    opacity: 0.5,
                  },
                }}
              >
                {creating
                  ? isDraft ? 'Publishing...' : 'Creating...'
                  : isDraft ? 'Publish Proposal' : 'Submit Proposal'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
