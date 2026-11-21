#!/usr/bin/env node
// Link audit for docs/protocols/ — produces a structured findings report.
// Categories:
//   B = Broken (target file does not exist)
//   A = Dangling Anchor (file exists but heading does not)
//   E = External (http/https) — listed for review, not error
//   X = Absolute path (i:/, C:/, /abs/) — error
//   S = Style (missing .md extension on relative doc link)
//   N = Normalize (uppercase anchor, non-hyphenated)

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, dirname, relative, posix } from 'node:path'

const ROOT = resolve(process.argv[2] ?? 'docs/protocols')
const REPO_ROOT = resolve('.')

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const s = statSync(p)
    if (s.isDirectory()) walk(p, acc)
    else if (p.endsWith('.md')) acc.push(p)
  }
  return acc
}

function extractHeadings(md) {
  const out = new Set()
  const re = /^(#{1,6})\s+(.+?)\s*$/gm
  let m
  while ((m = re.exec(md))) {
    const slug = m[2]
      .toLowerCase()
      .replace(/[`*_~]/g, '')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
    out.add(slug)
  }
  return out
}

const files = walk(ROOT)
const headingCache = new Map()
for (const f of files) headingCache.set(f, extractHeadings(readFileSync(f, 'utf8')))

const findings = []
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const lines = src.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let m
    LINK_RE.lastIndex = 0
    while ((m = LINK_RE.exec(line))) {
      const [, text, raw] = m
      const url = raw.trim()
      const rel = relative(REPO_ROOT, f).replace(/\\/g, '/')
      const loc = `${rel}:${i + 1}`

      if (/^https?:\/\//i.test(url)) {
        findings.push({ cat: 'E', loc, url, note: '' })
        continue
      }
      if (/^[a-zA-Z]:[\\/]/.test(url) || url.startsWith('/')) {
        findings.push({ cat: 'X', loc, url, note: 'absolute path' })
        continue
      }
      if (url.startsWith('#')) {
        const anchor = url.slice(1).toLowerCase()
        if (!headingCache.get(f).has(anchor)) {
          findings.push({ cat: 'A', loc, url, note: 'same-file anchor missing' })
        }
        continue
      }
      if (url.startsWith('mailto:') || url.startsWith('tel:')) continue

      const [pathPart, anchorPart] = url.split('#')
      if (!pathPart) continue
      const target = resolve(dirname(f), pathPart)

      if (!existsSync(target)) {
        findings.push({ cat: 'B', loc, url, note: 'file not found' })
        continue
      }
      const stat = statSync(target)
      if (stat.isDirectory()) continue

      if (target.endsWith('.md')) {
        if (!/\.md($|#)/.test(url) && !url.endsWith('.md')) {
          findings.push({ cat: 'S', loc, url, note: 'missing .md extension' })
        }
        if (anchorPart) {
          const anchorSlug = anchorPart.toLowerCase()
          const targetHeadings = headingCache.get(target) ?? extractHeadings(readFileSync(target, 'utf8'))
          if (!targetHeadings.has(anchorSlug)) {
            findings.push({ cat: 'A', loc, url, note: `anchor #${anchorPart} not in target` })
          }
          if (anchorPart !== anchorSlug) {
            findings.push({ cat: 'N', loc, url, note: 'anchor contains uppercase or non-slug chars' })
          }
        }
      }
    }
  }
}

const byCat = findings.reduce((acc, f) => {
  ;(acc[f.cat] ??= []).push(f)
  return acc
}, {})

const labels = {
  B: 'BROKEN (file not found)',
  A: 'ANCHOR (heading not found)',
  X: 'ABSOLUTE PATH',
  S: 'STYLE (missing .md ext)',
  N: 'NORMALIZE (anchor casing)',
  E: 'EXTERNAL (review only)',
}

console.log(`# Protocol Link Audit — ${new Date().toISOString().slice(0, 10)}`)
console.log(`\nScanned: ${files.length} files under \`${relative(REPO_ROOT, ROOT).replace(/\\/g, '/')}\`\n`)
console.log(`## Summary\n`)
for (const cat of ['B', 'A', 'X', 'S', 'N', 'E']) {
  console.log(`- ${labels[cat]}: **${(byCat[cat] ?? []).length}**`)
}
for (const cat of ['B', 'A', 'X', 'S', 'N']) {
  const items = byCat[cat] ?? []
  if (!items.length) continue
  console.log(`\n## ${labels[cat]} (${items.length})\n`)
  for (const f of items) {
    console.log(`- \`${f.loc}\` → \`${f.url}\`${f.note ? ` — ${f.note}` : ''}`)
  }
}

const externals = byCat.E ?? []
if (externals.length) {
  console.log(`\n## ${labels.E} (${externals.length})\n`)
  const hosts = new Map()
  for (const f of externals) {
    const host = new URL(f.url).host
    hosts.set(host, (hosts.get(host) ?? 0) + 1)
  }
  for (const [h, n] of [...hosts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`- ${h}: ${n}`)
  }
}
