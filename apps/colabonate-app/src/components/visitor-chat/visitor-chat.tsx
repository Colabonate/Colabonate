import { useState, useEffect, useCallback, useRef } from 'react'
import { Box, Typography, CircularProgress, Alert, List, ListItemButton, ListItemText, ListItemIcon, Badge, IconButton, Paper, Chip, Collapse } from '@mui/material'
import { ChatBubbleOutline as ChatIcon, Chat as ChatFilledIcon, Close as CloseIcon, ExpandMore as ExpandMoreIcon } from '@mui/icons-material'
import { Chat } from '@ds/ui'
import {
  sendChatMessage,
  getMyPubkey,
  subscribeToChatMessages,
  fetchChatMessages,
  type ChatMessageEvent,
} from '../../lib/nostr'
import { apiCall } from '../../lib/api'

interface DecryptedMessage {
  id: string
  pubkey: string
  content: string
  createdAt: number
  isOwn: boolean
}

const STORAGE_KEY = (offerId: string, visitorPubkey: string) => `visitor_chat_${offerId}_${visitorPubkey}`

function loadFromStorage(offerId: string, visitorPubkey: string): DecryptedMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(offerId, visitorPubkey))
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveToStorage(offerId: string, visitorPubkey: string, messages: DecryptedMessage[]) {
  try { localStorage.setItem(STORAGE_KEY(offerId, visitorPubkey), JSON.stringify(messages)) } catch {}
}

function mergeMessages(existing: DecryptedMessage[], incoming: DecryptedMessage[]): DecryptedMessage[] {
  const byId = new Map(existing.map(m => [m.id, m]))
  for (const m of incoming) { if (!byId.has(m.id)) byId.set(m.id, m) }
  return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt)
}

export interface Visitor {
  pubkey: string
  lastMessageAt: number
  hasChat: boolean
}

export interface VisitorChatProps {
  offerId: string
  sellerPubkey: string
  onVisitorNotification?: (visitor: Visitor) => void
}

export function VisitorChat({ offerId, sellerPubkey, onVisitorNotification }: VisitorChatProps) {
  const [visitors, setVisitors] = useState<Visitor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedVisitor, setSelectedVisitor] = useState<Visitor | null>(null)
  const [messages, setMessages] = useState<DecryptedMessage[]>([])
  const [sending, setSending] = useState(false)
  const [loginPubkey, setLoginPubkey] = useState<string>('')
  const [chatPubkey, setChatPubkey] = useState<string>('')
  const [notifiedVisitors, setNotifiedVisitors] = useState<Set<string>>(new Set())

  const chatPubkeyRef = useRef(chatPubkey)
  chatPubkeyRef.current = chatPubkey
  const notifiedRef = useRef(notifiedVisitors)
  notifiedRef.current = notifiedVisitors
  const activeVisitorRef = useRef<string | null>(null)

  useEffect(() => {
    getMyPubkey().then(setChatPubkey).catch(console.error)
    const stored = localStorage.getItem('pubkey')
    if (stored) setLoginPubkey(stored)
  }, [])

  const fetchVisitors = useCallback(async () => {
    if (!loginPubkey || loginPubkey !== sellerPubkey) return
    try {
      const res = await apiCall(`/api/offers/${offerId}/visitors`, { headers: { 'x-pubkey': loginPubkey } })
      if (res.ok) {
        const data = await res.json()
        setVisitors(data.visitors || [])
        setError(null)
      } else {
        const err = await res.json().catch(() => ({ error: 'Request failed' }))
        setError(err.error || `HTTP ${res.status}`)
      }
    } catch (err: any) { setError(err?.message || 'Failed to load visitors') }
    finally { setLoading(false) }
  }, [offerId, loginPubkey, sellerPubkey])

  useEffect(() => {
    if (!loginPubkey || loginPubkey !== sellerPubkey) {
      setLoading(false)
      return
    }
    setLoading(true)
    fetchVisitors()
  }, [loginPubkey, sellerPubkey, fetchVisitors])

  useEffect(() => {
    if (loginPubkey !== sellerPubkey) return
    const poll = setInterval(() => fetchVisitors(), 15000)
    return () => clearInterval(poll)
  }, [loginPubkey, sellerPubkey, fetchVisitors])

  const decryptEvent = useCallback(async (event: ChatMessageEvent): Promise<DecryptedMessage | null> => {
    const myPrivkey = localStorage.getItem('nostr_burner_key')
    if (!myPrivkey) return null
    try {
      const content = event.content
      const createdAt = event.created_at
      return { id: event.id, pubkey: event.pubkey, content, createdAt, isOwn: event.pubkey === chatPubkeyRef.current }
    } catch { return null }
  }, [])

  const loadMessages = useCallback(async () => {
    if (!loginPubkey || !chatPubkey || !selectedVisitor) return
    const visitorPubkey = selectedVisitor.pubkey
    try {
      const events = await fetchChatMessages(loginPubkey, visitorPubkey, offerId, undefined, chatPubkey)
      if (activeVisitorRef.current !== visitorPubkey) return
      const decrypted: DecryptedMessage[] = []
      for (const event of events) {
        const eventTicketId = event.tags.find(t => t[0] === 'ticket_id')?.[1]
        if (eventTicketId && eventTicketId !== offerId) continue
        const isFromVisitor = event.pubkey === visitorPubkey
        const isToVisitor = event.tags.some(t => t[0] === 'p' && t[1] === visitorPubkey)
        if (!isFromVisitor && !isToVisitor) continue
        const msg = await decryptEvent(event)
        if (msg) decrypted.push(msg)
      }
      if (activeVisitorRef.current !== visitorPubkey) return
      setMessages(prev => {
        const merged = mergeMessages(prev, decrypted)
        saveToStorage(offerId, visitorPubkey, merged)
        return merged
      })
    } catch { /* silent */ }
  }, [loginPubkey, chatPubkey, selectedVisitor, offerId, decryptEvent])

  useEffect(() => {
    if (!selectedVisitor) { activeVisitorRef.current = null; return }
    const visitorPubkey = selectedVisitor.pubkey
    activeVisitorRef.current = visitorPubkey

    const stored = loadFromStorage(offerId, visitorPubkey)
    setMessages(stored)
    if (!loginPubkey || !chatPubkey) return

    loadMessages()

    const unsubscribe = subscribeToChatMessages(
      loginPubkey,
      async (event: ChatMessageEvent) => {
        if (activeVisitorRef.current !== visitorPubkey) return
        const eventTicketId = event.tags.find(t => t[0] === 'ticket_id')?.[1]
        if (eventTicketId && eventTicketId !== offerId) return
        const isFromVisitor = event.pubkey === visitorPubkey
        const isToVisitor = event.tags.some(t => t[0] === 'p' && t[1] === visitorPubkey)
        if (!isFromVisitor && !isToVisitor) return
        const msg = await decryptEvent(event)
        if (!msg || activeVisitorRef.current !== visitorPubkey) return
        setMessages(prev => {
          const merged = mergeMessages(prev, [msg])
          saveToStorage(offerId, visitorPubkey, merged)
          return merged
        })
        if (!msg.isOwn && !notifiedRef.current.has(visitorPubkey)) {
          onVisitorNotification?.(selectedVisitor)
          setNotifiedVisitors(prev => new Set([...prev, visitorPubkey]))
        }
      },
      visitorPubkey,
      offerId,
      { limit: 50 },
      chatPubkey,
    )

    const poll = setInterval(loadMessages, 5000)
    return () => { unsubscribe(); clearInterval(poll) }
  }, [selectedVisitor?.pubkey, loginPubkey, chatPubkey, offerId, loadMessages, decryptEvent, onVisitorNotification])

  useEffect(() => {
    if (messages.length > 0 && selectedVisitor) saveToStorage(offerId, selectedVisitor.pubkey, messages)
  }, [messages, offerId, selectedVisitor])

  const handleSendMessage = async (content: string) => {
    if (!selectedVisitor) throw new Error('No recipient')
    setSending(true)
    try {
      const { id: eventId, createdAt } = await sendChatMessage(selectedVisitor.pubkey, content, offerId, loginPubkey)
      setMessages(prev => {
        const updated = mergeMessages(prev, [{ id: eventId, pubkey: chatPubkey, content, createdAt, isOwn: true }])
        saveToStorage(offerId, selectedVisitor.pubkey, updated)
        return updated
      })
    } catch (e) { console.error(e); throw e }
    finally { setSending(false) }
  }

  if (loginPubkey !== sellerPubkey) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">Sign in as the seller to view visitor chats</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', height: 480, border: '1px solid', borderColor: 'divider', borderRadius: 'var(--radius-lg, 12px)', overflow: 'hidden', bgcolor: 'background.paper' }}>
      <Box sx={{ width: 220, flexShrink: 0, borderRight: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.75, fontSize: '0.65rem' }}>
            Visitors ({visitors.length})
          </Typography>
        </Box>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={20} /></Box>
        ) : visitors.length === 0 ? (
          <Box sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="caption" color="text.disabled">No visitors yet</Typography>
          </Box>
        ) : (
          <List dense sx={{ flex: 1, overflowY: 'auto', py: 0 }}>
            {visitors.map(visitor => (
              <ListItemButton
                key={visitor.pubkey}
                selected={selectedVisitor?.pubkey === visitor.pubkey}
                onClick={() => {
                  setSelectedVisitor(visitor)
                  setNotifiedVisitors(prev => { const n = new Set(prev); n.delete(visitor.pubkey); return n })
                }}
                sx={{ px: 2, py: 1.5, '&.Mui-selected': { bgcolor: 'action.selected' } }}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  {visitor.hasChat
                    ? <Badge badgeContent={<Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'primary.main' }} />} variant="dot" sx={{ '& .MuiBadge-badge': { right: 2, top: 2 } }}><ChatIcon sx={{ fontSize: 18, color: 'text.secondary' }} /></Badge>
                    : <ChatIcon sx={{ fontSize: 18, color: 'text.disabled' }} />}
                </ListItemIcon>
                <ListItemText
                  primary={<Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{visitor.pubkey.slice(0, 12)}...</Typography>}
                  secondary={<Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.6rem' }}>{new Date(visitor.lastMessageAt * 1000).toLocaleDateString()}</Typography>}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Box>

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {selectedVisitor ? (
          <>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
              <ChatFilledIcon sx={{ fontSize: 16, color: 'primary.main' }} />
              <Typography variant="caption" fontWeight={600} sx={{ fontFamily: 'monospace', flex: 1 }}>{selectedVisitor.pubkey.slice(0, 16)}...</Typography>
              <IconButton size="small" onClick={() => setSelectedVisitor(null)} sx={{ ml: 'auto' }}><CloseIcon sx={{ fontSize: 16 }} /></IconButton>
            </Box>
            {error && <Alert severity="warning" sx={{ m: 1 }}>{error}</Alert>}
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <Chat messages={messages} myPubkey={chatPubkey} otherPartyPubkey={selectedVisitor.pubkey} onSendMessage={handleSendMessage} loading={sending} />
            </Box>
          </>
        ) : (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography variant="body2" color="text.disabled">Select a visitor to view the chat</Typography>
          </Box>
        )}
      </Box>
    </Box>
  )
}

function isValidHex64(s: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(s)
}

export function BuyerChatWidget({ offerId, sellerPubkey }: { offerId: string; sellerPubkey: string }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<DecryptedMessage[]>([])
  const [sending, setSending] = useState(false)
  const [chatPubkey, setChatPubkey] = useState<string>('')
  const chatPubkeyRef = useRef<string>('')

  useEffect(() => {
    getMyPubkey().then(pk => {
      setChatPubkey(pk)
      chatPubkeyRef.current = pk
    }).catch(console.error)
  }, [])

  useEffect(() => {
    if (!open || !chatPubkey || !isValidHex64(sellerPubkey)) return

    const stored = loadFromStorage(offerId, chatPubkey)
    setMessages(stored)

    fetchChatMessages(chatPubkey, sellerPubkey, offerId, undefined, chatPubkey)
      .then(events => {
        const decrypted = events
          .filter(e => {
            const tid = e.tags.find(t => t[0] === 'ticket_id')?.[1]
            return !tid || tid === offerId
          })
          .map(e => ({
            id: e.id,
            pubkey: e.pubkey,
            content: e.content,
            createdAt: e.created_at,
            isOwn: e.pubkey === chatPubkeyRef.current,
          }))
        setMessages(prev => mergeMessages(prev, decrypted))
      })
      .catch(() => {})

    const unsubscribe = subscribeToChatMessages(
      chatPubkey,
      (event) => {
        const tid = event.tags.find(t => t[0] === 'ticket_id')?.[1]
        if (tid && tid !== offerId) return
        setMessages(prev => {
          const msg = {
            id: event.id,
            pubkey: event.pubkey,
            content: event.content,
            createdAt: event.created_at,
            isOwn: event.pubkey === chatPubkeyRef.current,
          }
          const merged = mergeMessages(prev, [msg])
          saveToStorage(offerId, chatPubkeyRef.current, merged)
          return merged
        })
      },
      sellerPubkey,
      offerId,
      { limit: 50 },
      chatPubkey,
    )

    return () => unsubscribe()
  }, [open, chatPubkey, sellerPubkey, offerId])

  useEffect(() => {
    if (messages.length > 0 && chatPubkey) saveToStorage(offerId, chatPubkey, messages)
  }, [messages, offerId, chatPubkey])

  const handleSend = async (content: string) => {
    setSending(true)
    try {
      const loginPubkey = localStorage.getItem('pubkey') ?? undefined
      const { id: eventId, createdAt } = await sendChatMessage(sellerPubkey, content, offerId, loginPubkey)
      setMessages(prev => {
        const merged = mergeMessages(prev, [{ id: eventId, pubkey: chatPubkey, content, createdAt, isOwn: true }])
        saveToStorage(offerId, chatPubkey, merged)
        return merged
      })
    } catch (e) {
      console.error('Failed to send:', e)
      throw e
    } finally {
      setSending(false)
    }
  }

  if (!isValidHex64(sellerPubkey)) return null

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box
        onClick={() => setOpen(o => !o)}
        sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          px: 2.5, py: 1.5, cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ChatIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          <Typography variant="subtitle2" fontWeight={700}>Chat with seller</Typography>
          <Chip size="small" label="E2E Encrypted" color="success" variant="outlined" sx={{ fontSize: '0.6rem', height: 18 }} />
        </Box>
        <ExpandMoreIcon sx={{ fontSize: 20, transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} />
      </Box>
      <Collapse in={open} appear={false}>
        <Box sx={{ borderTop: '1px solid', borderColor: 'divider', height: 500 }}>
          <Chat messages={messages} myPubkey={chatPubkey} otherPartyPubkey={sellerPubkey} onSendMessage={handleSend} loading={sending} />
        </Box>
      </Collapse>
    </Paper>
  )
}