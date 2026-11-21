import { useState } from 'react'
import {
  Box,
  Button,
  ButtonGroup,
  Collapse,
  Grid,
  IconButton,
  InputAdornment,
  LinearProgress,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import type { MilestoneFormItem } from './offerFormConstants'
import { RichDescriptionEditor } from './RichDescriptionEditor'

export interface MilestoneEditorProps {
  milestones: MilestoneFormItem[]
  onMilestonesChange: React.Dispatch<React.SetStateAction<MilestoneFormItem[]>>
  /** Accent colour for numbering – defaults to 'primary' */
  color?: 'primary' | 'secondary'
  /** Section heading label */
  label?: string
  /** Descriptive text below the heading */
  description?: string
  /** Label for the title field */
  titleLabel?: string
  /** Label for the description field */
  descLabel?: string
  /** Label for the add button */
  addLabel?: string
  /** Placeholder for the title field */
  titlePlaceholder?: string
  /** Whether the editor is currently visible */
  visible?: boolean
  /** ADR-332 D2: optional per-milestone slot rendered below the title/%/
   *  description fields, inside the milestone card. The Coop Guide's agent
   *  flow mounts the per-milestone "Agent Pipeline" editor here; all other
   *  consumers pass nothing and render exactly as before. */
  renderMilestoneExtras?: (milestoneIndex: number, milestone: MilestoneFormItem) => React.ReactNode
  /** Opt-in: render the description as the ADR-295 WYSIWYG rich text editor
   *  (same component as the guide's Title & Description step) instead of a
   *  plain TextField. Default false — offer flows keep plain descriptions. */
  richDescription?: boolean
}

export function MilestoneEditor({
  milestones,
  onMilestonesChange,
  color = 'primary',
  label = 'Milestones',
  description,
  titleLabel = 'Title',
  descLabel = 'Description (optional)',
  addLabel = '+ Add milestone',
  titlePlaceholder,
  visible = true,
  renderMilestoneExtras,
  richDescription = false,
}: MilestoneEditorProps) {
  const total = milestones.reduce((s, m) => s + (m.percentage || 0), 0)

  const PERCENT_PRESETS = [25, 50, 75, 100] as const

  // Index-keyed collapse state (milestone objects are re-created on every
  // keystroke, so object identity is not a stable key). removeMilestone
  // shifts indices > i down by one so cards keep their expand state.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  function toggleCollapsed(i: number) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  function update(i: number, field: keyof MilestoneFormItem, value: string | number) {
    onMilestonesChange(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: value } : m))
  }

  function setPercentage(i: number, value: number) {
    update(i, 'percentage', Math.min(100, Math.max(0, Math.round(value))))
  }

  function stepPercentage(i: number, current: number, delta: number) {
    // Step on the 25% preset grid — manual inputs like 37 snap to the next /
    // previous multiple of 25 instead of drifting off-grid.
    const next = delta > 0
      ? (Math.floor(current / 25) + 1) * 25
      : (Math.ceil(current / 25) - 1) * 25
    setPercentage(i, next)
  }

  function removeMilestone(i: number) {
    onMilestonesChange(prev => prev.filter((_, idx) => idx !== i))
    setCollapsed(prev => {
      const next = new Set<number>()
      prev.forEach(idx => {
        if (idx < i) next.add(idx)
        else if (idx > i) next.add(idx - 1)
      })
      return next
    })
  }

  if (!visible) return null

  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={600} color="text.secondary" gutterBottom>
        {label}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {description}
        </Typography>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {milestones.map((m, i) => {
          const isCollapsed = collapsed.has(i)
          return (
            <Paper
              key={i}
              variant="outlined"
              sx={{
                // Subtle radial primary tint (ADR-332 follow-up styling): makes
                // each milestone card read as its own section inside the
                // Details step. --theme-bg-elevated is one step lighter than
                // the page surface in BOTH themes; the rgba overlay follows the
                // codebase's alpha-literal convention (tokens carry no alpha
                // variants).
                overflow: 'hidden',
                backgroundColor: 'var(--theme-bg-elevated)',
                backgroundImage:
                  'radial-gradient(130% 110% at 0% 0%, rgba(232,69,65,0.06) 0%, rgba(232,69,65,0.02) 40%, transparent 65%)',
              }}
            >
              {/* Collapsible header row. The toggle area (badge + live title +
                  % + chevron) is one button; Delete sits beside it as a
                  sibling — a button inside a button would be invalid HTML
                  and break the toggle click. */}
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Box
                  component="button"
                  type="button"
                  onClick={() => toggleCollapsed(i)}
                  aria-expanded={!isCollapsed}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    flex: 1,
                    minWidth: 0,
                    border: 'none',
                    bgcolor: 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    px: 3,
                    py: 2,
                    '&:focus-visible': { outline: '2px solid', outlineColor: `${color}.main`, outlineOffset: -2 },
                  }}
                >
                  <Box
                    sx={{
                      // Milestone number as a label badge: accent-colored square,
                      // white bold number — reads clearly against the tinted card.
                      minWidth: 28,
                      height: 28,
                      px: 0.75,
                      borderRadius: 1,
                      bgcolor: `${color}.main`,
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.9rem',
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      fontWeight={700}
                      sx={{
                        color: 'var(--theme-text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {m.title || `Milestone ${i + 1}`}
                    </Typography>
                  </Box>
                  <Typography
                    variant="body2"
                    fontWeight={700}
                    sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}
                  >
                    {m.percentage}%
                  </Typography>
                  <ExpandMoreIcon
                    sx={{
                      fontSize: 20,
                      flexShrink: 0,
                      color: 'text.secondary',
                      transform: isCollapsed ? 'none' : 'rotate(180deg)',
                      transition: 'transform 0.2s',
                    }}
                  />
                </Box>
                {milestones.length > 1 && (
                  <Button
                    size="small"
                    color="error"
                    variant="text"
                    startIcon={<DeleteIcon />}
                    aria-label={`Delete milestone ${i + 1}`}
                    onClick={() => removeMilestone(i)}
                    sx={{ mr: 2, ml: 1, flexShrink: 0 }}
                  >
                    Delete
                  </Button>
                )}
              </Box>
              <Collapse in={!isCollapsed}>
                {/* pt: 2 — clear air between the header row and the title
                    line; the collapsed header already carries the summary. */}
                <Box sx={{ px: 3, pb: 3, pt: 2, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                  {/* One line: title | % input | presets */}
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <TextField
                      label={titleLabel}
                      value={m.title}
                      onChange={e => update(i, 'title', e.target.value)}
                      size="small"
                      required
                      placeholder={titlePlaceholder}
                      sx={{ flex: 1, minWidth: 220 }}
                    />
                    <TextField
                      label="%"
                      type="number"
                      value={m.percentage}
                      onChange={e => setPercentage(i, parseInt(e.target.value) || 0)}
                      size="small"
                      required
                      sx={{
                        width: 150,
                        flexShrink: 0,
                        // Hide the native number-input spinners — stepping is
                        // handled by the MUI IconButtons in the adornments.
                        '& input': {
                          fontVariantNumeric: 'tabular-nums',
                          textAlign: 'center',
                          appearance: 'textfield',
                          MozAppearance: 'textfield',
                        },
                        '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': {
                          WebkitAppearance: 'none',
                          margin: 0,
                        },
                      }}
                      slotProps={{
                        htmlInput: { min: 0, max: 100, step: 25 },
                        input: {
                          startAdornment: (
                            <InputAdornment position="start">
                              <IconButton
                                size="small"
                                aria-label={`Decrease milestone ${i + 1} share`}
                                disabled={m.percentage <= 0}
                                onClick={() => stepPercentage(i, m.percentage, -25)}
                              >
                                <RemoveIcon fontSize="small" />
                              </IconButton>
                            </InputAdornment>
                          ),
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                size="small"
                                aria-label={`Increase milestone ${i + 1} share`}
                                disabled={m.percentage >= 100}
                                onClick={() => stepPercentage(i, m.percentage, 25)}
                              >
                                <AddIcon fontSize="small" />
                              </IconButton>
                            </InputAdornment>
                          ),
                        },
                      }}
                    />
                    {/* Presets as a ButtonGroup on the same row as the %
                        input; contained marks the active preset. */}
                    <ButtonGroup
                      size="small"
                      variant="outlined"
                      aria-label={`Quick share presets for milestone ${i + 1}`}
                      sx={{ mt: 0.5, flexShrink: 0 }}
                    >
                      {PERCENT_PRESETS.map(p => (
                        <Button
                          key={p}
                          variant={m.percentage === p ? 'contained' : 'outlined'}
                          aria-label={`Set ${p}%`}
                          aria-pressed={m.percentage === p}
                          onClick={() => setPercentage(i, p)}
                          sx={{ px: 1.25, fontVariantNumeric: 'tabular-nums' }}
                        >
                          {p}%
                        </Button>
                      ))}
                    </ButtonGroup>
                  </Box>
                  {/* Description | Agent Pipeline side by side from lg (900px,
                      project breakpoint scale); stacked single column on
                      mobile. ADR-365 D5: without an extras slot (human flows —
                      e.g. Corporate Tenders Create Tender) the description
                      takes the full row width instead of leaving an empty
                      half-column. The pipeline editor carries its own header +
                      subtext in every view. */}
                  <Grid container spacing={3}>
                    {/* display:flex + flex:1 chain so the description editor
                        stretches to the full column height next to a taller
                        pipeline column. */}
                    <Grid size={{ xs: 12, lg: renderMilestoneExtras ? 6 : 12 }} sx={{ display: 'flex' }}>
                      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        {richDescription ? (
                          <RichDescriptionEditor
                            label={descLabel}
                            value={m.description}
                            onChange={html => update(i, 'description', html)}
                            aiContext={{
                              title: m.title || `Milestone ${i + 1}`,
                              offerType: 'MILESTONE',
                            }}
                            fillHeight
                          />
                        ) : (
                          <TextField
                            label={descLabel}
                            value={m.description}
                            onChange={e => update(i, 'description', e.target.value)}
                            size="small"
                            fullWidth
                            multiline
                            minRows={4}
                          />
                        )}
                      </Box>
                    </Grid>
                    {renderMilestoneExtras && (
                      <Grid size={{ xs: 12, lg: 6 }}>
                        {renderMilestoneExtras(i, m)}
                      </Grid>
                    )}
                  </Grid>
                </Box>
              </Collapse>
            </Paper>
          )
        })}
      </Box>
      {/* Solid contained CTA — the primary action of this block; dashed
          ghost styling read as muted/disabled. Spacing rhythm: cards gap 2 →
          button mt 1.5 (tight to list it extends) → progress mt 2. */}
      <Button
        type="button"
        fullWidth
        variant="contained"
        color={color}
        startIcon={<AddIcon />}
        onClick={() => onMilestonesChange(prev => [...prev, { title: '', description: '', percentage: 0 }])}
        sx={{
          mt: 1.5,
          borderRadius: 1.5,
          py: 1.25,
          fontWeight: 700,
          fontSize: '0.875rem',
          textTransform: 'none',
        }}
      >
        {addLabel}
      </Button>
      {/* Allocation progress replaces the old always-on Alert: neutral at 0%,
          live bar + icon + count while authoring, success state at exactly
          100%. Hidden when the list is empty (no noise on pristine form). */}
      {milestones.length > 0 && (
        <Box sx={{ mt: 2 }} role="status" aria-live="polite">
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>
              Total allocation — must sum to 100%
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {total === 100 && (
                <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} aria-hidden />
              )}
              {total !== 100 && (
                <ErrorOutlineIcon sx={{ fontSize: 16, color: 'warning.main' }} aria-hidden />
              )}
              <Typography
                variant="caption"
                fontWeight={700}
                sx={{ color: total === 100 ? 'success.main' : 'warning.main', fontVariantNumeric: 'tabular-nums' }}
              >
                {total}%
                {total !== 100 && ` · ${Math.abs(100 - total)}% ${total < 100 ? 'remaining' : 'over'}`}
              </Typography>
            </Box>
          </Box>
          <LinearProgress
            variant="determinate"
            value={Math.min(Math.max(total, 0), 100)}
            color={total === 100 ? 'success' : 'warning'}
            sx={{ height: 6, borderRadius: 3 }}
            aria-label={`Milestone allocation ${total}% of 100%`}
          />
        </Box>
      )}
    </Box>
  )
}
