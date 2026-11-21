import { Link } from 'react-router-dom';
import { Button } from '@mui/material';
import {
  ArrowForward as ArrowForwardIcon,
  ShoppingCart as ShoppingCartIcon,
  Store as StoreIcon,
  Handshake as HandshakeIcon,
} from '@mui/icons-material';

interface DomainFilterLinkProps {
  domain: 'buy' | 'sell' | 'cooperate';
  label?: string;
  query?: string;
  filter?: string;
  offerType?: string;
  coopType?: string;
}

const DOMAIN_CONFIG = {
  buy: { icon: ShoppingCartIcon, color: 'var(--color-primary-50)', bg: 'var(--color-primary-8)', label: 'Buy' },
  sell: { icon: StoreIcon, color: 'var(--color-status-success)', bg: 'rgba(72,187,120,0.12)', label: 'Sell' },
  cooperate: { icon: HandshakeIcon, color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)', label: 'Cooperate' },
} as const;

function buildPath(props: DomainFilterLinkProps): string {
  const params = new URLSearchParams();
  if (props.query) params.set('q', props.query);
  if (props.offerType) params.set('type', props.offerType);
  if (props.filter) params.set('filter', props.filter);
  if (props.coopType) params.set('filter', props.coopType);
  const qs = params.toString();

  switch (props.domain) {
    case 'buy':
      return `/buy${qs ? `?${qs}` : ''}`;
    case 'sell':
      return `/sell/listings${qs ? `?${qs}` : ''}`;
    case 'cooperate':
      return `/coop${qs ? `?${qs}` : ''}`;
  }
}

export function DomainFilterLink({ domain, label, query, filter, offerType, coopType }: DomainFilterLinkProps) {
  const config = DOMAIN_CONFIG[domain];
  const path = buildPath({ domain, query, filter, offerType, coopType });
  const displayLabel = label ?? `View all in ${config.label}`;

  return (
    <Button
      component={Link}
      to={path}
      startIcon={<config.icon sx={{ fontSize: 12 }} />}
      endIcon={<ArrowForwardIcon sx={{ fontSize: 11 }} />}
      sx={{
        textTransform: 'none',
        background: config.bg,
        color: config.color,
        mt: 1,
        px: 1.25,
        py: 0.75,
        borderRadius: 2,
        fontSize: 11,
        fontWeight: 500,
        minWidth: 0,
        '&:hover': { background: config.bg, opacity: 0.85 },
        '& .MuiButton-startIcon': { mr: 0.75 },
        '& .MuiButton-endIcon': { ml: 0.5 },
      }}
    >
      {displayLabel}
    </Button>
  );
}
