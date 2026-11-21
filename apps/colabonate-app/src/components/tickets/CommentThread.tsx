import { useState } from 'react'
import { formatLocaleDate } from '../../contexts/LocaleContext'
import {
  Avatar,
  Box,
  Divider,
  IconButton,
  InputAdornment,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import LockIcon   from '@mui/icons-material/Lock'
import SendIcon   from '@mui/icons-material/Send'

interface Comment {
  id: string
  authorPubkey: string
  authorLnAddress?: string
  content: string
  createdAt: string
  attachments?: string[]
}

interface CommentThreadProps {
  comments: Comment[]
  onAddComment: (content: string) => Promise<void>
  currentUserPubkey: string
  readOnly?: boolean
}

function formatTime(dateString: string): string {
  const date = new Date(dateString)
  const diffMs   = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays  = Math.floor(diffHours / 24)
  if (diffMins < 1)   return 'Just now'
  if (diffMins < 60)  return `${diffMins} min. ago`
  if (diffHours < 24) return `${diffHours} hrs. ago`
  if (diffDays < 7)   return `${diffDays} days ago`
  return formatLocaleDate(date, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function shortenPubkey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`
}

export function CommentThread({
  comments,
  onAddComment,
  currentUserPubkey,
  readOnly = false,
}: CommentThreadProps) {
  const [newComment, setNewComment] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!newComment.trim() || submitting) return
    setSubmitting(true)
    try {
      await onAddComment(newComment.trim())
      setNewComment('')
    } catch (error) {
      console.error('Failed to add comment:', error)
    } finally {
      setSubmitting(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSubmit(e as unknown as React.FormEvent)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h6" fontWeight={600} mb={2}>
        Kommunikation {readOnly && '(Schreibgeschützt)'}
      </Typography>

      {/* ── Nachrichten-Liste ──────────────────────────────────────────────── */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          maxHeight: 380,
          overflowY: 'auto',
          mb: 2,
          pr: 0.5,
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 2 },
        }}
      >
        {comments.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 5 }}>
            <Typography variant="body2" color="text.disabled">
              No messages yet. Start the conversation!
            </Typography>
          </Box>
        ) : (
          comments.map((comment) => {
            const isOwn = comment.authorPubkey === currentUserPubkey
            const author = comment.authorLnAddress || shortenPubkey(comment.authorPubkey)
            const initials = author[0]?.toUpperCase() ?? '?'

            return (
              <Box
                key={comment.id}
                sx={{
                  display: 'flex',
                  flexDirection: isOwn ? 'row-reverse' : 'row',
                  alignItems: 'flex-end',
                  gap: 1,
                }}
              >
                {!isOwn && (
                  <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem', bgcolor: 'secondary.main', flexShrink: 0 }}>
                    {initials}
                  </Avatar>
                )}

                <Box sx={{ maxWidth: '78%' }}>
                  <Typography
                    variant="caption"
                    color="text.disabled"
                    sx={{ display: 'block', mb: 0.4, textAlign: isOwn ? 'right' : 'left' }}
                  >
                    {isOwn ? 'You' : author} · {formatTime(comment.createdAt)}
                  </Typography>

                  <Paper
                    variant={isOwn ? 'elevation' : 'outlined'}
                    elevation={isOwn ? 0 : 0}
                    sx={{
                      px: 1.75,
                      py: 1.25,
                      borderRadius: 2,
                      bgcolor: isOwn ? 'primary.main' : 'action.hover',
                      borderColor: isOwn ? 'transparent' : 'divider',
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{
                        whiteSpace: 'pre-wrap',
                        color: isOwn ? 'primary.contrastText' : 'text.primary',
                        wordBreak: 'break-word',
                      }}
                    >
                      {comment.content}
                    </Typography>

                    {comment.attachments && comment.attachments.length > 0 && (
                      <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.3 }}>
                        {comment.attachments.map((url, i) => (
                          <Typography
                            key={i}
                            component="a"
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            variant="caption"
                            sx={{
                              color: isOwn ? 'rgba(255,255,255,0.75)' : 'primary.main',
                              textDecoration: 'underline',
                            }}
                          >
                            📎 Anhang {i + 1}
                          </Typography>
                        ))}
                      </Box>
                    )}
                  </Paper>
                </Box>
              </Box>
            )
          })
        )}
      </Box>

      {/* ── Eingabe ────────────────────────────────────────────────────────── */}
      {!readOnly && (
        <>
          <Divider sx={{ mb: 2 }} />
          <Box component="form" onSubmit={handleSubmit}>
            <TextField
              fullWidth
              multiline
              minRows={2}
              maxRows={4}
              placeholder="Enter message... (Ctrl+Enter to send)"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={submitting}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end" sx={{ alignSelf: 'flex-end', mb: 0.5 }}>
                      <Tooltip title="Send (Ctrl+Enter)">
                        <span>
                          <IconButton
                            type="submit"
                            color="primary"
                            disabled={!newComment.trim() || submitting}
                            size="small"
                          >
                            <SendIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1 }}>
              <LockIcon sx={{ fontSize: 12, color: 'text.disabled' }} />
              <Typography variant="caption" color="text.disabled">
                End-to-end encrypted · only visible between involved parties
              </Typography>
            </Box>
          </Box>
        </>
      )}
    </Paper>
  )
}
