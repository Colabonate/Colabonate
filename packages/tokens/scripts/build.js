/**
 * Token Build Script
 * tokens.json → css/tokens.css  (CSS Custom Properties)
 *
 * Usage: pnpm tokens:build
 */

const fs = require('fs');
const path = require('path');

const TOKENS_FILE = path.join(__dirname, '../tokens.json');
const OUTPUT_DIR = path.join(__dirname, '../css');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'tokens.css');

function flattenTokens(obj, prefix = '') {
  return Object.entries(obj).reduce((acc, [key, value]) => {
    // Replace spaces and slashes with hyphens for CSS variables
    const cleanKey = key.toLowerCase().replace(/[\s/]+/g, '-');
    const cssKey = prefix ? `${prefix}-${cleanKey}` : cleanKey;

    if (typeof value === 'object' && value !== null) {
      Object.assign(acc, flattenTokens(value, cssKey));
    } else {
      acc[cssKey] = value;
    }
    return acc;
  }, {});
}

function buildCSS(tokens) {
  const flat = flattenTokens(tokens);
  const vars = Object.entries(flat)
    .map(([key, value]) => `  --${key}: ${value};`)
    .join('\n');

  return `/* ============================================================
 * Design Tokens – Auto-generated via pnpm tokens:build
 * DO NOT edit manually – Source: tokens.json
 * ============================================================ */

:root {
${vars}
}
`;
}

try {
  const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  const css = buildCSS(tokens);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, css, 'utf8');

  const varCount = Object.keys(flattenTokens(tokens)).length;
  console.log(`✅ Tokens built: ${varCount} CSS variables → packages/tokens/css/tokens.css`);
} catch (err) {
  console.error('❌ Token build failed:', err.message);
  process.exit(1);
}
