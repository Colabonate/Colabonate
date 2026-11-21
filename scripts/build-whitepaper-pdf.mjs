#!/usr/bin/env node
/**
 * build-whitepaper-pdf.mjs
 * Renders the Colabonate whitepaper (Markdown) into a branded PDF using the
 * Colabonate design system (tokens + typography) and Playwright (Edge/Chromium).
 *
 * Usage:
 *   node scripts/build-whitepaper-pdf.mjs [path/to/whitepaper.md] [out.pdf]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const input = resolve(root, process.argv[2] || 'docs/colabonate_whitepaper_de_v6.md');
const outName = process.argv[3] || basename(input).replace(/\.md$/i, '.pdf');
const output = resolve(root, 'docs', outName);

const mdRaw = readFileSync(input, 'utf8');

// Strip a leading YAML frontmatter block (--- … ---) if present.
const md = mdRaw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
// Colabonate wordmark logo (normalized: classes → inline fills, defs stripped)
const logoSvg = readFileSync(resolve(__dirname, 'assets/colabonate-wordmark.svg'), 'utf8');

// Version comes from the input filename (…_v9.md → v9), never from a hardcoded string.
const versionTag = (basename(input).match(/_v(\d+(?:\.\d+)*)/i)?.[0] ?? 'v0').toLowerCase();

// Language detection: English when input filename contains _en/_eng, else German
const isEnglish = /[_/]en(?:g|glish)?[._-]/i.test(input) || /eng\.md$/i.test(input);
const L = isEnglish
  ? {
      docTitle: 'Colabonate Whitepaper',
      version: `${versionTag} · English`,
      lang: 'en',
      eyebrow: 'Whitepaper · 2026',
      titleLead: 'A',
      titleAccent: 'Nostr extension',
      titleTrail: 'for decentralized collaboration &amp; trade',
      sub: 'An open protocol for Decentralized Collaborative Commerce (DCC) — built on Nostr, settled in Bitcoin, with verifiable Human Identities and community-led DAO governance.',
    }
  : {
      docTitle: 'Colabonate Whitepaper',
      version: `${versionTag} · Deutsch`,
      lang: 'de',
      eyebrow: 'Whitepaper · 2026',
      titleLead: 'Eine',
      titleAccent: 'Nostr-Erweiterung',
      titleTrail: 'für dezentrale Zusammenarbeit &amp; Handel',
      sub: 'Ein offenes Protokoll für Decentralized Collaborative Commerce (DCC) — auf Nostr, abgerechnet in Bitcoin, mit verifizierbaren Human Identities und gemeinschaftlicher DAO-Governance.',
    };

/* ------------------------------------------------------------------ *
 * Minimal, dependency-free Markdown -> HTML converter
 * Supports: ATX headings, hr, tables, ordered/unordered (nested) lists,
 * blockquotes, paragraphs, inline bold/italic/code/links.
 * ------------------------------------------------------------------ */
const esc = (s) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function inline(s) {
  let t = esc(s);
  // inline code first
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  // links
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // bold then italic
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>');
  return t;
}

function mdToHtml(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;

  const isHr = (l) => /^(-{3,}|\*{3,}|_{3,})\s*$/.test(l);
  const bulletRe = /^(\s*)[-*]\s+(.*)$/;
  const orderedRe = /^(\s*)(\d+)\.\s+(.*)$/;

  const flushList = (stack) => {
    while (stack.length) html.push(`</${stack.pop()}>`);
  };

  let listStack = [];
  const closeLists = () => {
    if (listStack.length) {
      flushList(listStack);
      listStack = [];
    }
  };

  // table support
  const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isTableSep = (l) => /^\s*\|?\s*:?-{3,}.*\|?\s*$/.test(l) && /\|/.test(l);

  while (i < lines.length) {
    let line = lines[i];

    // blank line
    if (/^\s*$/.test(line)) {
      closeLists();
      i++;
      continue;
    }

    // horizontal rule
    if (isHr(line)) {
      closeLists();
      html.push('<hr/>');
      i++;
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeLists();
      const lvl = h[1].length;
      html.push(`<h${lvl} id="sec-${html.length}">${inline(h[2])}</h${lvl}>`);
      i++;
      continue;
    }

    // table
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      closeLists();
      const headerCells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        rows.push(cells);
        i++;
      }
      let t = '<table><thead><tr>';
      headerCells.forEach((c) => (t += `<th>${inline(c)}</th>`));
      t += '</tr></thead><tbody>';
      rows.forEach((r) => {
        t += '<tr>';
        headerCells.forEach((_, idx) => (t += `<td>${inline(r[idx] || '')}</td>`));
        t += '</tr>';
      });
      t += '</tbody></table>';
      html.push(t);
      continue;
    }

    // unordered list
    if (bulletRe.test(line)) {
      const m = line.match(bulletRe);
      const depth = m[1].replace(/\t/g, '    ').length;
      const indent = Math.floor(depth / 4);
      if (listStack.length === 0) {
        html.push('<ul>');
        listStack.push('ul');
      } else if (indent >= listStack.length) {
        html.push('<ul>');
        listStack.push('ul');
      }
      while (indent < listStack.length - 1 && listStack.length > 1) {
        html.push(`</${listStack.pop()}>`);
      }
      html.push(`<li>${inline(m[2])}</li>`);
      i++;
      // peek for continuation
      if (i >= lines.length || (!bulletRe.test(lines[i]) && !orderedRe.test(lines[i]))) {
        closeLists();
      }
      continue;
    }

    // ordered list
    if (orderedRe.test(line)) {
      const m = line.match(orderedRe);
      const depth = m[1].replace(/\t/g, '    ').length;
      const indent = Math.floor(depth / 4);
      if (listStack.length === 0) {
        html.push('<ol>');
        listStack.push('ol');
      } else if (indent >= listStack.length) {
        html.push('<ol>');
        listStack.push('ol');
      }
      while (indent < listStack.length - 1 && listStack.length > 1) {
        html.push(`</${listStack.pop()}>`);
      }
      html.push(`<li>${inline(m[3])}</li>`);
      i++;
      if (i >= lines.length || (!bulletRe.test(lines[i]) && !orderedRe.test(lines[i]))) {
        closeLists();
      }
      continue;
    }

    // raw HTML block (e.g. <div class="title-page"> … </div>) — passed through verbatim
    if (/^\s*<\/?[a-zA-Z][^>]*>\s*$/.test(line)) {
      closeLists();
      html.push(line.trim());
      i++;
      continue;
    }

    // paragraph (accumulate consecutive non-empty, non-special lines)
    closeLists();
    const buf = [line];
    let j = i + 1;
    while (
      j < lines.length &&
      !/^\s*$/.test(lines[j]) &&
      !/^(#{1,6})\s+/.test(lines[j]) &&
      !isHr(lines[j]) &&
      !bulletRe.test(lines[j]) &&
      !orderedRe.test(lines[j]) &&
      !isTableRow(lines[j]) &&
      !/^\s*<\/?[a-zA-Z][^>]*>\s*$/.test(lines[j])
    ) {
      buf.push(lines[j]);
      j++;
    }
    html.push(`<p>${inline(buf.join(' '))}</p>`);
    i = j;
  }

  closeLists();
  return html.join('\n');
}

const bodyHtml = mdToHtml(md);

/* ------------------------------------------------------------------ *
 * HTML shell with Colabonate design system (real token values).
 * Colors: primary #E84541 (brand/BTC), secondary slate, neutrals.
 * Type: Inter (body), Barlow (display), Source Sans Pro, Source Code Pro (mono).
 * ------------------------------------------------------------------ */

const html = `<!DOCTYPE html>
<html lang="${L.lang}">
<head>
<meta charset="utf-8"/>
<title>${L.docTitle}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&family=Source+Sans+Pro:wght@300;400;600;700&family=Source+Code+Pro:wght@400;600&display=swap" rel="stylesheet">
<style>
  :root {
    /* Colabonate design tokens */
    --c-primary-10:#FDEEEE; --c-primary-40:#EFA1A1; --c-primary-50:#E84541;
    --c-primary-60:#CF3632; --c-primary-80:#9C211F; --c-primary-100:#6E1614;
    --c-secondary-50:#3D4C53; --c-secondary-70:#2D333B; --c-secondary-80:#252C33;
    --c-secondary-90:#1D242B; --c-secondary-100:#151D22;
    --c-accent-2:#F57C2A; --c-accent-3:#2AE866; --c-accent-4:#35E8D3;
    --c-neutral-1:#2C3A4B; --c-neutral-2:#394452; --c-neutral-3:#545D69;
    --c-neutral-4:#6D7580; --c-neutral-5:#858C94; --c-neutral-6:#A5ABB3;
    --c-neutral-7:#DADEE3; --c-neutral-8:#EBEEF2; --c-neutral-9:#F4F6F9;
    --c-white:#FFFFFF; --c-black:#2A2A2A;
    --f-sans:'Source Sans Pro', sans-serif;
    --f-body:'Inter', sans-serif;
    --f-display:'Barlow', sans-serif;
    --f-mono:'Source Code Pro', monospace;
  }

  @page {
    size: A4;
    margin: 22mm 18mm 20mm 18mm;
    @bottom-center {
      content: counter(page);
      font-family: var(--f-mono);
      font-size: 8.5pt;
      color: var(--c-neutral-5);
    }
    @bottom-left {
      content: "Colabonate · Whitepaper ${L.version}";
      font-family: var(--f-body);
      font-size: 7.5pt;
      letter-spacing: .04em;
      color: var(--c-neutral-5);
    }
    @top-right {
      content: "colabonate.com";
      font-family: var(--f-body);
      font-size: 7.5pt;
      color: var(--c-neutral-6);
    }
  }
  /* Cover page: no header/footer */
  @page cover { margin: 0; @bottom-center{content:""} @bottom-left{content:""} @top-right{content:""} }

  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  body {
    margin: 0;
    font-family: var(--f-body);
    color: var(--c-neutral-1);
    font-size: 10.5pt;
    line-height: 1.62;
    font-weight: 400;
  }

  /* ---------- Cover (clean, light) ---------- */
  .cover {
    page: cover;
    page-break-after: always;
    position: relative;
    width: 210mm;
    height: 297mm;
    overflow: hidden;
    color: var(--c-secondary-90);
    background: var(--c-white);
    display: flex;
    flex-direction: column;
  }
  .cover-bar { height: 6mm; background: var(--c-primary-50); }
  .cover-inner { flex:1; display:flex; flex-direction:column; justify-content:space-between; padding: 30mm 22mm 26mm; position:relative; }
  .cover-brand { display:flex; flex-direction:column; align-items:flex-start; gap: 5mm; }
  .cover-logo { width: 92mm; }
  .cover-logo svg { display:block; width: 100%; height: auto; }
  .cover-brand .brand-tag { font-family: var(--f-mono); font-size:8pt; letter-spacing:.18em; text-transform:uppercase; color: var(--c-neutral-5); }
  .cover-title { margin-top: 20mm; }
  .cover-eyebrow { font-family: var(--f-mono); font-size: 9pt; letter-spacing:.32em; text-transform:uppercase; color: var(--c-primary-60); margin-bottom: 8mm; }
  .cover-title h1 { font-family: var(--f-display); font-weight:700; font-size: 50pt; line-height:1.02; margin:0; letter-spacing:-.02em; color: var(--c-secondary-100); }
  .cover-title h1 .accent { color: var(--c-primary-50); }
  .cover-sub { margin-top: 12mm; font-family: var(--f-body); font-size: 14pt; font-weight:300; color: var(--c-neutral-3); max-width: 150mm; line-height:1.45; }
  .cover-rule { width: 44mm; height: 3px; background: var(--c-primary-50); margin: 16mm 0 0; }
  .cover-foot { display:flex; justify-content:space-between; align-items:flex-end; }
  .cover-meta { font-family: var(--f-mono); font-size: 8.5pt; letter-spacing:.14em; text-transform:uppercase; color: var(--c-neutral-5); }
  .cover-meta b { color: var(--c-secondary-90); font-weight:600; }
  .cover-chips { display:flex; gap:8px; flex-wrap:wrap; max-width:110mm; }
  .chip { font-family: var(--f-mono); font-size:7.5pt; letter-spacing:.1em; text-transform:uppercase; padding:5px 10px; border:1px solid var(--c-neutral-7); border-radius:999px; color: var(--c-neutral-3); }
  .chip.hot { border-color: var(--c-primary-50); color: var(--c-primary-60); }

  /* ---------- Content ---------- */
  .content { counter-reset: page 1; }
  h1, h2, h3, h4, h5, h6 { font-family: var(--f-display); color: var(--c-secondary-90); page-break-after: avoid; }

  /* title page wrapper (documents that carry an explicit <div class="title-page">) */
  .title-page { text-align: center; padding-top: 45mm; page-break-after: always; }
  .title-page h1 { font-size: 22pt; line-height: 1.15; margin: 0 0 4mm 0; border-top: none; padding-top: 0; }
  .title-page h3 { font-size: 12pt; font-weight: 500; color: var(--c-secondary-70); margin: 0 0 8mm 0; }
  .title-page p { font-size: 10pt; color: var(--c-secondary-70); margin: 1.5mm 0; }
  .title-page blockquote { margin: 6mm auto 0 auto; max-width: 78%; font-size: 9pt; }

  /* level-1 (#): full chapter divider */
  .content > h1 {
    font-size: 25pt; font-weight: 700; line-height: 1.12; letter-spacing:-.01em;
    margin: 0 0 6mm 0; padding-top: 4mm;
    border-top: 3px solid var(--c-primary-50);
    color: var(--c-secondary-100);
  }
  /* level-2 (##): section heading */
  h2 {
    font-size: 16.5pt; font-weight: 600; line-height: 1.2;
    margin: 9mm 0 3mm; color: var(--c-secondary-90);
  }
  h2::before { content:""; display:inline-block; width:9px; height:9px; background:var(--c-primary-50); margin-right:8px; transform: translateY(-2px); }
  /* level-3 (###): subsection */
  h3 { font-size: 13pt; font-weight: 600; margin: 6mm 0 2mm; color: var(--c-primary-80); letter-spacing:.01em; }
  h4 { font-size: 11.5pt; font-weight: 600; margin: 5mm 0 1.5mm; color: var(--c-secondary-80); }
  h5 { font-size: 10.5pt; font-weight: 600; margin: 4mm 0 1mm; color: var(--c-secondary-70); }
  h6 { font-size: 9.5pt; font-weight: 600; margin: 3mm 0 1mm; color: var(--c-secondary-70); }

  p { margin: 0 0 3.2mm; text-align: justify; hyphens: auto; }

  a { color: var(--c-primary-80); text-decoration: none; border-bottom: 1px solid var(--c-primary-40); }
  strong { font-weight: 600; color: var(--c-secondary-90); }
  em { font-style: italic; }
  code { font-family: var(--f-mono); font-size: 9pt; background: var(--c-neutral-8); color: var(--c-primary-80); padding: 1px 5px; border-radius: 3px; }

  ul, ol { margin: 0 0 3.2mm; padding-left: 6mm; }
  li { margin: 0 0 1.4mm; }
  li > ul, li > ol { margin: 1.4mm 0 0; }
  ul li::marker { color: var(--c-primary-50); }
  ol li::marker { color: var(--c-primary-60); font-family: var(--f-mono); font-weight:600; }

  hr { border: none; border-top: 1px solid var(--c-neutral-7); margin: 8mm 0; }

  /* tables */
  table { width: 100%; border-collapse: collapse; margin: 3mm 0 5mm; font-size: 9pt; page-break-inside: avoid; }
  thead th {
    text-align: left; font-family: var(--f-display); font-weight: 600;
    background: var(--c-secondary-80); color: #fff; padding: 7px 9px; letter-spacing:.02em;
    border-bottom: 2px solid var(--c-primary-50);
  }
  tbody td { padding: 6px 9px; border-bottom: 1px solid var(--c-neutral-7); vertical-align: top; line-height:1.45; }
  tbody tr:nth-child(even) { background: var(--c-neutral-9); }

  /* the leading H1 "Whitepaper: ..." rendered as the document title block on page 2 */
  .content > h1:first-child { display:none; }

  .section { page-break-inside: auto; }
  h1, h2 { page-break-after: avoid; }
  table, pre { page-break-inside: avoid; }

  /* callout-ish first paragraph after a chapter H1 */
  .content > h1 + p { color: var(--c-secondary-70); font-size: 11pt; }
</style>
</head>
<body>

<!-- ===================== COVER ===================== -->
${
  /* A document that carries its own <div class="title-page"> keeps that title page
     and does not get the generic whitepaper cover on top of it. */
  md.includes('class="title-page"')
    ? ''
    : `<section class="cover">
  <div class="cover-bar"></div>
  <div class="cover-inner">
    <div>
      <div class="cover-brand">
        <div class="cover-logo">${logoSvg}</div>
        <span class="brand-tag">Decentralized Collaborative Commerce</span>
      </div>

      <div class="cover-title">
        <div class="cover-eyebrow">${L.eyebrow}</div>
        <h1>${L.titleLead}<br/><span class="accent">${L.titleAccent}</span><br/>${L.titleTrail}</h1>
      </div>

      <p class="cover-sub">${L.sub}</p>
      <div class="cover-rule"></div>
    </div>

    <div class="cover-foot">
      <div class="cover-chips">
        <span class="chip hot">Nostr</span>
        <span class="chip">Bitcoin Lightning</span>
        <span class="chip">Human Identity</span>
        <span class="chip">DAO</span>
        <span class="chip">Open Protocol</span>
      </div>
      <div class="cover-meta">
        Version <b>${L.version}</b><br/>
        colabonate.com
      </div>
    </div>
  </div>
</section>
`
}

<!-- ===================== BODY ===================== -->
<section class="content">
${bodyHtml}
</section>

</body>
</html>`;

/* write the intermediate HTML next to the script for debugging */
writeFileSync(output.replace(/\.pdf$/i, '.html'), html, 'utf8');

/* ------------------------------------------------------------------ *
 * Render to PDF via Playwright.
 * Prefers the system Edge/Chrome when present, falls back to the
 * Playwright-managed Chromium so the build works on Linux and CI.
 * ------------------------------------------------------------------ */
const launchOptions = { headless: true };
let browser;
try {
  browser = await chromium.launch({ ...launchOptions, channel: 'msedge' });
} catch {
  browser = await chromium.launch(launchOptions);
}
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle' });
// ensure webfonts are ready
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);

await page.pdf({
  path: output,
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
});

await browser.close();
console.log('PDF written:', output);
