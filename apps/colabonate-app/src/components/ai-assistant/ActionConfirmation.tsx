import type { EntityPayload, EntityType } from './ai-assistant.types';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { useTranslation } from '../../contexts/LocaleContext';
import { CheckCircle as CheckCircleIcon, ArrowForward as ArrowForwardIcon, Bolt as BoltIcon } from '@mui/icons-material';

function getEntityRoute(entityType: EntityType, id: string, entity?: Record<string, unknown>): string {
  switch (entityType) {
    case 'offer': return `/offers/${id}`;
    case 'cooperation': return `/coop/${id}`;
    case 'company': return `/sell/company`;
    case 'ticket': return `/tickets/${id}`;
    case 'proposal': {
      const daoId = (entity?.daoId as string) || 'colabonate-foundation';
      if (entity?.status === 'DRAFT') return `/dao/${daoId}/proposals/new?draft=${id}`;
      return `/dao/${daoId}/proposals/${id}`;
    }
    default: return '#';
  }
}

function getSecondaryRoute(entityType: EntityType, entity?: Record<string, unknown>): string | null {
  switch (entityType) {
    case 'offer': return '/sell/listings';
    case 'cooperation': return '/coop';
    case 'company': return '/sell/company';
    case 'proposal': {
      const daoId = (entity?.daoId as string) || 'colabonate-foundation';
      return `/dao/${daoId}`;
    }
    default: return null;
  }
}

function getSecondaryLabel(entityType: EntityType): string | null {
  switch (entityType) {
    case 'offer': return 'Manage in Sell';
    case 'cooperation': return 'View in Cooperate';
    case 'company': return 'Manage in Sell';
    case 'proposal': return 'View in DAO';
    default: return null;
  }
}

function getEntityLabel(entityType: EntityType, entity?: Record<string, unknown>): string {
  switch (entityType) {
    case 'offer': return 'Offer';
    case 'cooperation': return 'Cooperation';
    case 'company': return 'Company';
    case 'ticket': return 'Ticket';
    case 'proposal': return entity?.status === 'DRAFT' ? 'Proposal draft' : 'Proposal';
    default: return 'Item';
  }
}

interface ActionConfirmationProps {
  payload: Extract<EntityPayload, { kind: 'created' | 'updated' }>;
}

export function ActionConfirmation({ payload }: ActionConfirmationProps) {
  const { formatNumber } = useTranslation();
  const isCreated = payload.kind === 'created';
  const headerColor = isCreated ? 'var(--color-status-success)' : 'var(--color-primary-50)';
  const entity = payload.entity as Record<string, unknown> | undefined;
  const entityId = entity?.id as string | undefined;

  const label = `${getEntityLabel(payload.entityType, entity)} ${isCreated ? 'created' : 'updated'}`;
  const secondaryRoute = entityId ? getSecondaryRoute(payload.entityType, entity) : null;
  const secondaryLabel = getSecondaryLabel(payload.entityType);
  const isDraftProposal = payload.entityType === 'proposal' && entity?.status === 'DRAFT';
  const primaryActionLabel = isDraftProposal ? 'Edit & Publish' : `View ${getEntityLabel(payload.entityType, entity)}`;

  return (
    <Box
      sx={{
        borderRadius: 3,
        p: 1.5,
        border: '1px solid',
        background: 'var(--theme-surface)',
        borderColor: isCreated ? 'rgba(72, 187, 120, 0.3)' : 'rgba(99, 179, 237, 0.3)',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <CheckCircleIcon sx={{ fontSize: 16, color: headerColor }} />
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: headerColor }}>
          {label}
        </Typography>
      </Stack>

      {entity && (
        <Box sx={{ mb: 1, p: 1, borderRadius: 2, background: 'var(--theme-bg-subtle)' }}>
          {typeof entity.title === 'string' && (
            <Typography sx={{ fontSize: 12, fontWeight: 500, mb: 0.5, color: 'var(--theme-text)' }}>
              {entity.title}
            </Typography>
          )}
          {typeof entity.priceSats === 'number' && (
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <BoltIcon sx={{ fontSize: 12, color: 'var(--color-primary-50)' }} />
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary-50)' }}>
                {formatNumber(entity.priceSats as number)} sats
              </Typography>
            </Stack>
          )}
          {typeof entity.budgetSats === 'number' && (
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <BoltIcon sx={{ fontSize: 12, color: 'var(--color-primary-50)' }} />
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary-50)' }}>
                {formatNumber(entity.budgetSats as number)} sats budget
              </Typography>
            </Stack>
          )}
        </Box>
      )}

      {'changed' in payload && payload.changed.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
          {payload.changed.map((field: string) => (
            <Typography
              key={field}
              component="span"
              sx={{
                fontSize: 10,
                px: 0.75,
                py: 0.25,
                borderRadius: 1,
                background: 'var(--color-primary-8)',
                color: 'var(--color-primary-40)',
              }}
            >
              {field}
            </Typography>
          ))}
        </Box>
      )}

      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mt: 1 }}>
        {entityId && (
          <Button
            component={Link}
            to={getEntityRoute(payload.entityType, entityId, entity)}
            endIcon={<ArrowForwardIcon sx={{ fontSize: 12 }} />}
            sx={{ textTransform: 'none', color: headerColor, minWidth: 0, padding: 0, fontSize: 12, fontWeight: 500, '&:hover': { opacity: 0.85 } }}
          >
            {primaryActionLabel}
          </Button>
        )}
        {secondaryRoute && secondaryLabel && (
          <Button
            component={Link}
            to={secondaryRoute}
            endIcon={<ArrowForwardIcon sx={{ fontSize: 11 }} />}
            sx={{ textTransform: 'none', color: 'var(--theme-text-muted)', minWidth: 0, padding: 0, fontSize: 11, '&:hover': { opacity: 0.85 } }}
          >
            {secondaryLabel}
          </Button>
        )}
      </Stack>
    </Box>
  );
}
