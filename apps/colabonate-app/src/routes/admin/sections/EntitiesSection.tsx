import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Box, Paper, Typography, CircularProgress, Alert, Chip, Tooltip,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  InputAdornment, TextField, Divider, Checkbox, Button,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import SearchIcon from '@mui/icons-material/Search'
import StorageIcon from '@mui/icons-material/Storage'
import TableChartIcon from '@mui/icons-material/TableChart'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import CloseIcon from '@mui/icons-material/Close'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import { ActionButton as EntityActionButton, type EntityActionMeta } from './ActionButton'
import { apiCall } from '../../../lib/api'

const C = {
  text:      'var(--theme-text)',
  textMuted: 'var(--theme-text-muted)',
  border:    'var(--theme-border)',
  surface:   'var(--theme-surface)',
  bgSubtle:  'var(--theme-bg-subtle)',
  accent:    'var(--color-warning-default, #f59e0b)',
} as const

interface EntitySummary { table: string; count: number }

interface Column { name: string; type: string; nullable: boolean }
interface FacetValue { value: string | null; count: number }
interface Facet { column: string; values: FacetValue[] }
interface DateStat { column: string; min: string | null; max: string | null }
interface EntityDetail {
  model: string
  page: number
  limit: number
  total: number
  totalAll: number
  search: string | null
  filters: Record<string, string>
  columns: Column[]
  rows: Record<string, unknown>[]
  facets: Facet[]
  dateStats: DateStat[]
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return value.toLocaleString('de-DE')
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      try {
        return new Date(value).toLocaleString('de-DE', {
          day: '2-digit', month: '2-digit', year: '2-digit',
          hour: '2-digit', minute: '2-digit',
        })
      } catch { return value }
    }
    return value.length > 48 ? value.slice(0, 48) + '…' : value
  }
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 48) + '…'
  return String(value)
}

function detectIdColumn(columns: Column[]): string | null {
  return (
    columns.find(c => c.name === 'id')?.name ??
    columns.find(c => c.name.endsWith('Id'))?.name ??
    columns[0]?.name ??
    null
  )
}

function isLikelyId(name: string): boolean {
  const n = name.toLowerCase()
  return n === 'id' || n.endsWith('id') || n === 'pubkey' || n.endsWith('pubkey')
}

export function EntitiesSection() {
  const [entities,    setEntities]    = useState<EntitySummary[]>([])
  const [entitiesLoading, setEntitiesLoading] = useState(true)
  const [entityError, setEntityError] = useState<string | null>(null)
  const [entityFilter, setEntityFilter] = useState('')

  const [selected, setSelected] = useState<string | null>(null)

  const [detail,  setDetail]  = useState<EntityDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [rowsPerPage] = useState(50)

  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null)

  // Row-level filter state (search + facet chips) for the selected entity.
  // ADR-284 D1: multiple columns can be filtered at once, AND-combined.
  const [rowSearch, setRowSearch] = useState('')
  const [rowSearchInput, setRowSearchInput] = useState('')
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})

  // ADR-284 D5: per-column pixel widths, session-scoped per table (mirrors
  // the ADR-242 useSessionState precedent — schema-drift risk rules out
  // localStorage for admin table column widths).
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const resizingRef = useRef<{ col: string; startX: number; startWidth: number } | null>(null)

  // ── Load entity list ──────────────────────────────────────────────────────
  const loadEntities = useCallback(async () => {
    setEntitiesLoading(true)
    setEntityError(null)
    try {
      const res = await apiCall('/api/admin/entities')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load')
      setEntities(json.entities as EntitySummary[])
    } catch (e) {
      setEntityError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setEntitiesLoading(false)
    }
  }, [])

  useEffect(() => { loadEntities() }, [loadEntities])

  // ── Load selected entity detail ───────────────────────────────────────────
  const loadDetail = useCallback(async () => {
    if (!selected) return
    setDetailLoading(true)
    setDetailError(null)
    setSelectedRow(null)
    try {
      const params = new URLSearchParams({
        page: String(page + 1),
        limit: String(rowsPerPage),
      })
      if (rowSearch) params.set('search', rowSearch)
      if (Object.keys(columnFilters).length > 0) params.set('filters', JSON.stringify(columnFilters))
      const res = await apiCall(`/api/admin/entities/${encodeURIComponent(selected)}?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load entity')
      setDetail(json as EntityDetail)
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setDetailLoading(false)
    }
  }, [selected, page, rowsPerPage, rowSearch, columnFilters])

  useEffect(() => { loadDetail() }, [loadDetail])

  // Reset page + filters whenever the selected entity changes
  useEffect(() => {
    setPage(0)
    setRowSearch('')
    setRowSearchInput('')
    setColumnFilters({})
    setSelectedIds(new Set())
  }, [selected])

  // ADR-284 D5: load persisted column widths for the newly selected table.
  useEffect(() => {
    if (!selected) { setColWidths({}); return }
    try {
      const raw = sessionStorage.getItem(`admin:entities:colwidths:${selected}`)
      setColWidths(raw ? JSON.parse(raw) as Record<string, number> : {})
    } catch {
      setColWidths({})
    }
  }, [selected])

  // Persist column widths for the current table whenever they change.
  useEffect(() => {
    if (!selected) return
    try {
      if (Object.keys(colWidths).length === 0) {
        sessionStorage.removeItem(`admin:entities:colwidths:${selected}`)
      } else {
        sessionStorage.setItem(`admin:entities:colwidths:${selected}`, JSON.stringify(colWidths))
      }
    } catch {
      // sessionStorage unavailable (private mode, quota) — resize still works
      // for the current render, it just won't survive a reload.
    }
  }, [selected, colWidths])

  const startResize = useCallback((e: React.MouseEvent, col: string) => {
    e.preventDefault()
    e.stopPropagation()
    const th = (e.currentTarget as HTMLElement).closest('th')
    const startWidth = colWidths[col] ?? th?.getBoundingClientRect().width ?? 150
    resizingRef.current = { col, startX: e.clientX, startWidth }

    function onMove(ev: MouseEvent) {
      const r = resizingRef.current
      if (!r) return
      const next = Math.max(60, Math.round(r.startWidth + (ev.clientX - r.startX)))
      setColWidths(prev => ({ ...prev, [r.col]: next }))
    }
    function onUp() {
      resizingRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [colWidths])

  // Reset bulk selection when the page changes (selection is page-scoped).
  useEffect(() => {
    setSelectedIds(new Set())
  }, [page])

  // Debounced commit of the row search input
  useEffect(() => {
    const t = setTimeout(() => {
      setRowSearch(prev => (prev === rowSearchInput ? prev : rowSearchInput))
    }, 350)
    return () => clearTimeout(t)
  }, [rowSearchInput])

  // ADR-284 D1: additive — toggling a chip sets/clears just that column's
  // entry in the map, other active columns stay untouched. Clicking the same
  // active value again clears that column; clicking a different value for a
  // column that's already filtered replaces it (values within one column are
  // mutually exclusive, columns across each other are AND-combined).
  function toggleFilter(column: string, value: string) {
    setColumnFilters(prev => {
      if (prev[column] === value) {
        const next = { ...prev }
        delete next[column]
        return next
      }
      return { ...prev, [column]: value }
    })
    setPage(0)
  }

  function clearRowFilters() {
    setRowSearch('')
    setRowSearchInput('')
    setColumnFilters({})
    setPage(0)
  }

  const filteredEntities = useMemo(() => {
    const f = entityFilter.trim().toLowerCase()
    const list = f ? entities.filter(e => e.table.toLowerCase().includes(f)) : entities
    return [...list].sort((a, b) => b.count - a.count)
  }, [entities, entityFilter])

  const idColumn = detail ? detectIdColumn(detail.columns) : null
  const columnOrder = detail?.columns.map(c => c.name) ?? []

  const showDetailColumn = !!selectedRow

  // ── Action registry state (ADR-201) ────────────────────────────────────
  const [actionsMeta, setActionsMeta] = useState<EntityActionMeta[]>([])
  const [actionResult, setActionResult] = useState<{ ok: boolean; msg: string } | null>(null)

  // ── Bulk selection (FU-201-B, generalized ADR-284 D3) ──────────────────────
  // Page-scoped: clearing on entity change + page change is intentional (the
  // selected ids don't survive a filter/page boundary; the user re-selects).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkRunningKey, setBulkRunningKey] = useState<string | null>(null)
  const [bulkPayloads, setBulkPayloads] = useState<Record<string, Record<string, string>>>({})
  // The server's bulk-action endpoint already accepts any registered action
  // key (admin.ts's POST /entities/:model/bulk-action is generic) — the UI
  // just needs to stop hardcoding 'delete'. type-id confirm is excluded: it
  // asks for ONE specific row's id, which has no meaning across a multi-row
  // selection.
  const bulkActions = useMemo(
    () => actionsMeta.filter(a => a.bulkEligible !== false && a.confirm.type !== 'type-id'),
    [actionsMeta],
  )

  function toggleRow(rowId: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }

  function toggleAllOnPage(rowIds: string[]) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      const allSelected = rowIds.every(id => next.has(id))
      if (allSelected) {
        for (const id of rowIds) next.delete(id)
      } else {
        for (const id of rowIds) next.add(id)
      }
      return next
    })
  }

  function bulkPayloadFor(action: EntityActionMeta): Record<string, string> {
    const stored = bulkPayloads[action.key] ?? {}
    const out: Record<string, string> = {}
    for (const f of action.payloadSchema ?? []) {
      out[f.field] = stored[f.field] ?? (f.type === 'enum' ? (f.default ?? f.values[0] ?? '') : '')
    }
    return out
  }

  function setBulkPayloadField(actionKey: string, field: string, value: string) {
    setBulkPayloads(prev => ({ ...prev, [actionKey]: { ...(prev[actionKey] ?? {}), [field]: value } }))
  }

  async function runBulkAction(action: EntityActionMeta) {
    if (selectedIds.size === 0 || !selected) return
    const payload = bulkPayloadFor(action)
    for (const f of action.payloadSchema ?? []) {
      if (!payload[f.field]) {
        setActionResult({ ok: false, msg: `"${f.label}" is required for ${action.label}` })
        return
      }
    }
    setBulkRunningKey(action.key)
    try {
      const res = await apiCall(
        `/api/admin/entities/${encodeURIComponent(selected)}/bulk-action`,
        {
          method: 'POST',
          body: JSON.stringify({ action: action.key, ids: Array.from(selectedIds), payload }),
        },
      )
      const json = await res.json()
      if (!res.ok) {
        setActionResult({ ok: false, msg: json.detail ?? json.error ?? `Bulk ${action.label} failed` })
        return
      }
      const { okCount, failCount, total, results } = json as {
        okCount: number
        failCount: number
        total: number
        results: { id: string; ok: boolean; error?: string; detail?: string }[]
      }
      const failedIds = results.filter(r => !r.ok)
      const failedSummary = failedIds.length
        ? ` · ${failCount} failed: ${failedIds.slice(0, 3).map(r => `${r.id.slice(0, 8)}…(${r.error ?? 'err'})`).join(', ')}${failedIds.length > 3 ? '…' : ''}`
        : ''
      setActionResult({
        ok: failCount === 0,
        msg: `Bulk ${action.label}: ${okCount}/${total} done${failedSummary}`,
      })
      setSelectedIds(new Set())
      void loadDetail()
    } catch (e) {
      setActionResult({ ok: false, msg: e instanceof Error ? e.message : `Bulk ${action.label} failed` })
    } finally {
      setBulkRunningKey(null)
    }
  }

  const loadActions = useCallback(async (model: string) => {
    try {
      const res = await apiCall(`/api/admin/entities/${encodeURIComponent(model)}/actions`)
      const json = await res.json()
      if (!res.ok) {
        // Fail-soft: leave the previous actions in place, but surface the error.
        setActionResult({ ok: false, msg: json.error ?? `Could not load actions for ${model}` })
        return
      }
      setActionsMeta((json.actions ?? []) as EntityActionMeta[])
      setActionResult(null)
    } catch (e) {
      setActionResult({ ok: false, msg: e instanceof Error ? e.message : 'Network error' })
    }
  }, [])

  // Reload action metadata whenever the selected entity changes.
  useEffect(() => {
    if (!selected) {
      setActionsMeta([])
      return
    }
    void loadActions(selected)
  }, [selected, loadActions])

  // Clear stale alerts when switching entities.
  useEffect(() => { setActionResult(null) }, [selected])

  function onActionSuccess(message: string) {
    setActionResult({ ok: true, msg: message })
    // Refresh the row list so callers can see the new state.
    void loadDetail()
  }

  const thSx = {
    color: C.textMuted, fontSize: '0.68rem', fontWeight: 700,
    borderColor: C.border, whiteSpace: 'nowrap' as const, py: 0.75, px: 1,
  }
  const tdSx = { borderColor: C.border, py: 0.75, px: 1, color: C.text }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="overline" sx={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', color: C.textMuted }}>
          Entities {entities.length ? `(${entities.length} tables)` : ''}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {entitiesLoading && <CircularProgress size={12} sx={{ color: C.textMuted }} />}
          <Box onClick={loadEntities} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: C.textMuted, '&:hover': { color: C.text } }}>
            <RefreshIcon sx={{ fontSize: 14 }} />
            <Typography variant="caption" sx={{ fontSize: '0.68rem' }}>Refresh</Typography>
          </Box>
        </Box>
      </Box>

      {entityError && <Alert severity="error" sx={{ mb: 2 }}>{entityError}</Alert>}

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: {
            xs: '1fr',
            md: showDetailColumn ? '240px minmax(0, 1fr) 320px' : '240px minmax(0, 1fr)',
          },
          alignItems: 'start',
        }}
      >
        {/* ── Entity list (left) ──────────────────────────────────────────── */}
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface, p: 1.5, maxHeight: { md: '70vh' }, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <TextField
            size="small"
            fullWidth
            placeholder="Filter tables…"
            value={entityFilter}
            onChange={e => setEntityFilter(e.target.value)}
            InputProps={{
              startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16, color: C.textMuted }} /></InputAdornment>,
              sx: { fontSize: '0.75rem', mb: 1 },
            }}
          />
          <Box sx={{ overflowY: 'auto', flex: 1 }}>
            {entitiesLoading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={20} /></Box>
            )}
            {!entitiesLoading && filteredEntities.length === 0 && (
              <Typography variant="caption" sx={{ color: C.textMuted, display: 'block', textAlign: 'center', py: 2 }}>No tables.</Typography>
            )}
            {filteredEntities.map(e => {
              const active = selected === e.table
              return (
                <Box
                  key={e.table}
                  onClick={() => { setSelected(e.table); setSelectedRow(null) }}
                  sx={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 1, px: 1, py: 0.75, borderRadius: 1, cursor: 'pointer',
                    mb: 0.25,
                    bgcolor: active ? 'var(--color-warning-subtle, #fef3c7)' : 'transparent',
                    border: `1px solid ${active ? C.accent : 'transparent'}`,
                    transition: 'background 0.12s',
                    '&:hover': { bgcolor: active ? 'var(--color-warning-subtle, #fef3c7)' : C.bgSubtle },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                    <TableChartIcon sx={{ fontSize: 14, color: active ? C.accent : C.textMuted, flexShrink: 0 }} />
                    <Typography sx={{ fontSize: '0.74rem', fontWeight: active ? 700 : 500, color: active ? C.accent : C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {e.table}
                    </Typography>
                  </Box>
                  <Chip label={e.count.toLocaleString('de-DE')} size="small"
                    sx={{ height: 18, fontSize: '0.64rem', fontWeight: 600, flexShrink: 0,
                      bgcolor: active ? C.accent : C.bgSubtle, color: active ? '#fff' : C.textMuted, border: 'none' }} />
                </Box>
              )
            })}
          </Box>
        </Paper>

        {/* ── Records table (center) ──────────────────────────────────────── */}
        {!selected ? (
          <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface, p: 6, textAlign: 'center' }}>
            <StorageIcon sx={{ fontSize: 40, color: C.textMuted, mb: 1 }} />
            <Typography variant="body2" sx={{ color: C.textMuted }}>Select a table to browse its records.</Typography>
          </Paper>
        ) : (
          <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface, overflow: 'hidden' }}>
            {/* Records header */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 1, borderBottom: `1px solid ${C.border}`, bgcolor: C.bgSubtle }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TableChartIcon sx={{ fontSize: 16, color: C.accent }} />
                <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: C.text, fontFamily: 'monospace' }}>{selected}</Typography>
                {detail && (
                  <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.7rem' }}>
                    {detail.total.toLocaleString('de-DE')} rows · page {detail.page}/{Math.max(1, Math.ceil(detail.total / rowsPerPage))}
                  </Typography>
                )}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {detailLoading && <CircularProgress size={12} sx={{ color: C.textMuted }} />}
              </Box>
            </Box>

            {detailError && <Alert severity="error" sx={{ m: 1.5 }}>{detailError}</Alert>}

            {actionResult && !showDetailColumn && (
              <Alert
                severity={actionResult.ok ? 'success' : 'error'}
                onClose={() => setActionResult(null)}
                sx={{ m: 1.5, fontSize: '0.74rem' }}
              >
                {actionResult.msg}
              </Alert>
            )}

            {detail && (
              <>
                {/* Toolbar: search + facet filter chips + clear */}
                <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <TextField
                      size="small"
                      placeholder={`Search in ${selected}…`}
                      value={rowSearchInput}
                      onChange={e => { setRowSearchInput(e.target.value); setPage(0) }}
                      InputProps={{
                        startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16, color: C.textMuted }} /></InputAdornment>,
                        sx: { fontSize: '0.75rem', height: 32 },
                      }}
                      sx={{ minWidth: 220, flex: '1 1 220px' }}
                    />
                    {(rowSearch || Object.keys(columnFilters).length > 0) && (
                      <Chip
                        label="Clear filters"
                        size="small"
                        onDelete={clearRowFilters}
                        onClick={clearRowFilters}
                        sx={{ height: 26, fontSize: '0.68rem', fontWeight: 600, bgcolor: C.bgSubtle, color: C.textMuted, border: `1px solid ${C.border}` }}
                      />
                    )}
                    {detail.total !== detail.totalAll && (
                      <Typography variant="caption" sx={{ fontSize: '0.68rem', color: C.accent, fontWeight: 600, ml: 'auto' }}>
                        {detail.total.toLocaleString('de-DE')} of {detail.totalAll.toLocaleString('de-DE')}
                      </Typography>
                    )}
                  </Box>

                  {/* ADR-284 D1: active multi-column filter chips (removable) */}
                  {Object.keys(columnFilters).length > 0 && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                      {Object.entries(columnFilters).map(([col, val]) => (
                        <Chip
                          key={col}
                          label={`${col} = ${val}`}
                          size="small"
                          onDelete={() => toggleFilter(col, val)}
                          sx={{
                            height: 22, fontSize: '0.66rem', fontWeight: 600,
                            bgcolor: C.accent, color: '#fff', border: `1px solid ${C.accent}`,
                            fontFamily: 'monospace',
                          }}
                        />
                      ))}
                    </Box>
                  )}

                  {/* Facet chips */}
                  {detail.facets.length > 0 && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                      {detail.facets.map(facet => (
                        <Box key={facet.column} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                          <Typography variant="caption" sx={{ fontSize: '0.64rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', mr: 0.25 }}>
                            {facet.column}:
                          </Typography>
                          {facet.values.map(v => {
                            const isNull = v.value === null
                            const active = !isNull && columnFilters[facet.column] === v.value
                            const label = v.value ?? 'NULL'
                            return (
                              <Chip
                                key={v.value ?? '__null__'}
                                label={`${label} (${v.count.toLocaleString('de-DE')})`}
                                size="small"
                                onClick={isNull ? undefined : () => toggleFilter(facet.column, v.value!)}
                                sx={{
                                  height: 22, fontSize: '0.66rem', fontWeight: 600,
                                  bgcolor: active ? C.accent : C.bgSubtle,
                                  color: active ? '#fff' : (isNull ? C.textMuted : C.text),
                                  border: `1px solid ${active ? C.accent : C.border}`,
                                  opacity: isNull ? 0.7 : 1,
                                  cursor: isNull ? 'default' : 'pointer',
                                  '&:hover': isNull ? {} : { borderColor: C.accent },
                                }}
                              />
                            )
                          })}
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>

                {/* Key-value info strip about the selected entity */}
                <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${C.border}`, bgcolor: C.surface, display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                  {(() => {
                    const cols = detail.columns
                    const idCols = cols.filter(c => isLikelyId(c.name)).map(c => c.name)
                    const nullableCount = cols.filter(c => c.nullable).length
                    const textCount = cols.filter(c => /char|text/i.test(c.type)).length
                    const timeCount = cols.filter(c => /timestamp|date/i.test(c.type)).length
                    const items: { k: string; v: string; mono?: boolean }[] = [
                      { k: 'Table', v: detail.model, mono: true },
                      { k: 'Total rows', v: detail.totalAll.toLocaleString('de-DE') },
                      { k: 'Columns', v: String(cols.length) },
                    ]
                    if (textCount) items.push({ k: 'Text cols', v: String(textCount) })
                    if (timeCount) items.push({ k: 'Time cols', v: String(timeCount) })
                    if (nullableCount) items.push({ k: 'Nullable', v: String(nullableCount) })
                    if (idCols.length) items.push({ k: 'Identifiers', v: idCols.slice(0, 4).join(', ') + (idCols.length > 4 ? ` +${idCols.length - 4}` : ''), mono: true })
                    for (const ds of detail.dateStats) {
                      if (!ds.max) continue
                      const label = /updatedAt|modifiedAt/i.test(ds.column) ? 'Last update' : /createdAt/i.test(ds.column) ? 'Newest record' : ds.column
                      items.push({ k: label, v: new Date(ds.max).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) })
                    }
                    return items.map(it => (
                      <Box key={it.k} sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <Typography variant="caption" sx={{ fontSize: '0.6rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1 }}>
                          {it.k}
                        </Typography>
                        <Typography sx={{ fontSize: '0.74rem', fontWeight: 600, color: C.text, fontFamily: it.mono ? 'monospace' : 'inherit', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
                          {it.v}
                        </Typography>
                      </Box>
                    ))
                  })()}
                </Box>

                <TableContainer sx={{ maxHeight: '60vh' }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow sx={{ bgcolor: C.bgSubtle }}>
                        {idColumn && (
                          <TableCell key="__select__" sx={{ ...thSx, width: 36, px: 0.5 }}>
                            {(() => {
                              const rowIds = detail.rows
                                .map(r => String(r[idColumn] ?? ''))
                                .filter(id => id !== '')
                              const allSelected = rowIds.length > 0 && rowIds.every(id => selectedIds.has(id))
                              const someSelected = rowIds.some(id => selectedIds.has(id))
                              return (
                                <Checkbox
                                  size="small"
                                  checked={allSelected}
                                  indeterminate={!allSelected && someSelected}
                                  onChange={() => toggleAllOnPage(rowIds)}
                                  disabled={rowIds.length === 0}
                                  sx={{ p: 0.25 }}
                                  inputProps={{ 'aria-label': 'Select all rows on this page' }}
                                />
                              )
                            })()}
                          </TableCell>
                        )}
                        {columnOrder.map(col => (
                          <TableCell
                            key={col}
                            sx={{
                              ...thSx,
                              color: isLikelyId(col) ? C.accent : C.textMuted,
                              position: 'relative',
                              ...(colWidths[col] ? { width: colWidths[col], minWidth: colWidths[col], maxWidth: colWidths[col] } : {}),
                            }}
                          >
                            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {isLikelyId(col) && <VpnKeyIcon sx={{ fontSize: 11, flexShrink: 0 }} />}
                              {col}
                            </Box>
                            {/* ADR-284 D5: drag handle — session-scoped column resize */}
                            <Box
                              onMouseDown={e => startResize(e, col)}
                              sx={{
                                position: 'absolute', top: 0, right: 0, bottom: 0, width: 6,
                                cursor: 'col-resize', userSelect: 'none',
                                '&:hover': { bgcolor: C.accent },
                              }}
                            />
                          </TableCell>
                        ))}
                        <TableCell key="__actions__" sx={{ ...thSx, textAlign: 'right', minWidth: 80 }}>
                          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, justifyContent: 'flex-end' }}>
                            Actions
                          </Box>
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detail.rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={columnOrder.length + (idColumn ? 2 : 1)} sx={{ textAlign: 'center', py: 4, color: C.textMuted }}>
                            <Typography variant="caption">No rows.</Typography>
                          </TableCell>
                        </TableRow>
                      )}
                      {detail.rows.map((row, i) => {
                        const activeRow = selectedRow === row
                        const rowId = idColumn ? String(row[idColumn] ?? '') : ''
                        const isSelected = !!rowId && selectedIds.has(rowId)
                        // ADR-284 D2: 'blockedAt' is a moderation column on
                        // Offer/Company/User — tint the whole row when set,
                        // regardless of which table is open.
                        const isBlocked = 'blockedAt' in row && row.blockedAt != null
                        return (
                          <TableRow
                            key={idColumn ? String(row[idColumn] ?? i) : i}
                            hover
                            selected={activeRow || isSelected}
                            onClick={() => setSelectedRow(activeRow ? null : row)}
                            sx={{
                              cursor: 'pointer',
                              '&:hover': { bgcolor: C.bgSubtle },
                              bgcolor: isSelected
                                ? 'var(--color-warning-subtle, rgba(245,158,11,0.08))'
                                : isBlocked
                                  ? 'rgba(218, 20, 20, 0.06)'
                                  : undefined,
                              borderLeft: isBlocked ? `3px solid var(--color-status-error, #DA1414)` : undefined,
                            }}
                          >
                            {idColumn && (
                              <TableCell
                                key="__select__"
                                sx={{ ...tdSx, width: 36, px: 0.5 }}
                                onClick={(e) => { e.stopPropagation(); if (rowId) toggleRow(rowId) }}
                              >
                                <Checkbox
                                  size="small"
                                  checked={isSelected}
                                  disabled={!rowId}
                                  onChange={() => rowId && toggleRow(rowId)}
                                  onClick={(e) => e.stopPropagation()}
                                  sx={{ p: 0.25 }}
                                  inputProps={{ 'aria-label': `Select row ${rowId}` }}
                                />
                              </TableCell>
                            )}
                            {columnOrder.map(col => (
                              <TableCell
                                key={col}
                                sx={{
                                  ...tdSx,
                                  ...(colWidths[col] ? { width: colWidths[col], minWidth: colWidths[col], maxWidth: colWidths[col] } : {}),
                                  overflow: 'hidden', textOverflow: 'ellipsis',
                                }}
                              >
                                <Tooltip title={typeof row[col] === 'string' && String(row[col]).length > 48 ? String(row[col]) : ''} placement="top">
                                  <Typography variant="caption" sx={{
                                    fontSize: '0.72rem', color: row[col] === null || row[col] === undefined ? C.textMuted : C.text,
                                    fontFamily: isLikelyId(col) ? 'monospace' : 'inherit',
                                    whiteSpace: 'nowrap',
                                  }}>
                                    {formatCell(row[col])}
                                  </Typography>
                                </Tooltip>
                              </TableCell>
                            ))}
                            <TableCell
                              key="__actions__"
                              sx={{ ...tdSx, textAlign: 'right', whiteSpace: 'nowrap' }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Box sx={{ display: 'inline-flex', gap: 0.5, justifyContent: 'flex-end', alignItems: 'center', minHeight: 22 }}>
                                {actionsMeta.length === 0 ? (
                                  <Typography variant="caption" sx={{ fontSize: '0.62rem', color: C.textMuted, fontStyle: 'italic' }}>
                                    —
                                  </Typography>
                                ) : (
                                  actionsMeta.map(a => (
                                    <EntityActionButton
                                      key={a.key}
                                      model={selected!}
                                      id={rowId}
                                      action={a}
                                      iconOnly
                                      onSuccess={onActionSuccess}
                                    />
                                  ))
                                )}
                              </Box>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>

                {/* Sticky bulk-action bar — FU-201-B, generalized ADR-284 D3:
                    every bulk-eligible registered action gets its own row,
                    not just delete. */}
                {bulkActions.length > 0 && selectedIds.size > 0 && (
                  <Box sx={{
                    position: 'sticky', bottom: 0, zIndex: 2,
                    display: 'flex', flexDirection: 'column', gap: 0.75,
                    px: 1.5, py: 0.75,
                    // `--color-warning-subtle` isn't an actual defined design
                    // token (no light/dark values anywhere in packages/tokens
                    // or index.css) — it always fell through to the hardcoded
                    // `#fef3c7` fallback, a pale yellow that reads fine
                    // against dark-mode-black text but goes unreadable
                    // against the light text `--theme-text` resolves to in
                    // dark mode. `--theme-bg-subtle` is a real theme-aware
                    // token already paired correctly with C.text/C.textMuted
                    // everywhere else in this file — the accent border still
                    // marks this bar as the warning/action area.
                    borderTop: `2px solid ${C.accent}`,
                    bgcolor: C.bgSubtle,
                  }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Typography variant="caption" sx={{ fontSize: '0.74rem', fontWeight: 700, color: C.text }}>
                        {selectedIds.size} row{selectedIds.size === 1 ? '' : 's'} selected
                      </Typography>
                      <Typography variant="caption" sx={{ fontSize: '0.68rem', color: C.textMuted }}>
                        · page-scoped; clears on entity or page change
                      </Typography>
                      <Box sx={{ flex: 1 }} />
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => setSelectedIds(new Set())}
                        sx={{ fontSize: '0.72rem', textTransform: 'none' }}
                      >
                        Clear
                      </Button>
                    </Box>
                    {bulkActions.map(action => (
                      <Box key={action.key} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        {(action.payloadSchema ?? []).map(f => (
                          <TextField
                            key={f.field}
                            size="small"
                            placeholder={f.label}
                            value={bulkPayloadFor(action)[f.field] ?? ''}
                            onChange={e => setBulkPayloadField(action.key, f.field, e.target.value)}
                            select={f.type === 'enum'}
                            SelectProps={f.type === 'enum' ? { native: true } : undefined}
                            sx={{ minWidth: 160, '& .MuiInputBase-input': { fontSize: '0.74rem', py: 0.5 } }}
                          >
                            {f.type === 'enum' && f.values.map(v => <option key={v} value={v}>{v}</option>)}
                          </TextField>
                        ))}
                        <Button
                          size="small"
                          variant="contained"
                          color={action.variant === 'danger' ? 'error' : action.variant === 'primary' ? 'warning' : 'inherit'}
                          startIcon={action.key === 'delete' ? <DeleteSweepIcon sx={{ fontSize: 16 }} /> : undefined}
                          disabled={bulkRunningKey !== null}
                          onClick={() => runBulkAction(action)}
                          sx={{ fontSize: '0.74rem', textTransform: 'none', fontWeight: 700 }}
                        >
                          {bulkRunningKey === action.key
                            ? `${action.label}…`
                            : `${action.label} (${selectedIds.size})`}
                        </Button>
                      </Box>
                    ))}
                  </Box>
                )}

                {/* Pagination */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 1, borderTop: `1px solid ${C.border}` }}>
                  <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.7rem' }}>
                    {rowsPerPage} / page
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      sx={{ fontSize: '0.72rem', fontWeight: 600, color: page === 0 ? C.textMuted : C.text, cursor: page === 0 ? 'default' : 'pointer', px: 1, py: 0.25, borderRadius: 1, '&:hover': { bgcolor: page === 0 ? 'transparent' : C.bgSubtle } }}
                    >Prev</Box>
                    <Typography variant="caption" sx={{ fontSize: '0.72rem', color: C.text, fontVariantNumeric: 'tabular-nums' }}>
                      {page + 1}
                    </Typography>
                    <Box
                      onClick={() => { if (detail && (page + 1) * rowsPerPage < detail.total) setPage(p => p + 1) }}
                      sx={{
                        fontSize: '0.72rem', fontWeight: 600,
                        color: detail && (page + 1) * rowsPerPage < detail.total ? C.text : C.textMuted,
                        cursor: detail && (page + 1) * rowsPerPage < detail.total ? 'pointer' : 'default',
                        px: 1, py: 0.25, borderRadius: 1,
                        '&:hover': { bgcolor: detail && (page + 1) * rowsPerPage < detail.total ? C.bgSubtle : 'transparent' },
                      }}
                    >Next</Box>
                  </Box>
                </Box>
              </>
            )}
          </Paper>
        )}

        {/* ── Selected record detail (right) ──────────────────────────────── */}
        {showDetailColumn && selectedRow && (
          <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface, p: 1.5, maxHeight: { md: '70vh' }, overflow: 'auto', position: 'sticky', top: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <VpnKeyIcon sx={{ fontSize: 16, color: C.accent }} />
                <Typography variant="overline" sx={{ fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.06em', color: C.textMuted }}>Record Detail</Typography>
              </Box>
              <Box onClick={() => setSelectedRow(null)} sx={{ cursor: 'pointer', color: C.textMuted, '&:hover': { color: C.text }, display: 'flex' }}>
                <CloseIcon sx={{ fontSize: 16 }} />
              </Box>
            </Box>

            {/* ADR-201: per-row action stack */}
            {idColumn && (
              <Box sx={{ mb: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                <Typography variant="overline" sx={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', color: C.textMuted }}>
                  Actions
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, minHeight: 32, alignItems: 'center' }}>
                  {actionsMeta.length === 0 ? (
                    <Typography variant="caption" sx={{ fontSize: '0.7rem', color: C.textMuted, fontStyle: 'italic' }}>
                      No actions registered for this table.
                    </Typography>
                  ) : (
                    actionsMeta.map(a => (
                      <EntityActionButton
                        key={a.key}
                        model={selected!}
                        id={String(selectedRow[idColumn] ?? '')}
                        action={a}
                        onSuccess={onActionSuccess}
                      />
                    ))
                  )}
                </Box>
                {actionResult && (
                  <Alert
                    severity={actionResult.ok ? 'success' : 'error'}
                    onClose={() => setActionResult(null)}
                    sx={{ fontSize: '0.7rem', py: 0.25 }}
                  >
                    {actionResult.msg}
                  </Alert>
                )}
                <Divider sx={{ borderColor: C.border, mt: 0.5 }} />
              </Box>
            )}

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {detail?.columns.map(col => {
                const val = selectedRow[col.name]
                const display = formatCell(val)
                return (
                  <Box key={col.name} sx={{ py: 0.5, borderBottom: `1px solid ${C.border}` }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                      <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: isLikelyId(col.name) ? C.accent : C.text, fontFamily: 'monospace' }}>
                        {col.name}
                      </Typography>
                      <Chip label={col.type} size="small"
                        sx={{ height: 14, fontSize: '0.58rem', bgcolor: C.bgSubtle, color: C.textMuted, border: 'none', '& .MuiChip-label': { px: 0.5 } }} />
                    </Box>
                    <Tooltip title={display === '—' ? '' : String(val)} placement="left">
                      <Typography sx={{
                        fontSize: '0.72rem', color: val === null || val === undefined ? C.textMuted : C.text,
                        fontFamily: isLikelyId(col.name) ? 'monospace' : 'inherit',
                        wordBreak: 'break-all', whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'hidden',
                      }}>
                        {display}
                      </Typography>
                    </Tooltip>
                  </Box>
                )
              })}
            </Box>
          </Paper>
        )}
      </Box>
    </Box>
  )
}
