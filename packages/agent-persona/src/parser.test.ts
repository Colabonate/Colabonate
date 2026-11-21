import { describe, it, expect } from 'vitest'
import {
  parsePersonaPack,
  resolveMcpServersForPersona,
  resolveEffectiveConfig,
  computePersonaPackHash,
  verifyPersonaPackHash,
} from './parser.js'

function validPluginJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'code-review-pack',
    name: 'Code Review Pack',
    version: '1.0.0',
    personas: ['agents/reviewer.persona.md'],
    defaults: { model: 'anthropic:claude-sonnet-4-20250514', temperature: 0.5 },
    ...overrides,
  })
}

function validPersonaMd(overrides: Record<string, unknown> = {}) {
  const fm: Record<string, unknown> = {
    name: 'reviewer',
    display_name: 'Code Reviewer',
    description: 'Reviews pull requests for correctness and style.',
    skills: ['./skills/code-review/'],
    ...overrides,
  }
  const yamlLines = Object.entries(fm).map(([k, v]) => {
    if (Array.isArray(v)) return `${k}:\n${v.map(x => `  - "${x}"`).join('\n')}`
    if (typeof v === 'string') return `${k}: "${v}"`
    return `${k}: ${JSON.stringify(v)}`
  })
  return `---\n${yamlLines.join('\n')}\n---\nYou are a meticulous code reviewer. Focus on correctness first.`
}

function validSkillMd() {
  return `---\nname: "code-review"\ndescription: "How to review a diff for correctness and style."\n---\nRead the diff, then flag anything unsafe.`
}

function basePack(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    '.plugin/plugin.json': validPluginJson(),
    'agents/reviewer.persona.md': validPersonaMd(),
    'skills/code-review/SKILL.md': validSkillMd(),
    'instructions.md': 'Follow the team style guide.',
    ...overrides,
  }
}

describe('parsePersonaPack', () => {
  it('parses a valid minimal pack', () => {
    const result = parsePersonaPack(basePack())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pack.manifest.id).toBe('code-review-pack')
    expect(result.pack.personas).toHaveLength(1)
    expect(result.pack.personas[0]?.frontmatter.name).toBe('reviewer')
    expect(result.pack.personas[0]?.systemPrompt).toContain('meticulous code reviewer')
    expect(result.pack.skills).toHaveLength(1)
    expect(result.pack.skills[0]?.name).toBe('code-review')
    expect(result.pack.instructions).toBe('Follow the team style guide.')
    expect(result.warnings).toHaveLength(0)
  })

  it('fails when plugin.json is missing', () => {
    const files = basePack()
    delete files['.plugin/plugin.json']
    const result = parsePersonaPack(files)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toContain('.plugin/plugin.json')
  })

  it('fails on invalid JSON in plugin.json', () => {
    const result = parsePersonaPack(basePack({ '.plugin/plugin.json': '{ not json' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toContain('invalid JSON')
  })

  it('fails when plugin.json has no personas array', () => {
    const result = parsePersonaPack(basePack({ '.plugin/plugin.json': validPluginJson({ personas: [] }) }))
    expect(result.ok).toBe(false)
  })

  it('fails when a referenced persona file is missing from the pack', () => {
    const files = basePack()
    delete files['agents/reviewer.persona.md']
    const result = parsePersonaPack(files)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toContain('not found in the pack')
  })

  it('fails on malformed YAML frontmatter', () => {
    const result = parsePersonaPack(basePack({ 'agents/reviewer.persona.md': '---\nname: [unterminated\n---\nbody' }))
    expect(result.ok).toBe(false)
  })

  it('fails when persona frontmatter is missing required fields', () => {
    const badPersona = `---\nname: "reviewer"\n---\nbody`
    const result = parsePersonaPack(basePack({ 'agents/reviewer.persona.md': badPersona }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toContain('validation failed')
  })

  it('fails when persona name is not lowercase-hyphen', () => {
    const result = parsePersonaPack(basePack({ 'agents/reviewer.persona.md': validPersonaMd({ name: 'Code Reviewer' }) }))
    expect(result.ok).toBe(false)
  })

  it('fails on duplicate persona names within a pack', () => {
    const files = basePack({
      '.plugin/plugin.json': validPluginJson({ personas: ['agents/a.persona.md', 'agents/b.persona.md'] }),
      'agents/a.persona.md': validPersonaMd({ name: 'reviewer' }),
      'agents/b.persona.md': validPersonaMd({ name: 'reviewer' }),
    })
    const result = parsePersonaPack(files)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some(e => e.includes('duplicate persona name'))).toBe(true)
  })

  it('silently skips (as a warning, not an error) a skill missing name/description', () => {
    const files = basePack({ 'skills/broken/SKILL.md': '---\nname: "broken"\n---\nno description field' })
    const result = parsePersonaPack(files)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pack.skills.some(s => s.path === 'skills/broken/SKILL.md')).toBe(false)
    expect(result.warnings.some(w => w.path === 'skills/broken/SKILL.md')).toBe(true)
  })

  it('warns when a persona references a skill that does not exist', () => {
    const files = basePack({ 'agents/reviewer.persona.md': validPersonaMd({ skills: ['./skills/does-not-exist/'] }) })
    const result = parsePersonaPack(files)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.some(w => w.message.includes('does-not-exist'))).toBe(true)
  })

  it('parses .mcp.json and validates its shape', () => {
    const files = basePack({
      '.mcp.json': JSON.stringify({ mcpServers: { shell: { command: 'buzz-dev-mcp', args: ['--shell'] } } }),
    })
    const result = parsePersonaPack(files)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pack.mcpConfig?.mcpServers.shell?.command).toBe('buzz-dev-mcp')
  })

  it('fails on invalid .mcp.json shape', () => {
    const files = basePack({ '.mcp.json': JSON.stringify({ mcpServers: { shell: { args: ['--shell'] } } }) })
    const result = parsePersonaPack(files)
    expect(result.ok).toBe(false)
  })

  it('parses hooks/hooks.json when present', () => {
    const files = basePack({ 'hooks/hooks.json': JSON.stringify({ on_start: './hooks/setup.sh', on_stop: null }) })
    const result = parsePersonaPack(files)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pack.hooksConfig?.on_start).toBe('./hooks/setup.sh')
  })

  it('returns null instructions when instructions.md is absent', () => {
    const files = basePack()
    delete files['instructions.md']
    const result = parsePersonaPack(files)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pack.instructions).toBeNull()
  })
})

describe('resolveMcpServersForPersona', () => {
  it('merges pack-level and persona-level servers, persona wins on name collision', () => {
    const files = basePack({
      '.mcp.json': JSON.stringify({
        mcpServers: {
          shell: { command: 'buzz-dev-mcp', args: ['--shell'] },
          fs: { command: 'buzz-dev-mcp', args: ['--fs'] },
        },
      }),
      'agents/reviewer.persona.md': `---\nname: "reviewer"\ndisplay_name: "Code Reviewer"\ndescription: "desc"\nmcp_servers:\n  - name: "shell"\n    command: "custom-shell-mcp"\n---\nbody`,
    })
    const result = parsePersonaPack(files)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const merged = resolveMcpServersForPersona(result.pack, result.pack.personas[0]!)
    expect(merged.get('shell')?.command).toBe('custom-shell-mcp')
    expect(merged.get('shell')?.args).toBeUndefined() // full replace, not partial merge
    expect(merged.get('fs')?.command).toBe('buzz-dev-mcp')
  })
})

describe('resolveEffectiveConfig', () => {
  it('persona frontmatter overrides pack defaults per-field', () => {
    const files = basePack({
      'agents/reviewer.persona.md': validPersonaMd({ temperature: 0.1 }),
    })
    const result = parsePersonaPack(files)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const config = resolveEffectiveConfig(result.pack, result.pack.personas[0]!)
    expect(config.temperature).toBe(0.1)
    expect(config.model).toBe('anthropic:claude-sonnet-4-20250514') // inherited from pack defaults
  })

  it('falls back to hardcoded defaults when neither pack nor persona set a field', () => {
    const files = basePack({ '.plugin/plugin.json': validPluginJson({ defaults: undefined }) })
    const result = parsePersonaPack(files)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const config = resolveEffectiveConfig(result.pack, result.pack.personas[0]!)
    expect(config.temperature).toBe(0.7)
    expect(config.thread_replies).toBe(true)
  })
})

describe('persona pack hash', () => {
  it('is stable regardless of key insertion order', () => {
    const a = { b: '2', a: '1' }
    const b = { a: '1', b: '2' }
    expect(computePersonaPackHash(a)).toBe(computePersonaPackHash(b))
  })

  it('changes when content changes', () => {
    const h1 = computePersonaPackHash({ 'a.md': 'hello' })
    const h2 = computePersonaPackHash({ 'a.md': 'hello!' })
    expect(h1).not.toBe(h2)
  })

  it('verifyPersonaPackHash matches a correct hash and rejects a wrong one', () => {
    const files = { 'a.md': 'hello' }
    const hash = computePersonaPackHash(files)
    expect(verifyPersonaPackHash(files, hash)).toBe(true)
    expect(verifyPersonaPackHash(files, hash.toUpperCase())).toBe(true)
    expect(verifyPersonaPackHash({ 'a.md': 'goodbye' }, hash)).toBe(false)
  })
})
