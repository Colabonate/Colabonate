import { useState } from 'react'
import { Box, Typography, Button, IconButton, TextField, Alert, Divider } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined'
import { nip19, getPublicKey } from 'nostr-tools'
import { getChatSignerNsecBech32, setChatSignerFromNsec, getMyPubkeySync, toNpub } from '../../lib/nostr-identity'

/**
 * FU-458 (ADR-314 D9 follow-up) — export/import for the device-local
 * chat/workspace-signer key.
 *
 * This is a DIFFERENT key from the one `KeyManagementPanel` backs up: that
 * panel exports the *login identity* (burner-login users only). This key is
 * used to sign NIP-17 DMs and ADR-314 workspace-chat actions regardless of
 * login method (bunker, NIP-07 extension, burner, MetaMask) — see
 * `lib/workspaceChat.ts`'s own module doc. Every login method shares this
 * same device-local signer, so export/import applies to everyone, not just
 * burner-identity users.
 */

type ExportStage = 'idle' | 'warn' | 'revealed'
type ImportStage = 'idle' | 'confirm' | 'done'

const C = {
  surface: 'var(--theme-surface)',
  bgSubtle: 'var(--theme-bg-subtle)',
  text: 'var(--theme-text)',
  textMuted: 'var(--theme-text-muted)',
  border: 'var(--theme-border)',
  error: 'var(--color-status-error)',
  errorBg: 'var(--color-status-error-bg)',
} as const

function shortNpub(npub: string): string {
  return npub.length < 20 ? npub : `${npub.slice(0, 12)}…${npub.slice(-8)}`
}

export function WorkspaceChatKeyPanel() {
  const [, force] = useState(0)
  const pubkey = getMyPubkeySync()
  const npub = toNpub(pubkey)

  const [exportStage, setExportStage] = useState<ExportStage>('idle')
  const [revealed, setRevealed] = useState(false)
  const [nsecValue, setNsecValue] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const [importOpen, setImportOpen] = useState(false)
  const [importValue, setImportValue] = useState('')
  const [showImportValue, setShowImportValue] = useState(false)
  const [importStage, setImportStage] = useState<ImportStage>('idle')
  const [importPreviewPubkey, setImportPreviewPubkey] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  function copy(text: string, onDone: () => void) {
    navigator.clipboard?.writeText(text).then(onDone).catch(() => {})
  }

  function handleReveal() {
    setExportError(null)
    try {
      setNsecValue(getChatSignerNsecBech32())
      setExportStage('revealed')
      setRevealed(true)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Could not read the chat key')
    }
  }

  function handleCopy() {
    if (!nsecValue) return
    copy(nsecValue, () => {
      setCopied(true)
      setRevealed(false)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  function handlePreviewImport() {
    setImportError(null)
    const trimmed = importValue.trim()
    if (!trimmed.startsWith('nsec1')) {
      setImportError('That doesn\'t look like a valid nsec key. It should start with "nsec1…".')
      return
    }
    try {
      const decoded = nip19.decode(trimmed)
      if (decoded.type !== 'nsec') {
        setImportError('That key is not a private key (nsec).')
        return
      }
      setImportPreviewPubkey(getPublicKey(decoded.data as Uint8Array))
      setImportStage('confirm')
    } catch {
      setImportError('Could not decode that key. Check for typos.')
    }
  }

  function handleConfirmImport() {
    setImportError(null)
    try {
      setChatSignerFromNsec(importValue)
      setImportStage('done')
      setImportValue('')
      force(n => n + 1)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Could not import that key')
      setImportStage('idle')
    }
  }

  function resetImport() {
    setImportOpen(false)
    setImportStage('idle')
    setImportValue('')
    setImportPreviewPubkey(null)
    setImportError(null)
  }

  return (
    <Box>
      <Box className="flex items-center gap-1.5 mb-1">
        <ForumOutlinedIcon sx={{ fontSize: 18, color: 'var(--color-primary-50)' }} />
        <Typography variant="subtitle2" className="!font-bold" sx={{ color: C.text }}>
          Chat &amp; workspace signer key
        </Typography>
      </Box>
      <Typography variant="caption" sx={{ color: C.textMuted, display: 'block', mb: 2 }}>
        Separate from your login identity above. This device-local key signs your NIP-17 private
        messages and AI-agent workspace chats. It lives only in this browser, so opening a workspace
        you already paid for from a new device or browser won't work until you import it here.
      </Typography>

      {npub && (
        <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: C.bgSubtle, border: `1px solid ${C.border}`, mb: 2 }}>
          <Typography variant="caption" sx={{ color: C.textMuted, display: 'block', mb: 0.5 }}>
            This device's chat pubkey
          </Typography>
          <code className="text-[12px] font-mono text-(--theme-text) break-all">{shortNpub(npub)}</code>
        </Box>
      )}

      <Box className="flex flex-col gap-4">
        {/* ── Export ──────────────────────────────────────────────────────── */}
        <Box>
          <Typography variant="caption" className="!font-semibold" sx={{ color: C.text, display: 'block', mb: 1 }}>
            Export from this device
          </Typography>

          {exportStage === 'idle' && (
            <Button
              variant="outlined"
              size="small"
              onClick={() => setExportStage('warn')}
              sx={{ textTransform: 'none', borderColor: C.error, color: C.error }}
            >
              Show my chat key (nsec)
            </Button>
          )}

          {exportStage === 'warn' && (
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: C.errorBg, border: `1px solid ${C.error}55` }}>
              <Typography variant="body2" className="!font-semibold" sx={{ color: C.error, mb: 1 }}>
                Anyone with this key can read your private chats and act as you in agent workspaces.
              </Typography>
              <Typography variant="caption" sx={{ color: C.textMuted, display: 'block', mb: 2 }}>
                Only paste it into Colabonate's own import field on the other device. Never share it
                elsewhere.
              </Typography>
              <Box className="flex gap-2">
                <Button variant="contained" size="small" color="error" onClick={handleReveal} sx={{ textTransform: 'none' }}>
                  I understand, reveal
                </Button>
                <Button variant="text" size="small" onClick={() => setExportStage('idle')} sx={{ textTransform: 'none', color: C.textMuted }}>
                  Cancel
                </Button>
              </Box>
            </Box>
          )}

          {exportStage === 'revealed' && (
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: C.bgSubtle, border: `1px solid ${C.border}` }}>
              <Box className="flex items-center gap-1.5">
                <code className="text-[13px] font-mono text-(--theme-text) break-all flex-1">
                  {revealed ? nsecValue : (nsecValue ? `${nsecValue.slice(0, 16)}${'•'.repeat(14)}` : '')}
                </code>
                <IconButton size="small" aria-label={revealed ? 'Hide' : 'Show'} onClick={() => setRevealed(v => !v)}>
                  {revealed ? <VisibilityOffIcon sx={{ fontSize: 18 }} /> : <VisibilityIcon sx={{ fontSize: 18 }} />}
                </IconButton>
                <Button variant="contained" size="small" startIcon={<ContentCopyIcon />} onClick={handleCopy} sx={{ textTransform: 'none' }}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </Box>
              <Button
                variant="text"
                size="small"
                onClick={() => { setExportStage('idle'); setNsecValue(null) }}
                sx={{ textTransform: 'none', color: C.textMuted, mt: 1 }}
              >
                Done, hide
              </Button>
            </Box>
          )}

          {exportError && <Alert severity="error" sx={{ mt: 1.5, bgcolor: 'transparent' }}>{exportError}</Alert>}
        </Box>

        <Divider sx={{ borderColor: C.border }} />

        {/* ── Import ──────────────────────────────────────────────────────── */}
        <Box>
          <Typography variant="caption" className="!font-semibold" sx={{ color: C.text, display: 'block', mb: 1 }}>
            Import from another device
          </Typography>

          {!importOpen && importStage !== 'done' && (
            <Button variant="outlined" size="small" onClick={() => setImportOpen(true)} sx={{ textTransform: 'none' }}>
              Paste a chat key
            </Button>
          )}

          {importOpen && importStage === 'idle' && (
            <Box className="flex flex-col gap-2">
              <TextField
                fullWidth
                size="small"
                type={showImportValue ? 'text' : 'password'}
                label="Chat key (nsec) from your other device"
                placeholder="nsec1…"
                value={importValue}
                onChange={e => { setImportValue(e.target.value); setImportError(null) }}
                autoComplete="off"
                spellCheck={false}
                InputProps={{
                  endAdornment: (
                    <IconButton size="small" onClick={() => setShowImportValue(v => !v)} aria-label={showImportValue ? 'Hide' : 'Show'}>
                      {showImportValue ? <VisibilityOffIcon sx={{ fontSize: 18 }} /> : <VisibilityIcon sx={{ fontSize: 18 }} />}
                    </IconButton>
                  ),
                }}
              />
              <Box className="flex gap-2">
                <Button variant="contained" size="small" disabled={!importValue.trim()} onClick={handlePreviewImport} sx={{ textTransform: 'none' }}>
                  Continue
                </Button>
                <Button variant="text" size="small" onClick={resetImport} sx={{ textTransform: 'none', color: C.textMuted }}>
                  Cancel
                </Button>
              </Box>
            </Box>
          )}

          {importStage === 'confirm' && importPreviewPubkey && (
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: C.errorBg, border: `1px solid ${C.error}55` }}>
              <Typography variant="body2" className="!font-semibold" sx={{ color: C.error, mb: 1 }}>
                This replaces this device's current chat key.
              </Typography>
              <Typography variant="caption" sx={{ color: C.textMuted, display: 'block', mb: 1 }}>
                Any workspace chat opened on this device with the old key becomes unreachable from
                here afterwards. New pubkey:
              </Typography>
              <code className="text-[12px] font-mono text-(--theme-text) break-all block mb-2">
                {shortNpub(toNpub(importPreviewPubkey) ?? importPreviewPubkey)}
              </code>
              <Box className="flex gap-2">
                <Button variant="contained" size="small" color="error" onClick={handleConfirmImport} sx={{ textTransform: 'none' }}>
                  Replace this device's key
                </Button>
                <Button variant="text" size="small" onClick={resetImport} sx={{ textTransform: 'none', color: C.textMuted }}>
                  Cancel
                </Button>
              </Box>
            </Box>
          )}

          {importStage === 'done' && (
            <Alert severity="success" sx={{ bgcolor: 'transparent' }}>
              Chat key imported. This device can now open workspace chats and NIP-17 DMs from the
              other device.
              <Button variant="text" size="small" onClick={resetImport} sx={{ textTransform: 'none', display: 'block', mt: 0.5 }}>
                Dismiss
              </Button>
            </Alert>
          )}

          {importError && <Alert severity="error" sx={{ mt: 1.5, bgcolor: 'transparent' }}>{importError}</Alert>}
        </Box>
      </Box>
    </Box>
  )
}
