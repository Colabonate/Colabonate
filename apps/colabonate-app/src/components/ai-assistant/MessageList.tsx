import { useRef, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Avatar from '@mui/material/Avatar';
import { AutoAwesome as AutoAwesomeIcon } from '@mui/icons-material';
import { Cable } from 'lucide-react';
import type { MessageTurn as MessageTurnType } from './ai-assistant.types';
import { MessageTurn } from './MessageTurn';
import { QuickActions } from './QuickActions';
import { AiCreditsStarter } from './AiCreditsStatus';

interface MessageListProps {
  turns: MessageTurnType[];
  compact?: boolean;
  onQuickAction?: (message: string) => void;
  /** F15/F16: re-runs the last user message (retry an error / regenerate). Only offered on the last turn. */
  onRegenerate?: () => void;
  emptyContent?: ReactNode;
  /** ADR-371 D6 — show the one-line "connect your own agent" hint in the empty state. */
  connectHint?: boolean;
  /** F7: visitor without an account → guide quick actions only. */
  guest?: boolean;
}

export function MessageList({
  turns,
  compact = true,
  onQuickAction,
  onRegenerate,
  emptyContent,
  connectHint,
  guest = false,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // F14: follow the stream only while the user is at the bottom; if they
  // scrolled up to read, show a "new answer" pill instead of yanking them down.
  const [atBottom, setAtBottom] = useState(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  };

  useEffect(() => {
    if (!atBottom) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, atBottom]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setAtBottom(true);
  };

  if (turns.length === 0) {
    return (
      <Box
        ref={scrollRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 3,
        }}
      >
        {emptyContent ?? (
          <Stack
            spacing={1.5}
            alignItems="center"
            sx={{ width: '100%', maxWidth: 320 }}
          >
            <Avatar
              sx={{
                width: 48,
                height: 48,
                bgcolor: 'var(--color-primary-8)',
                color: 'var(--color-primary-50)',
              }}
            >
              <AutoAwesomeIcon fontSize="small" />
            </Avatar>
            <Typography variant="subtitle1" sx={{ color: 'var(--theme-text)', fontWeight: 600 }}>
              Colabonate AI Assistant
            </Typography>
            <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', textAlign: 'center' }}>
              Buy, sell, and cooperate with AI
            </Typography>
            <Box sx={{ width: '100%', mt: 1 }}>
              <AiCreditsStarter />
            </Box>
            {onQuickAction && (
              <Box sx={{ width: '100%', mt: 1 }}>
                <QuickActions onAction={onQuickAction} guest={guest} />
              </Box>
            )}
            {connectHint && (
              <Link to="/ai/connect" style={{ textDecoration: 'none', width: '100%' }}>
                <Box
                  sx={{
                    width: '100%',
                    mt: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1.25,
                    py: 1,
                    borderRadius: 999,
                    border: '1px solid var(--theme-border)',
                    background: 'var(--theme-bg-subtle)',
                    color: 'var(--theme-text-muted)',
                    transition: 'border-color 150ms ease, color 150ms ease',
                    '&:hover': {
                      borderColor: 'var(--color-primary-50)',
                      color: 'var(--color-primary-50)',
                    },
                  }}
                >
                  <Cable size={14} />
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    Connect your own agent via MCP
                  </Typography>
                </Box>
              </Link>
            )}
          </Stack>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <Box
        ref={scrollRef}
        onScroll={handleScroll}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        }}
      >
        {turns.map((turn, index) => (
          <MessageTurn
            key={turn.id}
            turn={turn}
            compact={compact}
            onRegenerate={index === turns.length - 1 ? onRegenerate : undefined}
          />
        ))}
      </Box>

      {!atBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute left-1/2 z-10 -translate-x-1/2 rounded-full px-3 py-1.5 text-[12px] font-semibold shadow-lg"
          style={{
            bottom: 12,
            background: 'var(--color-primary-50)',
            color: 'var(--theme-surface)',
          }}
        >
          ↓ New answer
        </button>
      )}
    </Box>
  );
}
