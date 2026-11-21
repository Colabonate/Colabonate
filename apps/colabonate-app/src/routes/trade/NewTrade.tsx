import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material'
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline'
import { FormStepper, PageCard, PageContainer, type FormStep } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { Seo } from '../../components/Seo'
import { SatsAmountInput } from '../../components/currency/SatsAmountInput'
import { CanisterTrustPanel } from '../../components/trust/CanisterTrustPanel'
import {
  escrowTradeTermsMessage,
  pubkeyFromNsec,
  signTermsEvent,
  signTermsEventWithNsec,
  type EscrowAuthEventWire,
} from '../../lib/escrow-auth-events'
import { createEscrowTrade } from '../../lib/escrow-trade'
import { defaultEscrowCanisterId, verifyCanister } from '../../lib/icp-verification'
import { getMyLoginPubkey, isValidHex64 } from '../../lib/nostr-identity'

/**
 * /trade/new — start a trade (ADR-357 D2, minimal P3 slice). Five steps:
 * Counterparty → Terms → Trust (hard gate) → Review & sign → Counterparty
 * countersign + create. The canonical terms message is signed by BOTH parties
 * before `POST /api/escrow-trades` fires (the canister requires both
 * signatures atomically). The counterparty countersign is a local-test nsec
 * paste; production uses the share-link handshake (P3 full).
 */

type Role = 'buyer' | 'seller'

const STEPS: FormStep[] = [
  { id: 0, label: 'Counterparty', description: 'Role & peer' },
  { id: 1, label: 'Terms', description: 'Amount & milestones' },
  { id: 2, label: 'Trust', description: 'Verify canister' },
  { id: 3, label: 'Review & sign', description: 'Your signature' },
  { id: 4, label: 'Countersign', description: 'Create trade' },
]

const DAY_NS = 86_400_000_000_000n

/** "25,50,25" → [2500, 5000, 2500] (bps). Null when invalid or not summing to 100%. */
function parseMilestonePct(raw: string): number[] | null {
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return null
  const pcts = parts.map(Number)
  if (pcts.some((p) => !Number.isInteger(p) || p <= 0)) return null
  if (pcts.reduce((a, b) => a + b, 0) !== 100) return null
  return pcts.map((p) => p * 100)
}

export function NewTrade() {
  const navigate = useNavigate()

  const [currentStep, setCurrentStep] = useState(0)
  const [role, setRole] = useState<Role>('buyer')
  const [counterpartyPubkey, setCounterpartyPubkey] = useState('')
  const [amountSats, setAmountSats] = useState<number | ''>('')
  const [milestonePct, setMilestonePct] = useState('100')
  const [timeoutDays, setTimeoutDays] = useState('30')
  const [buyerRefundAddress, setBuyerRefundAddress] = useState('')
  const [sellerPayoutAddress, setSellerPayoutAddress] = useState('')
  const [timeoutAt, setTimeoutAt] = useState<string | null>(null)
  const [myPubkey, setMyPubkey] = useState<string | null>(null)
  const [myTermsEvent, setMyTermsEvent] = useState<EscrowAuthEventWire | null>(null)
  const [signing, setSigning] = useState(false)
  const [counterpartyNsec, setCounterpartyNsec] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void getMyLoginPubkey().then(setMyPubkey)
  }, [])

  const canisterId = defaultEscrowCanisterId()
  const milestoneBps = useMemo(() => parseMilestonePct(milestonePct), [milestonePct])

  const trustQuery = useQuery({
    queryKey: ['new-trade-trust', canisterId],
    queryFn: () => verifyCanister(canisterId as string),
    enabled: !!canisterId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const termsArgs = useMemo(() => {
    if (!myPubkey || !isValidHex64(counterpartyPubkey.trim())) return null
    if (typeof amountSats !== 'number' || amountSats <= 0) return null
    if (!milestoneBps) return null
    if (!timeoutAt) return null
    const cp = counterpartyPubkey.trim()
    return {
      buyerPubkey: role === 'buyer' ? myPubkey : cp,
      sellerPubkey: role === 'seller' ? myPubkey : cp,
      buyerRefundAddress: buyerRefundAddress.trim(),
      sellerPayoutAddress: sellerPayoutAddress.trim(),
      expectedAmountSats: amountSats,
      milestoneBps,
      timeoutAt: BigInt(timeoutAt),
    }
  }, [myPubkey, counterpartyPubkey, amountSats, milestoneBps, timeoutAt, buyerRefundAddress, sellerPayoutAddress, role])

  const termsMessage = termsArgs ? escrowTradeTermsMessage(termsArgs) : null

  const trustOutcome = trustQuery.data ?? null
  const trustPassed =
    !!trustOutcome
    && trustOutcome.status === 'verified'
    && (trustOutcome.verdict.verdict === 'VerifiedImmutable' || trustOutcome.verdict.verdict === 'VerifiedGoverned')
    && Date.now() - trustOutcome.verifiedAt < 60_000

  function onContinue(step: number): boolean {
    setError(null)
    if (step === 0) {
      if (!isValidHex64(counterpartyPubkey.trim())) {
        setError('Counterparty pubkey must be a 64-character hex public key.')
        return false
      }
      if (counterpartyPubkey.trim().toLowerCase() === myPubkey?.toLowerCase()) {
        setError('Buyer and seller must differ.')
        return false
      }
      return true
    }
    if (step === 1) {
      if (typeof amountSats !== 'number' || amountSats <= 0) {
        setError('Enter an amount greater than zero.')
        return false
      }
      if (!milestoneBps) {
        setError('Milestone percentages must be whole numbers that sum to 100 (e.g. 25,50,25).')
        return false
      }
      if (!buyerRefundAddress.trim() || !sellerPayoutAddress.trim()) {
        setError('Both the buyer refund and seller payout addresses are required.')
        return false
      }
      const days = Number(timeoutDays)
      if (!Number.isInteger(days) || days <= 0) {
        setError('Timeout must be a positive whole number of days.')
        return false
      }
      // Freeze the timeout once, so both signatures bind the SAME terms.
      setTimeoutAt((BigInt(Date.now()) * 1_000_000n + BigInt(days) * DAY_NS).toString())
      return true
    }
    if (step === 2) {
      if (!canisterId) {
        setError('No escrow canister is configured (VITE_ICP_ESCROW_CANISTER_ID). The trust gate cannot pass without a deployed canister.')
        return false
      }
      if (!trustPassed) {
        setError('Trust verification must pass — a fresh (< 60 s) VerifiedImmutable or VerifiedGoverned verdict is required before funding.')
        return false
      }
      return true
    }
    if (step === 3) {
      if (!myTermsEvent) {
        setError('Sign the terms with your identity key before continuing.')
        return false
      }
      return true
    }
    return true
  }

  async function handleSign() {
    if (!termsArgs) {
      setError('Complete the terms first.')
      return
    }
    setSigning(true)
    setError(null)
    try {
      const wire = await signTermsEvent(termsArgs)
      if (myPubkey && wire.pubkey !== myPubkey) {
        setError('Your signer produced a key that differs from your login identity. Sign with the same key you are logged in as.')
        return
      }
      setMyTermsEvent(wire)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSigning(false)
    }
  }

  async function handleCreate() {
    if (!termsArgs || !myTermsEvent) {
      setError('Terms or your signature are missing.')
      return
    }
    setCreating(true)
    setError(null)
    try {
      let counterpartyKey: string
      try {
        counterpartyKey = pubkeyFromNsec(counterpartyNsec)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return
      }
      if (counterpartyKey !== counterpartyPubkey.trim()) {
        setError('The counterparty nsec does not match the counterparty pubkey you entered.')
        return
      }
      const counterpartyEvent = signTermsEventWithNsec(counterpartyNsec, termsArgs)
      const buyerTermsEvent = role === 'buyer' ? myTermsEvent : counterpartyEvent
      const sellerTermsEvent = role === 'seller' ? myTermsEvent : counterpartyEvent
      const trade = await createEscrowTrade({
        expectedAmountSats: termsArgs.expectedAmountSats as number,
        buyerRefundAddress: termsArgs.buyerRefundAddress,
        sellerPayoutAddress: termsArgs.sellerPayoutAddress,
        buyerPubkey: termsArgs.buyerPubkey,
        sellerPubkey: termsArgs.sellerPubkey,
        milestoneBps: termsArgs.milestoneBps,
        timeoutAt: termsArgs.timeoutAt.toString(),
        buyerTermsEvent,
        sellerTermsEvent,
      })
      navigate(`/trade/${trade.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <Seo title="Start an escrow trade" description="Create a non-custodial Bitcoin escrow trade — terms, verification, and funding." path="/trade/new" />
      <PageContainer>
        <PageHeader
          icon={<AddCircleOutlineIcon sx={{ fontSize: 22 }} />}
          title="Start an escrow trade"
          subtitle="Both parties sign identical terms; a verifiable canister holds the funds. Testnet only until mainnet funding ships."
        />

        <PageCard>
          {error && (
            <Alert severity="error" sx={{ borderRadius: 2, mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <FormStepper
            steps={STEPS}
            currentStep={currentStep}
            onStepChange={setCurrentStep}
            onContinue={onContinue}
            onLastStepComplete={() => void handleCreate()}
            continueLabel="Create trade"
            disabled={creating}
          >
            {/* Step 0 — Counterparty */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FormControl component="fieldset">
                <FormLabel component="legend" sx={{ color: 'var(--theme-text-muted)', mb: 1 }}>
                  Your role
                </FormLabel>
                <RadioGroup row value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  <FormControlLabel value="buyer" control={<Radio size="small" />} label="Buyer (I fund and release)" />
                  <FormControlLabel value="seller" control={<Radio size="small" />} label="Seller (I deliver)" />
                </RadioGroup>
              </FormControl>
              <TextField
                label="Counterparty pubkey (hex)"
                size="small"
                fullWidth
                value={counterpartyPubkey}
                onChange={(e) => setCounterpartyPubkey(e.target.value)}
                placeholder="64-character hex public key"
                sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace' } }}
                inputProps={{ 'aria-label': 'Counterparty pubkey' }}
              />
              {myPubkey && (
                <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)' }}>
                  Your identity: <span style={{ fontFamily: 'monospace' }}>{myPubkey}</span>
                </Typography>
              )}
            </Box>

            {/* Step 1 — Terms */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <SatsAmountInput
                label="Amount"
                valueSats={amountSats}
                onChangeSats={setAmountSats}
              />
              <TextField
                label="Milestone split (%)"
                size="small"
                fullWidth
                value={milestonePct}
                onChange={(e) => setMilestonePct(e.target.value)}
                helperText="Comma-separated whole percentages summing to 100, e.g. 25,50,25"
              />
              <TextField
                label="Timeout (days)"
                size="small"
                fullWidth
                value={timeoutDays}
                onChange={(e) => setTimeoutDays(e.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
              />
              <TextField
                label="Buyer refund address"
                size="small"
                fullWidth
                value={buyerRefundAddress}
                onChange={(e) => setBuyerRefundAddress(e.target.value)}
                placeholder="Bitcoin address the buyer is refunded to"
                sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace' } }}
              />
              <TextField
                label="Seller payout address"
                size="small"
                fullWidth
                value={sellerPayoutAddress}
                onChange={(e) => setSellerPayoutAddress(e.target.value)}
                placeholder="Bitcoin address the seller is paid to"
                sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace' } }}
              />
            </Box>

            {/* Step 2 — Trust (hard gate) */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {canisterId ? (
                <CanisterTrustPanel
                  canisterId={canisterId}
                  loading={trustQuery.isLoading || trustQuery.isFetching}
                  outcome={trustOutcome}
                  onReverify={() => void trustQuery.refetch()}
                />
              ) : (
                <Alert severity="warning" sx={{ borderRadius: 2 }}>
                  No escrow canister is configured. Set <code>VITE_ICP_ESCROW_CANISTER_ID</code> (and{' '}
                  <code>VITE_ICP_HOST</code> for a local replica) to verify before funding.
                </Alert>
              )}
              <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>
                This step is a gate, not an information panel: you cannot reach funding without a
                fresh verified verdict (ADR-357 D2).
              </Typography>
            </Box>

            {/* Step 3 — Review & sign */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography variant="overline" sx={{ color: 'var(--theme-text-muted)' }}>
                Canonical terms (both parties sign this exact message)
              </Typography>
              <PageCard>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                  {termsMessage ?? '— complete the terms first —'}
                </Typography>
              </PageCard>
              <Button
                variant="contained"
                onClick={() => void handleSign()}
                disabled={signing || !termsArgs || !!myTermsEvent}
                sx={{ textTransform: 'none', alignSelf: 'flex-start' }}
              >
                {signing ? <CircularProgress size={16} sx={{ mr: 1 }} color="inherit" /> : null}
                {myTermsEvent ? 'Signed' : `Sign as ${role}`}
              </Button>
              {myTermsEvent && (
                <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)' }}>
                  Signed by <span style={{ fontFamily: 'monospace' }}>{myTermsEvent.pubkey}</span> · event{' '}
                  <span style={{ fontFamily: 'monospace' }}>{myTermsEvent.id.slice(0, 16)}…</span>
                </Typography>
              )}
              <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)' }}>
                Terms freeze at signing — step 1 becomes read-only from here.
              </Typography>
            </Box>

            {/* Step 4 — Counterparty countersign + create */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Alert severity="info" sx={{ borderRadius: 2 }}>
                The canister requires both parties to sign the identical terms. Paste your
                counterparty&apos;s <code>nsec</code> to countersign on this device (local test only —
                production uses a share-link handshake). The key is used in-memory and never sent.
              </Alert>
              <TextField
                label="Counterparty nsec (local test)"
                size="small"
                fullWidth
                type="password"
                value={counterpartyNsec}
                onChange={(e) => setCounterpartyNsec(e.target.value)}
                placeholder="nsec1…"
                inputProps={{ 'aria-label': 'Counterparty nsec' }}
              />
              {myTermsEvent && (
                <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>
                  Counterparty: <span style={{ fontFamily: 'monospace' }}>{counterpartyPubkey.trim()}</span>
                </Typography>
              )}
            </Box>
          </FormStepper>
        </PageCard>
      </PageContainer>
    </>
  )
}
