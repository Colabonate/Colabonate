// Persona Pack parser — ADR-305 D6 / FU-394.
//
// Input is an in-memory file map (pack-relative POSIX path -> raw file
// content), NOT a zip/git fetch — hosting/retrieval (Blossom/IPFS/Nostr) is
// explicitly out of scope for this package (no such integration exists in
// this repo yet). A caller that already has pack bytes (from any source)
// hands them here as a flat map; this module only parses and validates.

import { createHash } from 'node:crypto'
import { load as parseYaml } from 'js-yaml'
import {
  PluginManifestSchema, type PluginManifest,
  PersonaFrontmatterSchema, type PersonaFrontmatter,
  SkillFrontmatterSchema,
  McpConfigSchema, type McpConfig, type McpConfigEntry,
  HooksSchema, type Hooks,
} from './schema.js'
import { splitFrontmatter } from './frontmatter.js'

export interface ParsedPersona {
  path: string
  frontmatter: PersonaFrontmatter
  systemPrompt: string
}

export interface ParsedSkill {
  path: string
  name: string
  description: string
  content: string
}

export interface ParsedPersonaPack {
  manifest: PluginManifest
  personas: ParsedPersona[]
  skills: ParsedSkill[]
  mcpConfig: McpConfig | null
  hooksConfig: Hooks | null
  instructions: string | null
}

export interface PersonaPackWarning {
  path: string
  message: string
}

export type PersonaPackParseResult =
  | { ok: true; pack: ParsedPersonaPack; warnings: PersonaPackWarning[] }
  | { ok: false; errors: string[] }

const PLUGIN_MANIFEST_PATH = '.plugin/plugin.json'
const DEFAULT_MCP_PATH = '.mcp.json'
const DEFAULT_HOOKS_PATH = 'hooks/hooks.json'
const DEFAULT_INSTRUCTIONS_PATH = 'instructions.md'
const SKILL_PATH_RE = /^skills\/([^/]+)\/SKILL\.md$/

function normalizePath(p: string): string {
  return p.replace(/^\.\//, '')
}

function parseJsonField<T>(raw: string, path: string, schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } }): { value: T } | { error: string } {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (err) {
    return { error: `${path}: invalid JSON (${(err as Error).message})` }
  }
  const result = schema.safeParse(json)
  if (!result.success) {
    return { error: `${path}: schema validation failed — ${JSON.stringify((result.error as { issues?: unknown }).issues ?? result.error)}` }
  }
  return { value: result.data as T }
}

function parseYamlFrontmatterField(raw: string, path: string): { value: unknown } | { error: string } {
  const split = splitFrontmatter(raw)
  if (!split) return { error: `${path}: missing YAML frontmatter (expected content delimited by --- lines)` }
  let value: unknown
  try {
    value = parseYaml(split.frontmatter)
  } catch (err) {
    return { error: `${path}: invalid YAML frontmatter (${(err as Error).message})` }
  }
  return { value }
}

/**
 * Parses and validates a Persona Pack from an in-memory file map. Fatal
 * structural problems (missing/invalid plugin.json, a persona file the
 * manifest references but that isn't present, an invalid persona frontmatter,
 * duplicate persona names) return `{ ok: false, errors }`. Non-fatal issues
 * (a skill file missing name/description — per spec, silently skipped from
 * discovery, not an error) are surfaced as `warnings` on a successful parse.
 */
export function parsePersonaPack(files: Record<string, string>): PersonaPackParseResult {
  const errors: string[] = []
  const warnings: PersonaPackWarning[] = []

  const manifestRaw = files[PLUGIN_MANIFEST_PATH]
  if (manifestRaw === undefined) {
    return { ok: false, errors: [`${PLUGIN_MANIFEST_PATH}: required file is missing`] }
  }
  const manifestResult = parseJsonField<PluginManifest>(manifestRaw, PLUGIN_MANIFEST_PATH, PluginManifestSchema)
  if ('error' in manifestResult) return { ok: false, errors: [manifestResult.error] }
  const manifest = manifestResult.value

  // ── Personas ────────────────────────────────────────────────────────────
  const personas: ParsedPersona[] = []
  const seenNames = new Set<string>()
  for (const rawPath of manifest.personas) {
    const path = normalizePath(rawPath)
    const content = files[path]
    if (content === undefined) {
      errors.push(`${path}: persona file listed in plugin.json but not found in the pack`)
      continue
    }
    const fmResult = parseYamlFrontmatterField(content, path)
    if ('error' in fmResult) {
      errors.push(fmResult.error)
      continue
    }
    const parsed = PersonaFrontmatterSchema.safeParse(fmResult.value)
    if (!parsed.success) {
      errors.push(`${path}: persona frontmatter validation failed — ${JSON.stringify(parsed.error.issues)}`)
      continue
    }
    if (seenNames.has(parsed.data.name)) {
      errors.push(`${path}: duplicate persona name "${parsed.data.name}" — names must be unique within a pack`)
      continue
    }
    seenNames.add(parsed.data.name)
    const split = splitFrontmatter(content)
    personas.push({ path, frontmatter: parsed.data, systemPrompt: (split?.body ?? '').trim() })
  }

  // ── Skills (discovered by convention, not only by manifest reference) ──
  const skills: ParsedSkill[] = []
  for (const [path, content] of Object.entries(files)) {
    const match = SKILL_PATH_RE.exec(path)
    if (!match) continue
    const fmResult = parseYamlFrontmatterField(content, path)
    if ('error' in fmResult) {
      warnings.push({ path, message: 'skill has no valid YAML frontmatter — silently skipped per spec' })
      continue
    }
    const parsed = SkillFrontmatterSchema.safeParse(fmResult.value)
    if (!parsed.success) {
      // Spec: missing name/description => silently skipped during discovery,
      // no directory-name fallback. We keep that behavior but still record
      // *why*, as a warning, instead of a truly silent drop.
      warnings.push({ path, message: 'skill is missing required name/description frontmatter — silently skipped per spec' })
      continue
    }
    const split = splitFrontmatter(content)
    skills.push({ path, name: parsed.data.name, description: parsed.data.description, content: (split?.body ?? '').trim() })
  }

  // Cross-check: persona `skills:` references point at an existing skill dir.
  for (const persona of personas) {
    for (const skillRef of persona.frontmatter.skills ?? []) {
      const dir = normalizePath(skillRef).replace(/\/$/, '')
      const found = skills.some(s => s.path === `${dir}/SKILL.md`)
      if (!found) {
        warnings.push({ path: persona.path, message: `references skill "${skillRef}" which has no matching skills/<name>/SKILL.md in the pack` })
      }
    }
  }

  // ── .mcp.json ────────────────────────────────────────────────────────────
  let mcpConfig: McpConfig | null = null
  const mcpPath = manifest.mcp_config ? normalizePath(manifest.mcp_config) : DEFAULT_MCP_PATH
  if (files[mcpPath] !== undefined) {
    const result = parseJsonField<McpConfig>(files[mcpPath], mcpPath, McpConfigSchema)
    if ('error' in result) errors.push(result.error)
    else mcpConfig = result.value
  }

  // ── hooks/hooks.json ─────────────────────────────────────────────────────
  let hooksConfig: Hooks | null = null
  const hooksPath = manifest.hooks_config ? normalizePath(manifest.hooks_config) : DEFAULT_HOOKS_PATH
  if (files[hooksPath] !== undefined) {
    const result = parseJsonField<Hooks>(files[hooksPath], hooksPath, HooksSchema)
    if ('error' in result) errors.push(result.error)
    else hooksConfig = result.value
  }

  // ── instructions.md ──────────────────────────────────────────────────────
  const instructionsPath = manifest.pack_instructions ? normalizePath(manifest.pack_instructions) : DEFAULT_INSTRUCTIONS_PATH
  const instructions = files[instructionsPath] ?? null

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    pack: { manifest, personas, skills, mcpConfig, hooksConfig, instructions },
    warnings,
  }
}

/**
 * Resolves the effective MCP server set for one persona: pack-level
 * `.mcp.json` entries as the base, persona-level `mcp_servers` merged on top
 * — a name collision means the persona entry REPLACES the pack entry
 * entirely (no partial/field-level merge), per spec.
 */
export function resolveMcpServersForPersona(pack: ParsedPersonaPack, persona: ParsedPersona): Map<string, McpConfigEntry> {
  const resolved = new Map<string, McpConfigEntry>()
  for (const [name, entry] of Object.entries(pack.mcpConfig?.mcpServers ?? {})) {
    resolved.set(name, entry)
  }
  for (const ref of persona.frontmatter.mcp_servers ?? []) {
    resolved.set(ref.name, { command: ref.command, args: ref.args, env: ref.env })
  }
  return resolved
}

/**
 * Resolves one persona's effective behavioral config: pack `defaults` as the
 * base, persona frontmatter fields overriding per-field (same schema, per
 * spec — "Optional behavioral config... overrides pack defaults").
 */
export function resolveEffectiveConfig(pack: ParsedPersonaPack, persona: ParsedPersona) {
  const base = pack.manifest.defaults ?? {}
  const override = persona.frontmatter
  return {
    model: override.model ?? base.model,
    temperature: override.temperature ?? base.temperature ?? 0.7,
    max_context_tokens: override.max_context_tokens ?? base.max_context_tokens,
    subscribe: override.subscribe ?? base.subscribe ?? [],
    triggers: override.triggers ?? base.triggers ?? { mentions: true },
    thread_replies: override.thread_replies ?? base.thread_replies ?? true,
    broadcast_replies: override.broadcast_replies ?? base.broadcast_replies ?? false,
  }
}

/**
 * Pure SHA-256 integrity check over the in-memory file map — no fetch
 * involved (the caller already has the bytes, from whatever source). Hashes
 * paths in sorted order so the digest is independent of object key order.
 */
export function computePersonaPackHash(files: Record<string, string>): string {
  const hash = createHash('sha256')
  for (const path of Object.keys(files).sort()) {
    hash.update(path)
    hash.update('\0')
    hash.update(files[path] as string)
    hash.update('\0')
  }
  return hash.digest('hex')
}

export function verifyPersonaPackHash(files: Record<string, string>, expectedHash: string): boolean {
  return computePersonaPackHash(files) === expectedHash.toLowerCase()
}
