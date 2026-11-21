import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Alert, Box, Button } from '@mui/material'
import { getMissingIdentitySigner, toNpub } from '../../lib/nostr-identity'

const DISMISS_KEY = 'colabonate:identitySignerNoticeDismissed'

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * ADR-401 FU-893 (signer-first): shown after the sovereign key signed back into
 * its bound account on a device without a signer. In-app actions would then be
 * signed by this device's own key, not as the user's identity — connecting a
 * NIP-07 extension or NIP-46 bunker that holds the key fixes that.
 */
export function IdentitySignerNotice() {
  const [signer, setSigner] = useState<string | null>(() => getMissingIdentitySigner())
  const [dismissed, setDismissed] = useState(readDismissed)

  useEffect(() => {
    // Extensions inject window.nostr after load; a bunker can connect later.
    const recheck = () => setSigner(getMissingIdentitySigner())
    const timer = window.setTimeout(recheck, 1500)
    window.addEventListener('storage', recheck)
    window.addEventListener('focus', recheck)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('storage', recheck)
      window.removeEventListener('focus', recheck)
    }
  }, [])

  if (!signer || dismissed) return null

  const npub = toNpub(signer)
  const shortNpub = npub ? `${npub.slice(0, 12)}…${npub.slice(-6)}` : 'your Nostr identity'

  function handleDismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // ignore — the notice just shows again next time
    }
    setDismissed(true)
  }

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, pt: { xs: 0, md: 2 }, pb: 2, maxWidth: 1200, mx: 'auto', width: '100%' }}>
      <Alert
        severity="info"
        action={
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button component={RouterLink} to="/account#identity-security" color="inherit" size="small" sx={{ whiteSpace: 'nowrap' }}>
              Connect signer
            </Button>
            <Button onClick={handleDismiss} color="inherit" size="small">
              Later
            </Button>
          </Box>
        }
        sx={{ alignItems: 'center' }}
      >
        You signed in with {shortNpub}, but no signer is connected on this device. Actions here are signed with this
        device&apos;s own key, not as your identity. Connect Alby, nos2x or a NIP-46 bunker that holds your key.
      </Alert>
    </Box>
  )
}
