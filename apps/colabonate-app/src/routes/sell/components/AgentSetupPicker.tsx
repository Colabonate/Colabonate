import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, X, Check, Bot } from 'lucide-react'
import { IconButton, Autocomplete, TextField, CircularProgress, Box, Typography } from '@mui/material'
import { apiCall } from '../../../lib/api'

/**
 * ADR-340 D2: AgentSetupPicker — mirror of ProductPicker but for AGENT_SETUP
 * catalogs. Picks from the caller's own non-deleted AgentProfiles (same
 * ownership rule the row-⋮ menu enforces) and toggles membership via
 * PUT /api/catalog/:id/agents (unified membership endpoint, ADR-340 D6).
 *
 * Only offers setups NOT already members of the target catalog
 * (`excludeIds`) — assigning an already-assigned setup is not a valid
 * choice (ADR-340 D2 amendment, 2026-08-24).
 */
export function AgentSetupPicker({
  catalogId,
  excludeIds = [],
  onAssigned,
  onCancel,
}: {
  catalogId: string
  excludeIds?: string[]
  onAssigned: (agent: { id: string; name: string }) => void
  onCancel: () => void
}) {
  const navigate = useNavigate()
  const [allAgents, setAllAgents] = useState<Array<{ id: string; name: string; capabilities: string[] }>>([])
  const [selected, setSelected] = useState<{ id: string; name: string; capabilities: string[] } | null>(null)
  const [assigning, setAssigning] = useState(false)
  const [loading, setLoading] = useState(true)
  const exclude = useMemo(() => new Set(excludeIds), [excludeIds])

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      try {
        // The caller's own agent profiles (same shape as the stack's "owned"
        // list). GET /api/agent-profiles filters deletedAt: null since
        // ADR-340 D4 — soft-deleted setups don't appear.
        const res = await apiCall('/api/agent-profiles')
        const data = await res.json()
        if (!cancelled && data.agentProfiles) {
          setAllAgents(data.agentProfiles.map((p: { id: string; name: string; capabilities: string[] }) => ({
            id: p.id, name: p.name, capabilities: p.capabilities ?? [],
          })))
        }
      } catch {
        if (!cancelled) setAllAgents([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetch()
    return () => { cancelled = true }
  }, [])

  async function handleAssign() {
    if (!selected) return
    setAssigning(true)
    try {
      const res = await apiCall(`/api/catalog/${catalogId}/agents`, {
        method: 'PUT',
        body: JSON.stringify({ agentProfileId: selected.id, member: true }),
      })
      if (res.ok) onAssigned({ id: selected.id, name: selected.name })
    } catch (error) {
      console.error('Failed to assign agent:', error)
    } finally {
      setAssigning(false)
    }
  }

  return (
    <Box
      sx={{
        display: 'flex', flexDirection: 'column', gap: 2.5, p: 2.5, borderRadius: 2,
        background: 'var(--theme-surface)', border: '1px solid var(--theme-border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Bot size={15} style={{ color: 'var(--color-secondary-50)' }} />
          <Typography variant="body2" fontWeight={600}>Add Agent Setup to Catalog</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <button
            onClick={() => navigate('/coop/agents/new')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer hover:opacity-80"
            style={{ background: 'var(--color-secondary-50)', color: 'white' }}
          >
            <Plus size={12} /> New Agent
          </button>
          <IconButton onClick={onCancel} size="small" sx={{ width: 28, height: 28, background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)', '&:hover': { opacity: 0.8 } }}>
            <X size={13} />
          </IconButton>
        </Box>
      </Box>

      <Autocomplete
        options={allAgents.filter((a) => !exclude.has(a.id))}
        getOptionLabel={(option) => option.name}
        getOptionKey={(option) => option.id}
        value={selected}
        onChange={(_, value) => setSelected(value)}
        loading={loading}
        isOptionEqualToValue={(option, value) => option.id === value.id}
        size="small"
        renderInput={(params) => (
          <TextField
            {...params}
            label="Select agent setup"
            placeholder="Type to search…"
            slotProps={{
              input: {
                ...params.InputProps,
                endAdornment: (
                  <>
                    {loading ? <CircularProgress color="inherit" size={16} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              },
            }}
          />
        )}
        renderOption={(props, option) => (
          <li {...props} key={option.id}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%', py: 0.5 }}>
              <Box sx={{
                width: 28, height: 28, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                background: 'rgba(159,122,234,0.12)',
              }}>
                <Bot size={12} style={{ color: 'var(--color-secondary-50)' }} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600} noWrap>{option.name}</Typography>
                {option.capabilities.length > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    {option.capabilities.slice(0, 3).join(', ')}
                    {option.capabilities.length > 3 && ` +${option.capabilities.length - 3}`}
                  </Typography>
                )}
              </Box>
            </Box>
          </li>
        )}
        noOptionsText={allAgents.length === 0 ? 'No agent setups yet' : 'No unassigned agent setups'}
        sx={{
          '& .MuiOutlinedInput-root': {
            borderRadius: 1.5,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--theme-border)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--theme-border)' },
          },
        }}
      />

      {selected && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pt: 0.5, borderTop: '1px solid var(--theme-border)' }}>
          <Box sx={{ flex: 1, fontSize: 12, color: 'var(--theme-text-muted)' }}>
            Add <strong style={{ color: 'var(--theme-text)' }}>{selected.name}</strong> to this catalog?
          </Box>
          <button
            onClick={handleAssign}
            disabled={assigning}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold transition-all duration-150 cursor-pointer hover:opacity-90 shrink-0"
            style={{ background: 'var(--color-secondary-50)', color: 'white' }}
          >
            {assigning ? <span className="inline-block w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : <Check size={13} />}
            {assigning ? 'Adding…' : 'Add'}
          </button>
        </Box>
      )}
    </Box>
  )
}