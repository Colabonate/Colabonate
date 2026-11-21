/**
 * ADR-160 (PROB-003 B-γ) — Wallet-Mode Strategy picker.
 *
 * Lets the user choose once how trade visibility maps to wallet mode:
 *   HYBRID (default) | CUSTODIAL_ONLY | NONCUSTODIAL_ONLY
 *
 * The mapping + caveats come from the server (explainStrategy) so the UI never
 * duplicates the decision logic. Pure presentational + a thin fetch/set;
 * matches the PrivateTradeSettings pattern (plain async/useState, no TanStack).
 */

import { useEffect, useState } from 'react'
import {
  Box,
  Paper,
  Typography,
  RadioGroup,
  FormControlLabel,
  Radio,
  Alert,
  CircularProgress,
  Chip,
} from '@mui/material'
import { apiCall, ApiError } from '../../lib/api'
import type { StrategyExplanation, WalletModeStrategy } from '../../types/api'

const C = {
  surface: 'var(--theme-surface)',
  text: 'var(--theme-text)',
  textMuted: 'var(--theme-text-muted)',
  border: 'var(--theme-border)',
}

const modeLabel = (m: 'CUSTODIAL' | 'NON_CUSTODIAL') =>
  m === 'CUSTODIAL' ? 'Custodial' : 'Non-custodial'

export function WalletStrategySection({ pubkey }: { pubkey: string }) {
  const [explanations, setExplanations] = useState<StrategyExplanation[]>([])
  const [current, setCurrent] = useState<WalletModeStrategy>('HYBRID')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiCall(`/api/user/${pubkey}/wallet-strategy`)
      .then(r => r.json())
      .then((data: { walletModeStrategy: WalletModeStrategy; explanations: StrategyExplanation[] }) => {
        if (cancelled) return
        setCurrent(data.walletModeStrategy)
        setExplanations(data.explanations)
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load strategy')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [pubkey])

  async function handleChange(next: WalletModeStrategy) {
    setCurrent(next)
    setSaving(true)
    setError(null)
    try {
      const r = await apiCall(`/api/user/${pubkey}/wallet-strategy`, {
        method: 'PATCH',
        body: JSON.stringify({ walletModeStrategy: next }),
      })
      const data: { walletModeStrategy: WalletModeStrategy } = await r.json()
      setCurrent(data.walletModeStrategy)
    } catch (e) {
      setError(e instanceof ApiError ? (e.data?.message as string) ?? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const selected = explanations.find(e => e.strategy === current) ?? null
  // A Direct-Pay-only deployment (ADR-253) returns exactly one truthful mode —
  // there is nothing to choose, so it is shown as information, not a radio.
  const singleMode = !loading && explanations.length === 1

  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, bgcolor: C.surface, borderColor: C.border }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ color: C.text }}>
          {singleMode ? 'Wallet Mode' : 'Wallet Mode Strategy'}
        </Typography>
        {saving && <CircularProgress size={14} />}
      </Box>
      <Typography variant="caption" sx={{ color: C.textMuted, mb: 2, display: 'block' }}>
        {singleMode
          ? 'How your wallet is used for trades on this deployment.'
          : 'Choose once how public vs. private trades use your wallet. Applies to new wallets and trades.'}
      </Typography>

      {loading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={18} />
          <Typography variant="caption" sx={{ color: C.textMuted }}>
            Loading…
          </Typography>
        </Box>
      ) : singleMode ? (
        // ADR-253: a Direct-Pay-only deployment has exactly one truthful mode.
        <Box>
          <Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>
            {explanations[0].label}
          </Typography>
          <Typography variant="caption" sx={{ color: C.textMuted }}>
            {explanations[0].summary}
          </Typography>
        </Box>
      ) : (
        <>
          {error && (
            <Alert severity="error" variant="outlined" sx={{ mb: 1.5 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          <RadioGroup value={current} onChange={e => handleChange(e.target.value as WalletModeStrategy)}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {explanations.map(exp => (
                <FormControlLabel
                  key={exp.strategy}
                  value={exp.strategy}
                  control={<Radio size="small" />}
                  label={
                    <Box sx={{ ml: 0.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>
                          {exp.label}
                        </Typography>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`Public → ${modeLabel(exp.publicMode)} · Private → ${modeLabel(exp.privateMode)}`}
                          sx={{ height: 20, '& .MuiChip-label': { fontSize: '0.7rem', px: 0.75 } }}
                        />
                      </Box>
                      <Typography variant="caption" sx={{ color: C.textMuted }}>
                        {exp.summary}
                      </Typography>
                    </Box>
                  }
                  sx={{ alignItems: 'flex-start', mr: 0 }}
                />
              ))}
            </Box>
          </RadioGroup>

          {selected?.caveat && (
            <Alert severity="warning" variant="outlined" sx={{ mt: 1.5 }}>
              {selected.caveat}
            </Alert>
          )}
        </>
      )}
    </Paper>
  )
}
