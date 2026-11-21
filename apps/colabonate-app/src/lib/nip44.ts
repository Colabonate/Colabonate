import { getPublicKey } from 'nostr-tools'
import { getConversationKey, encrypt, decrypt } from 'nostr-tools/nip44'
import { createRumor, createSeal as nip59CreateSeal, wrapEvent, unwrapEvent } from 'nostr-tools/nip59'

export function encryptDM(
  plaintext: string,
  senderPrivkey: Uint8Array,
  recipientPubkey: string
): string {
  const conversationKey = getConversationKey(senderPrivkey, recipientPubkey)
  return encrypt(plaintext, conversationKey)
}

export function decryptDM(
  encrypted: string,
  senderPubkey: string,
  recipientPrivkey: Uint8Array
): string {
  const conversationKey = getConversationKey(recipientPrivkey, senderPubkey)
  return decrypt(encrypted, conversationKey)
}

export interface SealContent {
  pubkey: string
  content: string
  created_at: number
}

export function createSeal(
  innerContent: string,
  senderPrivkey: Uint8Array
): { pubkey: string; content: string } {
  const senderPubkey = getPublicKey(senderPrivkey)
  const encrypted = encryptDM(innerContent, senderPrivkey, senderPubkey)
  
  const rumor = createRumor({
    pubkey: senderPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 13,
    tags: [],
    content: encrypted,
  }, senderPrivkey)
  
  const seal = nip59CreateSeal(rumor, senderPrivkey, senderPubkey)
  
  return {
    pubkey: senderPubkey,
    content: seal.content,
  }
}

export function openSeal(
  sealContent: string,
  recipientPrivkey: Uint8Array
): SealContent | null {
  try {
    const unwrapped = unwrapEvent({ kind: 13, content: sealContent, tags: [], created_at: 0, pubkey: '' } as never, recipientPrivkey)
    return {
      pubkey: unwrapped.pubkey,
      content: unwrapped.content,
      created_at: unwrapped.created_at,
    }
  } catch {
    return null
  }
}

export function createGiftWrap(
  seal: { pubkey: string; content: string },
  senderPrivkey: Uint8Array,
  recipientPubkey: string
): { pubkey: string; content: string } {
  const senderPubkey = getPublicKey(senderPrivkey)
  
  const rumor = createRumor({
    pubkey: seal.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 13,
    tags: [],
    content: seal.content,
  }, senderPrivkey)
  
  const wrapped = wrapEvent(rumor, senderPrivkey, recipientPubkey)
  
  return {
    pubkey: senderPubkey,
    content: wrapped.content,
  }
}

export function unwrapGift(
  giftWrapContent: string,
  recipientPrivkey: Uint8Array
): SealContent | null {
  try {
    const unwrapped = unwrapEvent({ kind: 1059, content: giftWrapContent, tags: [], created_at: 0, pubkey: '' } as never, recipientPrivkey)
    return {
      pubkey: unwrapped.pubkey,
      content: unwrapped.content,
      created_at: unwrapped.created_at,
    }
  } catch {
    return null
  }
}

export async function decryptNIP17Message(
  eventContent: string,
  myPrivkey: Uint8Array
): Promise<string | null> {
  try {
    const seal = unwrapGift(eventContent, myPrivkey)
    if (!seal) return null
    
    const innerSeal = openSeal(seal.content, myPrivkey)
    if (!innerSeal) return null
    
    return innerSeal.content
  } catch {
    return null
  }
}

export function privkeyToHex(sk: Uint8Array): string {
  return Array.from(sk).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function hexToPrivkey(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)))
}