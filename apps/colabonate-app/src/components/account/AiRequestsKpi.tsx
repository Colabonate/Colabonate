// ADR-384: Account page section "AI Assistant" - the user's hosted-AI request
// standing as a KPI strip (requests left, used, status, mode) with a card that
// opens the shared buy dialog.
import { useState } from 'react'
import { KPIStrip } from '../kpi/KpiStrip'
import type { KPIItem } from '@ds/ui'
import BoltIcon from '@mui/icons-material/Bolt'
import HistoryIcon from '@mui/icons-material/History'
import SpeedIcon from '@mui/icons-material/Speed'
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart'
import { BuyAiCreditsDialog } from '../ai-assistant/BuyAiCreditsDialog'
import { isHostedModeActive, useAiCredits } from '../ai-assistant/useAiCredits'

const PROVIDER_LABEL: Record<string, string> = {
  platform: 'Colabonate Hosted',
  openai: 'Own API key',
  local: 'Local (Ollama)',
  adapter: 'CLI agent',
}

export function AiRequestsKpi() {
  const { remaining, used, peak, hostedEnabled } = useAiCredits()
  const [buyOpen, setBuyOpen] = useState(false)

  const loading = remaining === null
  const left = remaining ?? 0
  const low = left > 0 && left <= Math.max(1, Math.ceil(peak * 0.2))

  let status: string
  let statusColor: string | undefined
  if (left <= 0 && used === 0) {
    status = 'Not started'
  } else if (left <= 0) {
    status = 'Out of requests'
    statusColor = 'text-[var(--color-status-error)]'
  } else if (low) {
    status = 'Running low'
    statusColor = 'text-[#eab308]'
  } else {
    status = isHostedModeActive() ? 'Active' : 'Ready'
    statusColor = 'text-[var(--color-status-success)]'
  }

  const provider = localStorage.getItem('aiProvider') ?? 'openai'

  const items: KPIItem[] = [
    { icon: <BoltIcon />, value: left, label: 'Requests left', color: statusColor, tooltip: 'Hosted AI requests you can still use' },
    { icon: <HistoryIcon />, value: used, label: 'Requests used', tooltip: 'Hosted AI requests you have used so far' },
    { icon: <SpeedIcon />, value: status, label: 'Status', color: statusColor },
    { icon: <BoltIcon />, value: PROVIDER_LABEL[provider] ?? provider, label: 'Assistant mode' },
    // Hard gate (ADR-384): no buy card while hosted AI is not switched on.
    ...(hostedEnabled ? [{
      icon: <ShoppingCartIcon />,
      value: left <= 0 ? 'Buy credits' : 'Buy more',
      label: 'AI requests',
      onClick: () => setBuyOpen(true),
      tooltip: 'Open the credit packs',
    }] : []),
  ]

  return (
    <>
      <KPIStrip items={items} loading={loading} skeletonCount={hostedEnabled ? 5 : 4} wrap />
      <BuyAiCreditsDialog open={buyOpen} onClose={() => setBuyOpen(false)} />
    </>
  )
}
