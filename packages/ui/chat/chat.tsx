import { forwardRef } from 'react'
import { Box } from '@mui/material'
import { cn } from '@ds/utils'
import { ChatWindow, ChatInput } from './chat-window'
import type { ChatProps, ChatMessage } from './chat.types'

export const Chat = forwardRef<HTMLDivElement, ChatProps>(function Chat(
  { messages, myPubkey, onSendMessage, loading = false },
  ref
) {
  const formattedMessages: ChatMessage[] = messages.map(msg => ({
    id: msg.id,
    pubkey: msg.pubkey,
    content: msg.content,
    createdAt: msg.createdAt,
    isOwn: msg.pubkey === myPubkey || msg.isOwn,
  }))

  return (
    <Box
      ref={ref}
      sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      className={cn('chat-container')}
    >
      <ChatWindow messages={formattedMessages} loading={loading} />
      <ChatInput
        onSend={onSendMessage}
        disabled={loading}
        placeholder="Type a message..."
      />
    </Box>
  )
})