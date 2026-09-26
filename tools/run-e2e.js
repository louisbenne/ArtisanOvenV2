#!/usr/bin/env node
'use strict';

// Runs the Playwright suite inside the official Playwright image (browsers and
// fonts pinned, same pixels on every machine). Extra args go to `playwright test`.
//   npm run e2e                               compare against the v1 baseline
//   npm run e2e -- --update-snapshots         ONLY when Louis asks to re-baseline
//   TARGET=v2 npm run e2e                     screenshot the dev stack (joins ao-dev network)

const { spawnSync } = require('child_process');
const path = require('path');

const IMAGE  = 'mcr.microsoft.com/playwright:v1.63.0-noble';
const repo   = path.resolve(__dirname, '..');
const target = process.env.TARGET || 'v1';
const args   = process.argv.slice(2).map(a => `'${a.replace(/'/g, `'\''`)}'`).join(' ');

// The dev database password: infra/.env's DB_PASS (Compose reads it too), else the dev default.
const fs = require('fs');
const envFile = path.join(repo, 'infra', '.env');
const dbPass = ((fs.existsSync(envFile) && (fs.readFileSync(envFile, 'utf8').match(/^DB_PASS=(.*)$/m) || [])[1]) || '')
  .trim() || 'devpassword';

const docker = [
  'run', '--rm', '--ipc=host',
  '-v', `${repo}:/work`, '-w', '/work/e2e',
  '-e', `TARGET=${target}`, '-e', `DB_PASS=${dbPass}`,
  ...(target === 'v2' ? ['--network', 'ao-dev_default'] : []),
  IMAGE, 'sh', '-c', `npm ci --silent --no-audit --no-fund && npx playwright test ${args}`,
];

const run = spawnSync('docker', docker, { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
process.exit(run.status ?? 1);
