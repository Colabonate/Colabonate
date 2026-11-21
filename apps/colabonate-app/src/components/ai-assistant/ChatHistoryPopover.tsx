import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Popover from '@mui/material/Popover';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  ChatBubbleOutline as ChatBubbleOutlineIcon,
} from '@mui/icons-material';
import type { ChatSession } from './ai-assistant.types';

interface ChatHistoryPopoverProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
}

interface DateGroup {
  label: string;
  sessions: ChatSession[];
}

function groupByDate(sessions: ChatSession[]): DateGroup[] {
  const now = Date.now();
  const DAY = 86400000;
  const groups: DateGroup[] = [];
  const today: ChatSession[] = [];
  const yesterday: ChatSession[] = [];
  const lastWeek: ChatSession[] = [];
  const older: ChatSession[] = [];

  for (const s of sessions) {
    const age = now - s.updatedAt;
    if (age < DAY) today.push(s);
    else if (age < 2 * DAY) yesterday.push(s);
    else if (age < 7 * DAY) lastWeek.push(s);
    else older.push(s);
  }

  if (today.length)     groups.push({ label: 'Today',       sessions: today });
  if (yesterday.length) groups.push({ label: 'Yesterday',   sessions: yesterday });
  if (lastWeek.length)  groups.push({ label: 'Last 7 days', sessions: lastWeek });
  if (older.length)     groups.push({ label: 'Older',       sessions: older });

  return groups;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatHistoryPopover({
  anchorEl,
  open,
  onClose,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRenameSession,
}: ChatHistoryPopoverProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const groups = useMemo(() => groupByDate(sessions), [sessions]);

  const startRename = (session: ChatSession) => {
    setEditingId(session.id);
    setEditTitle(session.title);
  };

  const confirmRename = () => {
    if (editingId && editTitle.trim()) {
      onRenameSession(editingId, editTitle.trim());
    }
    setEditingId(null);
  };

  const cancelRename = () => {
    setEditingId(null);
  };

  const handleSelect = (id: string) => {
    onSelectSession(id);
    onClose();
  };

  const handleNew = () => {
    onNewSession();
    onClose();
  };

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{
        paper: {
          sx: {
            width: 300,
            maxWidth: 'calc(100vw - 24px)',
            maxHeight: 'min(440px, 62dvh)',
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 2,
            bgcolor: 'var(--theme-surface)',
            border: '1px solid var(--theme-border)',
            backgroundImage: 'none',
            mb: 1,
          },
        },
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ px: 1.5, py: 1.25, flexShrink: 0, borderBottom: '1px solid var(--theme-border)' }}
      >
        <Typography
          variant="subtitle2"
          sx={{ fontWeight: 600, color: 'var(--theme-text)' }}
        >
          Chat History
        </Typography>
        <Tooltip title="New chat">
          <IconButton
            size="small"
            onClick={handleNew}
            aria-label="New chat"
            sx={{
              bgcolor: 'var(--color-primary-8)',
              color: 'var(--color-primary-50)',
              '&:hover': { bgcolor: 'var(--color-primary-8)', opacity: 0.85 },
            }}
          >
            <AddIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Stack>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          p: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        {groups.length === 0 && (
          <Typography
            variant="caption"
            sx={{
              textAlign: 'center',
              py: 4,
              color: 'var(--theme-text-muted)',
            }}
          >
            No conversations yet
          </Typography>
        )}

        {groups.map(group => (
          <Stack key={group.label} spacing={0.75}>
            <Typography
              variant="overline"
              sx={{
                px: 1,
                fontWeight: 700,
                fontSize: '0.6875rem',
                letterSpacing: '0.08em',
                color: 'var(--theme-text-muted)',
              }}
            >
              {group.label}
            </Typography>
            {group.sessions.map(session => {
              const isActive = session.id === activeSessionId;
              return (
                <Box
                  key={session.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelect(session.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelect(session.id);
                    }
                  }}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1.25,
                    py: 1,
                    borderRadius: 1.5,
                    cursor: 'pointer',
                    transition: 'background-color 120ms ease, border-color 120ms ease',
                    bgcolor: isActive ? 'var(--theme-bg-subtle)' : 'transparent',
                    border: '1px solid',
                    borderColor: isActive ? 'var(--theme-border)' : 'transparent',
                    '&:hover': {
                      bgcolor: 'var(--theme-bg-hover)',
                      '& .session-actions': { opacity: 1 },
                    },
                    '&:focus-within .session-actions': { opacity: 1 },
                    '&:focus-visible': {
                      outline: '2px solid var(--color-primary-50)',
                      outlineOffset: '-2px',
                    },
                  }}
                >
                  <ChatBubbleOutlineIcon
                    sx={{ fontSize: 13, flexShrink: 0, color: 'var(--theme-text-muted)' }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    {editingId === session.id ? (
                      <Stack
                        direction="row"
                        spacing={0.5}
                        alignItems="center"
                        onClick={e => e.stopPropagation()}
                      >
                        <TextField
                          value={editTitle}
                          onChange={e => setEditTitle(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') confirmRename();
                            if (e.key === 'Escape') cancelRename();
                          }}
                          size="small"
                          fullWidth
                          autoFocus
                          sx={{
                            '& .MuiOutlinedInput-root': {
                              backgroundColor: 'var(--theme-bg-subtle)',
                              color: 'var(--theme-text)',
                              fontSize: '0.75rem',
                              borderRadius: 1,
                              minHeight: 28,
                              '& fieldset': { borderColor: 'var(--theme-border)' },
                              '&.Mui-focused fieldset': { borderColor: 'var(--color-primary-40)' },
                            },
                          }}
                        />
                        <IconButton
                          size="small"
                          onClick={confirmRename}
                          sx={{
                            color: 'var(--color-status-success)',
                            width: 24,
                            height: 24,
                          }}
                        >
                          <CheckIcon sx={{ fontSize: 13 }} />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={cancelRename}
                          sx={{
                            color: 'var(--theme-text-muted)',
                            width: 24,
                            height: 24,
                          }}
                        >
                          <CloseIcon sx={{ fontSize: 13 }} />
                        </IconButton>
                      </Stack>
                    ) : (
                      <>
                        <Typography
                          sx={{
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            lineHeight: 1.3,
                            color: isActive ? 'var(--theme-text)' : 'var(--theme-text-muted)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {session.title}
                        </Typography>
                        <Typography
                          sx={{
                            fontSize: '0.625rem',
                            mt: 0.25,
                            color: 'var(--theme-text-muted)',
                            opacity: 0.7,
                          }}
                        >
                          {formatTime(session.updatedAt)}
                        </Typography>
                      </>
                    )}
                  </Box>
                  {editingId !== session.id && (
                    <Stack
                      direction="row"
                      spacing={0.25}
                      className="session-actions"
                      sx={{
                        flexShrink: 0,
                        alignItems: 'center',
                        opacity: { xs: 1, sm: 0 },
                        transition: 'opacity 150ms ease',
                      }}
                      onClick={e => e.stopPropagation()}
                    >
                      <IconButton
                        size="small"
                        onClick={() => startRename(session)}
                        aria-label={`Rename ${session.title}`}
                        sx={{
                          color: 'var(--theme-text-muted)',
                          width: 24,
                          height: 24,
                        }}
                      >
                        <EditIcon sx={{ fontSize: 12 }} />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => onDeleteSession(session.id)}
                        aria-label={`Delete ${session.title}`}
                        sx={{
                          color: 'var(--color-status-error)',
                          width: 24,
                          height: 24,
                        }}
                      >
                        <DeleteIcon sx={{ fontSize: 12 }} />
                      </IconButton>
                    </Stack>
                  )}
                </Box>
              );
            })}
          </Stack>
        ))}
      </Box>
    </Popover>
  );
}
