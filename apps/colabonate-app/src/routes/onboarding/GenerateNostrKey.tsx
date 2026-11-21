import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { nip19, finalizeEvent } from 'nostr-tools'
import { generateSeedWords, accountFromSeedWords } from 'nostr-tools/nip06'
import {
  Box,
  Typography,
  Button,
  TextField,
  Checkbox,
  FormControlLabel,
  Alert,
  IconButton,
  Tooltip,
  Chip,
  Stepper,
  Step,
  StepLabel,
  CircularProgress,
} from '@mui/material'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import LockIcon from '@mui/icons-material/Lock'
import BoltIcon from '@mui/icons-material/Bolt'
import ShieldIcon from '@mui/icons-material/Shield'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import MailOutlineIcon from '@mui/icons-material/MailOutline'
import DownloadIcon from '@mui/icons-material/Download'
import { OnboardingSectionPage } from './components/OnboardingSectionPage'
import { NewsletterOptInCheckbox } from '../../components/newsletter/NewsletterOptInCheckbox'
import { OnboardingStagger } from './components/OnboardingStagger'
import { Seo } from '../../components/Seo'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { publishNostrProfile, publishIdentityCredential, upgradeIdentityToL1 } from '../../lib/nostr'
import { useNotification } from '../../context/NotificationContext'
import { apiCall } from '../../lib/api'
import { getMyPubkeySync, getPrivkeyBytes, recordLoginSigner, rotateDeviceSigner } from '../../lib/nostr-identity'
import { useWallet } from '../../contexts/WalletContext'
import {
  buildBackupFile,
  canConfirmBackup,
  initialPath,
  initialStage,
  progressStageId as toProgressStageId,
  stageAfterBackup,
  stepperStages,
  type EntryPath,
  type Stage,
} from './generate-nostr-key-flow'

/**
 * ADR-225 D1 (+ FU-225-B) — browser-only, server-blind Nostr keypair generator.
 * Built with MUI + the `colabonateTheme` tokens (ADR-072: MUI is the app's
 * primary component library) rather than raw Tailwind/lucide, and never
 * renders a styled native h1–h6 — `typography.css` binds those tags globally
 * and an unlayered rule always wins over Tailwind's layered utilities, so a
 * Tailwind-styled `<h3>` silently renders at the *global* size/weight
 * instead of the intended one. `Typography` is used with a non-heading
 * `component` throughout instead.
 *
 * The 12-word recovery phrase is generated with `nostr-tools/nip06`'s
 * `generateSeedWords()` (BIP-39 under the hood) and the keypair is derived
 * via `accountFromSeedWords()` (NIP-06: BIP-32 path m/44'/1237'/0'/0/0). Both
 * the mnemonic and the derived secret key live only in component state —
 * never written to localStorage/sessionStorage/IndexedDB, never included in
 * any request body. If the user navigates away before finishing, the
 * identity is lost — that is by design (see ADR-225 §D1).
 *
 * Simplification over the original implementation: the three technical
 * publish/sign steps (kind:0 profile, kind:30021/30405 credential, NIP-98
 * L1-upgrade) that used to require three separate manual button clicks with
 * Nostr jargon in the copy now auto-run in sequence behind a single
 * "Continue" press, with a friendly checklist and per-step retry.
 */

type ActivateStepId = 'profile' | 'credential' | 'activate'
type StepStatus = 'pending' | 'active' | 'done' | 'error'

const ACTIVATE_STEPS: { id: ActivateStepId; label: string }[] = [
  { id: 'profile', label: 'Publishing your profile' },
  { id: 'credential', label: 'Verifying your identity' },
  { id: 'activate', label: 'Activating your account' },
]

const STEP_ORDER: ActivateStepId[] = ['profile', 'credential', 'activate']
const WORD_COUNT = 12

export function GenerateNostrKey() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { showSnackbar } = useNotification()
  const prefersReduced = useReducedMotion()
  const { createWallet } = useWallet()
  const [pubkey, setPubkey] = useState<string>(() => localStorage.getItem('pubkey') ?? '')
  // Whether the user arrived already signed in (skip the entry + account step).
  const [startedSignedIn] = useState(() => !!localStorage.getItem('pubkey'))

  const [stage, setStage] = useState<Stage>(() =>
    initialStage(!!localStorage.getItem('pubkey'), new URLSearchParams(window.location.search).has('token')),
  )
  // Which entry path the user picked (ADR-401 D1). Null until chosen; a
  // magic-link return is the email path (the link opens a fresh page).
  const [path, setPath] = useState<EntryPath | null>(() => initialPath(new URLSearchParams(window.location.search).has('token')))

  // Email bootstrap (Account step) — reuses the same magic-link auth as TabEmail.
  const [email, setEmail] = useState('')
  // ADR-402 D16: explicit, unticked newsletter opt-in on the email path.
  const [newsletterOptIn, setNewsletterOptIn] = useState(false)
  const [emailStep, setEmailStep] = useState<'input' | 'sent'>('input')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [debugLink, setDebugLink] = useState<string | null>(null)
  const [verifying, setVerifying] = useState<boolean>(() => new URLSearchParams(window.location.search).has('token'))
  // Guards against a double-verify race: createWallet() flips WalletContext's
  // pubkey (null → P) mid-await, which changes createWallet's identity, which in
  // turn re-fires this token effect. The ref makes a repeat call with the same
  // (single-use) token a no-op, instead of bouncing a successful sign-in back to
  // the Account screen with "Invalid or expired token".
  const processedTokenRef = useRef<string | null>(null)

  // Key material — never persisted, never sent to the server (ADR-225 D1).
  const [secretKey, setSecretKey] = useState<Uint8Array | null>(null)
  const [npub, setNpub] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [revealedWords, setRevealedWords] = useState<Set<number>>(new Set())
  const [hasEngagedPhrase, setHasEngagedPhrase] = useState(false)
  const [nsecRevealed, setNsecRevealed] = useState(false)
  const [hasEngagedNsec, setHasEngagedNsec] = useState(false)
  const [copiedField, setCopiedField] = useState<'npub' | 'mnemonic' | 'nsec' | null>(null)
  const [backedUp, setBackedUp] = useState(false)
  // Path B (email-less) "continue on Colabonate" auth state.
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  // The nsec is the importable password — the same key the 12-word phrase
  // derives (BIP-39/NIP-06 → NIP-19). Never persisted (ADR-225 D1).
  const nsec = useMemo(() => (secretKey ? nip19.nsecEncode(secretKey) : ''), [secretKey])

  // Profile fields (ADR-240 D0: Lightning Address is optional).
  const [name, setName] = useState('')
  const [lud16, setLud16] = useState('')

  // Activation checklist.
  const [stepStatus, setStepStatus] = useState<Record<ActivateStepId, StepStatus>>({
    profile: 'pending',
    credential: 'pending',
    activate: 'pending',
  })
  const [stepError, setStepError] = useState<string | null>(null)
  const nostrPubkeyRef = useRef('')
  const startedRef = useRef(false)

  function handleGenerate() {
    const words = generateSeedWords()
    const { privateKey, publicKey } = accountFromSeedWords(words)
    setSecretKey(privateKey)
    setMnemonic(words)
    setNpub(nip19.npubEncode(publicKey))
    setStage('backup')
  }

  function toggleWord(i: number) {
    setHasEngagedPhrase(true)
    setRevealedWords(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const allRevealed = revealedWords.size === WORD_COUNT
  const allEngaged = canConfirmBackup(hasEngagedPhrase, hasEngagedNsec)

  function toggleRevealAll() {
    setHasEngagedPhrase(true)
    setRevealedWords(allRevealed ? new Set() : new Set(Array.from({ length: WORD_COUNT }, (_, i) => i)))
  }

  function toggleNsecReveal() {
    setHasEngagedNsec(true)
    setNsecRevealed(v => !v)
  }

  // FU-887: a plain-text backup the user saves themselves — never browser storage (ADR-225 D1).
  function handleDownloadBackup() {
    const blob = new Blob([buildBackupFile({ npub, mnemonic, nsec })], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `nostr-identity-backup-${npub.slice(5, 13)}.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    setHasEngagedPhrase(true)
    setHasEngagedNsec(true)
  }

  function handleCopy(field: 'npub' | 'mnemonic' | 'nsec', value: string) {
    if (field === 'mnemonic') setHasEngagedPhrase(true)
    if (field === 'nsec') setHasEngagedNsec(true)
    navigator.clipboard.writeText(value).then(
      () => {
        setCopiedField(field)
        window.setTimeout(() => setCopiedField(c => (c === field ? null : c)), 2000)
      },
      () => showSnackbar('Copy failed — select and copy the text manually.', 'error'),
    )
  }

  const resetActivation = useCallback(() => {
    startedRef.current = false
    nostrPubkeyRef.current = ''
    setStepStatus({ profile: 'pending', credential: 'pending', activate: 'pending' })
    setStepError(null)
  }, [])

  const runSteps = useCallback(async (from: ActivateStepId) => {
    if (!secretKey) return
    setStepError(null)
    const startIdx = STEP_ORDER.indexOf(from)

    for (let i = startIdx; i < STEP_ORDER.length; i++) {
      const id = STEP_ORDER[i]
      setStepStatus(prev => ({ ...prev, [id]: 'active' }))
      try {
        if (id === 'profile') {
          const event = await publishNostrProfile(
            { name, lud16: lud16 || undefined, colabonatePubkey: pubkey },
            secretKey,
          )
          nostrPubkeyRef.current = event.pubkey
        } else if (id === 'credential') {
          await publishIdentityCredential(pubkey, secretKey)
        } else {
          await upgradeIdentityToL1({ pubkey, nostrPubkey: nostrPubkeyRef.current, secretKey })
        }
        setStepStatus(prev => ({ ...prev, [id]: 'done' }))
      } catch (e) {
        setStepStatus(prev => ({ ...prev, [id]: 'error' }))
        setStepError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
        return
      }
    }

    showSnackbar('Nostr identity linked. Your recovery phrase will not be shown here again — keep your backup safe.', 'success')
    window.setTimeout(() => setStage('done'), prefersReduced ? 0 : 500)
  }, [secretKey, name, lud16, pubkey, showSnackbar, prefersReduced])

  useEffect(() => {
    if (stage === 'activating' && !startedRef.current) {
      startedRef.current = true
      void runSteps('profile')
    }
  }, [stage, runSteps])

  const handleStartActivation = useCallback(() => {
    resetActivation()
    setStage('activating')
  }, [resetActivation])

  const failedStep = ACTIVATE_STEPS.find(s => stepStatus[s.id] === 'error')

  // ── Email bootstrap (Account step) ─────────────────────────────────────
  // Reuses the exact magic-link auth flow as TabEmail, but the magic link
  // returns to THIS route (via the validated `returnTo` on /api/auth/email/send)
  // so the token is consumed here and the flow continues into key generation.
  const verifyEmailToken = useCallback(async (token: string) => {
    // No-op a repeat call with an already-processed token (see processedTokenRef).
    if (processedTokenRef.current === token) return
    processedTokenRef.current = token
    setVerifying(true)
    setEmailError(null)
    try {
      const r = await apiCall(`/api/auth/email/verify?token=${encodeURIComponent(token)}`)
      const data = await r.json()
      if (data.success) {
        localStorage.setItem('pubkey', data.pubkey)
        if (data.token) localStorage.setItem('authToken', data.token)
        if (data.email) localStorage.setItem('email', data.email)
        // ADR-179 Fix B parity: auto-create the custodial Wallet row so the new
        // account can pay. Non-fatal — a missing wallet is handled later.
        try {
          await createWallet()
        } catch (err) {
          console.warn('[GenerateNostrKey] Wallet bootstrap failed (non-fatal):', err)
        }
        setPubkey(data.pubkey)
        setStage('intro')
      } else {
        setEmailError(data.error || 'Verification failed. Request a new link below.')
        setStage('signin')
      }
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : 'Verification failed.')
      setStage('signin')
    } finally {
      setVerifying(false)
      // Strip the token from the URL so a refresh doesn't re-verify.
      window.history.replaceState({}, '', '/onboarding/generate-nostr-key')
    }
  }, [createWallet])

  useEffect(() => {
    const token = searchParams.get('token')
    if (token) void verifyEmailToken(token)
  }, [searchParams, verifyEmailToken])

  const handleSendLink = useCallback(async () => {
    if (!email || !email.includes('@')) {
      setEmailError('Please enter a valid email address')
      return
    }
    setEmailBusy(true)
    setEmailError(null)
    try {
      const r = await apiCall('/api/auth/email/send', {
        method: 'POST',
        body: JSON.stringify({
          email,
          pubkey: getMyPubkeySync(),
          returnTo: '/onboarding/generate-nostr-key',
          newsletterOptIn,
        }),
      })
      const data = await r.json()
      if (data.success) {
        setEmailStep('sent')
        if (data.debugLink) setDebugLink(data.debugLink)
      } else {
        setEmailError(data.error || 'Failed to send magic link')
      }
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : 'Failed to send magic link')
    } finally {
      setEmailBusy(false)
    }
  }, [email, newsletterOptIn])

  // ── Path B: continue with this identity on Colabonate (no email) ────────
  // The persisted device signer is the account/login key; the sovereign key
  // generated above stays the L1 identity (nostrPubkey) and is never stored
  // (ADR-401 D5/D7).
  const handleContinueWithColabonate = useCallback(async () => {
    // Already signed in earlier in this flow (user went Back from Profile):
    // never mint a second account.
    if (localStorage.getItem('pubkey')) {
      setStage('profile')
      return
    }
    setAuthBusy(true)
    setAuthError(null)
    try {
      // A fresh device signer: the stored one survives logout and may already
      // key someone else's account on a shared browser (ADR-401 review, P1-1).
      const devicePubkey = rotateDeviceSigner()
      const challengeRes = await apiCall('/api/auth/nostr/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedPubkey: devicePubkey }),
      })
      if (!challengeRes.ok) throw new Error(`Challenge request failed: ${challengeRes.status}`)
      const challenge = await challengeRes.json()

      const signedEvent = finalizeEvent(
        {
          kind: 27235,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['challenge', challenge.nonce]],
          content: '',
        },
        getPrivkeyBytes(),
      )

      const verifyRes = await apiCall('/api/auth/nostr/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: signedEvent }),
      })
      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}))
        throw new Error(data.message || `Sign-in failed: ${verifyRes.status}`)
      }
      const verify = await verifyRes.json()

      localStorage.setItem('pubkey', verify.pubkey)
      if (verify.token) localStorage.setItem('authToken', verify.token)
      recordLoginSigner(devicePubkey, verify.pubkey)
      try {
        await createWallet()
      } catch (err) {
        console.warn('[GenerateNostrKey] Wallet bootstrap failed (non-fatal):', err)
      }
      setPubkey(verify.pubkey)
      setStage('profile')
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'Could not continue. Please try again.')
    } finally {
      setAuthBusy(false)
    }
  }, [createWallet])

  // While the magic-link token is being verified, show a focused spinner.
  if (verifying) {
    return (
      <OnboardingSectionPage>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100%', px: 3, py: 4, textAlign: 'center' }}>
          <CircularProgress sx={{ color: 'var(--color-primary-50)', mb: 3 }} />
          <Typography component="div" role="heading" aria-level={1} variant="h6" sx={{ color: 'var(--theme-text)', mb: 1 }}>
            Verifying your email…
          </Typography>
          <Typography component="p" variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>
            Setting up your Colabonate account.
          </Typography>
        </Box>
      </OnboardingSectionPage>
    )
  }

  const visibleStages = stepperStages(startedSignedIn, path)
  const progressStageId = toProgressStageId(stage)
  const progressIndex = visibleStages.findIndex(p => p.id === progressStageId)
  const showProgress = progressIndex >= 0

  return (
    <>
      <Seo noindex />
    <OnboardingSectionPage
      pageKey={stage}
      topBar={
        showProgress ? (
          <Stepper activeStep={progressIndex} sx={{ px: 3, mb: 1 }}>
            {visibleStages.map(p => (
              <Step key={p.id}>
                <StepLabel>{p.label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        ) : undefined
      }
      footer={
        stage === 'entry' ? (
          <Box sx={{ px: 3, pb: 4, pt: 1 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, maxWidth: 448, mx: 'auto' }}>
              <Button
                variant="contained"
                fullWidth
                onClick={() => { setPath('email'); setStage('signin') }}
                endIcon={<ArrowForwardIcon />}
                sx={{ borderRadius: '12px', py: 1.5 }}
              >
                Continue with email
              </Button>
              <Button
                variant="outlined"
                fullWidth
                onClick={() => { setPath('direct'); setStage('intro') }}
                sx={{ borderRadius: '12px', py: 1.5 }}
              >
                Create my identity without email
              </Button>
              <Button variant="text" fullWidth onClick={() => navigate('/login')} sx={{ color: 'var(--theme-text-muted)' }}>
                I already have an account
              </Button>
            </Box>
          </Box>
        ) : stage === 'signin' ? (
          <Box sx={{ px: 3, pb: 4, pt: 1 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, maxWidth: 448, mx: 'auto' }}>
              {emailStep === 'input' ? (
                <Button
                  variant="contained"
                  fullWidth
                  onClick={handleSendLink}
                  disabled={emailBusy}
                  endIcon={emailBusy ? undefined : <ArrowForwardIcon />}
                  sx={{ borderRadius: '12px', py: 1.5 }}
                >
                  {emailBusy ? 'Sending…' : 'Send magic link'}
                </Button>
              ) : (
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={() => { setEmailStep('input'); setDebugLink(null) }}
                  sx={{ borderRadius: '12px', py: 1.5, color: 'var(--theme-text-muted)' }}
                >
                  Use a different email
                </Button>
              )}
              <Button variant="text" fullWidth onClick={() => navigate('/login')} sx={{ color: 'var(--theme-text-muted)' }}>
                I already have an account
              </Button>
            </Box>
          </Box>
        ) : stage === 'intro' ? (
          <Box sx={{ px: 3, pb: 4, pt: 1 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, maxWidth: 448, mx: 'auto' }}>
              <Button
                variant="contained"
                fullWidth
                onClick={handleGenerate}
                endIcon={<ArrowForwardIcon />}
                sx={{ borderRadius: '12px', py: 1.5 }}
              >
                Create my identity
              </Button>
              <Button
                variant="text"
                fullWidth
                onClick={() => navigate('/account#identity-security')}
                sx={{ color: 'var(--theme-text-muted)' }}
              >
                I&apos;ll do this later
              </Button>
            </Box>
          </Box>
        ) : stage === 'backup' ? (
          <FooterBar
            onBack={() => setStage('intro')}
            onContinue={() => setStage(stageAfterBackup(path))}
            continueDisabled={!backedUp}
          />
        ) : stage === 'continue' ? (
          <Box sx={{ px: 3, pb: 4, pt: 1 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, maxWidth: 448, mx: 'auto' }}>
              <Button
                variant="contained"
                fullWidth
                onClick={() => void handleContinueWithColabonate()}
                disabled={authBusy}
                endIcon={authBusy ? undefined : <ArrowForwardIcon />}
                sx={{ borderRadius: '12px', py: 1.5 }}
              >
                {authBusy ? 'Signing in…' : 'Continue with this identity'}
              </Button>
              <Button variant="text" fullWidth onClick={() => setStage('standalone')} sx={{ color: 'var(--theme-text-muted)' }}>
                Save my identity and finish
              </Button>
            </Box>
          </Box>
        ) : stage === 'standalone' ? (
          <Box sx={{ px: 3, pb: 4, pt: 1 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, maxWidth: 448, mx: 'auto' }}>
              <Button
                variant="contained"
                fullWidth
                onClick={() => navigate('/login')}
                endIcon={<ArrowForwardIcon />}
                sx={{ borderRadius: '12px', py: 1.5 }}
              >
                Sign in with this identity later
              </Button>
            </Box>
          </Box>
        ) : stage === 'profile' ? (
          <FooterBar onBack={() => setStage('backup')} onContinue={handleStartActivation} continueDisabled={!name.trim()} />
        ) : stage === 'done' ? (
          <Box sx={{ px: 3, pb: 4, pt: 1 }}>
            <Button
              variant="contained"
              fullWidth
              onClick={() => navigate('/account#identity-security')}
              endIcon={<ArrowForwardIcon />}
              sx={{ maxWidth: 448, mx: 'auto', display: 'flex', borderRadius: '12px', py: 1.5 }}
            >
              Go to my account
            </Button>
          </Box>
        ) : undefined
      }
    >
      {/* ── Entry: choose a path (ADR-401 D1) ──────────────────────────── */}
      {stage === 'entry' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100%', px: 3, py: 4 }}>
          <Box sx={{ width: '100%', maxWidth: 448 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', mb: 3 }}>
              <Box
                sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 80, height: 80, mb: 3, borderRadius: 4,
                  bgcolor: 'var(--color-primary-10)', color: 'var(--color-primary-50)',
                }}
              >
                <VpnKeyIcon sx={{ fontSize: 36 }} />
              </Box>
              <Typography component="div" role="heading" aria-level={1} variant="h5" sx={{ color: 'var(--theme-text)', mb: 1.5 }}>
                Set up your{' '}
                <Box component="span" sx={{ color: 'var(--color-primary-50)' }}>identity</Box>
              </Typography>
              <Typography component="p" variant="body2" sx={{ color: 'var(--theme-text-muted)', maxWidth: 400 }}>
                Both options create a personal Nostr identity in your browser. Choose whether we also set up your
                Colabonate account by email.
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ p: 2.5, borderRadius: 3, border: '1px solid var(--theme-border)', bgcolor: 'var(--theme-surface)' }}>
                <Typography component="div" variant="body2" sx={{ color: 'var(--theme-text)', fontWeight: 600, mb: 0.5 }}>
                  With email — recommended
                </Typography>
                <Typography component="p" variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>
                  Creates your Colabonate account with a one-tap sign-in link. You can choose to get our
                  community newsletter too. Most people start here.
                </Typography>
              </Box>
              <Box sx={{ p: 2.5, borderRadius: 3, border: '1px solid var(--theme-border)', bgcolor: 'var(--theme-surface)' }}>
                <Typography component="div" variant="body2" sx={{ color: 'var(--theme-text)', fontWeight: 600, mb: 0.5 }}>
                  Without email — sovereign
                </Typography>
                <Typography component="p" variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>
                  Generates your Nostr identity only. No email, no newsletter. You can still continue on Colabonate
                  with it afterwards — or use it in any Nostr app.
                </Typography>
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      {/* ── Sign in / Create account (Email bootstrap) ─────────────────── */}
      {stage === 'signin' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100%', px: 3, py: 4 }}>
          <Box sx={{ width: '100%', maxWidth: 448 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', mb: 3 }}>
              <Box
                sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 80, height: 80, mb: 3, borderRadius: 4,
                  bgcolor: 'var(--color-primary-10)', color: 'var(--color-primary-50)',
                }}
              >
                <MailOutlineIcon sx={{ fontSize: 36 }} />
              </Box>
              <Typography component="div" role="heading" aria-level={1} variant="h5" sx={{ color: 'var(--theme-text)', mb: 1.5 }}>
                Create your{' '}
                <Box component="span" sx={{ color: 'var(--color-primary-50)' }}>Colabonate account</Box>
              </Typography>
              <Typography component="p" variant="body2" sx={{ color: 'var(--theme-text-muted)', maxWidth: 380 }}>
                Enter your email to create your Colabonate account. We&apos;ll then generate your Nostr identity
                right here in your browser — no extensions or apps required.
              </Typography>
            </Box>

            {emailError && (
              <Alert severity="error" sx={{ mb: 2.5 }} icon={<ErrorOutlineIcon fontSize="small" />}>
                {emailError}
              </Alert>
            )}

            {emailStep === 'input' ? (
              <>
                <TextField
                  autoFocus
                  fullWidth
                  type="email"
                  label="Email address"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void handleSendLink() }}
                  placeholder="you@example.com"
                  helperText="We'll email you a secure sign-in link. No password needed."
                />
                <Box sx={{ mt: 2 }}>
                  <NewsletterOptInCheckbox checked={newsletterOptIn} onChange={setNewsletterOptIn} disabled={emailBusy} />
                </Box>
              </>
            ) : (
              <Box
                sx={{
                  width: '100%', p: 2.5, borderRadius: 3, textAlign: 'center',
                  border: '1px solid var(--theme-border)', bgcolor: 'var(--theme-surface)',
                }}
              >
                <CheckCircleIcon sx={{ color: 'var(--color-status-success)', mb: 1 }} />
                <Typography component="div" variant="body2" sx={{ color: 'var(--theme-text)', fontWeight: 600, mb: 0.5 }}>
                  Check your email
                </Typography>
                <Typography component="p" variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>
                  We sent a sign-in link to <strong>{email}</strong>. Open it to continue setting up your identity.
                </Typography>
                {import.meta.env.DEV && debugLink && (
                  <Alert severity="warning" sx={{ mt: 2, textAlign: 'left', bgcolor: 'var(--color-status-warning-bg)', color: 'var(--color-status-warning)' }}>
                    <Typography component="span" variant="caption" sx={{ display: 'block', fontWeight: 600, mb: 0.5 }}>
                      DEV — no email transport
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ display: 'block', wordBreak: 'break-all' }}>
                      {debugLink}
                    </Typography>
                  </Alert>
                )}
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* ── Intro ─────────────────────────────────────────────────────── */}
      {stage === 'intro' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100%', px: 3, py: 4 }}>
          <Box sx={{ width: '100%', maxWidth: 448 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              <Box
                sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 96, height: 96, mb: 3, borderRadius: 4,
                  bgcolor: 'var(--color-primary-10)', color: 'var(--color-primary-50)',
                }}
              >
                <VpnKeyIcon sx={{ fontSize: 40 }} />
              </Box>
              <Typography component="div" role="heading" aria-level={1} variant="h5" sx={{ color: 'var(--theme-text)', mb: 2 }}>
                Set up your{' '}
                <Box component="span" sx={{ color: 'var(--color-primary-50)' }}>secure identity</Box>
              </Typography>
              <Typography component="p" variant="body2" sx={{ color: 'var(--theme-text-muted)', mb: 3, maxWidth: 380 }}>
                This creates your personal Nostr key — the foundation of your identity on Colabonate. It&apos;s
                generated right here in your browser. We will never see it, and nobody can take it from you.
              </Typography>
            </Box>

            <Box sx={{ width: '100%', p: 2.5, borderRadius: 3, border: '1px solid var(--theme-border)', bgcolor: 'var(--theme-surface)' }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {[
                  { icon: <LockIcon fontSize="small" />, text: 'Stays only on this device' },
                  { icon: <BoltIcon fontSize="small" />, text: 'Takes under a minute' },
                  { icon: <ShieldIcon fontSize="small" />, text: 'You keep a backup, always' },
                ].map(item => (
                  <Box key={item.text} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{ display: 'flex', color: 'var(--color-primary-50)' }}>{item.icon}</Box>
                    <Typography component="span" variant="body2" sx={{ color: 'var(--theme-text)' }}>{item.text}</Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      {/* ── Backup ────────────────────────────────────────────────────── */}
      {stage === 'backup' && (
        <Box sx={{ px: 3, py: 3 }}>
          <Box sx={{ width: '100%', maxWidth: 448, mx: 'auto' }}>
            <Typography component="div" role="heading" aria-level={2} variant="h6" sx={{ color: 'var(--theme-text)', mb: 0.5 }}>
              Save your recovery phrase
            </Typography>
            <Typography component="p" variant="body2" sx={{ color: 'var(--theme-text-muted)', mb: 3 }}>
              Your identity is ready. Before we continue, back it up — it&apos;s the only way back in if you
              lose access.
            </Typography>

            <OnboardingStagger className="space-y-6">
              <Section title="Public key" subtitle="Your public identifier — safe to share, like a username. It never exposes your private key.">
                <Box
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderRadius: 2,
                    fontFamily: 'var(--typography-fontfamily-mono)', fontSize: 12, wordBreak: 'break-all',
                    bgcolor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)',
                  }}
                >
                  <Box sx={{ flex: 1 }}>{npub}</Box>
                  <Tooltip title={copiedField === 'npub' ? 'Copied!' : 'Copy public key'}>
                    <IconButton size="small" aria-label="Copy public key" onClick={() => handleCopy('npub', npub)} sx={{ color: 'var(--theme-text-muted)' }}>
                      {copiedField === 'npub' ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                </Box>
              </Section>

              <Section
                title="Recovery phrase"
                subtitle="12 words that can restore your identity if this device is lost. Anyone who sees them can access your account — reveal and note them down privately, word by word, or all at once if you're somewhere safe."
              >
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' }, gap: 1, mb: 1.5 }}>
                  {mnemonic.split(' ').map((word, i) => {
                    const isRevealed = revealedWords.has(i)
                    return (
                      <Chip
                        key={i}
                        onClick={() => toggleWord(i)}
                        aria-label={`Word ${i + 1}, ${isRevealed ? `revealed: ${word}` : 'hidden — click to reveal'}`}
                        aria-pressed={isRevealed}
                        variant={isRevealed ? 'filled' : 'outlined'}
                        label={`${i + 1}. ${isRevealed ? word : '•••••'}`}
                        sx={{
                          justifyContent: 'flex-start',
                          fontFamily: 'var(--typography-fontfamily-mono)',
                          fontSize: 14,
                          fontWeight: 700,
                          bgcolor: isRevealed ? 'var(--color-primary-10)' : 'transparent',
                          borderColor: isRevealed ? 'var(--color-primary-30)' : 'var(--theme-border)',
                          color: isRevealed ? 'var(--theme-text)' : 'var(--theme-text-muted)',
                        }}
                      />
                    )
                  })}
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 2 }}>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={allRevealed ? <VisibilityOffIcon /> : <VisibilityIcon />}
                    onClick={toggleRevealAll}
                  >
                    {allRevealed ? 'Hide all' : 'Show all'}
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={copiedField === 'mnemonic' ? <CheckIcon /> : <ContentCopyIcon />}
                    onClick={() => handleCopy('mnemonic', mnemonic)}
                  >
                    {copiedField === 'mnemonic' ? 'Copied!' : 'Copy phrase'}
                  </Button>
                </Box>

                <Alert
                  severity="warning"
                  icon={<ErrorOutlineIcon fontSize="small" />}
                  sx={{
                    mb: 2,
                    bgcolor: 'var(--color-status-warning-bg)',
                    color: 'var(--color-status-warning)',
                    '& .MuiAlert-icon': { color: 'var(--color-status-warning)' },
                  }}
                >
                  Write this down or copy it into your password manager. Closing this tab without backing up
                  means this identity is lost forever — there is no &quot;forgot my phrase&quot; flow. The only
                  fallback is redoing this setup from your Email/Lightning login.
                </Alert>

              </Section>

              <Section
                title="Private key (nsec) — your password"
                subtitle="This nsec is the password to your identity. It is the same key your 12-word phrase produces — two encodings of one key. Anyone who has it controls your account, so store it in your password manager and never share it."
              >
                <Box
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderRadius: 2,
                    fontFamily: 'var(--typography-fontfamily-mono)', fontSize: 12, wordBreak: 'break-all',
                    bgcolor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)',
                  }}
                >
                  <Box sx={{ flex: 1 }}>
                    {nsecRevealed ? nsec : '••••••••••••••••••••••••••••••••••••••••••••••••••••'}
                  </Box>
                  <Tooltip title={nsecRevealed ? 'Hide private key' : 'Reveal private key'}>
                    <IconButton
                      size="small"
                      aria-label={nsecRevealed ? 'Hide private key' : 'Reveal private key'}
                      aria-pressed={nsecRevealed}
                      onClick={toggleNsecReveal}
                      sx={{ color: 'var(--theme-text-muted)' }}
                    >
                      {nsecRevealed ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={copiedField === 'nsec' ? 'Copied!' : 'Copy private key'}>
                    <IconButton
                      size="small"
                      aria-label="Copy private key"
                      onClick={() => handleCopy('nsec', nsec)}
                      sx={{ color: 'var(--theme-text-muted)' }}
                    >
                      {copiedField === 'nsec' ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                </Box>

                <Alert
                  severity="warning"
                  icon={<ErrorOutlineIcon fontSize="small" />}
                  sx={{
                    mt: 2,
                    bgcolor: 'var(--color-status-warning-bg)',
                    color: 'var(--color-status-warning)',
                    '& .MuiAlert-icon': { color: 'var(--color-status-warning)' },
                  }}
                >
                  This nsec is your password. If it is lost, this identity is gone forever — there is no
                  &quot;forgot my password&quot; flow. Reveal and save it before continuing.
                </Alert>
              </Section>

              <Box sx={{ mt: 3 }}>
                <Button
                  variant="outlined"
                  fullWidth
                  startIcon={<DownloadIcon />}
                  onClick={handleDownloadBackup}
                  sx={{ borderRadius: '12px', py: 1.25 }}
                >
                  Download backup file
                </Button>
                <Typography component="p" variant="caption" sx={{ display: 'block', color: 'var(--theme-text-muted)', mt: 1.5 }}>
                  A text file with your npub, nsec and recovery phrase. Keep it private — move it into your password
                  manager or offline storage and delete other copies.
                </Typography>
              </Box>

              <FormControlLabel
                control={<Checkbox checked={backedUp} disabled={!allEngaged} onChange={e => setBackedUp(e.target.checked)} />}
                label={
                  <Typography component="span" variant="body2" sx={{ color: 'var(--theme-text)' }}>
                    I have saved both my recovery phrase and my nsec
                    {!allEngaged && (
                      <Typography component="span" variant="caption" sx={{ display: 'block', color: 'var(--theme-text-muted)' }}>
                        Reveal, copy or download the phrase and the nsec at least once to enable this.
                      </Typography>
                    )}
                  </Typography>
                }
              />
            </OnboardingStagger>
          </Box>
        </Box>
      )}

      {/* ── Profile ───────────────────────────────────────────────────── */}
      {stage === 'profile' && (
        <Box sx={{ px: 3, py: 3 }}>
          <Box sx={{ width: '100%', maxWidth: 448, mx: 'auto' }}>
            <Typography component="div" role="heading" aria-level={2} variant="h6" sx={{ color: 'var(--theme-text)', mb: 0.5 }}>
              Introduce yourself
            </Typography>
            <Typography component="p" variant="body2" sx={{ color: 'var(--theme-text-muted)', mb: 3 }}>
              This is what other Colabonate users will see.
            </Typography>

            <OnboardingStagger className="space-y-6">
              <Box>
                <TextField
                  autoFocus
                  fullWidth
                  label="Your name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Jamie"
                  helperText="Shown on your offers and profile — you can change it any time."
                />
              </Box>

              <Box>
                <TextField
                  fullWidth
                  label="Receiving address (optional)"
                  value={lud16}
                  onChange={e => setLud16(e.target.value)}
                  placeholder="name@domain.tld"
                  helperText="A Lightning Address lets people pay you instantly — like an email address for Bitcoin. Get one free from a wallet such as Alby, Wallet of Satoshi, or Phoenix. You can also add this later in Wallet settings."
                />
              </Box>
            </OnboardingStagger>
          </Box>
        </Box>
      )}

      {/* ── Activating ────────────────────────────────────────────────── */}
      {stage === 'activating' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100%', px: 3, py: 4 }}>
          <Box sx={{ width: '100%', maxWidth: 448 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', mb: 3 }}>
              <Box
                sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 64, height: 64, mb: 2, borderRadius: 3,
                  bgcolor: 'var(--color-primary-10)', color: 'var(--color-primary-50)',
                }}
              >
                {failedStep ? <ErrorOutlineIcon sx={{ fontSize: 30 }} /> : <CircularProgress size={30} sx={{ color: 'var(--color-primary-50)' }} />}
              </Box>
              <Typography component="div" role="heading" aria-level={2} variant="h6" sx={{ color: 'var(--theme-text)' }}>
                {failedStep ? 'Something went wrong' : 'Setting up your identity…'}
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              {ACTIVATE_STEPS.map(step => (
                <Box
                  key={step.id}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1.5, p: 1.75, borderRadius: 3,
                    border: `1px solid ${stepStatus[step.id] === 'active' ? 'var(--color-primary-30)' : 'var(--theme-border)'}`,
                    bgcolor: stepStatus[step.id] === 'active' ? 'var(--color-primary-10)' : 'var(--theme-surface)',
                  }}
                >
                  <StepIcon status={stepStatus[step.id]} />
                  <Typography component="span" variant="body2" sx={{ flex: 1, fontWeight: 500, color: stepStatus[step.id] === 'pending' ? 'var(--theme-text-muted)' : 'var(--theme-text)' }}>
                    {step.label}
                  </Typography>
                  {stepStatus[step.id] === 'error' && (
                    <Button size="small" variant="text" onClick={() => void runSteps(step.id)}>
                      Try again
                    </Button>
                  )}
                </Box>
              ))}
            </Box>

            {stepError && (
              <Box sx={{ mt: 2.5, textAlign: 'center' }}>
                <Typography component="p" variant="body2" sx={{ color: 'var(--color-status-error)', mb: 1 }}>
                  {stepError}
                </Typography>
                <Button variant="text" onClick={() => setStage('profile')} sx={{ color: 'var(--theme-text-muted)' }}>
                  Edit your profile and try again
                </Button>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* ── Continue (Path B choice) ──────────────────────────────────── */}
      {stage === 'continue' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100%', px: 3, py: 4, textAlign: 'center' }}>
          <Box sx={{ width: '100%', maxWidth: 448 }}>
            <Box
              sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 80, height: 80, mb: 3, mx: 'auto', borderRadius: 4,
                bgcolor: 'var(--color-primary-10)', color: 'var(--color-primary-50)',
              }}
            >
              <VpnKeyIcon sx={{ fontSize: 36 }} />
            </Box>
            <Typography component="div" role="heading" aria-level={1} variant="h5" sx={{ color: 'var(--theme-text)', mb: 1.5 }}>
              Continue with this identity?
            </Typography>
            <Typography component="p" variant="body2" sx={{ color: 'var(--theme-text-muted)', mb: 3 }}>
              Your Nostr identity is ready and saved. You can now create your Colabonate account with it — no email
              required — or keep it and finish for now.
            </Typography>

            {authError && (
              <Alert severity="error" sx={{ mb: 2.5, textAlign: 'left' }} icon={<ErrorOutlineIcon fontSize="small" />}>
                {authError}
              </Alert>
            )}

            <Box sx={{ p: 2.5, borderRadius: 3, border: '1px solid var(--theme-border)', bgcolor: 'var(--theme-surface)', textAlign: 'left' }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {[
                  { icon: <LockIcon fontSize="small" />, text: 'No email needed — your identity is your login' },
                  { icon: <ShieldIcon fontSize="small" />, text: 'Your nsec stays with you; we never store it' },
                  { icon: <BoltIcon fontSize="small" />, text: 'After the next steps link your key, you can sign in with it on any device' },
                ].map(item => (
                  <Box key={item.text} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{ display: 'flex', color: 'var(--color-primary-50)' }}>{item.icon}</Box>
                    <Typography component="span" variant="body2" sx={{ color: 'var(--theme-text)' }}>{item.text}</Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      {/* ── Standalone done (Path B finish) ───────────────────────────── */}
      {stage === 'standalone' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100%', px: 3, py: 4, textAlign: 'center' }}>
          <Box sx={{ width: '100%', maxWidth: 448 }}>
            <Box
              sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 96, height: 96, mb: 4, mx: 'auto', borderRadius: 4,
                bgcolor: 'var(--color-status-success-bg)', color: 'var(--color-status-success)',
              }}
            >
              <CheckCircleIcon sx={{ fontSize: 40 }} />
            </Box>
            <Typography component="div" role="heading" aria-level={1} variant="h5" sx={{ color: 'var(--theme-text)', mb: 1.5 }}>
              Your Nostr identity is ready
            </Typography>
            <Typography component="p" variant="body2" sx={{ color: 'var(--theme-text-muted)', mb: 3 }}>
              You created an independent Nostr account. It works in any Nostr app, and you can sign in to Colabonate
              later with your key.
            </Typography>

            <Box sx={{ p: 2, borderRadius: 3, border: '1px solid var(--theme-border)', bgcolor: 'var(--theme-surface)', textAlign: 'left', mb: 2.5 }}>
              <Typography component="p" variant="overline" sx={{ display: 'block', color: 'var(--theme-text-muted)' }}>
                Your public key (npub)
              </Typography>
              <Box
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, mt: 1, borderRadius: 2,
                  fontFamily: 'var(--typography-fontfamily-mono)', fontSize: 12, wordBreak: 'break-all',
                  bgcolor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)',
                }}
              >
                <Box sx={{ flex: 1 }}>{npub}</Box>
                <Tooltip title={copiedField === 'npub' ? 'Copied!' : 'Copy public key'}>
                  <IconButton size="small" aria-label="Copy public key" onClick={() => handleCopy('npub', npub)} sx={{ color: 'var(--theme-text-muted)' }}>
                    {copiedField === 'npub' ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>

            <Alert
              severity="warning"
              icon={<ErrorOutlineIcon fontSize="small" />}
              sx={{
                textAlign: 'left',
                bgcolor: 'var(--color-status-warning-bg)',
                color: 'var(--color-status-warning)',
                '& .MuiAlert-icon': { color: 'var(--color-status-warning)' },
              }}
            >
              Make sure you saved your recovery phrase and your nsec. They are the only way back to this identity —
              without them it cannot be recovered.
            </Alert>
          </Box>
        </Box>
      )}

      {/* ── Done ──────────────────────────────────────────────────────── */}
      {stage === 'done' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100%', px: 3, py: 4, textAlign: 'center' }}>
          <Box sx={{ width: '100%', maxWidth: 448 }}>
            <Box
              sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 96, height: 96, mb: 4, mx: 'auto', borderRadius: 4,
                bgcolor: 'var(--color-status-success-bg)', color: 'var(--color-status-success)',
              }}
            >
              <CheckCircleIcon sx={{ fontSize: 40 }} />
            </Box>
            <Typography component="div" role="heading" aria-level={1} variant="h5" sx={{ color: 'var(--theme-text)', mb: 1.5 }}>
              You&apos;re all set!
            </Typography>
            <Typography component="p" variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>
              Your Nostr identity is linked and Level 1 is active — you can now create offers and open tickets.
            </Typography>
          </Box>
        </Box>
      )}
    </OnboardingSectionPage>
    </>
  )
}

// ── Shared bits ──────────────────────────────────────────────────────────

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Box component="section" sx={{ mb: 0.5 }}>
      <Typography component="p" variant="overline" sx={{ display: 'block', color: 'var(--theme-text-muted)' }}>
        {title}
      </Typography>
      {subtitle && (
        <Typography component="p" variant="body2" sx={{ color: 'var(--theme-text-muted)', mb: 1.5 }}>
          {subtitle}
        </Typography>
      )}
      {children}
    </Box>
  )
}

function FooterBar({
  onBack,
  onContinue,
  continueDisabled,
}: {
  onBack: () => void
  onContinue: () => void
  continueDisabled?: boolean
}) {
  return (
    <Box sx={{ px: 3, pb: 4, pt: 1 }}>
      <Box sx={{ display: 'flex', gap: 1.5, maxWidth: 448, mx: 'auto' }}>
        <IconButton
          onClick={onBack}
          aria-label="Back"
          sx={{ bgcolor: 'var(--theme-surface-secondary)', color: 'var(--theme-text-muted)', borderRadius: '12px', width: 48, height: 48 }}
        >
          <ArrowForwardIcon sx={{ transform: 'rotate(180deg)' }} />
        </IconButton>
        <Button
          fullWidth
          variant="contained"
          onClick={onContinue}
          disabled={continueDisabled}
          endIcon={<ArrowForwardIcon />}
          sx={{ borderRadius: '12px', py: 1.5 }}
        >
          Continue
        </Button>
      </Box>
    </Box>
  )
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done') return <CheckCircleIcon sx={{ color: 'var(--color-status-success)' }} />
  if (status === 'active') return <CircularProgress size={20} sx={{ color: 'var(--color-primary-50)' }} />
  if (status === 'error') return <ErrorOutlineIcon sx={{ color: 'var(--color-status-error)' }} />
  return <Box sx={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--theme-border)' }} />
}
