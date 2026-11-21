import { useState, useEffect, useCallback, useRef } from 'react'
import { Box, Alert } from '@mui/material'
import { Chat } from '@ds/ui'
import {
  sendChatMessage,
  decryptChatMessage,
  getMyPubkey,
  subscribeToChatMessages,
  type ChatMessageEvent
} from '../../lib/nostr'
import { useNotification } from '../../context/NotificationContext'
import type { Ticket } from '../../types/api'

interface TicketChatProps {
  ticket: Ticket
}

interface DecryptedMessage {
  id: string
  pubkey: string
  content: string
  createdAt: number
  isOwn: boolean
}

const STORAGE_KEY = (ticketId: string) => `chat_messages_${ticketId}`

function loadFromStorage(ticketId: string): DecryptedMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(ticketId))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveToStorage(ticketId: string, messages: DecryptedMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY(ticketId), JSON.stringify(messages))
  } catch { /* quota exceeded — ignore */ }
}

/** Merge incoming messages into existing list, dedup by id, sort by createdAt. */
function mergeMessages(existing: DecryptedMessage[], incoming: DecryptedMessage[]): DecryptedMessage[] {
  const byId = new Map(existing.map(m => [m.id, m]))
  for (const m of incoming) {
    if (!byId.has(m.id)) byId.set(m.id, m)
  }
  return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt)
}

export function TicketChat({ ticket }: TicketChatProps) {
  const [messages, setMessages] = useState<DecryptedMessage[]>(() => loadFromStorage(ticket.id))
  const [, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // loginPubkey: NIP-07 / login — matches ticket.buyerPubkey / sellerPubkey, used for relay #p filter
  // chatPubkey:  derived from burner privkey — used for event signing and isOwn detection
  const [loginPubkey, setLoginPubkey] = useState<string>('')
  const [chatPubkey, setChatPubkey] = useState<string>('')

  const chatPubkeyRef = useRef(chatPubkey)
  chatPubkeyRef.current = chatPubkey

  const notifiedIdsRef = useRef(new Set<string>())
  const { addNotification, showSnackbar } = useNotification()

  const isBuyer = !!loginPubkey && loginPubkey === ticket.buyerPubkey
  const otherPartyPubkey = isBuyer ? ticket.sellerPubkey : ticket.buyerPubkey

  // Persist to localStorage whenever messages change
  useEffect(() => {
    if (messages.length > 0) saveToStorage(ticket.id, messages)
  }, [messages, ticket.id])

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
    setMessages(prev => {
      const merged = mergeMessages(prev, incoming)
      return merged
    })
  }, [])

  const loadMessages = useCallback(async () => {
    if (!loginPubkey || !chatPubkey || !otherPartyPubkey) return

    try {
      setLoading(true)
      setError(null)

      const events = await (await import('../../lib/nostr')).fetchChatMessages(loginPubkey, otherPartyPubkey, ticket.id, undefined, chatPubkey)
      const myPrivkey = localStorage.getItem('nostr_burner_key')
      if (!myPrivkey) throw new Error('No private key found')

      const decrypted: DecryptedMessage[] = []
      for (const event of events) {
        const eventTicketId = event.tags.find(t => t[0] === 'ticket_id')?.[1]
        if (eventTicketId && eventTicketId !== ticket.id) continue
        try {
          const { content, createdAt } = await decryptChatMessage(event, myPrivkey)
          decrypted.push({ id: event.id, pubkey: event.pubkey, content, createdAt, isOwn: event.pubkey === chatPubkey })
        } catch (e) {
          console.warn('Failed to decrypt message:', e)
        }
      }

      // Merge — never overwrite, so locally-added own messages survive
      addMessages(decrypted)
    } catch (e) {
      console.error('Failed to load messages:', e)
      setError('Failed to load chat messages')
    } finally {
      setLoading(false)
    }
  }, [loginPubkey, chatPubkey, otherPartyPubkey, ticket.id, addMessages])

  useEffect(() => {
    if (!loginPubkey) return
    loadMessages()

    const unsubscribe = subscribeToChatMessages(
      loginPubkey,
      async (event: ChatMessageEvent) => {
        const eventTicketId = event.tags.find(t => t[0] === 'ticket_id')?.[1]
        if (eventTicketId && eventTicketId !== ticket.id) return
        const myPrivkey = localStorage.getItem('nostr_burner_key')
        if (!myPrivkey) return
        try {
          const { content, createdAt } = await decryptChatMessage(event, myPrivkey)
          const isOwn = event.pubkey === chatPubkeyRef.current
          addMessages([{ id: event.id, pubkey: event.pubkey, content, createdAt, isOwn }])
          if (!isOwn && !notifiedIdsRef.current.has(event.id)) {
            notifiedIdsRef.current.add(event.id)
            const offerTitle = ticket.offer?.title ?? `#${ticket.id.slice(0, 8)}`
            const preview = content.length > 48 ? content.slice(0, 47) + '…' : content
            addNotification({
              type: 'message',
              title: `New Msg: ${preview}`,
              message: offerTitle,
              relatedId: ticket.id,
              actionUrl: `/tickets/${ticket.id}`,
              meta: { ticketId: ticket.id, partnerPubkey: event.pubkey },
            })
            showSnackbar(`${preview}`, 'info')
          }
        } catch (e) {
          console.warn('Failed to decrypt new message:', e)
        }
      },
      otherPartyPubkey,
      ticket.id,
      { limit: 50 }
    )

    return () => unsubscribe()
  }, [loginPubkey, chatPubkey, otherPartyPubkey, ticket.id, loadMessages, addMessages])

  const handleSendMessage = async (content: string) => {
    if (!otherPartyPubkey) throw new Error('No recipient pubkey')
    console.log('[TicketChat] sendMsg:', { loginPubkey: loginPubkey?.slice(0, 12), chatPubkey: chatPubkey?.slice(0, 12), otherPartyPubkey: otherPartyPubkey?.slice(0, 12), isBuyer, buyerPubkey: ticket.buyerPubkey?.slice(0, 12), sellerPubkey: ticket.sellerPubkey?.slice(0, 12) })
    const validRecipient = /^[0-9a-fA-F]{64}$/.test(otherPartyPubkey)
    const validSender = chatPubkey && /^[0-9a-fA-F]{64}$/.test(chatPubkey)
    if (!validRecipient || !validSender) {
      setError(`Chat unavailable — ${!validSender ? 'your' : "other party's"} key is not a valid 64-char Nostr hex key. Both users must log in via Alby/Lightning wallet (not Demo mode).`)
      return
    }
    setSending(true)
    try {
      const { id: eventId, createdAt } = await sendChatMessage(otherPartyPubkey, content, ticket.id)
      // Own messages never come back via subscription — add locally and persist
      addMessages([{ id: eventId, pubkey: chatPubkey, content, createdAt, isOwn: true }])
    } catch (e) {
      console.error('Failed to send message:', e)
      throw e
    } finally {
      setSending(false)
    }
  }

  if (!loginPubkey || !chatPubkey) return null
  if (loginPubkey !== ticket.buyerPubkey && loginPubkey !== ticket.sellerPubkey) return null

  return (
    <Box sx={{ mt: 3 }}>
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
