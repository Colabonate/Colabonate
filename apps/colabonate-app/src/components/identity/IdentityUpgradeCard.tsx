import { Box, Button, Card, CardContent, Chip, Typography } from '@mui/material'
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser'
import ShieldIcon from '@mui/icons-material/Shield'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import type { IdentityLevel } from '../../types/identity'

interface IdentityUpgradeCardProps {
  currentLevel: IdentityLevel
  onUpgradeL2: () => void
  onUpgradeL3: () => void
}

export function IdentityUpgradeCard({ currentLevel, onUpgradeL2, onUpgradeL3 }: IdentityUpgradeCardProps) {
  if (currentLevel >= 3) {
    return (
      <Card variant="outlined" sx={{ borderColor: '#f57f17' }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <CheckCircleIcon sx={{ color: '#f57f17', fontSize: 40 }} />
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>Fully verified</Typography>
            <Typography variant="body2" color="text.secondary">You have reached the highest identity level.</Typography>
          </Box>
        </CardContent>
      </Card>
    )
  }

  if (currentLevel === 1) {
    return (
      <Card variant="outlined" sx={{ borderColor: '#7b1fa2' }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <VerifiedUserIcon sx={{ color: '#7b1fa2' }} />
            <Typography variant="subtitle1" fontWeight={700}>Level 2: Peer Verification</Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Have your identity confirmed by two independent verifiers. Unlocks DAO governance participation and higher ticket limits.
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
            <strong>Steps:</strong> Security deposit → Verifier assignment → Personal meeting → Proximity proof
          </Typography>
          <Chip label="PHASE 3 MOCK" size="small" color="warning" sx={{ mr: 1, mb: 1 }} />
          <Button variant="contained" sx={{ bgcolor: '#7b1fa2' }} onClick={onUpgradeL2}>
            Start peer verification (Mock)
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (currentLevel === 2) {
    return (
      <Card variant="outlined" sx={{ borderColor: '#f57f17' }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <ShieldIcon sx={{ color: '#f57f17' }} />
            <Typography variant="subtitle1" fontWeight={700}>Level 3: Humanode HID</Typography>
            <Chip label="Coming soon" size="small" color="default" />
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Biometric ZK verification via Humanode Biomapper. Unlocks 1-person-1-vote governance and arbitrator eligibility.
          </Typography>
          <Button variant="outlined" disabled onClick={onUpgradeL3}>
            Humanode verification (Phase 4)
          </Button>
        </CardContent>
      </Card>
    )
  }

  return null
}
