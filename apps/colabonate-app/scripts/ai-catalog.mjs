// ADR-414 D6 / FU-955 — generates /.well-known/ai-catalog.json, the domain-level entry point that
// SEP-2127 (MCP Server Cards) points at. One catalog lists the MCP server card and the hosted
// Agent Skill(s) so an agent can start from the domain and find both.
//
// Format (AI Catalog working draft, github.com/Agent-Card/ai-catalog — a temporary Linux Foundation
// working repo; the spec is not final): media type `application/ai-catalog+json`, top level
// `specVersion` + `entries[]`, each entry `identifier` + `type` + exactly one of `url`/`data`, and an
// optional `digest` of the exact bytes retrieved from `url`.
//
// Digests are taken over the FINAL bytes nginx serves, so this runs at the end of prerender.mjs
// (after rewriteStaticOrigins and writeSkillsIndexes), exactly like skills-index.mjs.

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildSkillsIndexes, sha256Digest } from './skills-index.mjs'

export const AI_CATALOG_SPEC_VERSION = '1.0'
export const SERVER_CARD_MEDIA_TYPE = 'application/mcp-server-card+json'
export const SKILL_MD_MEDIA_TYPE = 'application/agent-skills+md'
const PUBLISHER_ID = 'colabonate.app'

/** Pure: build the catalog object from a built root (dist) and the public origin (no trailing slash). */
export async function buildAiCatalog(root, origin) {
  const entries = []

  // MCP server card — served at /mcp/server-card from public/mcp/server-card.json
  const cardFile = path.join(root, 'mcp', 'server-card.json')
  if (existsSync(cardFile)) {
    entries.push({
      identifier: `urn:air:${PUBLISHER_ID}:mcp:colabonate`,
      type: SERVER_CARD_MEDIA_TYPE,
      url: `${origin}/mcp/server-card`,
      digest: sha256Digest(await readFile(cardFile)),
    })
  }

  // Hosted Agent Skills — same digests as the skills discovery index
  const { v02 } = await buildSkillsIndexes(root, origin)
  for (const skill of v02.skills) {
    entries.push({
      identifier: `urn:air:${PUBLISHER_ID}:skill:${skill.name}`,
      type: SKILL_MD_MEDIA_TYPE,
      url: skill.url,
      digest: skill.digest,
    })
  }

  return {
    specVersion: AI_CATALOG_SPEC_VERSION,
    host: {
      displayName: 'Colabonate',
      identifier: PUBLISHER_ID,
      documentationUrl: `${origin}/agents.md`,
      logoUrl: `${origin}/favicon.svg`,
    },
    entries,
  }
}

/** Write /.well-known/ai-catalog.json into `root`. No-op when there is nothing to list. */
export async function writeAiCatalog(root, origin) {
  const catalog = await buildAiCatalog(root, origin)
  if (catalog.entries.length === 0) return { written: 0 }
  const file = path.join(root, '.well-known', 'ai-catalog.json')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(catalog, null, 2) + '\n')
  return { written: catalog.entries.length }
}
