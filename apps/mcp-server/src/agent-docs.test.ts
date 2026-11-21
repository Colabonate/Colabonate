// ADR-414 — drift guard for the public agent-facing files.
//
// `public/agents.md` and `public/llms.txt` are hand-written, but every
// concrete claim in them is checkable against code: the MCP tool names it
// lists must exist, and every internal URL it links must resolve to a real
// public route or static file. This test fails the build when either drifts.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = join(here, '..', '..', 'colabonate-app')
const read = (p: string) => readFileSync(p, 'utf8')

const agentsMd = read(join(appDir, 'public', 'agents.md'))
const llmsTxt = read(join(appDir, 'public', 'llms.txt'))

const ORIGIN = 'https://colabonate.app'
// Files nginx serves from public/ and a few routes/endpoints that are real but
// intentionally not in the prerender list (auth-gated page / API / MCP).
const STATIC_AND_SPECIAL = new Set([
  '/llms.txt',
  '/agents.md',
  '/robots.txt',
  '/sitemap.xml',
  '/ai/connect',
  '/api/mcp/pricing',
  '/mcp',
  // Generated at build time by scripts/skills-index.mjs (not present in public/).
  '/.well-known/agent-skills/index.json',
  '/.well-known/skills/index.json',
  // MCP server card (public/mcp/server-card.json served at /mcp/server-card) + the generated AI catalog.
  '/mcp/server-card',
  '/.well-known/ai-catalog.json',
])
const publicDir = join(appDir, 'public')
/** Real static files under public/ (skill files, etc.). */
const isPublicFile = (p: string) => existsSync(join(publicDir, p)) && statSync(join(publicDir, p)).isFile()

/** Registered MCP tool names, read from the tool sources. */
function registeredToolNames(): Set<string> {
  const dir = join(here, 'tools')
  const names = new Set<string>()
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue
    for (const m of read(join(dir, f)).matchAll(/registerTool\(\s*'([a-z_]+)'/g)) names.add(m[1])
  }
  return names
}

async function publicRoutePaths(): Promise<Set<string>> {
  const url = pathToFileURL(join(appDir, 'scripts', 'seo-routes.mjs')).href
  const mod = (await import(/* @vite-ignore */ url)) as { PUBLIC_ROUTES: { path: string }[] }
  return new Set(mod.PUBLIC_ROUTES.map((r) => r.path))
}

function internalPaths(doc: string): string[] {
  const out = new Set<string>()
  for (const m of doc.matchAll(/https:\/\/colabonate\.app(\/[^\s)>"'`]*)?/g)) {
    const raw = m[1] ?? '/'
    out.add(raw.split(/[?#]/)[0].replace(/[.,;:]+$/, '') || '/')
  }
  return [...out]
}

describe('agent-facing docs (ADR-414)', () => {
  it('every snake_case tool name in agents.md is a registered MCP tool', () => {
    const registered = registeredToolNames()
    expect(registered.size).toBeGreaterThan(30)
    const mentioned = [...agentsMd.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1])
    expect(mentioned.length).toBeGreaterThan(20)
    const unknown = [...new Set(mentioned)].filter((n) => !registered.has(n))
    expect(unknown).toEqual([])
  })

  it('every internal URL in agents.md and llms.txt resolves to a real route or file', async () => {
    const routes = await publicRoutePaths()
    for (const [label, doc] of [['agents.md', agentsMd], ['llms.txt', llmsTxt]] as const) {
      const dead = internalPaths(doc).filter((p) => !routes.has(p) && !STATIC_AND_SPECIAL.has(p) && !isPublicFile(p))
      expect({ file: label, dead }).toEqual({ file: label, dead: [] })
    }
  })

  it('agents.md never links to a non-production origin', () => {
    expect(agentsMd).not.toMatch(/beta\.colabonate\.app|localhost|127\.0\.0\.1/)
  })

  it('keeps the ESCROW-COPY marker and does not claim live escrow (ADR-397)', () => {
    expect(agentsMd).toContain('ESCROW-COPY')
    expect(agentsMd).toMatch(/not live/i)
    expect(agentsMd).not.toMatch(/funds? (is|are) held in escrow/i)
  })

  it('llms.txt advertises agents.md', () => {
    expect(llmsTxt).toContain(`${ORIGIN}/agents.md`)
  })
})

// ── D7–D9: the hosted skill ──────────────────────────────────────────────────

const skillDir = join(publicDir, '.well-known', 'agent-skills', 'colabonate')

function skillFiles(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...skillFiles(full, base))
    else out.push(full.slice(base.length + 1))
  }
  return out.sort()
}

/** Every `.ts` file under a server tree (no node_modules, no tests). */
function serverSources(): string {
  const roots = [join(here, '..', '..', 'server'), join(here, '..', '..', 'mcp-server', 'src')]
  const chunks: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist') continue
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) chunks.push(readFileSync(full, 'utf8'))
    }
  }
  roots.forEach(walk)
  return chunks.join('\n')
}

describe('hosted skill `colabonate` (ADR-414 D7–D9)', () => {
  const skillMd = read(join(skillDir, 'SKILL.md'))
  const files = skillFiles(skillDir)
  const allText = files.map((f) => read(join(skillDir, f))).join('\n')

  it('has valid agentskills.io frontmatter', async () => {
    const { parseFrontmatter } = (await import(/* @vite-ignore */ pathToFileURL(join(appDir, 'scripts', 'skills-index.mjs')).href)) as {
      parseFrontmatter: (md: string) => Record<string, string>
    }
    const fm = parseFrontmatter(skillMd)
    expect(fm.name).toBe('colabonate') // must equal the directory name
    expect(fm.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(fm.name.length).toBeLessThanOrEqual(64)
    expect(fm.description.length).toBeGreaterThan(50)
    expect(fm.description.length).toBeLessThanOrEqual(1024)
    expect(fm.description).toMatch(/\bUse\b.*\bwhen\b/i) // says what it does AND when to use it
    expect((fm.compatibility ?? '').length).toBeLessThanOrEqual(500)
    expect(fm.license).toBe('MIT') // repo LICENSE is MIT
  })

  it('stays inside the spec size budget and ships no scripts', () => {
    expect(skillMd.split('\n').length).toBeLessThanOrEqual(500)
    expect(files.some((f) => f.startsWith('scripts/'))).toBe(false)
  })

  it('names only registered MCP tools', () => {
    const registered = registeredToolNames()
    const mentioned = [...allText.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1])
    expect(mentioned.length).toBeGreaterThan(30)
    expect([...new Set(mentioned)].filter((n) => !registered.has(n))).toEqual([])
  })

  it('names only error codes / enums that exist in the server code', () => {
    const src = serverSources()
    const tokens = [...new Set([...allText.matchAll(/`([A-Z]+(?:_[A-Z]+)+)`/g)].map((m) => m[1]))]
    expect(tokens.length).toBeGreaterThan(15)
    expect(tokens.filter((t) => !src.includes(t))).toEqual([])
  })

  it('resolves every internal URL and every relative link', async () => {
    const routes = await publicRoutePaths()
    const deadUrls = internalPaths(allText).filter((p) => !routes.has(p) && !STATIC_AND_SPECIAL.has(p) && !isPublicFile(p))
    expect(deadUrls).toEqual([])
    for (const f of files.filter((x) => x.endsWith('.md'))) {
      const dirOfFile = dirname(f) === '.' ? '' : dirname(f)
      for (const m of read(join(skillDir, f)).matchAll(/\]\(((?!https?:|#)[^)\s]+)\)/g)) {
        const target = m[1].split('#')[0]
        const rel = join(dirOfFile, target)
        expect({ from: f, link: target, exists: existsSync(join(skillDir, rel)) }).toEqual({ from: f, link: target, exists: true })
        expect(rel.split('/').length).toBeLessThanOrEqual(2) // one level deep from SKILL.md
      }
    }
  })

  it('keeps the Direct-Pay copy honest (ADR-397 ESCROW-COPY)', () => {
    expect(read(join(skillDir, 'references', 'payments-direct-pay.md'))).toContain('ESCROW-COPY')
    expect(skillMd).toMatch(/not live/i)
    expect(allText).not.toMatch(/funds? (is|are) held in escrow/i)
    expect(allText).not.toMatch(/beta\.colabonate\.app|localhost|127\.0\.0\.1|\bdemo\b/i)
  })

  it('generates both discovery indexes with digests equal to an independent sha256', async () => {
    const { createHash } = await import('node:crypto')
    const mod = (await import(/* @vite-ignore */ pathToFileURL(join(appDir, 'scripts', 'skills-index.mjs')).href)) as {
      buildSkillsIndexes: (root: string, origin: string) => Promise<{
        v02: { $schema: string; skills: Array<Record<string, unknown>> }
        legacy: { skills: Array<Record<string, unknown>> }
      }>
    }
    const { v02, legacy } = await mod.buildSkillsIndexes(publicDir, ORIGIN)
    const independent = 'sha256:' + createHash('sha256').update(readFileSync(join(skillDir, 'SKILL.md'))).digest('hex')

    expect(v02.$schema).toBe('https://schemas.agentskills.io/discovery/0.2.0/schema.json')
    expect(v02.skills).toHaveLength(1)
    expect(v02.skills[0]).toMatchObject({
      name: 'colabonate',
      type: 'skill-md',
      url: `${ORIGIN}/.well-known/agent-skills/colabonate/SKILL.md`,
      digest: independent,
    })
    expect(legacy.skills[0]).toMatchObject({ name: 'colabonate', hash: independent, files: files })
  })

  it('is advertised by agents.md and llms.txt', () => {
    const idx = `${ORIGIN}/.well-known/agent-skills/index.json`
    expect(agentsMd).toContain(idx)
    expect(llmsTxt).toContain(idx)
  })
})

// ── D6 / FU-955: MCP server card + AI catalog ────────────────────────────────

describe('MCP server card and AI catalog (ADR-414 D6)', () => {
  const card = JSON.parse(read(join(publicDir, 'mcp', 'server-card.json'))) as Record<string, any>
  const mcpInstance = read(join(here, 'mcp-instance.ts'))

  it('satisfies the SEP-2127 schema constraints we depend on', () => {
    // required: $schema, name, version, description (schema.json of modelcontextprotocol/ext-server-card)
    expect(card.$schema).toBe('https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json')
    expect(card.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/)
    expect(card.name.length).toBeGreaterThanOrEqual(3)
    expect(card.name.length).toBeLessThanOrEqual(200)
    expect(card.version.length).toBeLessThanOrEqual(255)
    expect(card.version).toMatch(/^\d+\.\d+\.\d+$/) // semver, no ranges
    expect(card.description.length).toBeGreaterThan(0)
    expect(card.description.length).toBeLessThanOrEqual(100)
    expect(card.title.length).toBeLessThanOrEqual(100)
    for (const remote of card.remotes as Array<Record<string, any>>) {
      expect(['streamable-http', 'sse']).toContain(remote.type)
      expect(remote.url).toMatch(/^https?:\/\/[^\s]+$/)
      for (const h of (remote.headers ?? []) as Array<Record<string, unknown>>) expect(typeof h.name).toBe('string')
    }
  })

  it('points at the real remote endpoint and matches the MCP server version', () => {
    expect(card.remotes).toHaveLength(1)
    expect(card.remotes[0]).toMatchObject({ type: 'streamable-http', url: `${ORIGIN}/mcp` })
    const serverVersion = /name: 'colabonate-mcp-server', version: '([^']+)'/.exec(mcpInstance)?.[1]
    expect(serverVersion).toBeDefined()
    expect(card.version).toBe(serverVersion)
    expect(card.remotes[0].supportedProtocolVersions).toEqual(['2025-06-18'])
  })

  it('is public by design: no credentials, no internal hosts, no non-production origin', () => {
    // `isSecret` is a schema field NAME (it marks the optional header as secret), not a leaked value
    const raw = JSON.stringify(card).replace(/"isSecret"/g, '""')
    expect(raw).not.toMatch(/beta\.colabonate|localhost|127\.0\.0\.1|\.env|secret|nsec1|[0-9a-f]{64}/i)
    // the only auth field is a documented OPTIONAL secret header, never a value
    const header = card.remotes[0].headers[0]
    expect(header).toMatchObject({ name: 'Authorization', isRequired: false, isSecret: true })
    expect(header.value).toBeUndefined()
    expect(card.tools).toBeUndefined() // the card does not list primitives (spec)
  })

  it('links only to real pages and files', async () => {
    const routes = await publicRoutePaths()
    const links = Object.values(card._meta['app.colabonate/links'] as Record<string, string>).concat(card.websiteUrl, card.icons[0].src)
    const dead = internalPaths(links.join(' ')).filter((p) => !routes.has(p) && !STATIC_AND_SPECIAL.has(p) && !isPublicFile(p))
    expect(dead).toEqual([])
  })

  it('generates an AI catalog whose entries and digests match the real files', async () => {
    const { createHash } = await import('node:crypto')
    const mod = (await import(/* @vite-ignore */ pathToFileURL(join(appDir, 'scripts', 'ai-catalog.mjs')).href)) as {
      buildAiCatalog: (root: string, origin: string) => Promise<{ specVersion: string; host: Record<string, string>; entries: Array<Record<string, any>> }>
    }
    const catalog = await mod.buildAiCatalog(publicDir, ORIGIN)
    const sha = (f: string) => 'sha256:' + createHash('sha256').update(readFileSync(f)).digest('hex')

    expect(catalog.specVersion).toBe('1.0')
    expect(catalog.host.displayName).toBe('Colabonate')
    const byType = Object.fromEntries(catalog.entries.map((e) => [e.type, e]))
    expect(byType['application/mcp-server-card+json']).toMatchObject({
      identifier: 'urn:air:colabonate.app:mcp:colabonate',
      url: `${ORIGIN}/mcp/server-card`,
      digest: sha(join(publicDir, 'mcp', 'server-card.json')),
    })
    expect(byType['application/agent-skills+md']).toMatchObject({
      identifier: 'urn:air:colabonate.app:skill:colabonate',
      url: `${ORIGIN}/.well-known/agent-skills/colabonate/SKILL.md`,
      digest: sha(join(skillDir, 'SKILL.md')),
    })
    for (const e of catalog.entries) {
      // spec: exactly one of url / data
      expect(Number(e.url !== undefined) + Number(e.data !== undefined)).toBe(1)
      expect(e.identifier).toMatch(/^urn:air:[^:]+:[^:]+:[^:]+$/)
    }
  })

  it('is advertised by agents.md, llms.txt and the home page', () => {
    expect(agentsMd).toContain(`${ORIGIN}/mcp/server-card`)
    expect(agentsMd).toContain(`${ORIGIN}/.well-known/ai-catalog.json`)
    expect(llmsTxt).toContain(`${ORIGIN}/mcp/server-card`)
    expect(read(join(appDir, 'index.html'))).toContain('rel="ai-catalog"')
    expect(read(join(appDir, 'nginx.conf'))).toContain('rel="ai-catalog"')
  })
})
