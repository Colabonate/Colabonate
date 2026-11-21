import { useEffect, useState } from 'react'
import { Alert, Box, Button, CircularProgress, MenuItem, Select, TextField, Typography } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { apiCall, ApiError } from '../../lib/api'
import { publishLnAddressToProfile } from '../../lib/nostr'

const C = {
  surface: 'var(--theme-surface)',
  bg: 'var(--theme-bg-subtle)',
  text: 'var(--theme-text)',
  textMuted: 'var(--theme-text-muted)',
  border: 'var(--theme-border)',
} as const

type LnAddressMode = 'EXTERNAL' | 'NWC'

interface LnAddressState {
  handle: string | null
  mode: LnAddressMode | 'CASHU' | null
  address: string | null
  domain: string
  lnAddress: string | null
  nwcConnected: boolean
}

/**
 * ADR-240 D1/D2 — self-serve `<handle>@<domain>` Lightning Address. The address
 * is served by the platform's LNURL-pay router, but the invoice is minted on the
 * owner's own rail (external LUD-16 address or their NWC wallet). Colabonate
 * never holds funds.
 */
export function LnAddressSettings() {
  const [state, setState] = useState<LnAddressState | null>(null)
  const [handle, setHandle] = useState('')
  const [mode, setMode] = useState<LnAddressMode>('NWC')
  const [externalAddress, setExternalAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAddress, setSavedAddress] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishedToNostr, setPublishedToNostr] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiCall('/api/wallet/ln-address')
        const data = (await res.json()) as LnAddressState
        if (cancelled) return
        setState(data)
        setHandle(data.handle ?? '')
        setMode(data.mode === 'EXTERNAL' ? 'EXTERNAL' : 'NWC')
        // Prefill the EXTERNAL address with a usable stored one (placeholders
        // like `@colabonate.local` are ignored — they are not rails).
        const stored = data.lnAddress ?? ''
        setExternalAddress(stored && !stored.toLowerCase().endsWith('.local') ? stored : '')
      } catch {
        if (!cancelled) setState(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSavedAddress(null)
    setPublishedToNostr(false)
    setPublishError(null)
    try {
      const res = await apiCall('/api/wallet/ln-address', {
        method: 'PUT',
        body: JSON.stringify({ handle, mode, ...(mode === 'EXTERNAL' ? { address: externalAddress.trim() } : {}) }),
      })
      const data = (await res.json()) as { address: string }
      setSavedAddress(data.address)
      if (mode === 'EXTERNAL') {
        setState(s => (s ? { ...s, lnAddress: externalAddress.trim() } : s))
      }
    } catch (err) {
      setError(err instanceof ApiError ? ((err.data?.message as string) ?? err.message) : 'Could not save the address')
    } finally {
      setSaving(false)
    }
  }

  async function handleCopy(address: string) {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — the address stays selectable */
    }
  }

  async function handlePublishToNostr(address: string) {
    setPublishing(true)
    setPublishError(null)
    try {
      await publishLnAddressToProfile(address)
      setPublishedToNostr(true)
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Could not publish to your Nostr profile')
    } finally {
      setPublishing(false)
    }
  }

  if (!state) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1 }}>
        <CircularProgress size={16} />
        <Typography variant="caption" sx={{ color: C.textMuted }}>
          Loading…
        </Typography>
      </Box>
    )
  }

  const currentAddress = savedAddress ?? state.address
  // Mirrors the server rule (FU-754): synthetic placeholders like `@demo.local`
  // are not routable rails, so EXTERNAL mode cannot be saved against them.
  const hasRoutableLnAddress = Boolean(state.lnAddress) && !state.lnAddress!.toLowerCase().endsWith('.local')
  const externalAddressUsable =
    /^[^\s@]+@[^\s@]+$/.test(externalAddress.trim()) && !externalAddress.trim().toLowerCase().endsWith('.local')

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Typography variant="caption" sx={{ color: C.textMuted }}>
        Get a public Lightning address others can pay. Colabonate serves the address but never holds your
        funds — the invoice is created on your own wallet.
      </Typography>

      {currentAddress && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            alignItems: { xs: 'stretch', md: 'center' },
            gap: 1.5,
            px: 2, py: 1.5, borderRadius: 1,
            background: C.bg,
            border: `1px solid ${C.border}`,
          }}
        >
          <Typography variant="body2" sx={{ flex: 1, fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {currentAddress}
          </Typography>
          <Button
            size="small"
            variant="outlined"
            startIcon={<ContentCopyIcon sx={{ fontSize: 14 }} />}
            onClick={() => handleCopy(currentAddress)}
            sx={{ fontSize: '0.72rem', textTransform: 'none', flexShrink: 0 }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </Box>
      )}

      {currentAddress && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Button
            size="small"
            variant="outlined"
            disabled={publishing}
            onClick={() => handlePublishToNostr(currentAddress)}
            sx={{ alignSelf: { xs: 'stretch', md: 'flex-start' }, textTransform: 'none' }}
          >
            {publishing ? 'Publishing…' : publishedToNostr ? 'Published to your Nostr profile' : 'Publish to my Nostr profile'}
          </Button>
          <Typography variant="caption" sx={{ color: C.textMuted }}>
            Adds this address as <code>lud16</code> to your existing Kind-0 profile so Nostr clients can discover it.
            Needs a connected Nostr signer (NIP-46 bunker or NIP-07 extension).
          </Typography>
          {publishError && (
            <Typography variant="caption" sx={{ color: 'var(--color-status-warning, #f59e0b)' }}>
              {publishError}
            </Typography>
          )}
        </Box>
      )}

      {error && (
        <Alert severity="error" variant="outlined" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          flexWrap: 'wrap',
          gap: 2,
          alignItems: { xs: 'stretch', md: 'flex-start' },
        }}
      >
        <TextField
          size="small"
          label="Handle"
          placeholder="alice"
          value={handle}
          onChange={e => setHandle(e.target.value)}
          helperText={`Your address: ${handle.trim().toLowerCase().replace(/^@/, '').split('@')[0] || '…'}@${state.domain}`}
          sx={{ flex: 1, '& input': { fontFamily: 'monospace' } }}
        />
        <Select
          size="small"
          value={mode}
          onChange={e => setMode(e.target.value as LnAddressMode)}
          sx={{ width: { xs: '100%', md: 'auto' }, minWidth: { xs: 0, md: 220 }, background: C.surface }}
        >
          <MenuItem value="NWC">NWC wallet (recommended)</MenuItem>
          <MenuItem value="EXTERNAL">External Lightning address</MenuItem>
        </Select>
        {mode === 'EXTERNAL' && (
          <TextField
            size="small"
            label="Your Lightning address"
            placeholder="you@wallet.example"
            value={externalAddress}
            onChange={e => setExternalAddress(e.target.value)}
            sx={{ flex: 1, minWidth: { xs: 0, md: 220 }, '& input': { fontFamily: 'monospace' } }}
          />
        )}
        <Button
          variant="contained"
          size="small"
          disabled={saving || handle.trim().length === 0 || (mode === 'EXTERNAL' && !externalAddressUsable)}
          onClick={handleSave}
          sx={{ textTransform: 'none', height: 40 }}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </Box>

      {mode === 'NWC' && !state.nwcConnected && (
        <Typography variant="caption" sx={{ color: 'var(--color-status-warning, #f59e0b)' }}>
          No NWC wallet connected yet — connect one below, then save.
        </Typography>
      )}
      {mode === 'EXTERNAL' && !externalAddressUsable && (
        <Typography variant="caption" sx={{ color: 'var(--color-status-warning, #f59e0b)' }}>
          {hasRoutableLnAddress
            ? 'Adjust the address above if needed — it must be a routable user@domain.'
            : 'Enter your own Lightning address (user@domain) — it must be routable, or use the NWC mode.'}
        </Typography>
      )}
    </Box>
  )
}
