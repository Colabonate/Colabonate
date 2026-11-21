// ADR-201: Shared ActionButton for the admin /entities page and
// the Account detail panel. Renders a single action with a confirm
// dialog (type-id / checkbox / none) and posts to
//   POST /api/admin/entities/:model/:id/:action
// Errors from the server surface inline.
//
// This component is rendered in BOTH the per-row Icon column
// (EntitiesSection) and the Quick Actions stack (AccountsSection).

import { useState } from 'react'
import {
  Box, Typography, CircularProgress, TextField, Checkbox, FormControlLabel, Alert,
} from '@mui/material'
import LinkIcon     from '@mui/icons-material/Link'
import CheckIcon    from '@mui/icons-material/Check'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import DeleteIcon   from '@mui/icons-material/Delete'
import FlagIcon     from '@mui/icons-material/Flag'
import BoltIcon     from '@mui/icons-material/Bolt'
import { apiCall } from '../../../lib/api'

const C = {
  text:       'var(--theme-text)',
  textMuted:  'var(--theme-text-muted)',
  border:     'var(--theme-border)',
  surface:    'var(--theme-surface)',
  bgSubtle:   'var(--theme-bg-subtle)',
  accent:     'var(--color-warning-default, #f59e0b)',
  danger:     'var(--color-status-error, #DA1414)',
  success:    'var(--color-status-success, #23CA61)',
} as const

export type ActionVariant = 'danger' | 'primary' | 'neutral'

export type ActionConfirm =
  | { type: 'none' }
  | { type: 'checkbox'; prompt: string }
  | { type: 'type-id'; prompt: string }

export type ActionField =
  | { field: string; label: string; type: 'string' }
  | { field: string; label: string; type: 'enum'; values: string[]; default?: string }

export type EntityActionMeta = {
  key: string
  label: string
  description: string
  icon?: string
  variant: ActionVariant
  confirm: ActionConfirm
  payloadSchema?: ActionField[]
  /** Whether this action may run over a multi-row selection (ADR-284 D3). Defaults to true. */
  bulkEligible?: boolean
}

type IconCmp = React.ComponentType<{ sx?: Record<string, unknown> }>

function resolveIcon(name?: string): IconCmp | null {
  switch (name) {
    case 'delete':       return DeleteIcon as unknown as IconCmp
    case 'flag':         return FlagIcon as unknown as IconCmp
    case 'restart_alt':  return RestartAltIcon as unknown as IconCmp
    case 'bolt':         return BoltIcon as unknown as IconCmp
    case 'link':         return LinkIcon as unknown as IconCmp
    default:             return null
  }
}

function variantColors(v: ActionVariant) {
  if (v === 'danger') {
    return { border: C.danger, color: C.danger, hoverBg: 'rgba(218,20,20,0.06)' }
  }
  if (v === 'primary') {
    return { border: C.accent, color: C.accent, hoverBg: 'var(--color-warning-subtle, #fef3c7)' }
  }
  return { border: C.border, color: C.text, hoverBg: C.bgSubtle }
}

export type ActionButtonProps = {
  /** Prisma model name (e.g. "Account", "Offer") */
  model: string
  /** Row id used in the POST URL */
  id: string
  /** Action metadata from the server */
  action: EntityActionMeta
  /** Show as a compact icon-only button (per-row). Default: full-width. */
  iconOnly?: boolean
  /** Re-fetch parent list after a successful action (optional) */
  onSuccess?: (message: string) => void
  /** Initial payload values (e.g. { startBalance: '1000' }) */
  defaultPayload?: Record<string, string>
}

export function ActionButton({
  model, id, action, iconOnly, onSuccess, defaultPayload,
}: ActionButtonProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy,        setBusy]        = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [done,        setDone]        = useState(false)
  const [typeId,      setTypeId]      = useState('')
  const [checkbox,    setCheckbox]    = useState(false)
  const [payload,     setPayload]     = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const f of action.payloadSchema ?? []) {
      init[f.field] = defaultPayload?.[f.field] ?? (f.type === 'enum' ? (f.default ?? f.values[0] ?? '') : '')
    }
    return init
  })

  const colors = variantColors(action.variant)
  const IconCmp = resolveIcon(action.icon)

  function open() {
    if (busy) return
    setError(null)
    setTypeId('')
    setCheckbox(false)
    setConfirmOpen(true)
  }

  function close() {
    if (busy) return
    setConfirmOpen(false)
  }

  async function execute() {
    setBusy(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(payload)) {
        if (v === '' || v === undefined) continue
        body[k] = v
      }
      const res = await apiCall(
        `/api/admin/entities/${encodeURIComponent(model)}/${encodeURIComponent(id)}/${encodeURIComponent(action.key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.detail ? `${json.error}: ${json.detail}` : (json.error ?? `HTTP ${res.status}`))
        return
      }
      const message: string = json.message ?? 'Done'
      setDone(true)
      setTimeout(() => setDone(false), 1800)
      setConfirmOpen(false)
      onSuccess?.(message)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setBusy(false)
    }
  }

  const canConfirm =
    action.confirm.type === 'none' ||
    (action.confirm.type === 'checkbox' && checkbox) ||
    (action.confirm.type === 'type-id' && typeId === id)

  // ── Render ──
  if (iconOnly) {
    return (
      <>
        <Box
          onClick={open}
          title={action.label}
          sx={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, borderRadius: 1, cursor: 'pointer',
            border: `1px solid ${done ? C.success : C.border}`,
            color: done ? C.success : C.textMuted,
            bgcolor: done ? 'rgba(35,202,97,0.06)' : C.bgSubtle,
            transition: 'all 0.15s',
            '&:hover': { borderColor: colors.border, color: colors.color, bgcolor: colors.hoverBg },
          }}
        >
          {done
            ? <CheckIcon sx={{ fontSize: 14 }} />
            : (IconCmp ? <IconCmp sx={{ fontSize: 14 }} /> : <BoltIcon sx={{ fontSize: 14 }} />)}
        </Box>
        <ActionConfirmDialog
          open={confirmOpen}
          action={action}
          id={id}
          typeId={typeId}    setTypeId={setTypeId}
          checkbox={checkbox} setCheckbox={setCheckbox}
          payload={payload}   setPayload={setPayload}
          busy={busy}
          error={error}
          canConfirm={canConfirm}
          onClose={close}
          onConfirm={execute}
        />
      </>
    )
  }

  return (
    <>
      <Box
        onClick={open}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1,
          px: 1.5, py: 0.75, borderRadius: 1.5, cursor: 'pointer',
          border: `1px solid ${done ? C.success : colors.border}`,
          bgcolor: done ? 'rgba(35,202,97,0.06)' : 'transparent',
          color: done ? C.success : colors.color,
          transition: 'all 0.2s',
          opacity: busy ? 0.5 : 1,
          '&:hover': { bgcolor: colors.hoverBg },
        }}
      >
        {busy
          ? <CircularProgress size={14} color="inherit" />
          : done
            ? <CheckIcon sx={{ fontSize: 14 }} />
            : (IconCmp ? <IconCmp sx={{ fontSize: 14 }} /> : <BoltIcon sx={{ fontSize: 14 }} />)}
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: 'inherit' }}>
          {done ? 'Done' : action.label}
        </Typography>
      </Box>
      <ActionConfirmDialog
        open={confirmOpen}
        action={action}
        id={id}
        typeId={typeId}    setTypeId={setTypeId}
        checkbox={checkbox} setCheckbox={setCheckbox}
        payload={payload}   setPayload={setPayload}
        busy={busy}
        error={error}
        canConfirm={canConfirm}
        onClose={close}
        onConfirm={execute}
      />
    </>
  )
}

// ── Confirm dialog ────────────────────────────────────────────────────────

type DialogProps = {
  open: boolean
  action: EntityActionMeta
  id: string
  typeId: string
  setTypeId: (v: string) => void
  checkbox: boolean
  setCheckbox: (v: boolean) => void
  payload: Record<string, string>
  setPayload: (v: Record<string, string>) => void
  busy: boolean
  error: string | null
  canConfirm: boolean
  onClose: () => void
  onConfirm: () => void
}

function ActionConfirmDialog({
  open, action, id, typeId, setTypeId, checkbox, setCheckbox,
  payload, setPayload, busy, error, canConfirm, onClose, onConfirm,
}: DialogProps) {
  if (!open) return null
  const colors = variantColors(action.variant)
  return (
    <Box
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      sx={{
        position: 'fixed', inset: 0, zIndex: 1300,
        bgcolor: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        p: 2,
      }}
    >
      <Box
        onClick={e => e.stopPropagation()}
        sx={{
          width: '100%', maxWidth: 480, bgcolor: C.surface, color: C.text,
          border: `1px solid ${C.border}`, borderRadius: 2, p: 2.5,
          display: 'flex', flexDirection: 'column', gap: 1.5,
        }}
      >
        <Typography sx={{ fontSize: '0.9rem', fontWeight: 700 }}>{action.label}</Typography>
        <Typography sx={{ fontSize: '0.78rem', color: C.textMuted }}>{action.description}</Typography>

        {action.payloadSchema?.map(field => (
          <Box key={field.field} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: C.textMuted }}>
              {field.label}
            </Typography>
            {field.type === 'enum' ? (
              <TextField
                select
                size="small"
                value={payload[field.field] ?? ''}
                onChange={e => setPayload({ ...payload, [field.field]: e.target.value })}
                SelectProps={{ native: true }}
                inputProps={{ style: { fontSize: '0.78rem' } }}
              >
                {field.values.map(v => <option key={v} value={v}>{v}</option>)}
              </TextField>
            ) : (
              <TextField
                size="small"
                value={payload[field.field] ?? ''}
                onChange={e => setPayload({ ...payload, [field.field]: e.target.value })}
                inputProps={{ style: { fontSize: '0.78rem' } }}
              />
            )}
          </Box>
        ))}

        {action.confirm.type === 'type-id' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Typography sx={{ fontSize: '0.7rem', color: C.textMuted }}>
              {action.confirm.prompt}
            </Typography>
            <Typography sx={{ fontSize: '0.66rem', color: C.textMuted, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {id}
            </Typography>
            <TextField
              size="small"
              value={typeId}
              onChange={e => setTypeId(e.target.value)}
              placeholder="Type the id to confirm"
              inputProps={{ style: { fontSize: '0.78rem', fontFamily: 'monospace' } }}
            />
          </Box>
        )}

        {action.confirm.type === 'checkbox' && (
          <FormControlLabel
            control={
              <Checkbox size="small" checked={checkbox} onChange={e => setCheckbox(e.target.checked)} />
            }
            label={<Typography sx={{ fontSize: '0.74rem' }}>{action.confirm.prompt}</Typography>}
          />
        )}

        {error && <Alert severity="error" sx={{ fontSize: '0.72rem' }}>{error}</Alert>}

        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 0.5 }}>
          <Box
            onClick={onClose}
            sx={{
              px: 1.5, py: 0.75, borderRadius: 1.5, cursor: 'pointer',
              border: `1px solid ${C.border}`, color: C.textMuted,
              fontSize: '0.74rem', fontWeight: 600,
              '&:hover': { bgcolor: C.bgSubtle, color: C.text },
            }}
          >Cancel</Box>
          <Box
            onClick={canConfirm && !busy ? onConfirm : undefined}
            sx={{
              px: 1.5, py: 0.75, borderRadius: 1.5,
              cursor: canConfirm && !busy ? 'pointer' : 'not-allowed',
              border: `1px solid ${colors.border}`,
              color: '#fff', bgcolor: colors.border,
              fontSize: '0.74rem', fontWeight: 600, opacity: canConfirm ? 1 : 0.5,
              display: 'flex', alignItems: 'center', gap: 0.75,
              '&:hover': canConfirm ? { filter: 'brightness(0.92)' } : {},
            }}
          >
            {busy && <CircularProgress size={12} sx={{ color: '#fff' }} />}
            Confirm
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
