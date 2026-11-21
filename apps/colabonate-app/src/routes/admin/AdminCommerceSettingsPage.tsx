// ADR-405: platform-wide sales & visibility switches for the AI Assistant and
// MCP surfaces. Close-only / hide-only — the environment gates
// (AI_HOSTED_ENABLED, MCP_PAYWALL_ENABLED) stay authoritative, so these
// switches can only pause sales or hide the Home sections, never force them on.
import { useState, useEffect, useCallback } from 'react'
import { Alert, Box, CircularProgress, Paper, Stack, Switch, Typography } from '@mui/material'
import TuneIcon from '@mui/icons-material/Tune'
import { Seo } from '../../components/Seo'
import { apiCall } from '../../lib/api'

interface FoundationSettingsFlags {
  remoteCandidatesAutoApprove: boolean
  aiSalesPaused: boolean
  mcpSalesPaused: boolean
  aiAssistantSectionHidden: boolean
  mcpSectionHidden: boolean
  updatedBy: string | null
  updatedAt: string | null
}

type ToggleKey = 'aiSalesPaused' | 'mcpSalesPaused' | 'aiAssistantSectionHidden' | 'mcpSectionHidden'

const ROWS: Array<{ key: ToggleKey; label: string; hint: string }> = [
  {
    key: 'aiSalesPaused',
    label: 'Pause AI credit sales',
    hint: 'Stops new credit-pack purchases. Existing credits keep working, and already-issued invoices are never gated.',
  },
  {
    key: 'aiAssistantSectionHidden',
    label: 'Hide the "Colabonate AI Assistant" Home section',
    hint: 'Removes the AI Assistant marketing section (heading, CTA, packs) from the Home page.',
  },
  {
    key: 'mcpSalesPaused',
    label: 'Pause MCP pass sales',
    hint: 'Stops new pass purchases. Active passes and the free trial keep working, and already-issued invoices still confirm.',
  },
  {
    key: 'mcpSectionHidden',
    label: 'Hide the "Connect your own agent" Home section',
    hint: 'Removes the MCP marketing section from the Home page.',
  },
]

export function AdminCommerceSettingsPage() {
  const [settings, setSettings] = useState<FoundationSettingsFlags | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<ToggleKey | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiCall('/api/admin/foundation-settings')
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message || body?.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setSettings(data.settings)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function toggle(key: ToggleKey, value: boolean) {
    setSavingKey(key)
    setError(null)
    try {
      const res = await apiCall('/api/admin/foundation-settings', {
        method: 'PATCH',
        body: JSON.stringify({ [key]: value }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail || body?.message || body?.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setSettings(data.settings)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update setting')
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <Box>
      <Seo noindex title="Sales & Visibility — Admin" />
      <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 3 }}>
        <TuneIcon sx={{ color: 'var(--color-warning-default, #f59e0b)' }} />
        <Box>
          <Typography variant="h6" fontWeight={700}>Sales &amp; Visibility</Typography>
          <Typography variant="body2" color="text.secondary">
            Platform-wide switches for the AI Assistant and MCP (ADR-405). The environment gates stay authoritative —
            these can only pause sales or hide the Home sections.
          </Typography>
        </Box>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>}

      <Paper>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
            <CircularProgress size={28} />
          </Box>
        ) : settings ? (
          <Box>
            {ROWS.map((row, i) => (
              <Box
                key={row.key}
                sx={{
                  px: 2.5,
                  py: 2,
                  borderTop: i === 0 ? 'none' : '1px solid var(--theme-border)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 2,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body1" fontWeight={600}>{row.label}</Typography>
                  <Typography variant="body2" color="text.secondary">{row.hint}</Typography>
                </Box>
                <Switch
                  checked={Boolean(settings[row.key])}
                  disabled={savingKey === row.key}
                  onChange={(e) => toggle(row.key, e.target.checked)}
                  inputProps={{ 'aria-label': row.label }}
                  sx={{ flexShrink: 0, mt: 0.25 }}
                />
              </Box>
            ))}
            <Box sx={{ px: 2.5, py: 1.5, borderTop: '1px solid var(--theme-border)' }}>
              <Typography variant="caption" color="text.secondary">
                {settings.updatedAt
                  ? `Last changed ${new Date(settings.updatedAt).toLocaleString('de-DE')}`
                  : 'No changes recorded yet'}
                {settings.updatedBy ? ` · by ${settings.updatedBy.slice(0, 8)}…${settings.updatedBy.slice(-4)}` : ''}
              </Typography>
            </Box>
          </Box>
        ) : null}
      </Paper>
    </Box>
  )
}
