import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Paper from '@mui/material/Paper'
import BoltIcon from '@mui/icons-material/Bolt'
import FlagIcon from '@mui/icons-material/Flag'
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import PaidOutlinedIcon from '@mui/icons-material/PaidOutlined'
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined'

type TicketTypeKey = 'SMART_ORDER' | 'MILESTONE'

// ─── Static data ────────────────────────────────────────────────────────────

interface FlowStep {
  icon: React.ReactNode
  label: string
  description: string
}

interface TicketTypeData {
  name: string
  short: string
  detailHeadline: string
  detail: string[]
  flow: FlowStep[]
}

const TICKET_TYPE_DATA: Record<TicketTypeKey, TicketTypeData> = {
  SMART_ORDER: {
    name: 'Smart Order',
    short: 'Three fixed payment phases (25 / 50 / 25%) – simple & ready to use',
    detailHeadline: 'How Smart Order works',
    detail: [
      'Smart Order splits the total into three predefined escrow phases. No setup needed – the phases are automatic. Ideal for standard orders, physical goods, and simple services with a clear start and end.',
      'All escrow logic runs on the Lightning Network. Every phase release is a real on-chain settlement – no intermediary holds your funds, and every transaction can be independently verified by either party at any time.',
    ],
    flow: [
      {
        icon: <StorefrontOutlinedIcon fontSize="small" />,
        label: 'Buyer places order',
        description:
          'Buyer sends the full amount into escrow. For Services, the seller must accept first.',
      },
      {
        icon: <LockOutlinedIcon fontSize="small" />,
        label: '25% released at start',
        description: 'First phase unlocks once both parties confirm the order has begun.',
      },
      {
        icon: <HourglassEmptyIcon fontSize="small" />,
        label: '50% after main delivery',
        description: 'The bulk of the payment is released when the core work is delivered.',
      },
      {
        icon: <CheckCircleOutlineIcon fontSize="small" />,
        label: '25% on final acceptance',
        description: 'Final payment releases after the buyer confirms full completion.',
      },
    ],
  },
  MILESTONE: {
    name: 'Milestone',
    short: 'Freely configurable milestones with custom percentages – for complex projects',
    detailHeadline: 'How Milestone works',
    detail: [
      'You define your own milestones (e.g. Concept, Draft, Delivery) and assign each a percentage of the total price. All milestones must add up to 100%. Each step is confirmed and paid out separately.',
      'Each payout is a direct Lightning settlement – no platform can withhold or delay it. Both buyer and seller can verify every milestone release independently, without relying on any third party.',
    ],
    flow: [
      {
        icon: <FlagOutlinedIcon fontSize="small" />,
        label: 'You define milestones',
        description:
          'Create 2 or more steps with a title, description and percentage. Together they must total 100%.',
      },
      {
        icon: <StorefrontOutlinedIcon fontSize="small" />,
        label: 'Buyer funds escrow',
        description: 'The full amount goes into escrow. Nothing is released until both parties act.',
      },
      {
        icon: <PaidOutlinedIcon fontSize="small" />,
        label: 'Step-by-step payout',
        description:
          'Both parties confirm each milestone. Payment for that step is released immediately after.',
      },
      {
        icon: <CheckCircleOutlineIcon fontSize="small" />,
        label: 'Final milestone closes order',
        description: 'When the last milestone is confirmed, the order is complete and closed.',
      },
    ],
  },
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface SelectCardProps {
  type: TicketTypeKey
  selected: boolean
  onSelect: () => void
}

function SelectCard({ type, selected, onSelect }: SelectCardProps) {
  const data = TICKET_TYPE_DATA[type]
  return (
    <Paper
      onClick={onSelect}
      elevation={selected ? 4 : 0}
      variant={selected ? 'elevation' : 'outlined'}
      sx={{
        flex: 1,
        p: 2,
        cursor: 'pointer',
        borderRadius: 'var(--radius-md, 8px)',
        borderColor: selected ? 'primary.main' : 'divider',
        borderWidth: selected ? 2 : 1,
        borderStyle: 'solid',
        transition: 'box-shadow 150ms, border-color 150ms',
        '&:hover': { borderColor: 'primary.main' },
        outline: 'none',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        {type === 'SMART_ORDER' ? (
          <BoltIcon fontSize="small" color={selected ? 'primary' : 'action'} />
        ) : (
          <FlagIcon fontSize="small" color={selected ? 'secondary' : 'action'} />
        )}
        <Typography
          variant="body2"
          fontWeight={700}
          color={selected ? 'text.primary' : 'text.secondary'}
        >
          {data.name}
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary" display="block" lineHeight={1.5}>
        {data.short}
      </Typography>
    </Paper>
  )
}

interface TypePanelProps {
  type: TicketTypeKey
}

function DetailText({ type }: TypePanelProps) {
  const data = TICKET_TYPE_DATA[type]
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography variant="subtitle2" fontWeight={700}>
        {data.detailHeadline}
      </Typography>
      {data.detail.map((paragraph, i) => (
        <Typography key={i} variant="body2" color="text.secondary">
          {paragraph}
        </Typography>
      ))}
    </Box>
  )
}

function FlowPanel({ type }: TypePanelProps) {
  const data = TICKET_TYPE_DATA[type]
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography
        variant="overline"
        color="text.disabled"
        display="block"
        sx={{ letterSpacing: '0.08em', fontSize: '0.65rem' }}
      >
        Buyer &amp; Seller Flow
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {data.flow.map((step, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
            <Box
              sx={{
                flexShrink: 0,
                width: 28,
                height: 28,
                borderRadius: '50%',
                bgcolor: 'action.hover',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'text.secondary',
              }}
            >
              {step.icon}
            </Box>
            <Box>
              <Typography variant="body2" fontWeight={600} lineHeight={1.3}>
                {step.label}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                {step.description}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ─── Public component ────────────────────────────────────────────────────────

export interface OfferTypeIntroPageProps {
  selectedType: TicketTypeKey
  onSelect: (type: TicketTypeKey) => void
}

/**
 * Full-page 3-column intro section for CreateOfferPage.
 * Column 1: "How Selling works" explainer
 * Column 2: Smart Order / Milestone selection cards (elevated when selected)
 * Column 3: Detail + user flow for the selected type
 */
export function OfferTypeIntroPage({ selectedType, onSelect }: OfferTypeIntroPageProps) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 'var(--radius-md, 8px)' }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1.2fr 1.3fr' },
          gap: { xs: 2.5, md: 0 },
        }}
      >
        {/* ── Column 1: SelectCards ── */}
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            pr: { md: 3 },
            borderRight: { md: '1px solid' },
            borderColor: { md: 'divider' },
          }}
        >
          <Typography variant="overline" color="text.disabled" sx={{ fontSize: '0.65rem', letterSpacing: '0.08em' }}>
            Select order type
          </Typography>
          {(['SMART_ORDER', 'MILESTONE'] as const).map((type) => (
            <SelectCard
              key={type}
              type={type}
              selected={selectedType === type}
              onSelect={() => onSelect(type)}
            />
          ))}
        </Box>

        {/* ── Column 2: Headline + explanation of selected type ── */}
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            px: { md: 3 },
            borderRight: { md: '1px solid' },
            borderColor: { md: 'divider' },
          }}
        >
          <DetailText type={selectedType} />
        </Box>

        {/* ── Column 3: User flow of selected type ── */}
        <Box sx={{ pl: { md: 3 } }}>
          <FlowPanel type={selectedType} />
        </Box>
      </Box>
    </Paper>
  )
}

// ─── Compact variant for modal ───────────────────────────────────────────────

export interface OfferTypeIntroProps {
  selectedType: TicketTypeKey
  onSelect: (type: TicketTypeKey) => void
}

/**
 * Compact selectable variant used in CreateOfferModal.
 * Replaces the separate Ticket Type section – selection is done here.
 */
export function OfferTypeIntro({ selectedType, onSelect }: OfferTypeIntroProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="overline" color="text.disabled" sx={{ fontSize: '0.65rem', letterSpacing: '0.08em' }}>
        Order type
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        {(['SMART_ORDER', 'MILESTONE'] as const).map((type) => (
          <SelectCard
            key={type}
            type={type}
            selected={selectedType === type}
            onSelect={() => onSelect(type)}
          />
        ))}
      </Box>
    </Box>
  )
}
