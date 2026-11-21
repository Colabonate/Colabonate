// ADR-397 D6: the brief a bounty ticket was created from — title, description,
// acceptance criteria, deadline — frozen on the ticket so later bounty edits
// never change what the agent was hired for. Rendered on the ticket and in the
// workspace; in the workspace the buyer can drop it into the chat composer as
// the agent's first message (sent through the normal signed chat relay).
import { Box, Button, Paper, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { Target } from 'lucide-react'
import { RichText, hasRichTextHtml, richTextToPlainText } from '../offers'
import type { BountyBrief } from '../../hooks/useAgentTaskQueries'

/** Plain-text brief for the agent's first chat message. */
export function bountyBriefAsMessage(brief: BountyBrief): string {
  const description = hasRichTextHtml(brief.description) ? richTextToPlainText(brief.description) : brief.description
  return [
    `Bounty: ${brief.title}`,
    '',
    description.trim(),
    ...(brief.acceptanceCriteria ? ['', 'Acceptance criteria:', brief.acceptanceCriteria.trim()] : []),
    ...(brief.deadline ? ['', `Deadline: ${new Date(brief.deadline).toLocaleString()}`] : []),
  ].join('\n')
}

export function BountyBriefCard({ brief, onUseAsMessage }: { brief: BountyBrief; onUseAsMessage?: () => void }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          <Target size={20} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={700}>Bounty brief</Typography>
            <Typography variant="caption" color="text.secondary">
              What the agent was hired for — frozen when the ticket was created.
            </Typography>
          </Box>
        </Box>
        <Link to={`/bounties/${brief.bountyId}`} style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary-50)' }}>
          View bounty
        </Link>
      </Box>

      <Box sx={{ mt: 2.5, display: 'grid', rowGap: 2 }}>
        <Typography variant="subtitle2" fontWeight={700}>{brief.title}</Typography>
        {hasRichTextHtml(brief.description)
          ? <RichText value={brief.description} />
          : <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{brief.description}</Typography>}
        {brief.acceptanceCriteria && (
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Acceptance criteria
            </Typography>
            <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>{brief.acceptanceCriteria}</Typography>
          </Box>
        )}
        {brief.deadline && (
          <Typography variant="body2" color="text.secondary">Deadline: {new Date(brief.deadline).toLocaleString()}</Typography>
        )}
      </Box>

      {onUseAsMessage && (
        <Button variant="outlined" size="small" sx={{ mt: 2.5 }} onClick={onUseAsMessage}>
          Use as first message to the agent
        </Button>
      )}
    </Paper>
  )
}
