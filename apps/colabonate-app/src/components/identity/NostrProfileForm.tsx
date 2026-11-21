import { useEffect, useState } from 'react'
import { Box, Button, TextField, Typography, Alert, CircularProgress, Stepper, Step, StepLabel, ButtonBase, Divider, Avatar } from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { publishNostrProfile, publishIdentityCredential, upgradeIdentityToL1, fetchNostrProfile } from '../../lib/nostr'
import { isNip46Active } from '../../lib/nostr-nip46'
import { getMyLoginPubkey } from '../../lib/nostr-identity'
import type { IdentityData } from '../../types/identity'

interface NostrProfileFormProps {
  pubkey: string
  onSuccess: (data: IdentityData) => void
  onCancel: () => void
  /**
   * ADR-225 D1: a browser-generated secret key (never sent to the server).
   * When present, every publish/sign step in this form uses it locally via
   * `finalizeEvent` instead of requiring a NIP-07 extension or NIP-46 bunker.
   */
  secretKey?: Uint8Array
  /** Trigger the relay profile import automatically on mount (used when the
   *  form is opened via the "Import from Nostr" button elsewhere). */
  autoImport?: boolean
}

const STEPS = ['Connect Nostr Profile', 'Publish Credential', 'Activate Level 1']

export function NostrProfileForm({ pubkey, onSuccess, onCancel, secretKey, autoImport = false }: NostrProfileFormProps) {
  const [activeStep, setActiveStep] = useState(0)
  const [name, setName] = useState('')
  const [lud16, setLud16] = useState('')
  const [nip05, setNip05] = useState('')
  const [picture, setPicture] = useState('')
  const [nostrPubkey, setNostrPubkey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState(false)

  async function handleImportFromNostr() {
    setImporting(true)
    setError(null)
    try {
      // getMyLoginPubkey prefers the NIP-07 extension pubkey (the user's real
      // Nostr key with an existing Kind 0) over burner/localStorage fallbacks.
      const hexPubkey = await getMyLoginPubkey()
      if (!hexPubkey) {
        setError('Cannot determine your Nostr pubkey. Make sure your signer is connected.')
        return
      }
      const profile = await fetchNostrProfile(hexPubkey)
      if (profile.name) setName(profile.name)
      if (profile.picture) setPicture(profile.picture)
      if (profile.nip05) setNip05(profile.nip05)
      if (profile.lud16) setLud16(profile.lud16)
      setNostrPubkey(hexPubkey)
      setImported(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch Nostr profile from relays.')
    } finally {
      setImporting(false)
    }
  }

  // Auto-import on mount when opened via the external "Import from Nostr" button.
  useEffect(() => {
    if (autoImport) void handleImportFromNostr()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoImport])

  // ADR-379: an imported profile already exists on the relay, so adopting it must not
  // require a re-publish. Skip straight to publishing the Level 1 credential.
  function handleContinueWithImportedProfile() {
    setError(null)
    setActiveStep(1)
  }

  async function handlePublishProfile() {
    if (!name) {
      setError('Display Name is required')
      return
    }
    if (lud16 && !/^[^@]+@[^@]+\.[^@]+$/.test(lud16)) {
      setError('Lightning Address must be in the format name@domain.tld')
      return
    }
    if (!secretKey && !isNip46Active() && (!window.nostr || typeof window.nostr.signEvent !== 'function')) {
      setError('A Nostr signer (NIP-07 extension like Alby, or a connected bunker) is required for Level 1 identity operations. Please connect one and refresh.')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const event = await publishNostrProfile({
        name,
        lud16: lud16 || undefined,
        colabonatePubkey: pubkey,
        nip05: nip05 || undefined,
        picture: picture || undefined,
      }, secretKey)
      setNostrPubkey(event.pubkey)
      setActiveStep(1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to publish Nostr profile. Make sure a Nostr extension (NIP-07) is installed.')
    } finally {
      setLoading(false)
    }
  }

  async function handlePublishCredential() {
    setLoading(true)
    setError(null)
    try {
      await publishIdentityCredential(pubkey, secretKey)
      setActiveStep(2)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to publish identity credential.')
    } finally {
      setLoading(false)
    }
  }

  async function handleUpgrade() {
    setLoading(true)
    setError(null)
    try {
      const identData = await upgradeIdentityToL1({
        pubkey,
        nostrPubkey,
        nip05: nip05 || undefined,
        picture: picture || undefined,
        secretKey,
      })
      onSuccess(identData)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upgrade failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>Link Nostr Profile (Level 1)</Typography>

      <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
        {STEPS.map(label => (
          <Step key={label}><StepLabel>{label}</StepLabel></Step>
        ))}
      </Stepper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {activeStep === 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Prominent import card — first thing the user sees on step 1 */}
          <ButtonBase
            onClick={handleImportFromNostr}
            disabled={importing || loading}
            focusRipple
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              width: '100%',
              p: 2,
              borderRadius: '14px',
              border: '2px solid',
              borderColor: imported ? 'success.main' : 'primary.main',
              backgroundColor: 'action.selected',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              '&:hover': {
                backgroundColor: 'action.focus',
                transform: 'translateY(-1px)',
              },
              '&:active': { transform: 'scale(0.99)' },
              '&.Mui-disabled': { opacity: 0.7 },
            }}
          >
            {picture ? (
              <Box
                component="img"
                src={picture}
                alt=""
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                sx={{
                  width: 46, height: 46, borderRadius: '50%', objectFit: 'cover',
                  flexShrink: 0, border: '2px solid', borderColor: imported ? 'success.main' : 'primary.main',
                }}
              />
            ) : (
              <Avatar
                sx={{
                  width: 46, height: 46, flexShrink: 0,
                  bgcolor: imported ? 'success.main' : 'primary.main',
                  color: 'common.white',
                }}
              >
                {importing ? <CircularProgress size={22} sx={{ color: 'common.white' }} /> : <DownloadIcon />}
              </Avatar>
            )}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                sx={{
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  color: imported ? 'success.main' : 'primary.main',
                  display: 'flex', alignItems: 'center', gap: 0.5,
                }}
              >
                {imported ? 'Imported from Nostr' : 'Import from Nostr'}
                {imported && <CheckCircleIcon sx={{ fontSize: 18 }} />}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {imported
                  ? 'Your existing profile was found on Nostr. Continue to link it to Colabonate. No need to publish it again.'
                  : 'Already have a Nostr profile? One tap pulls your name, avatar, NIP-05 and Lightning address.'}
              </Typography>
            </Box>
            {!imported && !importing && (
              <ChevronRightIcon sx={{ color: 'primary.main', flexShrink: 0 }} />
            )}
          </ButtonBase>

          {imported && (
            <Alert severity="success">
              Imported as {name || 'your Nostr profile'}
              {nip05 ? ` (${nip05})` : ''}. It is already published, so you can adopt it as-is.
            </Alert>
          )}

          {/* Divider between import and manual entry */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Divider sx={{ flex: 1 }} />
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.08em' }}>
              {imported ? 'REVIEW OR EDIT' : 'OR FILL IN MANUALLY'}
            </Typography>
            <Divider sx={{ flex: 1 }} />
          </Box>

          <TextField label="Display Name *" value={name} onChange={e => setName(e.target.value)} size="small" />
          <TextField
            label="Lightning Address (lud16)"
            value={lud16}
            onChange={e => setLud16(e.target.value)}
            size="small"
            placeholder="name@domain.tld"
              helperText="Optional. Add a receiving address now if you have one, or set it up later in your wallet settings."
          />
          <TextField label="NIP-05 (optional)" value={nip05} onChange={e => setNip05(e.target.value)} size="small" placeholder="name@domain.tld" />
          <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2 }}>
            <TextField
              label="Avatar URL (optional)"
              value={picture}
              onChange={e => setPicture(e.target.value)}
              size="small"
              placeholder="https://..."
              sx={{ flex: 1 }}
            />
            {picture && (
              <Box
                component="img"
                src={picture}
                alt="Avatar preview"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                sx={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '1px solid', borderColor: 'divider' }}
              />
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {imported ? (
              <>
                {/* ADR-379: the profile already lives on the relay — adopt it without re-publishing. */}
                <Button variant="contained" onClick={handleContinueWithImportedProfile} disabled={loading || importing}>
                  Continue → Publish credential
                </Button>
                <Button variant="outlined" onClick={handlePublishProfile} disabled={loading || importing}>
                  {loading ? <CircularProgress size={20} /> : 'Save edits to Nostr'}
                </Button>
              </>
            ) : (
              <Button variant="contained" onClick={handlePublishProfile} disabled={loading}>
                {loading ? <CircularProgress size={20} /> : 'Publish profile to Nostr'}
              </Button>
            )}
            <Button onClick={onCancel}>Cancel</Button>
          </Box>
        </Box>
      )}

      {activeStep === 1 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Alert severity="success">Your Nostr profile is ready.</Alert>
          <Typography variant="body2" color="text.secondary">
            Now a Level 1 credential (Kind 30021) will be published, linking your Colabonate account with your Nostr profile.
          </Typography>
          <Button variant="contained" onClick={handlePublishCredential} disabled={loading}>
            {loading ? <CircularProgress size={20} /> : 'Publish identity credential'}
          </Button>
        </Box>
      )}

      {activeStep === 2 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Alert severity="success">Credential published! Now activate Level 1 in the database.</Alert>
          <Button variant="contained" color="success" onClick={handleUpgrade} disabled={loading}>
            {loading ? <CircularProgress size={20} /> : 'Activate Level 1'}
          </Button>
        </Box>
      )}
    </Box>
  )
}
