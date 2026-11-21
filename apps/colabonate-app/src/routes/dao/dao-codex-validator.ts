const REQUIRED_CODEX_SECTIONS = [
  'Purpose & Scope',
  'Membership Criteria',
  'Governance Rules',
  'Dispute Resolution Clause',
  'Sanction Levels',
  'Amendment Procedure',
  'Dissolution Clause',
]

export function validateCodexSections(content: string): {
  valid: boolean
  missingSections: string[]
} {
  const missingSections = REQUIRED_CODEX_SECTIONS.filter(
    section => !content.includes(section)
  )
  return { valid: missingSections.length === 0, missingSections }
}

export { REQUIRED_CODEX_SECTIONS }
