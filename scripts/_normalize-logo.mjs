// Normalize colabonate.svg: resolve .a/.b classes to inline fills, strip defs/style.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const src = resolve(process.argv[2]);
const out = resolve(process.argv[3]);

let svg = readFileSync(src, 'utf8');

// pull the two class colours out of the inline <style>
const aFill = (svg.match(/\.a\{fill:([^;}]+)/) || [])[1] || '#3d4c53';
const bFill = (svg.match(/\.b\{fill:([^;}]+)/) || [])[1] || '#e84541';

// drop defs/style blocks
svg = svg.replace(/<defs>[\s\S]*?<\/defs>/g, '');
svg = svg.replace(/<style>[\s\S]*?<\/style>/g, '');

// replace class="a" -> fill, class="b" -> fill
svg = svg.replace(/\s*class="a"/g, ` fill="${aFill.trim()}"`);
svg = svg.replace(/\s*class="b"/g, ` fill="${bFill.trim()}"`);
// any other class attrs removed
svg = svg.replace(/\s*class="[^"]*"/g, '');

// tidy whitespace
svg = svg.replace(/>\s+</g, '><').trim();

mkdirSync(resolve(out, '..'), { recursive: true });
writeFileSync(out, svg, 'utf8');

console.log('normalized viewBox:', (svg.match(/viewBox="[^"]+"/) || [])[0]);
console.log('paths:', (svg.match(/<path/g) || []).length);
console.log('written:', out, `(${svg.length} bytes)`);
