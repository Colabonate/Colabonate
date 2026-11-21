#!/usr/bin/env node
/**
 * build-research-pdf.mjs
 * Renders a research Markdown document into a clean PDF using Playwright.
 *
 * Usage:
 *   node scripts/build-research-pdf.mjs docs/research/adex-colabonate-alignment_en.md
 *   node scripts/build-research-pdf.mjs docs/research/mbs-holon-colabonate-mapping.md
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const input = resolve(root, process.argv[2]);
if (!input) {
  console.error('Usage: node scripts/build-research-pdf.mjs <path/to/doc.md>');
  process.exit(1);
}
const outName = basename(input).replace(/\.md$/i, '.pdf');
const output = resolve(root, 'docs', outName);

const md = readFileSync(input, 'utf8');

/* Minimal markdown -> HTML converter (same approach as whitepaper script) */
const esc = (s) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
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

  const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isTableSep = (l) => /^\s*\|?\s*:?-{3,}.*\|?\s*$/.test(l) && /\|/.test(l);

  while (i < lines.length) {
    let line = lines[i];

    if (/^\s*$/.test(line)) {
      closeLists();
      i++;
      continue;
    }

    if (isHr(line)) {
      closeLists();
      html.push('<hr/>');
      i++;
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeLists();
      const lvl = h[1].length;
      html.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      i++;
      continue;
    }

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
      if (i >= lines.length || (!bulletRe.test(lines[i]) && !orderedRe.test(lines[i]))) {
        closeLists();
      }
      continue;
    }

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
      !isTableRow(lines[j])
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

const css = `
@page {
  size: A4;
  margin: 18mm;
}
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 11pt;
  line-height: 1.6;
  color: #1a1a1a;
}
h1 { font-size: 22pt; margin-bottom: 0.4em; }
h2 { font-size: 16pt; margin-top: 1.2em; margin-bottom: 0.4em; border-bottom: 1px solid #e5e5e5; padding-bottom: 0.2em; }
h3 { font-size: 13pt; margin-top: 1em; margin-bottom: 0.3em; }
table { border-collapse: collapse; width: 100%; margin: 0.8em 0; font-size: 10pt; }
th, td { border: 1px solid #d4d4d4; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #f7f7f7; font-weight: 600; }
tr:nth-child(even) { background: #fafafa; }
code { background: #f4f4f4; padding: 2px 5px; border-radius: 4px; font-size: 10pt; }
pre { background: #f4f4f4; padding: 10px; border-radius: 6px; overflow-x: auto; font-size: 10pt; }
blockquote { border-left: 4px solid #e5e5e5; padding-left: 1em; margin-left: 0; color: #555; }
ul, ol { margin-top: 0.3em; margin-bottom: 0.6em; }
li { margin-bottom: 0.2em; }
p { margin: 0.5em 0; }
`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${basename(input).replace(/\.md$/i, '')}</title>
<style>${css}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

/* write intermediate HTML for debugging */
writeFileSync(output.replace(/\.pdf$/i, '.html'), html, 'utf8');

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle' });
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
