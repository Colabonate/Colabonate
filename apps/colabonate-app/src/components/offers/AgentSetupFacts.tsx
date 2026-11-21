// ADR-396 D2 (FU-849): what a buyer needs to evaluate an Agent Setup before
// booking it — until now the detail page showed only an "Agent" chip. All
// values are public: runtime is the seller's cleartext disclosure
// (agentConfigMeta.runtime), tools show name/description only (addresses stay
// sealed), scores come from the AgentProfile (ADR-307/317).
import { Box, Chip, Tooltip, Typography } from '@mui/material'
import { Bot, Cpu, Wrench, Clock, ShieldCheck, Star, BadgeCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AgentProfileSummary } from '../../types/api'

const PROVIDER_LABEL: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  ollama: 'Ollama (self-hosted)',
}

const BILLING_LABEL: Record<string, string> = {
  ONE_TIME: 'One-time price',
  PER_HOUR: 'Per hour',
  PER_TOKEN: 'Per token',
  SUBSCRIPTION: 'Subscription',
}

export interface AgentSetupFactsProps {
  profile?: AgentProfileSummary | null
  capabilities?: string[]
  /** ADR-409 D1/OD-6: providerLabel + catalogId are optional cosmetic fields — legacy offers carry flavor + model only. */
  runtime?: { provider?: string; model?: string; providerLabel?: string; catalogId?: string } | null
  billingModel?: string | null
  estimatedWorkspaceHours?: number | null
  workspaceTTLSeconds?: number | null
}

function FactRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '36px 1fr', columnGap: 1.5, alignItems: 'start' }}>
      <Box sx={{
        width: 36, height: 36, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(159,122,234,0.12)', color: '#9F7AEA',
      }}>
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', display: 'block', mb: 0.5 }}>{label}</Typography>
        <Box sx={{ color: 'var(--theme-text)', fontSize: 14, lineHeight: 1.6 }}>{children}</Box>
      </Box>
    </Box>
  )
}

export function AgentSetupFacts({
  profile, capabilities, runtime, billingModel, estimatedWorkspaceHours, workspaceTTLSeconds,
}: AgentSetupFactsProps) {
  const caps = (profile?.capabilities?.length ? profile.capabilities : capabilities) ?? []
  const tools = Array.isArray(profile?.tools) ? profile.tools.filter(t => t?.name) : []
  const ttlDays = workspaceTTLSeconds && workspaceTTLSeconds > 0 ? Math.round(workspaceTTLSeconds / 86400) : null

  return (
    <Box
      className="section-animate"
      sx={{
        p: { xs: 2.5, sm: 3 },
        borderRadius: 'var(--radius-lg, 12px)',
        background: 'var(--theme-surface)',
        border: '1px solid var(--theme-border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2.5 }}>
        <Bot size={16} style={{ color: 'var(--theme-text-muted)' }} />
        <Typography variant="subtitle2" fontWeight={700} color="text.secondary"
          sx={{ textTransform: 'uppercase', letterSpacing: 0.75, fontSize: '0.7rem' }}>
          About this agent
        </Typography>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, rowGap: 3, columnGap: 4 }}>
        <FactRow icon={<Cpu size={16} />} label="Runs on">
          {runtime?.provider && runtime.model
            ? <>
              {/* ADR-409 OD-6: the seller's readable label wins, the flavor
                  label is the legacy fallback. */}
              {runtime.providerLabel?.trim() || PROVIDER_LABEL[runtime.provider] || runtime.provider} · <code>{runtime.model}</code>
              <Typography variant="caption" component="span" sx={{ display: 'block', mt: 0.25, color: 'var(--theme-text-muted)' }}>
                Your task inputs are processed by this seller-chosen LLM provider.
              </Typography>
            </>
            : <span style={{ color: 'var(--theme-text-muted)' }}>Not disclosed by the seller</span>}
        </FactRow>

        <FactRow icon={<Star size={16} />} label="Track record">
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
            {typeof profile?.reputationScore === 'number'
              ? <span>★ {profile.reputationScore.toFixed(1)} reputation</span>
              : <span style={{ color: 'var(--theme-text-muted)' }}>No reviews yet</span>}
            {typeof profile?.trustScore === 'number' && <span>· Trust {Math.round(profile.trustScore * 100)}%</span>}
            {profile?.isVerified && (
              <Chip size="small" icon={<BadgeCheck size={13} />} label="Verified" sx={{ height: 22, fontSize: '0.7rem' }} />
            )}
            {profile?.isPioneer && <Chip size="small" label="Pioneer" sx={{ height: 22, fontSize: '0.7rem' }} />}
          </Box>
        </FactRow>

        <FactRow icon={<Bot size={16} />} label="Capabilities">
          {caps.length > 0 ? (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {caps.map(c => <Chip key={c} size="small" variant="outlined" label={c} sx={{ height: 24 }} />)}
            </Box>
          ) : <span style={{ color: 'var(--theme-text-muted)' }}>None listed</span>}
        </FactRow>

        <FactRow icon={<Wrench size={16} />} label="Tools the agent can call">
          {tools.length > 0 ? (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {tools.map(t => (
                <Tooltip key={t.name} title={t.description || ''} disableHoverListener={!t.description}>
                  <Chip size="small" variant="outlined" label={t.name} sx={{ height: 24 }} />
                </Tooltip>
              ))}
            </Box>
          ) : <span style={{ color: 'var(--theme-text-muted)' }}>No external tools — the agent works from its model and your input</span>}
        </FactRow>

        <FactRow icon={<Clock size={16} />} label="Pricing & workspace">
          <Box component="ul" sx={{ m: 0, pl: 2, display: 'grid', rowGap: 0.75 }}>
            <li>{BILLING_LABEL[billingModel ?? 'ONE_TIME'] ?? billingModel}</li>
            {estimatedWorkspaceHours ? (
              <li>
                Typical duration {estimatedWorkspaceHours} h. When the workspace starts you pre-fund its runtime for
                {' '}{estimatedWorkspaceHours} h + 30% buffer.
              </li>
            ) : null}
            {ttlDays ? <li>Results stay accessible for {ttlDays} day{ttlDays === 1 ? '' : 's'} after completion</li> : null}
          </Box>
        </FactRow>

        <FactRow icon={<ShieldCheck size={16} />} label="Human oversight">
          <Box component="ul" sx={{ m: 0, pl: 2, display: 'grid', rowGap: 0.75 }}>
            <li>{profile?.requireHumanApproval === false
              ? 'Starts automatically after payment'
              : 'The seller confirms each booking before it starts'}</li>
            {profile?.humanInLoop && <li>The seller reviews the result before you can complete the order</li>}
          </Box>
        </FactRow>
      </Box>
    </Box>
  )
}
