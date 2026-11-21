// Persona Pack schema — Zod validation for the Buzz Persona Pack Spec
// (https://github.com/block/buzz/blob/main/crates/buzz-persona/PERSONA_PACK_SPEC.md),
// adapted per ADR-305 D6 / BUZZ-EVALUATION.md §3.1 / FU-394.
//
// Field names and structure mirror the spec exactly (snake_case, as the spec
// defines it) so a pack authored for Buzz parses unchanged here.

import { z } from 'zod'

export const TriggersSchema = z.object({
  mentions: z.boolean().optional(),
  keywords: z.array(z.string()).optional(),
  all_messages: z.boolean().optional(),
})
export type Triggers = z.infer<typeof TriggersSchema>

// Shared by plugin.json's `defaults` and a persona's frontmatter overrides.
export const BehavioralDefaultsSchema = z.object({
  model: z.string().optional(),
  temperature: z.number().optional(),
  max_context_tokens: z.number().int().positive().optional(),
  subscribe: z.array(z.string()).optional(),
  triggers: TriggersSchema.optional(),
  thread_replies: z.boolean().optional(),
  broadcast_replies: z.boolean().optional(),
})
export type BehavioralDefaults = z.infer<typeof BehavioralDefaultsSchema>

export const PluginManifestSchema = z.object({
  $schema: z.string().optional(),
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  license: z.string().optional(),
  homepage: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  engines: z.object({ buzz: z.string().optional() }).optional(),
  personas: z.array(z.string()).min(1, 'plugin.json must list at least one persona'),
  pack_instructions: z.string().optional(),
  mcp_config: z.string().optional(),
  hooks_config: z.string().optional(),
  defaults: BehavioralDefaultsSchema.optional(),
})
export type PluginManifest = z.infer<typeof PluginManifestSchema>

export const McpServerRefSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
})
export type McpServerRef = z.infer<typeof McpServerRefSchema>

export const HooksSchema = z.object({
  on_start: z.string().nullable().optional(),
  on_stop: z.string().nullable().optional(),
  on_message: z.string().nullable().optional(),
})
export type Hooks = z.infer<typeof HooksSchema>

export const PersonaFrontmatterSchema = BehavioralDefaultsSchema.extend({
  name: z.string().regex(/^[a-z0-9-]+$/, 'name must be lowercase letters, numbers, or hyphens only'),
  display_name: z.string().min(1),
  description: z.string().min(1),
  avatar: z.string().optional(),
  version: z.string().optional(),
  author: z.string().optional(),
  skills: z.array(z.string()).optional(),
  mcp_servers: z.array(McpServerRefSchema).optional(),
  hooks: HooksSchema.optional(),
})
export type PersonaFrontmatter = z.infer<typeof PersonaFrontmatterSchema>

// skills/<name>/SKILL.md frontmatter. Per spec: missing name or description
// means the skill is silently skipped during discovery (no directory-name
// fallback) — the parser mirrors that (see parser.ts), this schema only
// validates a frontmatter block that IS present.
export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
})
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>

// .mcp.json — pack-level MCP configuration.
export const McpConfigEntrySchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
})
export type McpConfigEntry = z.infer<typeof McpConfigEntrySchema>

export const McpConfigSchema = z.object({
  mcpServers: z.record(z.string(), McpConfigEntrySchema),
})
export type McpConfig = z.infer<typeof McpConfigSchema>
