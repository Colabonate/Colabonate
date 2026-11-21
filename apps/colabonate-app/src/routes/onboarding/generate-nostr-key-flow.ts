/**
 * ADR-401 — pure stage logic for `/onboarding/generate-nostr-key`, kept out of
 * the component so the two-path flow can be unit tested without rendering.
 */

export type Stage = 'entry' | 'signin' | 'intro' | 'backup' | 'continue' | 'standalone' | 'profile' | 'activating' | 'done'
export type EntryPath = 'email' | 'direct'

export const PROGRESS_STAGES: { id: Stage; label: string }[] = [
  { id: 'backup', label: 'Backup' },
  { id: 'profile', label: 'Profile' },
  { id: 'activating', label: 'Activate' },
]

// Prepended to the stepper only on the email path (account bootstrap first).
export const ACCOUNT_STAGE: { id: Stage; label: string } = { id: 'signin', label: 'Account' }

/** First stage: signed-in users skip straight to keygen; a magic-link return lands on the email step. */
export function initialStage(hasSession: boolean, hasMagicLinkToken: boolean): Stage {
  if (hasSession) return 'intro'
  return hasMagicLinkToken ? 'signin' : 'entry'
}

/**
 * The chosen path. A magic-link return is always the email path: the link opens
 * a fresh page, so the in-memory choice from before the email is gone.
 */
export function initialPath(hasMagicLinkToken: boolean): EntryPath | null {
  return hasMagicLinkToken ? 'email' : null
}

/** Stepper entries for the current path; empty while no path is chosen (entry screen). */
export function stepperStages(startedSignedIn: boolean, path: EntryPath | null): { id: Stage; label: string }[] {
  if (startedSignedIn || path === 'direct') return PROGRESS_STAGES
  if (path === 'email') return [ACCOUNT_STAGE, ...PROGRESS_STAGES]
  return []
}

/** intro / backup / continue all belong to the identity-creation step. */
export function progressStageId(stage: Stage): Stage {
  return stage === 'intro' || stage === 'backup' || stage === 'continue' ? 'backup' : stage
}

/** After the backup, the email path already has an account; the direct path chooses first (D5). */
export function stageAfterBackup(path: EntryPath | null): Stage {
  return path === 'direct' ? 'continue' : 'profile'
}

/** The backup checkbox needs both secrets engaged with (revealed, copied or downloaded) — D4. */
export function canConfirmBackup(hasEngagedPhrase: boolean, hasEngagedNsec: boolean): boolean {
  return hasEngagedPhrase && hasEngagedNsec
}

/** Plain-text backup file (FU-887). Written only to the user's own download, never to browser storage. */
export function buildBackupFile(input: { npub: string; mnemonic: string; nsec: string; createdAt?: Date }): string {
  const created = (input.createdAt ?? new Date()).toISOString()
  return [
    'Nostr identity backup (created with Colabonate)',
    `Created: ${created}`,
    '',
    'KEEP THIS FILE PRIVATE. Anyone who has it controls your identity.',
    'Store it in a password manager or offline, then delete other copies.',
    '',
    'Public key (npub) — safe to share:',
    input.npub,
    '',
    'Private key (nsec) — this is your password:',
    input.nsec,
    '',
    'Recovery phrase (12 words, same key as the nsec):',
    input.mnemonic,
    '',
    'Sign in on any Nostr app or on Colabonate with the nsec or the recovery phrase.',
    '',
  ].join('\n')
}
