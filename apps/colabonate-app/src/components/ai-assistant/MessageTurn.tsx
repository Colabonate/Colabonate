import { useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { Stop as StopIcon, ContentCopy as ContentCopyIcon, Refresh as RefreshIcon, Check as CheckIcon, Done as DoneIcon } from '@mui/icons-material';
import type { MessageTurn as MessageTurnType } from './ai-assistant.types';
import { ToolActivityIndicator } from './ToolActivityIndicator';
import { EntityResultBlock } from './EntityResultBlock';
import { ActionConfirmation } from './ActionConfirmation';
import { MarkdownRenderer } from './MarkdownRenderer';

interface MessageTurnProps {
  turn: MessageTurnType;
  compact?: boolean;
  /** F15/F16: re-run the last user message (retry an error / regenerate an answer). */
  onRegenerate?: () => void;
}

export function MessageTurn({ turn, compact = true, onRegenerate }: MessageTurnProps) {
  const isUser = turn.role === 'user';
  const [copied, setCopied] = useState(false);

  const copyAnswer = async () => {
    try {
      await navigator.clipboard.writeText(turn.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (insecure context) — no-op
    }
  };

  if (isUser) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end' }}>
        <Box
          sx={{
            maxWidth: '80%',
            px: 1.5,
            py: 1,
            borderRadius: 4,
            borderBottomRightRadius: 8,
            background: 'var(--color-primary-50)',
            color: 'var(--color-neutral-white)',
          }}
        >
          {turn.images && turn.images.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 0.75 }}>
              {turn.images.map((url, i) => (
                <Box
                  key={i}
                  component="img"
                  src={url}
                  alt={`Image ${i + 1}`}
                  sx={{ borderRadius: 1, width: 64, height: 64, objectFit: 'cover', display: 'block' }}
                />
              ))}
            </Box>
          )}
          <Typography sx={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{turn.text}</Typography>
        </Box>
      </Box>
    );
  }

  const showActions = turn.status === 'done' && turn.text.trim().length > 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
      {/* Result cards use the full column; only the prose bubble keeps the 85% chat width. */}
      <Box sx={{ width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {turn.steps && turn.steps.length > 0 && (
          <Stack direction="row" flexWrap="wrap" gap={1}>
            {turn.steps.map((step, i) => (
              <Stack key={`${step.tool}-${i}`} direction="row" alignItems="center" spacing={0.5} sx={{ color: 'var(--theme-text-muted)' }}>
                <DoneIcon sx={{ fontSize: 12 }} />
                <Typography sx={{ fontSize: 11 }}>
                  {step.label}
                  {typeof step.count === 'number' ? ` · ${step.count} ${step.count === 1 ? 'result' : 'results'}` : ''}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}

        {turn.toolActivity && (
          <ToolActivityIndicator label={turn.toolActivity.label} />
        )}

        {turn.entities.map((entity, i) => {
          if (entity.kind === 'created' || entity.kind === 'updated') {
            return <ActionConfirmation key={i} payload={entity} />;
          }
          return <EntityResultBlock key={i} payload={entity} compact={compact} />;
        })}

        {(turn.text || turn.status === 'streaming') && (
          <Box
            aria-live={turn.status === 'done' ? 'polite' : undefined}
            sx={{
              maxWidth: '85%',
              px: 1.5,
              py: 1,
              borderRadius: 4,
              borderBottomLeftRadius: 8,
              background: 'var(--theme-bg-subtle)',
            }}
          >
            <MarkdownRenderer content={turn.text} />
            {turn.status === 'streaming' && (
              <Typography
                component="span"
                sx={{
                  display: 'inline-block',
                  ml: 0.5,
                  fontSize: 14,
                  color: 'var(--theme-text)',
                  animation: 'aiCursorPulse 1s ease-in-out infinite',
                  '@keyframes aiCursorPulse': {
                    '0%, 100%': { opacity: 1 },
                    '50%': { opacity: 0.2 },
                  },
                }}
              >
                ▊
              </Typography>
            )}
          </Box>
        )}

        {/* F16: per-answer actions. Copy + regenerate only; feedback buttons later (decision 4). */}
        {showActions && (
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Tooltip title={copied ? 'Copied' : 'Copy answer'}>
              <IconButton size="small" onClick={copyAnswer} aria-label="Copy answer" sx={{ color: 'var(--theme-text-muted)' }}>
                {copied ? <CheckIcon sx={{ fontSize: 15 }} /> : <ContentCopyIcon sx={{ fontSize: 15 }} />}
              </IconButton>
            </Tooltip>
            {onRegenerate && (
              <Tooltip title="Regenerate">
                <IconButton size="small" onClick={onRegenerate} aria-label="Regenerate answer" sx={{ color: 'var(--theme-text-muted)' }}>
                  <RefreshIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        )}

        {/* F15: an error turn gets a retry control instead of a raw "Error:" line. */}
        {turn.status === 'error' && onRegenerate && (
          <Button
            size="small"
            variant="outlined"
            onClick={onRegenerate}
            startIcon={<RefreshIcon sx={{ fontSize: 14 }} />}
            sx={{ alignSelf: 'flex-start', minWidth: 0, height: 28, px: 1.25, fontSize: 12, textTransform: 'none', borderRadius: 999 }}
          >
            Try again
          </Button>
        )}

        {turn.status === 'cancelled' && (
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'var(--theme-text-muted)' }}>
            <StopIcon sx={{ fontSize: 12 }} />
            <Typography variant="caption" sx={{ fontSize: 11 }}>
              Stopped
            </Typography>
          </Stack>
        )}
      </Box>
    </Box>
  );
}
