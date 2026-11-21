/**
 * Dev-only NIP-46 mock bunker (ADR-154, FU-154-D).
 *
 * A LOCAL remote-signer that holds a test nsec and answers NIP-46 requests
 * (connect / get_public_key / sign_event / nip44_encrypt / nip44_decrypt /
 * ping) over the dev mock relay. Lets the NIP-46 login + chat paths be verified
 * end-to-end WITHOUT a real signer app (Alby Hub / Amber).
 *
 * DEV ONLY — never bundled into production (guarded by import.meta.env.DEV at
 * the call-site). The mock never holds or transmits a user's real key; it owns
 * a throwaway test key persisted in localStorage so the pubkey is stable across
 * reloads.
 *
 * Wire protocol (matches nostr-tools BunkerSigner):
 *   request  kind 24133, author=client, #p=bunker, content=NIP44({id,method,params})
 *   response kind 24133, author=bunker,  #p=client, content=NIP44({id,result|error})
 *   conversationKey = nip44.getConversationKey(sk, peerPubkey)
 */

import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import * as nip44 from 'nostr-tools/nip44'

const NOSTR_CONNECT = 24133
const STORAGE_KEY = 'colabonate:nip46-mock-bunker'

export interface MockBunker {
  /** The test identity pubkey the bunker signs as. */
  pubkey: string
  /** `bunker://` URI — paste into the NIP-46 login / Settings panel to connect. */
  bunkerUri: string
  /** Tear down subscriptions + relay connections. */
  stop: () => void
}

let instance: MockBunker | null = null

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)))
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('')
}

function devRelay(): string {
  if (typeof window === 'undefined') return 'ws://localhost:4001'
  return `ws://${window.location.hostname}:4001`
}

function dispatch(
  method: string,
  params: string[],
  sk: Uint8Array,
  pubkey: string,
  clientPubkey: string,
): string {
  switch (method) {
    case 'connect':
      // nostr-tools' BunkerSigner only resolves a request on a TRUTHY result,
      // so return the requester's pubkey (a common NIP-46 connect acknowledgement).
      return clientPubkey
    case 'ping':
      return 'pong'
    case 'get_public_key':
      return pubkey
    case 'sign_event': {
      const tmpl = JSON.parse(params[0]) as Record<string, unknown> & {
        created_at?: number
      }
      const signed = finalizeEvent(
        {
          kind: tmpl.kind as number,
          tags: (tmpl.tags as string[][]) ?? [],
          content: (tmpl.content as string) ?? '',
          created_at: (tmpl.created_at as number) ?? Math.floor(Date.now() / 1000),
        },
        sk,
      )
      return JSON.stringify(signed)
    }
    case 'nip44_encrypt': {
      const [peer, plaintext] = params
      return nip44.encrypt(plaintext, nip44.getConversationKey(sk, peer))
    }
    case 'nip44_decrypt': {
      const [peer, payload] = params
      return nip44.decrypt(payload, nip44.getConversationKey(sk, peer))
    }
    default:
      throw new Error(`mock bunker: unsupported method "${method}"`)
  }
}

/** The running mock bunker, or null. */
export function getMockBunker(): MockBunker | null {
  return instance
}

/** Start the mock bunker (idempotent — returns the existing instance if running). */
export function startMockBunker(): MockBunker {
  if (instance) return instance

  // Stable test nsec across reloads (so the pubkey the user logs in with is consistent).
  let skHex = ''
  try {
    skHex = localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    // localStorage unavailable — fall back to an ephemeral key
  }
  let sk: Uint8Array
  if (skHex && /^[0-9a-f]{64}$/i.test(skHex)) {
    sk = hexToBytes(skHex)
  } else {
    sk = generateSecretKey()
    try {
      localStorage.setItem(STORAGE_KEY, bytesToHex(sk))
    } catch {
      // ignore
    }
  }
  const pubkey = getPublicKey(sk)
  const relay = devRelay()
  const secret = bytesToHex(generateSecretKey())

  const pool = new SimplePool()
  const sub = pool.subscribe(
    [relay],
    { kinds: [NOSTR_CONNECT], '#p': [pubkey], limit: 0 },
    {
      onevent: async (event) => {
        try {
          const convKey = nip44.getConversationKey(sk, event.pubkey)
          const req = JSON.parse(nip44.decrypt(event.content, convKey)) as {
            id: string
            method: string
            params: string[]
          }

          let result = ''
          let error: string | undefined
          try {
            result = dispatch(req.method, req.params ?? [], sk, pubkey, event.pubkey)
          } catch (err) {
            error = err instanceof Error ? err.message : String(err)
          }

          const payload = JSON.stringify(error ? { id: req.id, error } : { id: req.id, result })
          const encrypted = nip44.encrypt(payload, convKey)
          const response = finalizeEvent(
            {
              kind: NOSTR_CONNECT,
              tags: [['p', event.pubkey]],
              content: encrypted,
              created_at: Math.floor(Date.now() / 1000),
            },
            sk,
          )
          pool.publish([relay], response)
        } catch {
          // Malformed/unrelated event — ignore (mock must not crash on noise)
        }
      },
    },
  )

  instance = {
    pubkey,
    bunkerUri: `bunker://${pubkey}?relay=${encodeURIComponent(relay)}&secret=${secret}`,
    stop: () => {
      try {
        sub.close()
        pool.close([relay])
      } catch {
        // best-effort
      }
      instance = null
    },
  }
  return instance
}

/** Stop the running mock bunker (no-op if none). */
export function stopMockBunker(): void {
  instance?.stop()
}
