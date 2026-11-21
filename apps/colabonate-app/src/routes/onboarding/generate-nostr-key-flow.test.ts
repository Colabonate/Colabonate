/**
 * ADR-401 two-path onboarding — stage logic, backup gating, backup file, and
 * the D4 claim that the 12-word phrase and the nsec are one key.
 */

import { describe, it, expect } from 'vitest'
import { nip19, getPublicKey } from 'nostr-tools'
import { generateSeedWords, accountFromSeedWords } from 'nostr-tools/nip06'
import {
  buildBackupFile,
  canConfirmBackup,
  initialPath,
  initialStage,
  progressStageId,
  stageAfterBackup,
  stepperStages,
} from './generate-nostr-key-flow'

describe('entry (D1)', () => {
  it('signed-out visitors start at the path choice', () => {
    expect(initialStage(false, false)).toBe('entry')
    expect(initialPath(false)).toBeNull()
  })

  it('signed-in users skip the choice and go straight to keygen', () => {
    expect(initialStage(true, false)).toBe('intro')
  })

  it('a magic-link return resumes the email path', () => {
    expect(initialStage(false, true)).toBe('signin')
    expect(initialPath(true)).toBe('email')
  })
})

describe('stepper', () => {
  it('is hidden on the entry screen', () => {
    expect(stepperStages(false, null)).toEqual([])
  })

  it('shows the Account step on the email path, also after the magic-link return', () => {
    expect(stepperStages(false, initialPath(true)).map(s => s.id)).toEqual(['signin', 'backup', 'profile', 'activating'])
  })

  it('has no Account step on the direct path or when already signed in', () => {
    expect(stepperStages(false, 'direct').map(s => s.id)).toEqual(['backup', 'profile', 'activating'])
    expect(stepperStages(true, null).map(s => s.id)).toEqual(['backup', 'profile', 'activating'])
  })

  it('maps intro, backup and continue onto the Backup step', () => {
    for (const s of ['intro', 'backup', 'continue'] as const) expect(progressStageId(s)).toBe('backup')
    expect(progressStageId('profile')).toBe('profile')
  })
})

describe('after backup (D5)', () => {
  it('the direct path chooses between Colabonate and finishing standalone', () => {
    expect(stageAfterBackup('direct')).toBe('continue')
  })

  it('the email path (and signed-in users) go on to the profile', () => {
    expect(stageAfterBackup('email')).toBe('profile')
    expect(stageAfterBackup(null)).toBe('profile')
  })
})

describe('backup confirmation (D4)', () => {
  it('needs both the phrase and the nsec', () => {
    expect(canConfirmBackup(false, false)).toBe(false)
    expect(canConfirmBackup(true, false)).toBe(false)
    expect(canConfirmBackup(false, true)).toBe(false)
    expect(canConfirmBackup(true, true)).toBe(true)
  })
})

describe('phrase and nsec are one key (D4)', () => {
  it('the nsec encodes exactly the key the phrase derives', () => {
    const words = generateSeedWords()
    const { privateKey, publicKey } = accountFromSeedWords(words)
    const nsec = nip19.nsecEncode(privateKey)
    const decoded = nip19.decode(nsec)
    expect(decoded.type).toBe('nsec')
    expect(getPublicKey(decoded.data as Uint8Array)).toBe(publicKey)
    expect(accountFromSeedWords(words).publicKey).toBe(publicKey)
  })
})

describe('backup file (FU-887)', () => {
  it('contains npub, nsec and phrase, labelled, with a privacy warning', () => {
    const file = buildBackupFile({ npub: 'npub1abc', nsec: 'nsec1xyz', mnemonic: 'one two three', createdAt: new Date('2026-09-26T00:00:00Z') })
    expect(file).toContain('npub1abc')
    expect(file).toContain('nsec1xyz')
    expect(file).toContain('one two three')
    expect(file).toContain('this is your password')
    expect(file).toContain('KEEP THIS FILE PRIVATE')
    expect(file).toContain('2026-09-26T00:00:00.000Z')
  })
})
