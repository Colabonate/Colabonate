// ADR-414 D8 — generates the Agent Skills discovery indexes for the hosted skill(s).
//
// Source of truth: <root>/.well-known/agent-skills/<name>/SKILL.md (+ files),
// served from public/ by Vite. Two index shapes are written next to it:
//   - /.well-known/agent-skills/index.json  RFC v0.2.0 (draft): $schema + skills[{name,type,description,url,digest}]
//   - /.well-known/skills/index.json        legacy v0.1 shape: skills[{name,description,url,files,hash}]
// Digests are SHA-256 over the raw SKILL.md bytes, so this must run on the
// FINAL bytes nginx serves — prerender.mjs calls it after rewriteStaticOrigins().
//
// Pure functions are exported for the drift test (apps/mcp-server/src/agent-docs.test.ts).

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const SKILLS_SCHEMA_URI = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json'
const SKILLS_DIR = '.well-known/agent-skills'
const LEGACY_DIR = '.well-known/skills'

export const sha256Digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

/** Minimal frontmatter reader: top-level `key: value` scalars only (name, description, license, compatibility). */
export function parseFrontmatter(markdown) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(markdown)
  if (!m) throw new Error('SKILL.md has no YAML frontmatter')
  const out = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (!kv) continue // indented map entries (metadata:) are ignored here
    let v = kv[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[kv[1]] = v
  }
  return out
}

async function listFiles(dir, base = dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await listFiles(full, base)))
    else out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out.sort()
}

/**
 * Build both indexes from the skills found under `<root>/.well-known/agent-skills/`.
 * `origin` has no trailing slash. Returns { v02, legacy, skills }.
 */
export async function buildSkillsIndexes(root, origin) {
  const skillsRoot = path.join(root, SKILLS_DIR)
  const v02Skills = []
  const legacySkills = []
  if (!existsSync(skillsRoot)) return { v02: { $schema: SKILLS_SCHEMA_URI, skills: [] }, legacy: { skills: [] }, skills: [] }

  const dirs = (await readdir(skillsRoot, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  for (const dir of dirs) {
    const skillDir = path.join(skillsRoot, dir)
    const skillFile = path.join(skillDir, 'SKILL.md')
    if (!existsSync(skillFile)) continue
    const bytes = await readFile(skillFile)
    const fm = parseFrontmatter(bytes.toString('utf8'))
    if (fm.name !== dir) throw new Error(`skill "${dir}": frontmatter name "${fm.name}" must equal the directory name`)
    if (!fm.description) throw new Error(`skill "${dir}": missing description`)
    const url = `${origin}/${SKILLS_DIR}/${dir}/SKILL.md`
    const digest = sha256Digest(bytes)
    v02Skills.push({ name: dir, type: 'skill-md', description: fm.description, url, digest })
    legacySkills.push({ name: dir, description: fm.description, url, files: await listFiles(skillDir), hash: digest })
  }
  return {
    v02: { $schema: SKILLS_SCHEMA_URI, skills: v02Skills },
    legacy: { skills: legacySkills },
    skills: dirs,
  }
}

/** Write both index files into `root` (the build's dist directory). */
export async function writeSkillsIndexes(root, origin) {
  const { v02, legacy } = await buildSkillsIndexes(root, origin)
  if (v02.skills.length === 0) return { written: 0 }
  const write = async (rel, data) => {
    const file = path.join(root, rel)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(data, null, 2) + '\n')
  }
  await write(`${SKILLS_DIR}/index.json`, v02)
  await write(`${LEGACY_DIR}/index.json`, legacy)
  return { written: v02.skills.length }
}
