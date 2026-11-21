import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'
import { schnorr } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'

interface Subscription {
  id: string
  filters: any[]
  ws: WebSocket
}

interface AuthedClient {
  ws: WebSocket
  pubkey: string
  challenge: string
}

// In-memory AUTH state (ADR-153 step 0.7). The mock relay is dev-only and
// never carries real user data, so per-connection state is sufficient.
const authedClients = new WeakMap<WebSocket, AuthedClient>()

function matchesFilters(event: any, filters: any[]): boolean {
  return filters.some((f: any) => {
    if (f.kinds && !f.kinds.includes(event.kind)) return false
    if (f.since && event.created_at < f.since) return false
    if (f.until && event.created_at > f.until) return false
    if (f.authors && !f.authors.includes(event.pubkey)) return false
    if (f['#p']) {
      const pTags = event.tags.filter((t: string[]) => t[0] === 'p').map((t: string[]) => t[1])
      if (!f['#p'].some((p: string) => pTags.includes(p))) return false
    }
    if (f['#e']) {
      const eTags = event.tags.filter((t: string[]) => t[0] === 'e').map((t: string[]) => t[1])
      if (!f['#e'].some((e: string) => eTags.includes(e))) return false
    }
    if (f['#ticket_id']) {
      const ticketTags = event.tags.filter((t: string[]) => t[0] === 'ticket_id').map((t: string[]) => t[1])
      if (!f['#ticket_id'].some((id: string) => ticketTags.includes(id))) return false
    }
    return true
  })
}

export function attachMockRelay(server: Server) {
  const wss = new WebSocketServer({ server })
  
  const events: any[] = []
  const subscriptions: Set<Subscription> = new Set()

  wss.on('connection', (ws) => {
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString())
        const type = data[0]

        // NIP-42 AUTH challenge/response handshake.
        // Server sends ["AUTH", "<challenge>"] right after the WS upgrade.
        // Client replies with ["AUTH", signed-event].
        if (type === 'AUTH') {
          const authEvent = data[1]
          // Validate event structure
          if (
            !authEvent ||
            authEvent.kind !== 22242 ||
            typeof authEvent.pubkey !== 'string' ||
            typeof authEvent.sig !== 'string' ||
            typeof authEvent.id !== 'string' ||
            !Array.isArray(authEvent.tags)
          ) {
            ws.send(JSON.stringify(["OK", authEvent?.id ?? '', false, "invalid: malformed AUTH event"]))
            return
          }
          // Find the 'challenge' tag and verify it matches the one we issued
          const challengeTag = authEvent.tags.find((t: string[]) => t[0] === 'challenge')
          const issued = authedClients.get(ws)?.challenge
          if (!challengeTag || challengeTag[1] !== issued) {
            ws.send(JSON.stringify(["OK", authEvent.id, false, "invalid: challenge mismatch"]))
            return
          }
          // Verify the Schnorr signature against the serialized event
          try {
            const serialized = JSON.stringify([0, authEvent.pubkey, authEvent.created_at, authEvent.kind, authEvent.tags, authEvent.content])
            const hashHex = bytesToHex(sha256(new TextEncoder().encode(serialized)))
            if (hashHex !== authEvent.id) {
              ws.send(JSON.stringify(["OK", authEvent.id, false, "invalid: id does not match event hash"]))
              return
            }
            const valid = schnorr.verify(authEvent.sig, authEvent.id, authEvent.pubkey)
            if (!valid) {
              ws.send(JSON.stringify(["OK", authEvent.id, false, "invalid: bad signature"]))
              return
            }
            authedClients.set(ws, { ws, pubkey: authEvent.pubkey, challenge: issued! })
            ws.send(JSON.stringify(["OK", authEvent.id, true, ""]))
            console.log(`[relay] AUTH ok pubkey=${authEvent.pubkey.slice(0,8)}`)
          } catch (err) {
            ws.send(JSON.stringify(["OK", authEvent.id, false, `invalid: ${(err as Error).message}`]))
          }
          return
        }

        if (type === 'EVENT') {
          const event = data[1]
          events.push(event)
          ws.send(JSON.stringify(["OK", event.id, true, ""]))

          const pTag = (event.tags ?? []).find((t: string[]) => t[0] === 'p')?.[1]
          const ticketTag = (event.tags ?? []).find((t: string[]) => t[0] === 'ticket_id')?.[1]

          let forwarded = 0
          subscriptions.forEach(sub => {
            if (sub.ws !== ws && matchesFilters(event, sub.filters)) {
              sub.ws.send(JSON.stringify(["EVENT", sub.id, event]))
              forwarded++
            }
          })
          if (subscriptions.size > 0) {
            console.log(`[relay] EVENT kind=${event.kind} from=${event.pubkey?.slice(0,8)} p=${pTag?.slice(0,8)} ticket=${ticketTag?.slice(0,8)} fwd=${forwarded}/${subscriptions.size}`)
          }
        }
        else if (type === 'REQ') {
          const subId = data[1]
          const filters = data.slice(2)
          subscriptions.add({ id: subId, filters, ws })

          events.forEach(event => {
            if (matchesFilters(event, filters)) {
              ws.send(JSON.stringify(["EVENT", subId, event]))
            }
          })
          
          ws.send(JSON.stringify(["EOSE", subId]))
        }
        else if (type === 'CLOSE') {
          const subId = data[1]
          for (const sub of subscriptions) {
            if (sub.id === subId && sub.ws === ws) {
              subscriptions.delete(sub)
            }
          }
        }
      } catch (err) {
        console.error('Mock relay error', err)
      }
    })

    // Issue a NIP-42 AUTH challenge right after the WS upgrade. Public relays
    // (e.g. inbox.nostr.wine) require AUTH; this lets us exercise the same
    // code path in dev with the mock relay.
    const challenge = bytesToHex(sha256(new TextEncoder().encode(`${Date.now()}-${Math.random()}`)))
    authedClients.set(ws, { ws, pubkey: '', challenge })
    ws.send(JSON.stringify(['AUTH', challenge]))

    ws.on('close', () => {
      authedClients.delete(ws)
      for (const sub of subscriptions) {
        if (sub.ws === ws) {
          subscriptions.delete(sub)
        }
      }
    })
  })

  console.log('Mock Nostr Relay attached to HTTP server (WS /) — NIP-42 AUTH challenge issued on connect')
}
