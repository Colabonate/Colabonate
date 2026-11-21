// ADR-281 D12 — compact provider badge shown in both assistant surfaces
// (FAB panel header + /ai page input row). Click navigates to Settings → AI tab
// (deep link /settings#ai, handled via TAB_HASHES in Settings.tsx).
import { useNavigate } from 'react-router-dom';
import { Tune as TuneIcon } from '@mui/icons-material';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import type { AiProviderInfo } from './ai-assistant.types';

function badgeColor(provider: AiProviderInfo['provider']): string {
  switch (provider) {
    case 'local':
      return 'var(--color-primary-50)';
    case 'openai':
      return 'var(--color-status-success)';
    case 'adapter':
    case 'platform':
      return 'var(--color-status-warning)';
  }
}

export function ProviderBadge({ info }: { info: AiProviderInfo }) {
  const navigate = useNavigate();
  const color = badgeColor(info.provider);
  const detail = info.model ? `${info.label} · ${info.model}` : info.label;
  return (
    <Tooltip title={`Provider: ${detail} — change in Settings`}>
      <Chip
        icon={<TuneIcon />}
        label={info.label}
        size="small"
        onClick={e => {
          e.stopPropagation();
          navigate('/settings#ai');
        }}
        sx={{
          border: '1px solid color-mix(in srgb, var(--theme-border) 80%, transparent)',
          background: 'var(--theme-bg-subtle)',
          color,
          fontSize: 11,
          fontWeight: 600,
          height: 26,
          cursor: 'pointer',
          maxWidth: 180,
          '& .MuiChip-icon': { color: 'inherit', fontSize: 13 },
          '& .MuiChip-label': {
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        }}
      />
    </Tooltip>
  );
}
