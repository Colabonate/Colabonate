// ADR-332 D2 (V2 nested pipeline): per-milestone "Agent Pipeline" editor —
// renders INSIDE a milestone card (MilestoneEditor's renderMilestoneExtras
// slot). Mirrors the capability-chip input pattern already built twice
// (CreateAgentPage.tsx, CreateBountyPage.tsx): a text input + Add button
// feeding a Chip list, not a new shared component. Deliberately linear, not
// a DAG editor — order is array position (stepIndex) within the milestone;
// the global execution order for matching is derived by flattening
// M1.s1, M1.s2, M2.s1, … in useCoopForm.
import { useState } from 'react'
import { Box, Chip, IconButton, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import BotIcon from '@mui/icons-material/SmartToyOutlined'
import type { MilestoneStepDraft } from '../../../components/offers/offerFormConstants'

const MAX_STEPS = 20

export function OrchestrationStepsEditor({
  steps,
  onChange,
}: {
  steps: MilestoneStepDraft[]
  onChange: (steps: MilestoneStepDraft[]) => void
}) {
  const [capabilityInputs, setCapabilityInputs] = useState<Record<number, string>>({})

  function addStep() {
    if (steps.length >= MAX_STEPS) return
    onChange([...steps, { title: '', requiredCapabilities: [] }])
  }

  function removeStep(index: number) {
    onChange(steps.filter((_, i) => i !== index))
  }

  function updateTitle(index: number, title: string) {
    onChange(steps.map((s, i) => (i === index ? { ...s, title } : s)))
  }

  function addCapability(index: number) {
    const trimmed = (capabilityInputs[index] ?? '').trim()
    if (!trimmed) return
    onChange(steps.map((s, i) =>
      i === index && !s.requiredCapabilities.includes(trimmed)
        ? { ...s, requiredCapabilities: [...s.requiredCapabilities, trimmed] }
        : s,
    ))
    setCapabilityInputs(prev => ({ ...prev, [index]: '' }))
  }

  function removeCapability(index: number, capability: string) {
    onChange(steps.map((s, i) =>
      i === index ? { ...s, requiredCapabilities: s.requiredCapabilities.filter(c => c !== capability) } : s,
    ))
  }

  return (
    <Box
      sx={{
        // ADR-332 follow-up styling: the pipeline zone is its own visual
        // section inside the milestone card — light elevated base + a subtle
        // radial layer in the app-wide agent purple (#9F7AEA, see
        // EXECUTOR_OPTIONS / Bot badges). Step boxes below sit on
        // --theme-surface so they read raised against this tint.
        p: 3,
        borderRadius: 2,
        backgroundColor: 'var(--theme-bg-elevated)',
        backgroundImage:
          'radial-gradient(130% 110% at 0% 0%, rgba(159,122,234,0.09) 0%, rgba(159,122,234,0.03) 40%, transparent 65%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2.5,
      }}
    >
      {/* gap 2.5 (10px at the app's 4px spacing unit) matches the guide's
          SectionHeader / NumberedSectionHeader icon-to-title distance. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: '10px',
            bgcolor: 'rgba(159,122,234,0.14)',
            color: '#9F7AEA',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <BotIcon sx={{ fontSize: 18 }} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ lineHeight: 1.3, display: 'block', color: 'var(--theme-text)' }}>
            Agent Pipeline
          </Typography>
          {/* agent-pipeline-subtitle: index.css exception that zeroes the
              guide-page caption rhythm margin — without it the 16px phantom
              margin inflates this block and knocks the header out of
              alignment with the 32px icon badge. */}
          <Typography
            variant="caption"
            className="agent-pipeline-subtitle"
            color="text.secondary"
            sx={{ lineHeight: 1.3, display: 'block' }}
          >
            Agent work assigned to this milestone
          </Typography>
        </Box>
      </Box>
      {steps.map((step, index) => (
        <Box
          key={index}
          sx={{ p: 2.5, borderRadius: 2, border: '1px solid var(--theme-border)', display: 'flex', flexDirection: 'column', gap: 2, background: 'var(--theme-surface)' }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
            <Box
              sx={{
                // Step number as a label badge in the app-wide agent purple
                // (#9F7AEA, see EXECUTOR_OPTIONS / Bot badges), white bold
                // number — mirrors the milestone number badge one level up.
                minWidth: 26,
                height: 26,
                px: 0.5,
                borderRadius: 1,
                bgcolor: '#9F7AEA',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.8rem',
                fontWeight: 700,
                flexShrink: 0,
                mt: 0.5,
              }}
            >
              {index + 1}
            </Box>
            <TextField
              size="small" fullWidth label={`Step ${index + 1} name *`}
              placeholder="e.g. Research, Draft copy, Generate images…"
              value={step.title}
              onChange={e => updateTitle(index, e.target.value)}
            />
            <IconButton size="small" onClick={() => removeStep(index)} aria-label="Remove step">
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Box>

          <Box sx={{ pl: 4.5 }}>
            <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5 }}>
              <TextField
                size="small" fullWidth placeholder="Required capability, e.g. research, writing…"
                value={capabilityInputs[index] ?? ''}
                onChange={e => setCapabilityInputs(prev => ({ ...prev, [index]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCapability(index) } }}
              />
              <IconButton size="small" onClick={() => addCapability(index)} aria-label="Add capability">
                <AddIcon fontSize="small" />
              </IconButton>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {step.requiredCapabilities.map(c => (
                <Chip key={c} size="small" label={c} onDelete={() => removeCapability(index, c)} />
              ))}
            </Box>
          </Box>
        </Box>
      ))}

      {steps.length === 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>
          No pipeline steps yet. Add steps to assign agent work to this milestone. A milestone
          without steps is executed by humans.
        </Typography>
      )}

      <Box
        component="button"
        type="button"
        onClick={addStep}
        disabled={steps.length >= MAX_STEPS}
        sx={{
          px: 2, py: 1.5, borderRadius: 2, border: '1px dashed var(--theme-border)',
          background: 'transparent', color: 'var(--theme-text-muted)', cursor: 'pointer',
          fontWeight: 600, fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center',
          '&:hover': { borderColor: 'var(--color-primary-50)', color: 'var(--color-primary-50)' },
          '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
        }}
      >
        <AddIcon fontSize="small" /> Add pipeline step
      </Box>
    </Box>
  )
}
