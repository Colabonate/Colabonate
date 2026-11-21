import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Divider,
  Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import RefreshIcon from '@mui/icons-material/Refresh'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CancelIcon from '@mui/icons-material/Cancel'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { cn } from '@ds/utils'
import { ProvenanceChip } from './ProvenanceChip'
import type {
  FailureReason,
  VerificationOutcome,
  Verdict,
} from '../../lib/icp-verification'

/**
 * CanisterTrustPanel — the L1/L2/L3 verdict as a sentence, not a badge
 * (ADR-356 D7). Prose carries the controller semantics ("nobody can change it"
 * vs. "controlled by principal X, which can replace this code"); the expandable
 * proof lets a user check the check: raw hash, controllers, subnet, timestamp
 * and copyable `icp` CLI reproduction commands.
 */

function shortHash(hash: string): string {
  return hash.length <= 16 ? hash : `${hash.slice(0, 8)}…${hash.slice(-6)}`
}

interface VerdictMeta {
  label: string
  severity: 'success' | 'info' | 'warning' | 'error'
  icon: React.ReactNode
  sentence: (outcome: Extract<VerificationOutcome, { status: 'verified' }>) => string
}

function verdictMeta(verdict: Verdict, disposition: string): VerdictMeta {
  switch (verdict) {
    case 'VerifiedImmutable':
      return {
        label: 'Verified — immutable',
        severity: 'success',
        icon: <CheckCircleIcon sx={{ fontSize: 28, color: 'var(--color-status-success)' }} />,
        sentence: (o) => `Verified: this canister runs build ${shortHash(o.facts.moduleHash)} and has no controller — nobody can change it.`,
      }
    case 'VerifiedGoverned':
      if (disposition === 'dao-multisig') {
        return {
          label: 'Verified — DAO-governed',
          severity: 'info',
          icon: <CheckCircleIcon sx={{ fontSize: 28, color: 'var(--color-status-info)' }} />,
          sentence: (o) => `Verified: this canister runs build ${shortHash(o.facts.moduleHash)} and is governed by the DAO multisig ${o.facts.controllers[0]}.`,
        }
      }
      return {
        label: 'Verified — mutable controller',
        severity: 'warning',
        icon: <WarningAmberIcon sx={{ fontSize: 28, color: 'var(--color-status-warning)' }} />,
        sentence: (o) => `Verified on-chain: build ${shortHash(o.facts.moduleHash)} is installed, but it is controlled by ${o.facts.controllers.join(', ') || 'an unknown principal'}, which can replace this code.`,
      }
    case 'HashUnknown':
      return {
        label: 'Verified — build not identified',
        severity: 'warning',
        icon: <WarningAmberIcon sx={{ fontSize: 28, color: 'var(--color-status-warning)' }} />,
        sentence: (o) => `Verified on-chain: this canister runs build ${shortHash(o.facts.moduleHash)}, but no published attestation identifies this build. Funding is blocked until it is identified.`,
      }
    case 'HashMismatch':
      return {
        label: 'Hash mismatch',
        severity: 'error',
        icon: <CancelIcon sx={{ fontSize: 28, color: 'var(--color-status-error)' }} />,
        sentence: () => `The certified on-chain hash does not match the published attestation for this canister. Do not fund this canister.`,
      }
    case 'ControllerChanged':
      return {
        label: 'Controller changed',
        severity: 'error',
        icon: <CancelIcon sx={{ fontSize: 28, color: 'var(--color-status-error)' }} />,
        sentence: () => `The controller set has changed since your last verification. Review the change before funding.`,
      }
    case 'Unverifiable':
    default:
      return {
        label: 'Unverifiable',
        severity: 'error',
        icon: <CancelIcon sx={{ fontSize: 28, color: 'var(--color-status-error)' }} />,
        sentence: () => `This canister could not be verified.`,
      }
  }
}

function failureSentence(reason: FailureReason): string {
  switch (reason.kind) {
    case 'network': return 'The boundary node could not be reached — no verification could be performed.'
    case 'certificate': return 'The certificate signature could not be verified against the NNS root key.'
    case 'range': return 'The canister is not in the certified subnet range.'
    case 'time': return 'The certificate is outside the allowed time window.'
    case 'root-key': return 'No root key is available to verify against.'
    case 'no-module': return 'No code is installed on this canister — there is nothing to verify.'
    default: return reason.detail
  }
}

function reproductionCommands(canisterId: string): string {
  return [
    '# Independently read what this canister actually runs (module hash + controllers)',
    `icp canister status ${canisterId} -n ic --public`,
    '',
    '# The source commit -> wasm hash mapping (rebuild steps) is published by the',
    '# attestation service once it ships (FU-622). The reproducible-build recipe lives',
    '# in packages/icp-escrow-canister (Dockerfile + verify-reproducible-build.sh).',
  ].join('\n')
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard may be unavailable (non-secure context); ignore.
    }
  }
  return (
    <Button
      size="small"
      startIcon={<ContentCopyIcon sx={{ fontSize: 16 }} />}
      onClick={onCopy}
      sx={{ textTransform: 'none' }}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}

export interface CanisterTrustPanelProps {
  canisterId: string
  loading: boolean
  outcome: VerificationOutcome | null
  onReverify: () => void
}

export function CanisterTrustPanel({ canisterId, loading, outcome, onReverify }: CanisterTrustPanelProps) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent sx={{ p: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Typography variant="overline" sx={{ color: 'var(--theme-text-muted)', letterSpacing: '0.08em' }}>
            Canister trust
          </Typography>
          <Button
            size="small"
            startIcon={<RefreshIcon sx={{ fontSize: 16 }} />}
            onClick={onReverify}
            disabled={loading}
            sx={{ textTransform: 'none' }}
          >
            Re-verify
          </Button>
        </Box>

        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 3 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>
              Verifying against the Internet Computer…
            </Typography>
          </Box>
        ) : !outcome ? (
          <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', py: 2 }}>
            Not yet verified.
          </Typography>
        ) : outcome.status === 'unverifiable' ? (
          <UnverifiableView reason={outcome.reason} />
        ) : (
          <VerifiedView canisterId={canisterId} outcome={outcome} />
        )}
      </CardContent>
    </Card>
  )
}

function UnverifiableView({ reason }: { reason: FailureReason }) {
  return (
    <Box sx={{ mt: 1.5 }}>
      <Alert severity="error" icon={<CancelIcon />} sx={{ borderRadius: 2 }}>
        <Typography variant="subtitle2">Unverifiable</Typography>
        <Typography variant="body2">{failureSentence(reason)}</Typography>
      </Alert>
      <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', mt: 1 }}>
        Money-moving actions are blocked. Verification never silently falls back to trusting the platform.
      </Typography>
    </Box>
  )
}

function VerifiedView({ canisterId, outcome }: { canisterId: string; outcome: Extract<VerificationOutcome, { status: 'verified' }> }) {
  const meta = verdictMeta(outcome.verdict.verdict, outcome.verdict.controllerDisposition)
  const ageSeconds = Math.max(0, Math.round((Date.now() - outcome.verifiedAt) / 1000))
  const stale = ageSeconds > 60
  const commands = reproductionCommands(canisterId)

  return (
    <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
        {meta.icon}
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
            {meta.label}
          </Typography>
          <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', mt: 0.25 }}>
            {meta.sentence(outcome)}
          </Typography>
        </Box>
      </Box>

      {outcome.verdict.livenessDegraded && (
        <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ borderRadius: 2 }}>
          Cycle headroom is low. A frozen canister cannot sign a payout.
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
        <ProvenanceChip provenance="on-chain" />
        <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)' }}>
          {stale ? `Verified ${ageSeconds}s ago — stale, re-verify before funding.` : `Verified ${ageSeconds}s ago.`}
        </Typography>
      </Box>

      <Accordion disableGutters elevation={0} sx={{ '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: 40 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            Check the check
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Fact label="Module hash (SHA-256)" mono value={outcome.facts.moduleHash} />
          <Fact label="Controllers" mono value={outcome.facts.controllers.length ? outcome.facts.controllers.join('\n') : '(none — blackholed)'} />
          {outcome.subnetId && <Fact label="Subnet" mono value={outcome.subnetId} />}
          <Fact label="Verification time" value={new Date(outcome.verifiedAt).toISOString()} />
          <Divider />
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>Reproduce (icp CLI)</Typography>
              <CopyButton text={commands} />
            </Box>
            <Typography
              component="pre"
              sx={{
                mt: 0.75,
                p: 1.5,
                fontSize: '0.75rem',
                fontFamily: 'monospace',
                bgcolor: 'var(--theme-bg-subtle)',
                borderRadius: 2,
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                color: 'var(--theme-text)',
              }}
            >
              {commands}
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)' }}>
            Verification proves identity and immutability of the code — it does not prove the code is correct.
            The Internet Computer never exposes the wasm, only its SHA-256, so hash comparison is the only possible check.
          </Typography>
        </AccordionDetails>
      </Accordion>
    </Box>
  )
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)' }}>{label}</Typography>
      <Typography
        variant="body2"
        className={cn(mono && 'font-mono')}
        sx={{ wordBreak: 'break-all', whiteSpace: mono ? 'pre-wrap' : undefined }}
      >
        {value}
      </Typography>
    </Box>
  )
}
