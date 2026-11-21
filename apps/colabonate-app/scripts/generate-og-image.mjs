// Generates public/og-image.png (1200×630 Open Graph card) from the
// committed logo asset. Uses the repo-root Playwright install — no extra deps.
//
// Usage: node scripts/generate-og-image.mjs   (from apps/colabonate-app)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const logoSvg = readFileSync(path.join(appDir, 'src/assets/colabonate_icon.svg'), 'utf8')

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: 1200px; height: 630px;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 36px;
        background: #1e242c;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .logo { width: 160px; height: 160px; }
      .logo svg { width: 100%; height: 100%; }
      h1 { font-size: 84px; font-weight: 700; color: #f5f7fa; letter-spacing: -0.02em; }
      p { font-size: 34px; font-weight: 500; color: #9aa4b0; }
      .accent { color: #e84541; }
    </style>
  </head>
  <body>
    <div class="logo">${logoSvg}</div>
    <h1>Colabonate</h1>
    <p>Buy, sell <span class="accent">&amp;</span> cooperate — directly, peer-to-peer.</p>
  </body>
</html>`

const templatePath = path.join(tmpdir(), 'colabonate-og-template.html')
writeFileSync(templatePath, html)

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
  await page.goto(`file://${templatePath}`)
  const out = path.join(appDir, 'public/og-image.png')
  mkdirSync(path.dirname(out), { recursive: true })
  await page.screenshot({ path: out, type: 'png' })
  console.log(`[og-image] wrote ${path.relative(process.cwd(), out)}`)
} finally {
  await browser.close()
}
