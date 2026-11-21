import { forwardRef, useState, useEffect, useRef } from 'react'
import { Box, Button, CircularProgress, TextField, Typography, Paper } from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
import type { ChatInputProps } from './chat.types'

export const ChatInput = forwardRef<HTMLDivElement, ChatInputProps>(
  function ChatInput({ onSend, disabled = false, placeholder = 'Type a message...' }, ref) {
    const [message, setMessage] = useState('')
    const [sending, setSending] = useState(false)

    const handleSubmit = async () => {
      const trimmed = message.trim()
      if (!trimmed || disabled || sending) return

      setSending(true)
      try {
        await onSend(trimmed)
        setMessage('')
      } catch (error) {
        console.error('Failed to send message:', error)
      } finally {
        setSending(false)
      }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    }

    return (
      <Box
        ref={ref}
        sx={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 1,
          p: 2,
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <TextField
          fullWidth
          multiline
          maxRows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || sending}
          size="small"
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: 3,
              bgcolor: 'action.hover',
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: 'primary.main',
              },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                borderColor: 'primary.main',
                borderWidth: 2,
              },
            },
            '& .MuiInputBase-input': {
              fontSize: '0.875rem',
              py: 1,
            },
          }}
        />
        <Button
          variant="contained"
          color="primary"
          onClick={handleSubmit}
          disabled={!message.trim() || disabled || sending}
          endIcon={sending ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
          sx={{ flexShrink: 0, alignSelf: 'flex-end', height: 40 }}
        >
          Send
        </Button>
      </Box>
    )
  }
)

export const ChatBubble = forwardRef<HTMLDivElement, { content: string; isOwn: boolean; timestamp: number }>(
  function ChatBubble({ content, isOwn, timestamp }, ref) {
    const d = new Date(timestamp * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    const timeStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

    return (
      <Box
        ref={ref}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: isOwn ? 'flex-end' : 'flex-start',
          maxWidth: '80%',
          alignSelf: isOwn ? 'flex-end' : 'flex-start',
          width: 'fit-content',
        }}
      >
        <Paper
          sx={{
            p: 1.5,
            px: 2,
            borderRadius: 3,
            bgcolor: isOwn ? 'primary.main' : 'action.hover',
            color: isOwn ? 'primary.contrastText' : 'text.primary',
            borderBottomRightRadius: isOwn ? 4 : 16,
            borderBottomLeftRadius: isOwn ? 16 : 4,
            wordBreak: 'break-word',
          }}
        >
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {content}
          </Typography>
        </Paper>
        <Typography
          variant="caption"
          color="text.disabled"
          sx={{
            mt: 0.5,
            px: 0.5,
            fontSize: '0.65rem',
          }}
        >
          {timeStr}
        </Typography>
      </Box>
    )
  }
)

export const ChatWindow = forwardRef<HTMLDivElement, {
  messages: Array<{ id: string; content: string; isOwn: boolean; createdAt: number }>
  loading?: boolean
}>(
  function ChatWindow({ messages, loading }, ref) {
    const scrollRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    }, [messages])

    const setRefs = (node: HTMLDivElement | null) => {
      scrollRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node
    }

    return (
      <Box
        ref={setRefs}
        sx={{
          flex: 1,
          overflowY: 'auto',
          p: 2,
          pb: 3,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          bgcolor: 'background.default',
        }}
      >
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : messages.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              No messages yet.<br />Start the conversation!
            </Typography>
          </Box>
        ) : (
          messages.map((msg) => (
            <ChatBubble
              key={msg.id}
              content={msg.content}
              isOwn={msg.isOwn}
              timestamp={msg.createdAt}
            />
          ))
        )}
      </Box>
    )
  }
)