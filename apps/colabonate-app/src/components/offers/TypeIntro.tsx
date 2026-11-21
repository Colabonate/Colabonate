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
import HandshakeOutlinedIcon from '@mui/icons-material/HandshakeOutlined'
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined'

export type TicketTypeKey = 'SMART_ORDER' | 'MILESTONE'
export type OfferTypeVariant = 'offer' | 'service'

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
    short: 'Three fixed payment phases (25 / 50 / 25%)',
    detailHeadline: 'How Smart Order works',
    detail: [
      'Smart Order splits the total into three predefined escrow phases. No setup needed – the phases are automatic. Ideal for standard orders, physical goods, and simple services with a clear start and end.',
      'All escrow logic runs on the Lightning Network. Every phase release is a real on-chain settlement – no intermediary holds your funds, and every transaction can be independently verified by either party at any time.',
    ],
    flow: [
      {
        icon: <StorefrontOutlinedIcon fontSize="small" />,
        label: 'Buyer places order',
        description: 'Buyer sends the full amount into escrow. For Services, the seller must accept first.',
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
    short: 'Freely configurable milestones with custom percentages',
    detailHeadline: 'How Milestone works',
    detail: [
      'You define your own milestones (e.g. Concept, Draft, Delivery) and assign each a percentage of the total price. All milestones must add up to 100%. Each step is confirmed and paid out separately.',
      'Each payout is a direct Lightning settlement – no platform can withhold or delay it. Both buyer and seller can verify every milestone release independently, without relying on any third party.',
    ],
    flow: [
      {
        icon: <FlagOutlinedIcon fontSize="small" />,
        label: 'You define milestones',
        description: 'Create 2 or more steps with a title, description and percentage. Together they must total 100%.',
      },
      {
        icon: <StorefrontOutlinedIcon fontSize="small" />,
        label: 'Buyer funds escrow',
        description: 'The full amount goes into escrow. Nothing is released until both parties act.',
      },
      {
        icon: <PaidOutlinedIcon fontSize="small" />,
        label: 'Step-by-step payout',
        description: 'Both parties confirm each milestone. Payment for that step is released immediately after.',
      },
      {
        icon: <CheckCircleOutlineIcon fontSize="small" />,
        label: 'Final milestone closes order',
        description: 'When the last milestone is confirmed, the order is complete and closed.',
      },
    ],
  },
}

// Service-specific flow (adds accept/decline step)
const SERVICE_FLOW: Record<TicketTypeKey, FlowStep[]> = {
  SMART_ORDER: [
    {
      icon: <AssignmentOutlinedIcon fontSize="small" />,
      label: 'Client places a request',
      description: 'The client submits the service request. Funds go into escrow – nothing is paid out yet.',
    },
    {
      icon: <HandshakeOutlinedIcon fontSize="small" />,
      label: 'You accept or decline',
      description: 'Review the brief and timeline. Only after your acceptance does the engagement begin.',
    },
    {
      icon: <LockOutlinedIcon fontSize="small" />,
      label: '25% at kick-off',
      description: 'First payment unlocks once both parties confirm the work has started.',
    },
    {
      icon: <HourglassEmptyIcon fontSize="small" />,
      label: '50% after main delivery',
      description: 'The bulk releases when the core work is handed over and acknowledged.',
    },
    {
      icon: <CheckCircleOutlineIcon fontSize="small" />,
      label: '25% on final acceptance',
      description: 'Last payment releases after the client confirms full satisfaction.',
    },
  ],
  MILESTONE: [
    {
      icon: <FlagOutlinedIcon fontSize="small" />,
      label: 'You define the project phases',
      description: 'Create milestones with a title, description, and percentage. Together they must total 100%.',
    },
    {
      icon: <AssignmentOutlinedIcon fontSize="small" />,
      label: 'Client reviews and funds escrow',
      description: 'The client accepts the scope and sends the full amount into escrow.',
    },
    {
      icon: <HandshakeOutlinedIcon fontSize="small" />,
      label: 'You accept the engagement',
      description: 'Once you confirm, the first milestone becomes active and work begins.',
    },
    {
      icon: <PaidOutlinedIcon fontSize="small" />,
      label: 'Step-by-step delivery & payout',
      description: 'Both parties confirm each milestone. That phase\'s payment releases immediately after.',
    },
    {
      icon: <CheckCircleOutlineIcon fontSize="small" />,
      label: 'Final milestone closes the project',
      description: 'When the last milestone is confirmed, the project is complete and the engagement is closed.',
    },
  ],
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface SelectCardProps {
  type: TicketTypeKey
  selected: boolean
  onSelect: () => void
}

function SelectCard({ type, selected, onSelect }: SelectCardProps) {
  const data = TICKET_TYPE_DATA[type]
  const selectedGreen = {
    accent: 'var(--color-action-secondary-default)',
    bg: 'rgba(33, 225, 104, 0.12)',
    iconBg: 'rgba(33, 225, 104, 0.12)',
  }
  const colors = {
    accent: selectedGreen.accent,
    bg: selectedGreen.bg,
    iconBg: selectedGreen.iconBg,
  }

  return (
    <Box
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      sx={{
        position: 'relative',
        p: 3,
        borderRadius: 'var(--radius-md, 8px)',
        border: '2px solid',
        borderColor: selected ? colors.accent : 'var(--theme-border)',
        bgcolor: selected ? colors.bg : 'transparent',
        cursor: 'pointer',
        transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        outline: 'none',
        '&:hover': {
          bgcolor: selected ? colors.bg : 'var(--theme-item-hover)',
          transform: 'translateY(-2px)',
          boxShadow: 'var(--theme-shadow)',
        },
        '&:focus-visible': {
          boxShadow: `0 0 0 3px ${colors.accent}40`,
        },
      }}
    >
      {selected && (
        <Box
          sx={{
            position: 'absolute',
            top: 10,
            right: 10,
            width: 22,
            height: 22,
            borderRadius: '50%',
            bgcolor: colors.accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="12" height="9" viewBox="0 0 12 9" fill="none">
            <path d="M1 4.5L4.5 8L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </Box>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 1.5 }}>
        <Box
          sx={{
            width: 52,
            height: 52,
            borderRadius: '14px',
            bgcolor: selected ? colors.iconBg : 'var(--theme-bg-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: selected ? colors.accent : 'var(--theme-text-muted)',
            transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          {type === 'SMART_ORDER' ? (
            <BoltIcon sx={{ fontSize: 26 }} />
          ) : (
            <FlagIcon sx={{ fontSize: 26 }} />
          )}
        </Box>
        <Typography
          variant="body2"
          fontWeight={700}
          sx={{
            color: selected ? 'var(--theme-text)' : 'var(--theme-text-secondary)',
            fontSize: '0.9375rem',
            transition: 'color 200ms',
          }}
        >
          {data.name}
        </Typography>
        <Typography
          variant="caption"
          sx={{
            color: 'var(--theme-text-muted)',
            lineHeight: 1.5,
            fontSize: '0.75rem',
            maxWidth: 200,
          }}
        >
          {data.short}
        </Typography>
      </Box>
    </Box>
  )
}

interface FlowPanelProps {
  type: TicketTypeKey
  variant: OfferTypeVariant
}

function FlowPanel({ type, variant }: FlowPanelProps) {
  const flowSteps = variant === 'service' ? SERVICE_FLOW[type] : TICKET_TYPE_DATA[type].flow
  const label = variant === 'service' ? 'Service Flow' : 'Buyer & Seller Flow'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography
        variant="overline"
        sx={{
          letterSpacing: '0.08em',
          fontSize: '0.65rem',
          color: 'var(--theme-text-muted)',
        }}
      >
        {label}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {flowSteps.map((step, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
            <Box
              sx={{
                flexShrink: 0,
                width: 28,
                height: 28,
                borderRadius: '50%',
                bgcolor: 'var(--theme-bg-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--theme-text-muted)',
              }}
            >
              {step.icon}
            </Box>
            <Box>
              <Typography variant="body2" fontWeight={600} lineHeight={1.3} sx={{ color: 'var(--theme-text)' }}>
                {step.label}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5, lineHeight: 1.5, color: 'var(--theme-text-secondary)' }}>
                {step.description}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ─── Public components ────────────────────────────────────────────────────────

export interface TypeIntroPageProps {
  selectedType: TicketTypeKey
  onSelect: (type: TicketTypeKey) => void
  variant?: OfferTypeVariant
  hiddenTypes?: TicketTypeKey[]
}

export function TypeIntroPage({ selectedType, onSelect, variant = 'offer', hiddenTypes = [] }: TypeIntroPageProps) {
  const availableTypes = (['SMART_ORDER', 'MILESTONE'] as const).filter(t => !hiddenTypes.includes(t))
  const selectLabel = variant === 'service' ? 'Select service type' : 'Select order type'

  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 2.5, sm: 3 },
        borderRadius: 'var(--radius-lg, 12px)',
        borderColor: 'var(--theme-border)',
        bgcolor: 'var(--theme-surface)',
      }}
    >
      {/* Header with icon */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: '10px',
            bgcolor: 'var(--color-accent-1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <BoltIcon sx={{ fontSize: 18, color: 'white' }} />
        </Box>
        <h5 className="!mt-0 !mb-0 !text-[var(--theme-text)]">{selectLabel}</h5>
      </Box>

      {/* SelectCards in 2-column grid */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
          gap: 2,
          mb: 4,
        }}
      >
        {availableTypes.map((type) => (
          <SelectCard
            key={type}
            type={type}
            selected={selectedType === type}
            onSelect={() => onSelect(type)}
          />
        ))}
      </Box>

      {/* 2-column layout for details and flow */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1.2fr 1.3fr' },
          gap: { xs: 4, md: 0 },
        }}
      >
        {/* Column 1: Headline + explanation */}
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            pr: { md: 3 },
            borderRight: { md: '1px solid' },
            borderColor: { md: 'var(--theme-border)' },
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>
              {TICKET_TYPE_DATA[selectedType].detailHeadline}
            </Typography>
            {TICKET_TYPE_DATA[selectedType].detail.map((paragraph, i) => (
              <Typography key={i} variant="body2" sx={{ lineHeight: 1.6, color: 'var(--theme-text-secondary)' }}>
                {paragraph}
              </Typography>
            ))}
          </Box>
        </Box>

        {/* Column 2: User flow */}
        <Box sx={{ pl: { md: 3 } }}>
          <FlowPanel type={selectedType} variant={variant} />
        </Box>
      </Box>
    </Paper>
  )
}

export interface TypeIntroProps {
  selectedType: TicketTypeKey
  onSelect: (type: TicketTypeKey) => void
  variant?: OfferTypeVariant
  hiddenTypes?: TicketTypeKey[]
}

export function TypeIntro({ selectedType, onSelect, variant = 'offer', hiddenTypes = [] }: TypeIntroProps) {
  const availableTypes = (['SMART_ORDER', 'MILESTONE'] as const).filter(t => !hiddenTypes.includes(t))
  const selectLabel = variant === 'service' ? 'Service type' : 'Order type'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="overline" color="text.disabled" sx={{ fontSize: '0.65rem', letterSpacing: '0.08em' }}>
        {selectLabel}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        {availableTypes.map((type) => (
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

// ─── Legacy exports for backwards compatibility ───────────────────────────────

export function OfferTypeIntroPage(props: TypeIntroPageProps) {
  return <TypeIntroPage {...props} variant="offer" />
}

export function OfferTypeIntro(props: TypeIntroProps) {
  return <TypeIntro {...props} variant="offer" />
}

export function ServiceTypeIntroPage(props: TypeIntroPageProps) {
  return <TypeIntroPage {...props} variant="service" />
}

export function ServiceTypeIntro(props: TypeIntroProps) {
  return <TypeIntro {...props} variant="service" />
}
