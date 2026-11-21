// YAML-frontmatter + markdown-body split, used by both agents/*.persona.md
// and skills/<name>/SKILL.md (spec: content delimited by `---` lines).

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export interface SplitDocument {
  frontmatter: string
  body: string
}

export function splitFrontmatter(content: string): SplitDocument | null {
  const match = FRONTMATTER_RE.exec(content)
  if (!match) return null
  return { frontmatter: match[1] ?? '', body: match[2] ?? '' }
}
