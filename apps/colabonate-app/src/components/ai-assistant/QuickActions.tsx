import { useState } from 'react';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import {
  Search as SearchIcon,
  Article as ArticleIcon,
  Store as StoreIcon,
  Add as AddIcon,
  Handshake as HandshakeIcon,
  ShoppingCart as ShoppingCartIcon,
  NewReleases as NewReleasesIcon,
  WorkOutline as WorkOutlineIcon,
  Forum as ForumIcon,
  HelpOutline as HelpOutlineIcon,
  Bolt as BoltIcon,
  SmartToy as SmartToyIcon,
} from '@mui/icons-material';

interface QuickActionsProps {
  onAction: (message: string) => void;
  /** Center group labels and chips — used by the /ai page hero empty state. */
  centered?: boolean;
  /** F7: render the visitor guide actions (informational, no tools) instead. */
  guest?: boolean;
  /** F20: collapse to the first N groups with a "Show more" toggle (hero only). */
  maxGroups?: number;
}

interface QuickActionItem {
  icon: typeof SearchIcon;
  label: string;
  message: string;
}

interface QuickActionGroup {
  label: string;
  /** Self-explanatory one-liner shown as the tooltip on the category chip. */
  description: string;
  color: string;
  bg: string;
  items: QuickActionItem[];
}

const GROUPS: QuickActionGroup[] = [
  {
    label: 'Buy',
    description: 'Ask the assistant to find offers you can buy, or show your purchase tickets.',
    color: 'var(--color-primary-50)',
    bg: 'color-mix(in srgb, var(--color-primary-50) 12%, transparent)',
    items: [
      { icon: SearchIcon, label: 'Find offers', message: 'Show me available offers I can buy' },
      { icon: ArticleIcon, label: 'My tickets', message: 'Show my purchase tickets' },
    ],
  },
  {
    label: 'Sell',
    description: 'Ask the assistant to show your listings, or help you create a new offer.',
    color: 'var(--color-status-success)',
    bg: 'color-mix(in srgb, var(--color-status-success) 12%, transparent)',
    items: [
      { icon: StoreIcon, label: 'My listings', message: 'Show my active offers and listings' },
      { icon: AddIcon, label: 'Create offer', message: 'Help me create a new offer' },
    ],
  },
  {
    label: 'Cooperate',
    description: 'Ask the assistant about cooperation opportunities, or start a new cooperation.',
    // Violet matches the "Cooperate" domain color used by DomainFilterLink; the
    // old secondary-50 slate was unreadable on the dark theme.
    color: '#8B5CF6',
    bg: 'rgba(139,92,246,0.12)',
    items: [
      { icon: HandshakeIcon, label: 'Opportunities', message: 'What cooperation possibilities do I have?' },
      { icon: ShoppingCartIcon, label: 'My cooperations', message: 'Show my active cooperations' },
      { icon: AddIcon, label: 'Start cooperation', message: 'Help me start a new cooperation' },
    ],
  },
  {
    label: 'Discover',
    description: 'Explore what is new or open on Colabonate right now.',
    color: 'var(--color-accent-5)',
    bg: 'color-mix(in srgb, var(--color-accent-5) 12%, transparent)',
    items: [
      { icon: NewReleasesIcon, label: 'Newest offers', message: 'Show me the newest offers on the marketplace' },
      { icon: WorkOutlineIcon, label: 'Open bounties', message: 'Show open bounties my agents can apply to' },
    ],
  },
  {
    label: 'Help',
    description: 'Ask the assistant for help with an order issue or a dispute.',
    color: 'var(--color-status-error)',
    bg: 'color-mix(in srgb, var(--color-status-error) 12%, transparent)',
    items: [
      { icon: ForumIcon, label: 'Dispute help', message: 'I have an issue with an order, can you help me resolve it?' },
    ],
  },
];

// F7: visitors without an account have no tools — offering "show my tickets"
// would invite hallucination. These prompts only explain how Colabonate works.
const GUEST_GROUPS: QuickActionGroup[] = [
  {
    label: 'Get started',
    description: 'Learn what Colabonate is and how to begin.',
    color: 'var(--color-primary-50)',
    bg: 'color-mix(in srgb, var(--color-primary-50) 12%, transparent)',
    items: [
      { icon: HelpOutlineIcon, label: 'How it works', message: 'How does Colabonate work?' },
      { icon: BoltIcon, label: 'Lightning payments', message: 'How do payments with Lightning and sats work on Colabonate?' },
    ],
  },
  {
    label: 'Marketplace',
    description: 'How buying, selling and agents work on Colabonate.',
    color: 'var(--color-status-success)',
    bg: 'color-mix(in srgb, var(--color-status-success) 12%, transparent)',
    items: [
      { icon: StoreIcon, label: 'Sell an offer', message: 'How do I sell a service or product on Colabonate?' },
      { icon: SmartToyIcon, label: 'Agent setups', message: 'What is an agent setup and how do AI agents work on Colabonate?' },
    ],
  },
];

/**
 * One chip per quick-action category (Buy, Sell, Cooperate, Discover, Help),
 * firing that category's primary preset. Used by the Home AI promo section so a
 * click opens the side panel and starts the chat with a sensible default.
 */
export function QuickActionCategoryChips({ onAction, guest = false }: QuickActionsProps) {
  const groups = guest ? GUEST_GROUPS : GROUPS;
  return (
    <Stack direction="row" flexWrap="wrap" gap={1}>
      {groups.map(group => {
        const first = group.items[0];
        return (
          <Tooltip key={group.label} title={group.description} arrow>
            <Chip
              icon={<first.icon sx={{ fontSize: 16 }} />}
              label={group.label}
              onClick={() => onAction(first.message)}
              size="small"
              sx={{
                backgroundColor: group.bg,
                color: group.color,
                fontSize: '0.8125rem',
                fontWeight: 600,
                cursor: 'pointer',
                px: 0.5,
                '&:hover': { backgroundColor: group.bg, opacity: 0.85 },
                '& .MuiChip-icon': { color: 'inherit' },
              }}
            />
          </Tooltip>
        );
      })}
    </Stack>
  );
}

export function QuickActions({ onAction, centered = false, guest = false, maxGroups }: QuickActionsProps) {
  const groups = guest ? GUEST_GROUPS : GROUPS;
  const [expanded, setExpanded] = useState(false);
  const visible = maxGroups && !expanded ? groups.slice(0, maxGroups) : groups;
  const hidden = groups.length - visible.length;

  return (
    <Stack spacing={2} sx={{ width: '100%' }}>
      {visible.map(group => (
        <Stack key={group.label} spacing={1} alignItems={centered ? 'center' : undefined}>
          <Typography
            variant="overline"
            sx={{
              color: group.color,
              fontWeight: 700,
              fontSize: '0.6875rem',
              lineHeight: 1.2,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {group.label}
          </Typography>
          <Stack direction="row" flexWrap="wrap" gap={1} justifyContent={centered ? 'center' : undefined}>
            {group.items.map(item => (
              <Chip
                key={item.label}
                icon={<item.icon sx={{ fontSize: 13 }} />}
                label={item.label}
                onClick={() => onAction(item.message)}
                size="small"
                sx={{
                  backgroundColor: group.bg,
                  color: group.color,
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  '&:hover': { backgroundColor: group.bg, opacity: 0.85 },
                  '& .MuiChip-icon': { color: 'inherit' },
                }}
              />
            ))}
          </Stack>
        </Stack>
      ))}
      {maxGroups !== undefined && (hidden > 0 || expanded) && (
        <Stack direction="row" justifyContent={centered ? 'center' : 'flex-start'}>
          <Chip
            label={hidden > 0 ? `Show ${hidden} more` : 'Show less'}
            size="small"
            onClick={() => setExpanded(v => !v)}
            sx={{
              fontSize: '0.75rem',
              cursor: 'pointer',
              backgroundColor: 'var(--theme-bg-subtle)',
              color: 'var(--theme-text-muted)',
            }}
          />
        </Stack>
      )}
    </Stack>
  );
}
