// Shared types for Cooperation Templates

export interface TemplateMilestone {
  title: string
  percentage: number
  description?: string
}

export interface TemplateBudgetRange {
  min: number
  max: number
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
  budgetRange?: TemplateBudgetRange | null
  images?: string[]
  terms?: string
  isPublic: boolean
  createdByPubkey: string
  createdAt?: string
}

export interface CoopTemplateFormData {
  name: string
  description: string
  cooperationType: string
  timelinePreset: string
  requiredSkills: string[]
  defaultMilestones: TemplateMilestone[]
  images: string[]
  terms: string
  isPublic: boolean
}