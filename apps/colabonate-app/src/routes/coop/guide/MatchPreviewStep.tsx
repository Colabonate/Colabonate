// FU-483 (ADR-328 D2/D4) + ADR-332 D2: Match-Preview — the final Guide step
// for Projects+agent, right before Publish. Runs the already-shipped ADR-310
// D4 matching (matchAgentsToOrchestration) against the NESTED pipeline
// authored inside the Details step's milestone cards, grouped by milestone.
// The server contract stays flat (global step order); grouping is a display
// concern — steps are flattened M1.s1, M1.s2, M2.s1, … for the match request
// and mapped back by global order. Lets the buyer pick a candidate per step
// (or leave it unassigned — assignment isn't required to publish, same as a
// human cooperation not requiring milestone assignees upfront).
import { useEffect, useMemo, useRef } from 'react'
import {
  Alert, Avatar, Box, Card, CardActionArea, Chip, CircularProgress, Typography,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { CardIntro } from './CoopCreateSteps'
import { SatsAmount } from '../../../components/currency/SatsAmount'
import { useMatchAgentsToOrchestration, type OrchestrationMatchStep } from '../../../hooks/useOrchestrationMatchQueries'
import type { useCoopForm } from './useCoopForm'

type CoopFormInstance = ReturnType<typeof useCoopForm>

export function MatchPreviewStep({ form, isActive = false }: { form: CoopFormInstance; isActive?: boolean }) {
  const mutation = useMatchAgentsToOrchestration()
  const requestedFor = useRef<string>('')

  // ADR-332 D2: flatten the nested pipeline into global execution order and
  // remember where each step came from (milestoneIndex, stepIndex).
  const flatSteps = useMemo(() => {
    const out: Array<{
      order: number
      milestoneIndex: number
      stepIndex: number
      title: string
      requiredCapabilities: string[]
    }> = []
    form.milestones.forEach((m, mi) => m.steps?.forEach((s, si) => {
      if (out.length >= 20) return // MAX_STEPS guard, mirrors the editor
      out.push({
        order: out.length + 1,
        milestoneIndex: mi,
        stepIndex: si,
        title: s.title,
        requiredCapabilities: s.requiredCapabilities,
      })
    }))
    return out
  }, [form.milestones])

  // Re-run whenever the authored pipeline actually changes (not on every
  // render) — steps are compared by a cheap serialization since they're a
  // small, bounded array of primitives.
  // GATED on isActive: FormStepper keeps ALL step children mounted
  // (display:none, form-stepper.tsx) — without this gate the effect fires
  // on every keystroke in the Details step and spams the match endpoint
  // with half-authored steps (400 per keystroke).
  // Also gated on step validity: the wizard only lets valid pipelines
  // advance here, so firing on incomplete steps is pure waste.
  const stepsValid = flatSteps.length > 0
    && flatSteps.every(s => s.title.trim().length > 0 && s.requiredCapabilities.length > 0)
  useEffect(() => {
    if (!isActive || !stepsValid) return
    const key = JSON.stringify(flatSteps)
    if (requestedFor.current === key) return
    requestedFor.current = key
    const serverSteps: OrchestrationMatchStep[] = flatSteps.map((s, i) => ({
      order: s.order,
      title: s.title,
      requiredAgentCapabilities: s.requiredCapabilities,
      inputFromStep: i === 0 ? null : flatSteps[i - 1].order,
      outputToSteps: i === flatSteps.length - 1 ? [] : [flatSteps[i + 1].order],
    }))
    mutation.mutate(serverSteps)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatSteps, isActive, stepsValid])

  if (flatSteps.length === 0) {
    return (
      <Alert severity="warning">
        No pipeline steps were authored in the Details step — go back and add steps to a
        milestone before previewing matches.
      </Alert>
    )
  }

  const budget = parseInt(form.values.priceSats) || 0
  // Global order -> match result (candidates) lookup
  const matchByOrder = new Map((mutation.data?.matches ?? []).map(m => [m.step.order, m]))

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4.5 }}>
      <CardIntro
        icon={<CheckCircleIcon fontSize="small" />}
        title="Review Matched Agents"
        what="For each pipeline step inside your milestones, we show the top public agents holding the required capability, ranked by reputation and price."
        why="You stay in control of who's assigned — matching is a suggestion, not an automatic booking."
        how="Click a candidate to assign them to that step. Assignment is optional — you can publish without picking one and assign later."
      />

      {mutation.isPending && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 4, justifyContent: 'center' }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">Matching agents to your pipeline…</Typography>
        </Box>
      )}

      {mutation.isError && (
        <Alert severity="error">
          {mutation.error instanceof Error ? mutation.error.message : 'Failed to match agents.'}
        </Alert>
      )}

      {/* ADR-332 D2: grouped by milestone — the money row is the milestone's
          escrow share; the steps beneath it are the agent work inside it. */}
      {form.milestones.map((milestone, mi) => {
        const stepsInMilestone = flatSteps.filter(f => f.milestoneIndex === mi)
        return (
          <Box key={mi} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
              <Typography variant="subtitle1" fontWeight={700}>
                M{mi + 1} · {milestone.title || 'Untitled milestone'}
              </Typography>
              {budget > 0 && (
                <SatsAmount sats={Math.round(budget * milestone.percentage / 100)} size="sm" showUnit />
              )}
            </Box>

            {stepsInMilestone.map(f => {
              const match = matchByOrder.get(f.order)
              const candidates = match?.candidates ?? []
              const assignedId = form.milestones[f.milestoneIndex]?.steps?.[f.stepIndex]?.assigneeAgentProfileId
              return (
                <Box key={f.order} sx={{ pl: { xs: 0, sm: 3 } }}>
                  <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                    {f.order}. {f.title}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1.5 }}>
                    {f.requiredCapabilities.map(c => (
                      <Chip key={c} size="small" label={c} variant="outlined" />
                    ))}
                  </Box>

                  {mutation.isPending ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                      <CircularProgress size={14} />
                      <Typography variant="caption" color="text.secondary">Matching…</Typography>
                    </Box>
                  ) : candidates.length === 0 ? (
                    <Alert severity="info" sx={{ mb: 1 }}>
                      No public agents currently hold every required capability for this step. You can
                      still publish — assign an agent to this step later.
                    </Alert>
                  ) : (
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2, mb: 1.5 }}>
                      {candidates.map(c => {
                        const selected = assignedId === c.agentProfileId
                        return (
                          <Card
                            key={c.agentProfileId}
                            variant="outlined"
                            sx={{
                              borderRadius: 2,
                              borderColor: selected ? 'var(--color-primary-50)' : 'var(--theme-border)',
                              borderWidth: selected ? 2 : 1,
                              background: selected ? 'rgba(232,69,65,0.06)' : 'var(--theme-surface)',
                            }}
                          >
                            <CardActionArea
                              disabled={!c.cheapestOfferId}
                              onClick={() => c.cheapestOfferId && form.setStepAssignment(f.milestoneIndex, f.stepIndex, c.agentProfileId, c.cheapestOfferId)}
                              sx={{ p: 2, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}
                            >
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                <Avatar src={c.avatarUrl ?? undefined} sx={{ width: 32, height: 32 }}>
                                  {c.name.charAt(0).toUpperCase()}
                                </Avatar>
                                <Typography variant="body2" fontWeight={700} sx={{ flex: 1, minWidth: 0 }} noWrap>
                                  {c.name}
                                </Typography>
                                {selected && <CheckCircleIcon sx={{ fontSize: 18, color: 'var(--color-primary-50)' }} />}
                              </Box>
                              <Box sx={{ display: 'flex', gap: 1.5 }}>
                                <Typography variant="caption" color="text.secondary">
                                  ★ {c.reputationScore != null ? c.reputationScore.toFixed(1) : '—'}
                                </Typography>
                                {c.minOfferPriceSats != null && (
                                  <Typography variant="caption" color="text.secondary">
                                    from {c.minOfferPriceSats.toLocaleString()} sats
                                  </Typography>
                                )}
                              </Box>
                              {!c.cheapestOfferId && (
                                <Typography variant="caption" color="text.disabled">
                                  No active listing to book — can't be assigned yet.
                                </Typography>
                              )}
                            </CardActionArea>
                          </Card>
                        )
                      })}
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
        )
      })}
    </Box>
  )
}
