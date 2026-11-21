import { forwardRef, useState, useEffect, useRef, type KeyboardEvent } from 'react'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Button from '@mui/material/Button'
import OutlinedInput from '@mui/material/OutlinedInput'
import Skeleton from '@mui/material/Skeleton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import { cn } from '@ds/utils'
import type { ChatRoomProps, ChatRoomMessage, ChatRoomProfile } from './chat-room.types'

// ── helpers ───────────────────────────────────────────────────────────────────

function defaultFormatSender(pubkey: string): string {
  if (pubkey.length <= 10) return pubkey
  return `${pubkey.slice(0, 6)}…${pubkey.slice(-4)}`
}

function defaultFormatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const AVATAR_COLORS = [
  'var(--color-primary-50)',
  'var(--color-secondary-50)',
  'var(--color-info-primary)',
  'var(--color-warning-primary)',
  'var(--color-status-success)',
]

function avatarColor(pubkey: string): string {
  if (!pubkey || pubkey.length < 2) return AVATAR_COLORS[0]
  const seed = pubkey.charCodeAt(0) + pubkey.charCodeAt(1)
  return AVATAR_COLORS[seed % AVATAR_COLORS.length]
}

function pubkeyInitials(pubkey: string): string {
  return pubkey.length >= 2 ? pubkey.slice(0, 2).toUpperCase() : '??'
}

function profileInitials(profile: ChatRoomProfile | undefined, pubkey: string): string {
  const name = profile?.name?.trim()
  if (name) {
    const initials = name
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join('')
    if (initials) return initials
  }
  return pubkeyInitials(pubkey)
}

// ── loading skeleton ──────────────────────────────────────────────────────────

const SKELETON_ROWS = [
  { right: false, width: 192 },
  { right: true, width: 148 },
  { right: false, width: 228 },
  { right: true, width: 168 },
]

function LoadingSkeleton() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 0.5 }}>
      {SKELETON_ROWS.map((row, i) => (
        <Box
          key={i}
          sx={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: row.right ? 'flex-end' : 'flex-start',
            gap: 1,
          }}
        >
          {!row.right && <Skeleton variant="circular" width={28} height={28} />}
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0.5,
              alignItems: row.right ? 'flex-end' : 'flex-start',
            }}
          >
            {!row.right && (
              <Skeleton variant="text" width={52} sx={{ fontSize: '0.625rem' }} />
            )}
            <Skeleton
              variant="rounded"
              width={row.width}
              height={38}
              sx={{
                borderRadius: row.right ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              }}
            />
            <Skeleton variant="text" width={30} sx={{ fontSize: '0.625rem' }} />
          </Box>
        </Box>
      ))}
    </Box>
  )
}

// ── empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        gap: 1.5,
        py: 6,
        textAlign: 'center',
      }}
    >
      <Box
        sx={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: 'var(--theme-surface)',
          border: '1px solid var(--theme-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--theme-text-muted)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </Box>
      <Box>
        <Typography
          sx={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--theme-text)', mb: 0.25 }}
        >
          No messages yet
        </Typography>
        <Typography sx={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
          Be the first to say hello!
        </Typography>
      </Box>
    </Box>
  )
}

// ── message bubble ────────────────────────────────────────────────────────────

function MessageBubble({
  message,
  isOwn,
  profile,
  formatSender,
  formatTimestamp,
}: {
  message: ChatRoomMessage
  isOwn: boolean
  profile?: ChatRoomProfile
  formatSender: (pubkey: string) => string
  formatTimestamp: (createdAt: number) => string
}) {
  const color = avatarColor(message.pubkey)
  const time = formatTimestamp(message.createdAt)
  const senderName = profile?.name?.trim() || formatSender(message.pubkey)

  if (isOwn) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.25 }}>
        <Box
          sx={{
            maxWidth: '72%',
            px: 1.75,
            py: 1,
            borderRadius: '18px 18px 4px 18px',
            background: 'var(--color-primary-50)',
            color: 'white',
            fontSize: '0.8125rem',
            lineHeight: 1.55,
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
          }}
        >
          {message.content}
        </Box>
        <Typography
          component="time"
          sx={{ fontSize: '0.625rem', color: 'var(--theme-text-muted)', pr: 0.5 }}
        >
          {time}
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1 }}>
      <Tooltip
        title={message.pubkey}
        placement="top-start"
        arrow
        slotProps={{
          tooltip: { sx: { fontSize: '0.5625rem', fontFamily: 'monospace', maxWidth: 280 } },
        }}
      >
        <Avatar
          src={profile?.picture || undefined}
          alt={profile?.name || undefined}
          sx={{
            width: 28,
            height: 28,
            fontSize: '0.5625rem',
            fontWeight: 700,
            letterSpacing: '0.02em',
            background: color,
            color: 'white',
            flexShrink: 0,
            mb: 1.5,
            cursor: 'default',
            userSelect: 'none',
          }}
        >
          {profileInitials(profile, message.pubkey)}
        </Avatar>
      </Tooltip>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, maxWidth: '72%' }}>
        <Typography
          sx={{ fontSize: '0.625rem', fontWeight: 600, color: 'var(--theme-text-muted)', pl: 0.5 }}
        >
          {senderName}
        </Typography>
        <Box
          sx={{
            px: 1.75,
            py: 1,
            borderRadius: '18px 18px 18px 4px',
            background: 'var(--theme-surface)',
            color: 'var(--theme-text)',
            fontSize: '0.8125rem',
            lineHeight: 1.55,
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
            border: '1px solid var(--theme-border)',
          }}
        >
          {message.content}
        </Box>
        <Typography
          component="time"
          sx={{ fontSize: '0.625rem', color: 'var(--theme-text-muted)', pl: 0.5 }}
        >
          {time}
        </Typography>
      </Box>
    </Box>
  )
}

// ── chat room ─────────────────────────────────────────────────────────────────

/**
 * Render cap for the message list. Only the newest N messages are mounted as
 * DOM nodes; the scroll container itself caps the visible viewport. Paired
 * with the buffer cap in the consumer (ContactChat) this keeps DOM size
 * bounded regardless of how long the channel has been live.
 */
const MAX_RENDERED_MESSAGES = 100

export const ChatRoom = forwardRef<HTMLDivElement, ChatRoomProps>(function ChatRoom(
  {
    messages,
    myPubkey,
    onSendMessage,
    loading = false,
    disabled = false,
    formatSender = defaultFormatSender,
    profiles,
    formatTimestamp = defaultFormatTimestamp,
    className,
  },
  ref,
) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Render only the newest MAX_RENDERED_MESSAGES so a long channel history
  // never mounts an unbounded number of DOM nodes. Messages arrive oldest-first.
  const visibleMessages = messages.length > MAX_RENDERED_MESSAGES
    ? messages.slice(messages.length - MAX_RENDERED_MESSAGES)
    : messages

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  async function handleSend() {
    const trimmed = draft.trim()
    if (!trimmed || disabled || sending) return
    setSending(true)
    try {
      await onSendMessage(trimmed)
      setDraft('')
    } catch (error) {
      console.error('Failed to send message:', error)
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <Box
      ref={ref}
      className={cn(className)}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--theme-border)',
        borderRadius: '12px',
        overflow: 'hidden',
      }}
    >
      {/* Message list */}
      <Box
        ref={scrollRef}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          minHeight: 240,
          maxHeight: 440,
          overflowY: 'auto',
          p: 2,
          background: 'var(--theme-surface-secondary)',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--theme-border) transparent',
          '&::-webkit-scrollbar': { width: '4px' },
          '&::-webkit-scrollbar-track': { background: 'transparent' },
          '&::-webkit-scrollbar-thumb': {
            background: 'var(--theme-border)',
            borderRadius: '2px',
          },
        }}
      >
        {loading ? (
          <LoadingSkeleton />
        ) : messages.length === 0 ? (
          <EmptyState />
        ) : (
          visibleMessages.map(msg => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isOwn={msg.pubkey === myPubkey}
              profile={profiles?.[msg.pubkey]}
              formatSender={formatSender}
              formatTimestamp={formatTimestamp}
            />
          ))
        )}
      </Box>

      {/* Input area */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 1,
          px: 1.5,
          py: 1.25,
          borderTop: '1px solid var(--theme-border)',
          background: 'var(--theme-surface)',
        }}
      >
        <OutlinedInput
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Login required to post' : 'Type a message… (Enter to send)'}
          disabled={disabled || sending}
          multiline
          maxRows={4}
          fullWidth
          size="small"
          sx={{
            flex: 1,
            borderRadius: '10px',
            background: 'var(--theme-surface-secondary)',
            fontSize: '0.8125rem',
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: 'var(--theme-border)',
              transition: 'border-color 0.15s ease',
            },
            '&:hover:not(.Mui-disabled) .MuiOutlinedInput-notchedOutline': {
              borderColor: 'var(--color-primary-50)',
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: 'var(--color-primary-50)',
              borderWidth: '1px',
            },
            '& .MuiInputBase-input': {
              color: 'var(--theme-text)',
              '&::placeholder': {
                color: 'var(--theme-text-muted)',
                opacity: 1,
              },
            },
            '&.Mui-disabled': {
              opacity: 0.55,
            },
          }}
        />
        <Button
          onClick={handleSend}
          disabled={disabled || sending || !draft.trim()}
          variant="contained"
          disableElevation
          endIcon={sending ? <CircularProgress size={14} sx={{ color: 'white' }} /> : <SendRoundedIcon sx={{ fontSize: 16 }} />}
          aria-label="Send message"
          sx={{
            flexShrink: 0,
            height: 38,
            borderRadius: '10px',
            background: 'var(--color-primary-50)',
            color: 'white',
            fontWeight: 600,
            fontSize: '0.8125rem',
            textTransform: 'none',
            px: 2,
            boxShadow: 'none',
            '&:hover': {
              background: 'var(--color-primary-50)',
              opacity: 0.88,
              boxShadow: 'none',
            },
            '&:active': {
              transform: 'scale(0.97)',
              boxShadow: 'none',
            },
            '&.Mui-disabled': {
              background: 'var(--theme-border)',
              color: 'var(--theme-text-muted)',
            },
          }}
        >
          Send
        </Button>
      </Box>
    </Box>
  )
})
