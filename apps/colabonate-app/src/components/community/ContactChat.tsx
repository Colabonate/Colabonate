import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ChatRoom, type ChatRoomMessage, type ChatRoomProfile } from '@ds/ui'
import { cn } from '@ds/utils'
import {
  COMMUNITY_CHANNEL_ID,
  COMMUNITY_CHANNEL_RELAY,
  COMMUNITY_CHAT_ENABLED,
  isMessageAllowed,
  fetchChannelMessages,
  subscribeToChannelMessages,
  sendChannelMessage,
  type ChannelMessage,
} from '../../lib/nostr-channel'
import { isNip07Available } from '../../lib/nostr-identity'
import { fetchNostrProfile } from '../../lib/nostr'
import { useTranslation } from '../../contexts/LocaleContext'

const STORAGE_KEY = 'community_chat_messages'
const PROFILE_STORAGE_KEY = 'community_chat_profiles'

/** Hard cap on how many messages we keep in memory + render. */
const MAX_BUFFER = 200
/** Debounce window (ms) for persisting messages to localStorage. */
const PERSIST_DEBOUNCE_MS = 1500

function loadFromStorage(): ChatRoomMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveToStorage(messages: ChatRoomMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
  } catch {
    /* quota exceeded — ignore */
  }
}

function loadProfilesFromStorage(): Record<string, ChatRoomProfile> {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

/**
 * Merge an already-sorted `existing` list with an assumed-sorted `incoming`
 * batch, deduping by id and keeping ascending order by `createdAt`.
 *
 * Both inputs are sorted ascending by `createdAt` (the fetched batch is
 * explicitly sorted by `fetchChannelMessages`; live subscription events
 * arrive in relay order which is ascending for `created_at`). This is
 * O(n + m) — no full re-sort — so accumulating n messages stays linear.
 */
function mergeMessages(existing: ChatRoomMessage[], incoming: ChannelMessage[]): ChatRoomMessage[] {
  if (existing.length === 0) {
    const seen = new Set<string>()
    const out: ChatRoomMessage[] = []
    for (const m of incoming) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      out.push(m)
    }
    return out
  }

  const existingIds = new Set(existing.map(m => m.id))
  const novel = incoming.filter(m => !existingIds.has(m.id))
  if (novel.length === 0) return existing

  // Two-pointer merge of two ascending-sorted arrays.
  const out: ChatRoomMessage[] = []
  let i = 0
  let j = 0
  while (i < existing.length && j < novel.length) {
    out.push(existing[i].createdAt <= novel[j].createdAt ? existing[i++] : novel[j++])
  }
  while (i < existing.length) out.push(existing[i++])
  while (j < novel.length) out.push(novel[j++])
  return out
}

export function ContactChat() {
  const { formatDate, formatTime } = useTranslation()
  const [messages, setMessages] = useState<ChatRoomMessage[]>(() => loadFromStorage())
  const [profiles, setProfiles] = useState<Record<string, ChatRoomProfile>>(loadProfilesFromStorage)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [myPubkey, setMyPubkey] = useState<string>('')
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Tracks which pubkeys we've already requested a Kind-0 profile for, so a
  // burst of messages never refetches the same author repeatedly.
  const requestedProfiles = useRef<Set<string> | null>(null)
  if (requestedProfiles.current === null) {
    requestedProfiles.current = new Set(Object.keys(profiles))
  }

  const formatTimestamp = useCallback(
    (createdAt: number) => {
      const date = new Date(createdAt * 1000)
      return `${formatDate(date)} · ${formatTime(date)}`
    },
    [formatDate, formatTime],
  )

  const addMessages = useCallback((incoming: ChannelMessage[]) => {
    // Drop blocked / over-length content before it ever enters the buffer.
    const allowed = incoming.filter(isMessageAllowed)
    if (allowed.length === 0) return
    setMessages(prev => {
      const merged = mergeMessages(prev, allowed)
      // Cap the buffer to the newest MAX_BUFFER entries (memory + DOM bound).
      return merged.length > MAX_BUFFER ? merged.slice(merged.length - MAX_BUFFER) : merged
    })
  }, [])

  // Resolve login pubkey (NIP-07 > localStorage 'pubkey')
  useEffect(() => {
    async function resolveIdentity() {
      const ext = isNip07Available() ? window.nostr : null
      if (ext) {
        try {
          const pk = await ext.getPublicKey()
          if (pk && /^[0-9a-fA-F]{64}$/.test(pk)) {
            setMyPubkey(pk)
            return
          }
        } catch {
          /* extension rejected — fall through */
        }
      }
      const stored = localStorage.getItem('pubkey')
      if (stored && /^[0-9a-fA-F]{64}$/.test(stored)) {
        setMyPubkey(stored)
      }
    }
    resolveIdentity()
  }, [])

  // Fetch + subscribe to channel messages
  useEffect(() => {
    if (!COMMUNITY_CHAT_ENABLED) {
      setLoading(false)
      return
    }
    let unsubscribe: (() => void) | null = null

    async function load() {
      try {
        setLoading(true)
        setError(null)
        const fetched = await fetchChannelMessages(COMMUNITY_CHANNEL_ID)
        addMessages(fetched)
      } catch (e) {
        console.error('Failed to load channel messages:', e)
        setError('Failed to load messages')
      } finally {
        setLoading(false)
      }
    }

    load()

    unsubscribe = subscribeToChannelMessages(
      COMMUNITY_CHANNEL_ID,
      (message) => addMessages([message]),
    )

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [addMessages])

  // Persist to localStorage, debounced so a burst of messages doesn't
  // serialize the whole history once per event.
  useEffect(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    if (messages.length === 0) return
    persistTimer.current = setTimeout(() => {
      saveToStorage(messages)
      persistTimer.current = null
    }, PERSIST_DEBOUNCE_MS)
    return () => {
      if (persistTimer.current) {
        clearTimeout(persistTimer.current)
        persistTimer.current = null
      }
    }
  }, [messages])

  // Resolve Nostr Kind-0 profiles (name + picture) for message authors so the
  // chat shows who wrote what, not just a truncated pubkey.
  useEffect(() => {
    const requested = requestedProfiles.current
    if (!requested) return
    const missing = Array.from(new Set(messages.map(m => m.pubkey)))
      .filter(pubkey => pubkey && !requested.has(pubkey))
    if (missing.length === 0) return
    for (const pubkey of missing) requested.add(pubkey)

    Promise.allSettled(
      missing.map(async (pubkey): Promise<readonly [string, ChatRoomProfile]> => {
        const profile = await fetchNostrProfile(pubkey)
        return [pubkey, { name: profile.name ?? '', picture: profile.picture ?? '' }] as const
      }),
    ).then(results => {
      const entries = results
        .filter((r): r is PromiseFulfilledResult<readonly [string, ChatRoomProfile]> => r.status === 'fulfilled')
        .map(r => r.value)
      if (entries.length === 0) return
      setProfiles(prev => ({ ...prev, ...Object.fromEntries(entries) }))
    })
  }, [messages])

  // Persist resolved profiles so reopening the chat doesn't refetch them all.
  useEffect(() => {
    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles))
    } catch {
      /* quota exceeded — ignore */
    }
  }, [profiles])

  const handleSend = async (content: string) => {
    setSending(true)
    try {
      const event = await sendChannelMessage(COMMUNITY_CHANNEL_ID, COMMUNITY_CHANNEL_RELAY, content)
      // Optimistically add own message (subscription may also deliver it).
      // Still subject to moderation in case the operator blocked us.
      addMessages([{
        id: event.id,
        pubkey: event.pubkey,
        content: event.content,
        createdAt: event.created_at,
      }])
    } catch (e) {
      console.error('Failed to send channel message:', e)
      setError(e instanceof Error ? e.message : 'Failed to send message')
      throw e
    } finally {
      setSending(false)
    }
  }

  const isLoggedIn = !!myPubkey

  if (!COMMUNITY_CHAT_ENABLED) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-[var(--theme-text-muted)]">
          The community chat is temporarily disabled.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--theme-text-muted)]">
        Public community chat powered by Nostr (NIP-28). Messages are public and visible to everyone.
      </p>

      {error && (
        <div className="px-3 py-2 rounded-lg bg-[var(--color-error-bg)] text-[var(--color-error)] text-sm">
          {error}
        </div>
      )}

      {isLoggedIn ? (
        <ChatRoom
          messages={messages}
          myPubkey={myPubkey}
          onSendMessage={handleSend}
          loading={loading}
          disabled={sending}
          profiles={profiles}
          formatTimestamp={formatTimestamp}
        />
      ) : (
        <ChatRoom
          messages={messages}
          myPubkey=""
          onSendMessage={async () => {}}
          loading={loading}
          disabled
          profiles={profiles}
          formatTimestamp={formatTimestamp}
        />
      )}

      {!isLoggedIn && !loading && (
        <div className={cn(
          'flex flex-col items-center justify-center gap-3 py-4 text-center',
        )}>
          <p className="text-sm text-[var(--theme-text-muted)]">
            Login with a Nostr wallet (e.g. Alby) to post in the community chat.
          </p>
          <Link
            to="/login"
            className={cn(
              'px-4 py-2 rounded-lg font-medium text-sm text-white',
              'bg-[var(--color-primary)] hover:opacity-90 transition-opacity',
            )}
          >
            Login to Join
          </Link>
        </div>
      )}
    </div>
  )
}
