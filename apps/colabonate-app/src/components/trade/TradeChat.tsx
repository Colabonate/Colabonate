import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Alert, Box, Button, Chip, CircularProgress, TextField, Typography } from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import VerifiedIcon from '@mui/icons-material/Verified'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import {
  sendChatMessage,
  decryptChatMessage,
  getMyPubkey,
  subscribeToChatMessages,
  fetchChatMessages,
  type ChatMessageEvent,
} from '../../lib/nostr'
import { transcriptFingerprint } from '../../lib/trade-transcript'
import { shortPubkey } from '../../lib/escrow-trade'
import { ProvenanceChip } from '../trust/ProvenanceChip'

/**
 * TradeChat (ADR-358) — trade-scoped NIP-17 thread. Each message carries:
 *  - signature validity (NIP-17 anti-spoofing is enforced at decrypt),
 *  - honest durability (relay-sourced vs. relayed-to-N),
 * and the thread shows a rolling transcript fingerprint two parties can compare.
 */

interface TradeMessage {
  id: string
  content: string
  createdAt: number
  isOwn: boolean
  signatureValid: boolean
  relayCount?: number
}

interface TradeChatProps {
  /** On-chain trade reference — the `trade_id` tag value + fingerprint seed. */
  tradeRef: string
  buyerPubkey: string
  sellerPubkey: string
}

const STORAGE_KEY = (tradeRef: string) => `trade_messages_${tradeRef}`

function loadFromStorage(tradeRef: string): TradeMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(tradeRef))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function mergeMessages(existing: TradeMessage[], incoming: TradeMessage[]): TradeMessage[] {
  const byId = new Map(existing.map((m) => [m.id, m]))
  for (const m of incoming) {
    if (!byId.has(m.id)) byId.set(m.id, m)
  }
  return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt)
}

function tradeTag(event: ChatMessageEvent): string | undefined {
  return event.tags.find((t) => t[0] === 'trade_id')?.[1]
}

/** Decrypts a relay event and keeps it only when it is attributable to this trade.
 *  Scope tags live inside the NIP-17 rumor, not on the kind-1059 envelope, so
 *  attribution requires decryption first (legacy kind-14 events carry their tags
 *  on the event itself and are scoped before decrypt). */
async function toTradeMessage(
  event: ChatMessageEvent,
  tradeRef: string,
  myPrivkey: string,
  isOwnPubkey: string,
): Promise<TradeMessage | null> {
  if (event.kind === 14 && tradeTag(event) !== tradeRef) return null
  try {
    const { content, createdAt, tradeId } = await decryptChatMessage(event, myPrivkey)
    if (tradeId != null && tradeId !== tradeRef) return null
    return { id: event.id, content, createdAt, isOwn: event.pubkey === isOwnPubkey, signatureValid: true }
  } catch {
    // ADR-358 D2: render the unverifiable, never hide it — but only when the
    // event is attributable to this trade. A gift-wrapped event that fails to
    // decrypt cannot be attributed (its tags are hidden), so it is skipped
    // rather than shown in the wrong thread.
    if (event.kind === 14) {
      return { id: event.id, content: '(unverifiable message)', createdAt: event.created_at, isOwn: false, signatureValid: false }
    }
    return null
  }
}

export function TradeChat({ tradeRef, buyerPubkey, sellerPubkey }: TradeChatProps) {
  const [messages, setMessages] = useState<TradeMessage[]>(() => loadFromStorage(tradeRef))
  const [loginPubkey, setLoginPubkey] = useState('')
  const [chatPubkey, setChatPubkey] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const chatPubkeyRef = useRef(chatPubkey)
  chatPubkeyRef.current = chatPubkey

  const otherPartyPubkey = loginPubkey && loginPubkey === buyerPubkey ? sellerPubkey : buyerPubkey

  const fingerprint = useMemo(
    () => transcriptFingerprint(tradeRef, [...messages].sort((a, b) => a.createdAt - b.createdAt).map((m) => m.id)),
    [tradeRef, messages],
  )

  useEffect(() => {
    if (messages.length > 0) {
      try { localStorage.setItem(STORAGE_KEY(tradeRef), JSON.stringify(messages)) } catch { /* quota */ }
    }
  }, [messages, tradeRef])

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

  const addMessages = useCallback((incoming: TradeMessage[]) => {
    setMessages((prev) => mergeMessages(prev, incoming))
  }, [])

  const loadMessages = useCallback(async () => {
    if (!loginPubkey || !chatPubkey || !otherPartyPubkey) return
    try {
      setLoading(true)
      setError(null)
      const myPrivkey = localStorage.getItem('nostr_burner_key')
      if (!myPrivkey) throw new Error('No private key found')
      const events = await fetchChatMessages(loginPubkey, otherPartyPubkey, tradeRef, undefined, chatPubkey)
      const decrypted: TradeMessage[] = []
      for (const event of events) {
        const message = await toTradeMessage(event, tradeRef, myPrivkey, chatPubkey)
        if (message) decrypted.push(message)
      }
      addMessages(decrypted)
    } catch (e) {
      console.error('Failed to load trade messages:', e)
      setError('Failed to load trade messages')
    } finally {
      setLoading(false)
    }
  }, [loginPubkey, chatPubkey, otherPartyPubkey, tradeRef, addMessages])

  useEffect(() => {
    if (!loginPubkey) return
    loadMessages()
    const unsubscribe = subscribeToChatMessages(
      loginPubkey,
      async (event: ChatMessageEvent) => {
        const myPrivkey = localStorage.getItem('nostr_burner_key')
        if (!myPrivkey) return
        const message = await toTradeMessage(event, tradeRef, myPrivkey, chatPubkeyRef.current)
        if (message) addMessages([message])
      },
      otherPartyPubkey,
      tradeRef,
      { limit: 50 },
    )
    return () => unsubscribe()
  }, [loginPubkey, chatPubkey, otherPartyPubkey, tradeRef, loadMessages, addMessages])

  const handleSend = async () => {
    const content = draft.trim()
    if (!content || !otherPartyPubkey || !chatPubkey) return
    if (!/^[0-9a-fA-F]{64}$/.test(otherPartyPubkey) || !/^[0-9a-fA-F]{64}$/.test(chatPubkey)) {
      setError('Chat unavailable — keys are not valid 64-char Nostr hex keys (no Demo mode).')
      return
    }
    setSending(true)
    try {
      const { id, createdAt, relayCount } = await sendChatMessage(otherPartyPubkey, content, tradeRef, loginPubkey, ['trade_id', tradeRef])
      addMessages([{ id, content, createdAt, isOwn: true, signatureValid: true, relayCount }])
      setDraft('')
    } catch (e) {
      console.error('Failed to send trade message:', e)
      setError('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const onCopyFingerprint = async () => {
    try { await navigator.clipboard.writeText(fingerprint) } catch { /* ignore */ }
  }

  if (!loginPubkey || !chatPubkey) return null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {error && <Alert severity="warning" sx={{ borderRadius: 2 }}>{error}</Alert>}

      {/* Transcript fingerprint (ADR-358 D3) */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)' }}>Transcript fingerprint</Typography>
        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.78rem', wordBreak: 'break-all' }}>{fingerprint.slice(0, 24)}…</Typography>
        <Button size="small" onClick={onCopyFingerprint} sx={{ textTransform: 'none', minWidth: 0, px: 0.5 }}>
          <ContentCopyIcon sx={{ fontSize: 14 }} />
        </Button>
        <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)' }}>
          Comparing fingerprints tells you whether two parties hold the same conversation — not that nothing was withheld.
        </Typography>
      </Box>

      {/* Messages */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 360, overflowY: 'auto' }}>
        {loading && messages.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={20} /></Box>
        ) : messages.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>No messages yet.</Typography>
        ) : (
          messages.map((m) => (
            <Box
              key={m.id}
              sx={{
                alignSelf: m.isOwn ? 'flex-end' : 'flex-start',
                maxWidth: '88%',
                p: 1.25,
                borderRadius: 2,
                bgcolor: m.isOwn ? 'var(--theme-bg-accent)' : 'var(--theme-bg-subtle)',
                border: '1px solid var(--theme-border)',
              }}
            >
              <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{m.content}</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mt: 0.5 }}>
                {m.signatureValid ? (
                  <Chip
                    size="small"
                    variant="outlined"
                    icon={<VerifiedIcon sx={{ fontSize: 12 }} />}
                    label="signed"
                    sx={{ height: 18, fontSize: '0.62rem', color: 'var(--color-status-success)', borderColor: 'var(--color-status-success)', '& .MuiChip-icon': { color: 'var(--color-status-success)', fontSize: 12 }, '& .MuiChip-label': { px: '5px' } }}
                  />
                ) : (
                  <Chip
                    size="small"
                    variant="outlined"
                    icon={<HelpOutlineIcon sx={{ fontSize: 12 }} />}
                    label="unverifiable"
                    sx={{ height: 18, fontSize: '0.62rem', color: 'var(--color-status-warning)', borderColor: 'var(--color-status-warning)', '& .MuiChip-icon': { color: 'var(--color-status-warning)', fontSize: 12 }, '& .MuiChip-label': { px: '5px' } }}
                  />
                )}
                <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)' }}>
                  {m.isOwn ? `you · ${m.relayCount !== undefined ? `relayed to ${m.relayCount} relay${m.relayCount === 1 ? '' : 's'}` : 'on this device'}` : `${shortPubkey(otherPartyPubkey)} · relay-sourced`}
                </Typography>
                <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)' }}>
                  {new Date(m.createdAt * 1000).toLocaleTimeString()}
                </Typography>
              </Box>
            </Box>
          ))
        )}
      </Box>

      {/* Composer */}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          size="small"
          fullWidth
          multiline
          maxRows={3}
          placeholder="Message (end-to-end encrypted)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend() } }}
        />
        <Button variant="contained" onClick={() => void handleSend()} disabled={sending || !draft.trim()} sx={{ textTransform: 'none', flexShrink: 0 }}>
          <SendIcon sx={{ fontSize: 16 }} />
        </Button>
      </Box>

      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
        <ProvenanceChip provenance="app-record" />
        <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)' }}>
          Messages are end-to-end encrypted; durability is only as strong as the relays that acknowledged them.
        </Typography>
      </Box>
    </Box>
  )
}
