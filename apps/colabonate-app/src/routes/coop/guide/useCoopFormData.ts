// Data-fetching hook for cooperation creation forms (ADR-033, ADR-330 D6)
// Categories / companies / templates via React Query so the remount loading
// flash goes away (memory `feedback_tab_switch_caching.md`).

import { useQuery } from '@tanstack/react-query'
import { apiCall } from '../../../lib/api'
import type { CoopRole, CoopType } from './coopGuideConstants'
import type { StandardCategory } from '../../../types/api'

interface TemplateMilestone {
  title: string
  percentage: number
}

export interface CoopTemplate {
  id: string
  name: string
  description?: string
  cooperationType: string
  timelinePreset?: string
  requiredSkills: string[]
  defaultMilestones: TemplateMilestone[]
  categoryCode?: string
  // ADR-331 D3: server already returns this on /api/cooperation-templates
  // (the field lives on CooperationTemplate, ADR-310 D1). When true, the
  // CoopGuide auto-apply effect flips executor='agent' so the wizard enters
  // the orchestration flow (OrchestrationStepsEditor + Match-Preview).
  isAgentOrchestration?: boolean
}

export interface CoopFormData {
  categories: StandardCategory[]
  categoriesLoading: boolean
  companies: { id: string; name: string }[]
  templates: CoopTemplate[]
}

export function useCoopFormData(
  role: CoopRole | null,
  coopType: CoopType | null,
): CoopFormData {
  const categoriesQuery = useQuery({
    queryKey: ['standard-categories-tree'],
    queryFn: async (): Promise<StandardCategory[]> => {
      const r = await apiCall('/api/standard-categories/tree/flat')
      const data = await r.json()
      return (data.standardCategories ?? []) as StandardCategory[]
    },
    // ADR-330 D6 — categories are near-static reference data (admin-curated,
    // surfaced by the seeded standard-categories tree). 24h mirrors the existing
    // taxonomy in apps/server/services/standard-categories.ts and avoids the
    // tab-switch flash called out in feedback_tab_switch_caching.md.
    staleTime: 24 * 60 * 60 * 1000,
  })
  const categoriesLoading = categoriesQuery.isPending

  const pubkey = typeof window !== 'undefined' ? localStorage.getItem('pubkey') : null

  const companyQuery = useQuery({
    queryKey: ['my-company', pubkey],
    queryFn: async (): Promise<Array<{ id: string; name: string }>> => {
      if (!pubkey) return []
      const r = await apiCall(`/api/company/${pubkey}`)
      const data = await r.json()
      return data?.company ? [{ id: data.company.id, name: data.company.name }] : []
    },
    enabled: role === 'corporate' && !!pubkey,
  })

  const templatesQuery = useQuery({
    queryKey: ['coop-templates', pubkey],
    queryFn: async (): Promise<CoopTemplate[]> => {
      const params = new URLSearchParams()
      if (pubkey) params.set('pubkey', pubkey)
      const r = await apiCall(`/api/cooperation-templates?${params.toString()}`)
      const data = await r.json()
      return (data.templates ?? []) as CoopTemplate[]
    },
    enabled: coopType === 'projects',
  })

  return {
    categories: categoriesQuery.data ?? [],
    categoriesLoading,
    companies: companyQuery.data ?? [],
    templates: templatesQuery.data ?? [],
  }
}
