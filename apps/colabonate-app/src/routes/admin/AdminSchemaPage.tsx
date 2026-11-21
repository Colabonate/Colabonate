import { useState, useMemo } from 'react'
import {
  Box,
  Typography,
  Paper,
  Chip,
  Collapse,
  TextField,
  InputAdornment,
  Divider,
} from '@mui/material'
import SchemaIcon       from '@mui/icons-material/Schema'
import SearchIcon       from '@mui/icons-material/Search'
import ExpandMoreIcon   from '@mui/icons-material/ExpandMore'
import KeyIcon          from '@mui/icons-material/Key'
import LinkIcon         from '@mui/icons-material/Link'
import EventNoteIcon    from '@mui/icons-material/EventNote'
import { cn } from '@ds/utils'
import { ENTITY_CONTEXTS, totalEntityCount, type EntityContextDef, type EntityDef } from './adminEntityData'

// ── Colour token constants (same pattern as AdminKpiStrip) ────────────────────
const C = {
  text:      'var(--theme-text)',
  textMuted: 'var(--theme-text-muted)',
  border:    'var(--theme-border)',
  surface:   'var(--theme-surface)',
  bg:        'var(--theme-bg)',
  bgSubtle:  'var(--theme-bg-subtle)',
  accent:    'var(--color-warning-default, #f59e0b)',
} as const

// ── Entity field row ──────────────────────────────────────────────────────────
function FieldRow({ name, type, optional, isId, isRelation }: {
  name: string
  type: string
  optional?: boolean
  isId?: boolean
  isRelation?: boolean
}) {
  return (
    <Box sx={{
      display: 'flex',
      alignItems: 'baseline',
      gap: 1,
      py: 0.4,
      borderBottom: `1px solid ${C.border}`,
      '&:last-child': { borderBottom: 'none' },
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, flexShrink: 0 }}>
        {isId && <KeyIcon sx={{ fontSize: 10, color: C.accent }} />}
        {isRelation && <LinkIcon sx={{ fontSize: 10, color: 'var(--color-accent-3)' }} />}
        <Typography
          variant="caption"
          sx={{
            fontFamily: 'monospace',
            fontWeight: isId ? 700 : 500,
            color: isId ? C.accent : C.text,
            fontSize: '0.72rem',
          }}
        >
          {name}
        </Typography>
        {optional && (
          <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.62rem', lineHeight: 1 }}>?</Typography>
        )}
      </Box>
      <Typography
        variant="caption"
        sx={{
          fontFamily: 'monospace',
          color: isRelation ? 'var(--color-accent-3)' : C.textMuted,
          fontSize: '0.68rem',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {type}
      </Typography>
    </Box>
  )
}

// ── Entity card ───────────────────────────────────────────────────────────────
function EntityCard({ entity, color, iconColor, bgColor }: {
  entity: EntityDef
  color: string
  iconColor: string
  bgColor: string
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 2,
        borderColor: expanded ? color : C.border,
        bgcolor: C.surface,
        overflow: 'hidden',
        transition: 'border-color 0.15s',
      }}
    >
      {/* Header row */}
      <Box
        onClick={() => setExpanded(p => !p)}
        sx={{
          px: 2,
          py: 1.5,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1.5,
          '&:hover': { bgcolor: C.bgSubtle },
        }}
      >
        <Box sx={{
          width: 28, height: 28, borderRadius: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          bgcolor: bgColor,
          color: iconColor,
          mt: 0.25,
        }}>
          <SchemaIcon sx={{ fontSize: 14 }} />
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography
              sx={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.85rem', color: C.text }}
            >
              {entity.model}
            </Typography>
            {entity.adr && (
              <Chip
                label={entity.adr}
                size="small"
                sx={{
                  height: 16, fontSize: '0.58rem', fontWeight: 700,
                  bgcolor: C.bgSubtle, color: C.textMuted,
                }}
              />
            )}
            {entity.nostrKind && (
              <Chip
                icon={<EventNoteIcon sx={{ fontSize: '0.7rem !important' }} />}
                label={entity.nostrKind}
                size="small"
                sx={{
                  height: 16, fontSize: '0.58rem', fontWeight: 600,
                  bgcolor: 'rgba(157,123,237,0.10)', color: 'var(--color-accent-5)',
                }}
              />
            )}
          </Box>
          <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.72rem', lineHeight: 1.4 }}>
            {entity.description}
          </Typography>
          <Box sx={{ mt: 0.75 }}>
            <Chip
              icon={<KeyIcon sx={{ fontSize: '0.7rem !important' }} />}
              label={entity.keyField}
              size="small"
              sx={{
                height: 18, fontSize: '0.62rem', fontFamily: 'monospace',
                bgcolor: `${color}15`, color: color,
                '& .MuiChip-icon': { color: `${color} !important` },
              }}
            />
          </Box>
        </Box>

        <ExpandMoreIcon
          sx={{
            fontSize: 18, color: C.textMuted, flexShrink: 0,
            transition: 'transform 0.2s',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </Box>

      {/* Expanded: fields + relations */}
      <Collapse in={expanded}>
        <Divider sx={{ borderColor: C.border }} />
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography
            variant="overline"
            sx={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.07em', color: C.textMuted, display: 'block', mb: 0.75 }}
          >
            Fields
          </Typography>
          {entity.fields.map(f => (
            <FieldRow key={f.name} {...f} />
          ))}

          {entity.relations && entity.relations.length > 0 && (
            <Box sx={{ mt: 1.5 }}>
              <Typography
                variant="overline"
                sx={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.07em', color: C.textMuted, display: 'block', mb: 0.75 }}
              >
                Relations
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {entity.relations.map(r => (
                  <Chip
                    key={r}
                    label={r}
                    size="small"
                    sx={{
                      height: 20, fontSize: '0.65rem',
                      bgcolor: 'rgba(107,177,255,0.08)',
                      color: 'var(--color-accent-1)',
                    }}
                  />
                ))}
              </Box>
            </Box>
          )}
        </Box>
      </Collapse>
    </Paper>
  )
}

// ── Context section (expandable) ──────────────────────────────────────────────
function ContextSection({ ctx, isOpen, onToggle }: {
  ctx: EntityContextDef
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <Box>
      {/* Context header — same card style as HelpCategoryCard */}
      <Paper
        onClick={onToggle}
        className={cn(
          'flex items-center gap-3',
          'px-4 py-3',
          'rounded-xl',
          'cursor-pointer',
          'transition-all duration-150',
          'hover:-translate-y-px',
        )}
        elevation={0}
        sx={{
          bgcolor: isOpen ? ctx.bgColor : C.surface,
          border: `1px solid ${isOpen ? ctx.color : C.border}`,
          mb: isOpen ? 1.5 : 0,
          '&:hover': { boxShadow: 'var(--theme-shadow)' },
        }}
      >
        <Box sx={{
          width: 36, height: 36, borderRadius: 1.5,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: ctx.iconBg, color: ctx.iconColor, flexShrink: 0,
        }}>
          {ctx.icon}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: C.text, lineHeight: 1.2 }}>
            {ctx.title}
          </Typography>
          <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.72rem' }}>
            {ctx.description}
          </Typography>
        </Box>

        <Chip
          label={`${ctx.entities.length} models`}
          size="small"
          sx={{
            height: 20, fontSize: '0.65rem', fontWeight: 700,
            bgcolor: `${ctx.color}15`, color: ctx.color, flexShrink: 0,
          }}
        />
        <ExpandMoreIcon
          sx={{
            fontSize: 18, color: C.textMuted, flexShrink: 0,
            transition: 'transform 0.2s',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </Paper>

      <Collapse in={isOpen}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
            gap: 1.5,
            mb: 2.5,
          }}
        >
          {ctx.entities.map(entity => (
            <EntityCard
              key={entity.model}
              entity={entity}
              color={ctx.color}
              iconColor={ctx.iconColor}
              bgColor={ctx.bgColor}
            />
          ))}
        </Box>
      </Collapse>
    </Box>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function AdminSchemaPage() {
  const [search, setSearch] = useState('')
  const [openContexts, setOpenContexts] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    if (!search.trim()) return ENTITY_CONTEXTS
    const q = search.toLowerCase()
    return ENTITY_CONTEXTS
      .map(ctx => ({
        ...ctx,
        entities: ctx.entities.filter(e =>
          e.model.toLowerCase().includes(q)          ||
          e.description.toLowerCase().includes(q)    ||
          e.keyField.toLowerCase().includes(q)       ||
          (e.adr ?? '').toLowerCase().includes(q)    ||
          (e.nostrKind ?? '').toLowerCase().includes(q) ||
          e.fields.some(f =>
            f.name.toLowerCase().includes(q) ||
            f.type.toLowerCase().includes(q)
          )
        ),
      }))
      .filter(ctx => ctx.entities.length > 0)
  }, [search])

  const isSearching = search.trim().length > 0
  const contextIds  = isSearching ? new Set(filtered.map(c => c.id)) : openContexts

  function toggle(id: string) {
    if (isSearching) return
    setOpenContexts(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function expandAll() {
    setOpenContexts(new Set(ENTITY_CONTEXTS.map(c => c.id)))
  }

  function collapseAll() {
    setOpenContexts(new Set())
  }

  return (
    <Box>
      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h6" fontWeight={700} sx={{ color: C.text, mb: 0.5 }}>
            Schema Reference
          </Typography>
          <Typography variant="body2" sx={{ color: C.textMuted }}>
            {totalEntityCount()} Prisma models across {ENTITY_CONTEXTS.length} contexts — fields, relations, and Nostr event kinds
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Box
            onClick={expandAll}
            sx={{ cursor: 'pointer', color: C.textMuted, fontSize: '0.72rem', fontWeight: 600, '&:hover': { color: C.text } }}
          >
            Expand all
          </Box>
          <Typography variant="caption" sx={{ color: C.border }}>·</Typography>
          <Box
            onClick={collapseAll}
            sx={{ cursor: 'pointer', color: C.textMuted, fontSize: '0.72rem', fontWeight: 600, '&:hover': { color: C.text } }}
          >
            Collapse all
          </Box>
        </Box>
      </Box>

      {/* ── Search ── */}
      <TextField
        size="small"
        fullWidth
        placeholder="Search models, fields, relations, ADRs…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 18, color: C.textMuted }} />
            </InputAdornment>
          ),
          sx: {
            bgcolor: C.surface,
            fontSize: '0.85rem',
            '& fieldset': { borderColor: C.border },
            '&:hover fieldset': { borderColor: C.accent },
            '&.Mui-focused fieldset': { borderColor: C.accent },
          },
        }}
        sx={{ mb: 3 }}
      />

      {/* ── Legend ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2.5, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <KeyIcon sx={{ fontSize: 11, color: C.accent }} />
          <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.68rem' }}>Primary / unique key</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <LinkIcon sx={{ fontSize: 11, color: 'var(--color-accent-3)' }} />
          <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.68rem' }}>Foreign key / relation</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <EventNoteIcon sx={{ fontSize: 11, color: 'var(--color-accent-5)' }} />
          <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.68rem' }}>Nostr event kind</Typography>
        </Box>
        <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.68rem' }}>
          · Click any card to see fields
        </Typography>
      </Box>

      {/* ── Context sections ── */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {filtered.map(ctx => (
          <ContextSection
            key={ctx.id}
            ctx={ctx}
            isOpen={contextIds.has(ctx.id)}
            onToggle={() => toggle(ctx.id)}
          />
        ))}
      </Box>

      {filtered.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <SearchIcon sx={{ fontSize: 36, color: C.textMuted, mb: 1 }} />
          <Typography variant="body2" sx={{ color: C.textMuted }}>
            No entities match "{search}"
          </Typography>
        </Box>
      )}
    </Box>
  )
}
