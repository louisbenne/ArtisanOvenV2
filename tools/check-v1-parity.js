#!/usr/bin/env node
'use strict';

// Golden rule 1: public/ is v1, byte for byte. Every file in public/ (except
// public/js/**, which is v2-only) must equal its counterpart in docs/v1-reference/
// — or docs/v1-reference-extra/ for index.html — unless it is on the allow-list
// in tools/v1-parity-allowlist.json with a reason.
// Also fails if a v1 file that belongs in public/ is missing.
// Usage: node tools/check-v1-parity.js      (exit 1 on any violation)

const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const PUBLIC  = path.join(ROOT, 'public');
const V1      = path.join(ROOT, 'docs', 'v1-reference');
const V1EXTRA = path.join(ROOT, 'docs', 'v1-reference-extra');
const { allowed } = require('./v1-parity-allowlist.json');

// v1 files that are deliberately NOT served by v2.
const NOT_PUBLIC = new Set([
  'live.html', 'server.js', 'package.json', 'apps-script.js', 'CNAME', 'GEMINI.md',
  'README.md', 'ArtisanOven License', 'SNAPSHOT.md',
]);

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

const problems = [];
const sourceFor = rel => (rel === 'index.html' ? path.join(V1EXTRA, 'index.html') : path.join(V1, rel));

for (const rel of walk(PUBLIC)) {
  if (rel.startsWith('js/')) continue;
  const rule = allowed[rel];
  if (rule && rule.kind === 'free') continue;
  const src = sourceFor(rel);
  let served = fs.readFileSync(path.join(PUBLIC, rel));
  // 'rewire': undo the one sanctioned edit — the result must be v1 exactly.
  if (rule && rule.kind === 'rewire') {
    served = Buffer.from(served.toString('latin1').split('AO_API.fetch(').join('fetch('), 'latin1');
  }
  if (!fs.existsSync(src)) problems.push(`not in v1: public/${rel}`);
  else if (!fs.readFileSync(src).equals(served)) {
    problems.push(`differs from v1: public/${rel} (add to tools/v1-parity-allowlist.json only if the change is sanctioned)`);
  }
}

for (const rel of walk(V1)) {
  const top = rel.split('/')[0];
  if (NOT_PUBLIC.has(rel) || top === 'apps-script' || top.startsWith('.')) continue;
  if (!fs.existsSync(path.join(PUBLIC, rel))) problems.push(`missing from public/: ${rel}`);
}

for (const rel of Object.keys(allowed)) {
  if (!fs.existsSync(path.join(PUBLIC, rel))) problems.push(`allow-list entry has no file: ${rel}`);
}

if (problems.length) {
  console.error(`v1 parity check FAILED (${problems.length}):\n  ` + problems.join('\n  '));
  process.exit(1);
}
console.log(`v1 parity check passed (${walk(PUBLIC).length} files; ${Object.keys(allowed).length} sanctioned edits).`);
