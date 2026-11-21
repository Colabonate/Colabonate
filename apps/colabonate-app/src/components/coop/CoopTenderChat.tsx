import { useState, useEffect, useCallback, useRef } from 'react'
import { Box, Alert, Typography } from '@mui/material'
import { Chat } from '@ds/ui'
import {
  sendChatMessage,
  decryptChatMessage,
  getMyPubkey,
  subscribeToChatMessages,
  type ChatMessageEvent,
} from '../../lib/nostr'

interface CoopTenderChatProps {
  tenderId: string
  initiatorPubkey: string
  partnerPubkey?: string | null
}

interface DecryptedMessage {
  id: string
  pubkey: string
  content: string
  createdAt: number
  isOwn: boolean
}

const STORAGE_KEY = (tenderId: string) => `coop_chat_messages_${tenderId}`

function loadFromStorage(tenderId: string): DecryptedMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(tenderId))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveToStorage(tenderId: string, messages: DecryptedMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY(tenderId), JSON.stringify(messages))
  } catch { /* quota exceeded — ignore */ }
}

function mergeMessages(existing: DecryptedMessage[], incoming: DecryptedMessage[]): DecryptedMessage[] {
  const byId = new Map(existing.map(m => [m.id, m]))
  for (const m of incoming) {
    if (!byId.has(m.id)) byId.set(m.id, m)
  }
  return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt)
}

export function CoopTenderChat({ tenderId, initiatorPubkey, partnerPubkey }: CoopTenderChatProps) {
  const [messages, setMessages] = useState<DecryptedMessage[]>(() => loadFromStorage(tenderId))
  const [, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [loginPubkey, setLoginPubkey] = useState<string>('')
  const [chatPubkey, setChatPubkey] = useState<string>('')

  const chatPubkeyRef = useRef(chatPubkey)
  chatPubkeyRef.current = chatPubkey

  const isInitiator = !!loginPubkey && loginPubkey === initiatorPubkey
  const otherPartyPubkey = isInitiator ? (partnerPubkey ?? null) : initiatorPubkey

  useEffect(() => {
    if (messages.length > 0) saveToStorage(tenderId, messages)
  }, [messages, tenderId])

  useEffect(() => {
    getMyPubkey().then(setChatPubkey).catch(console.error)

    const load = async () => {
      if (window.nostr) {
        try { setLoginPubkey(await window.nostr.getPublicKey()); return } catch { /* fall through */ }
      }
      const stored = localStorage.getItem('pubkey')
      if (stored) { setLoginPubkey(stored); return }
      getMyPubkey().then(setLoginPubkey).catch(console.error)
    }
    load()
  }, [])

  const addMessages = useCallback((incoming: DecryptedMessage[]) => {
    setMessages(prev => mergeMessages(prev, incoming))
  }, [])

  const decryptEvent = useCallback(async (event: ChatMessageEvent): Promise<DecryptedMessage | null> => {
    const myPrivkey = localStorage.getItem('nostr_burner_key')
    if (!myPrivkey) return null
    try {
      const { content, createdAt } = await decryptChatMessage(event, myPrivkey)
      return { id: event.id, pubkey: event.pubkey, content, createdAt, isOwn: event.pubkey === chatPubkeyRef.current }
    } catch {
      return null
    }
  }, [])

  const loadMessages = useCallback(async () => {
    if (!loginPubkey || !chatPubkey || !otherPartyPubkey) return

    try {
      setLoading(true)
      setError(null)

      const events = await (await import('../../lib/nostr')).fetchChatMessages(loginPubkey, otherPartyPubkey, tenderId, undefined, chatPubkey)

      const decrypted: DecryptedMessage[] = []
      for (const event of events) {
        const eventTicketId = event.tags.find(t => t[0] === 'ticket_id')?.[1]
        if (eventTicketId && eventTicketId !== tenderId) continue
        const msg = await decryptEvent(event)
        if (msg) decrypted.push(msg)
      }

      addMessages(decrypted)
    } catch (e) {
      console.error('Failed to load messages:', e)
      setError('Failed to load chat messages')
    } finally {
      setLoading(false)
    }
  }, [loginPubkey, chatPubkey, otherPartyPubkey, tenderId, addMessages, decryptEvent])

  useEffect(() => {
    if (!loginPubkey || !chatPubkey || !otherPartyPubkey) return

    loadMessages()

    const unsubscribe = subscribeToChatMessages(
      loginPubkey,
      async (event: ChatMessageEvent) => {
        const eventTicketId = event.tags.find(t => t[0] === 'ticket_id')?.[1]
        if (eventTicketId && eventTicketId !== tenderId) return
        const msg = await decryptEvent(event)
        if (msg) addMessages([msg])
      },
      otherPartyPubkey,
      tenderId,
      { limit: 50 },
      chatPubkey,
    )

    const poll = setInterval(loadMessages, 5000)

    return () => {
      unsubscribe()
      clearInterval(poll)
    }
  }, [loginPubkey, chatPubkey, otherPartyPubkey, tenderId, loadMessages, addMessages, decryptEvent])

  const handleSendMessage = async (content: string) => {
    if (!otherPartyPubkey) throw new Error('No recipient pubkey')
    setSending(true)
    try {
      const { id: eventId, createdAt } = await sendChatMessage(otherPartyPubkey, content, tenderId, loginPubkey)
      addMessages([{ id: eventId, pubkey: chatPubkey, content, createdAt, isOwn: true }])
    } catch (e) {
      console.error('Failed to send message:', e)
      throw e
    } finally {
      setSending(false)
    }
  }

  if (!loginPubkey || !chatPubkey) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">Sign in to use the chat</Typography>
      </Box>
    )
  }

  if (!otherPartyPubkey) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          {isInitiator
            ? 'Chat will be available once you accept a partner application'
            : 'Chat is not available'}
        </Typography>
      </Box>
    )
  }

  return (
    <Box>
      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Chat
        messages={messages}
        myPubkey={chatPubkey}
        otherPartyPubkey={otherPartyPubkey}
        onSendMessage={handleSendMessage}
        loading={sending}
      />
    </Box>
  )
}
