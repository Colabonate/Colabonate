import { useState } from 'react'
import { Alert, Box, Rating, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { Modal, ModalActions, ModalContent } from '@ds/ui'
import { publishReview, publishAgentReviewAttestation } from '../../lib/nostr'
import type { SubmitReviewInput } from '../../types/identity'

interface ReviewFormProps {
  ticketId: string
  reviewerPubkey: string
  revieweePubkey: string
  colPoints?: number
  offerType?: string
  onSuccess: () => void
  onCancel: () => void
}

const MAX_CONTENT_LENGTH = 2048

// ADR-307 D1: shown as extra dimensions when reviewing an AGENT_SETUP ticket.
const AGENT_DIMENSIONS = [
  { key: 'accuracy', label: 'Korrektheit' },
  { key: 'speed', label: 'Geschwindigkeit' },
  { key: 'reliability', label: 'Zuverlässigkeit' },
  { key: 'quality', label: 'Output-Qualität' },
] as const
type AgentDimensionKey = (typeof AGENT_DIMENSIONS)[number]['key']

/**
 * ReviewForm Component
 *
 * Migrated to use @ds/ui Modal wrapper (ADR-049)
 */
export function ReviewForm({ ticketId, reviewerPubkey, revieweePubkey, colPoints, offerType, onSuccess, onCancel }: ReviewFormProps) {
  const [stars, setStars] = useState<number | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [agentDimensions, setAgentDimensions] = useState<Record<AgentDimensionKey, number | null>>({
    accuracy: null,
    speed: null,
    reliability: null,
    quality: null,
  })
  const [wouldReuse, setWouldReuse] = useState<boolean | null>(null)

  const isAgentReview = offerType === 'AGENT_SETUP'

  async function handleSubmit() {
    if (!stars) {
      setError('Bitte wähle eine Sternebewertung aus.')
      return
    }
    if (!content.trim()) {
      setError('Bitte schreibe eine Bewertung.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const input: SubmitReviewInput = {
        ticketId,
        reviewerPubkey,
        revieweePubkey,
        stars,
        content: content.trim(),
      }

      // ADR-307 D1: only send agentMetrics when at least one dimension was rated.
      const hasAgentDimensions = isAgentReview && (
        Object.values(agentDimensions).some(v => v != null) || wouldReuse != null
      )
      const agentMetrics = hasAgentDimensions
        ? { ...agentDimensions, wouldReuse }
        : undefined
      const apiBody = agentMetrics ? { ...input, agentMetrics } : input

      // Publish to Nostr and submit to API in parallel
      const [nostrResult, apiResult] = await Promise.allSettled([
        publishReview({ ...input, colPoints }),
        fetch('/api/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(apiBody),
        }).then(async res => {
          if (!res.ok) {
            const data = await res.json()
            throw new Error(data.message || 'Review could not be saved')
          }
          return res.json()
        }),
      ])

      const nostrEventId = nostrResult.status === 'fulfilled' ? nostrResult.value.id : undefined
      const apiSucceeded = apiResult.status === 'fulfilled'

      // If Nostr event was published but API submission failed, retry with nostrEventId
      if (nostrEventId && !apiSucceeded) {
        const retry = await fetch('/api/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...apiBody, nostrEventId }),
        })
        if (!retry.ok) {
          // Non-fatal: review already exists, Nostr event published
          console.warn('Review already indexed or retry failed')
        }
      }

      if (!apiSucceeded && apiResult.status === 'rejected') {
        throw apiResult.reason
      }

      // ADR-307 D4: best-effort portable attestation, fires after the review
      // itself succeeded. Never blocks or fails the review flow.
      if (agentMetrics) {
        publishAgentReviewAttestation({ ticketId, reviewerPubkey, revieweePubkey, content: input.content, ...agentMetrics }).catch(e =>
          console.warn('[ADR-307] agent review attestation publish failed:', e)
        )
      }

      onSuccess()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ein Fehler ist aufgetreten.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open
      onClose={onCancel}
      title="Zusammenarbeit bewerten"
      size="sm"
      actions={
        <ModalActions
          cancel={{ onClick: onCancel, disabled: loading }}
          confirm={{
            onClick: handleSubmit,
            children: 'Bewertung abschicken',
            loading,
          }}
        />
      }
    >
      <ModalContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Box>
            <Typography variant="body2" gutterBottom>Sternebewertung *</Typography>
            <Rating
              value={stars}
              onChange={(_, value) => setStars(value)}
              size="large"
            />
          </Box>

          {isAgentReview && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>Agent-Bewertung (optional)</Typography>
              {AGENT_DIMENSIONS.map(({ key, label }) => (
                <Box key={key} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Typography variant="body2">{label}</Typography>
                  <Rating
                    value={agentDimensions[key]}
                    onChange={(_, value) => setAgentDimensions(prev => ({ ...prev, [key]: value }))}
                  />
                </Box>
              ))}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="body2">Würdest du diesen Agent wieder buchen?</Typography>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={wouldReuse === null ? null : wouldReuse ? 'yes' : 'no'}
                  onChange={(_, value) => setWouldReuse(value === null ? null : value === 'yes')}
                >
                  <ToggleButton value="yes">Ja</ToggleButton>
                  <ToggleButton value="no">Nein</ToggleButton>
                </ToggleButtonGroup>
              </Box>
            </Box>
          )}

          <Box>
            <TextField
              label="Bewertung *"
              multiline
              rows={4}
              fullWidth
              value={content}
              onChange={e => setContent(e.target.value.slice(0, MAX_CONTENT_LENGTH))}
              inputProps={{ maxLength: MAX_CONTENT_LENGTH }}
              helperText={`${content.length} / ${MAX_CONTENT_LENGTH} Zeichen`}
            />
          </Box>

          <Alert severity="info">
            +3 COL-Points für dich und die Gegenseite, wenn beide Parteien eine Bewertung abgeben.
          </Alert>
        </Box>
      </ModalContent>
    </Modal>
  )
}
