#!/usr/bin/env node
// Records every screen of screens.json (U11-13), each with the session it needs: node e2e/visual/record-all.mjs <folder holding seller.json, buyer.json and operator.json> [--only name,name]
// A session file is a Playwright storage state of a signed-in demo account (the dev stack is running at http://localhost:5173). Screens that need a state the demo data does not have (an
// unverified account at the ID check) are made from a recorded one by `derive` below.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [sessions, ...rest] = process.argv.slice(2);
if (!sessions) { console.error('usage: node e2e/visual/record-all.mjs <sessions folder> [--only a,b]'); process.exit(1); }
const only = rest.includes('--only') ? new Set(rest[rest.indexOf('--only') + 1].split(',')) : null;
const screens = JSON.parse(readFileSync(join(here, 'screens.json'), 'utf8'));
for (const s of screens) {
  if (only && !only.has(s.name)) continue;
  const args = [join(here, 'record.mjs'), s.name, s.path, ...(s.session ? ['--session', join(sessions, `${s.session}.json`)] : [])];
  const run = spawnSync('node', args, { encoding: 'utf8' });
  console.log((run.stdout || run.stderr).trim().split('\n').pop());
}

// the ID check as a person who has not been verified sees it: the recorded verified screen with the status of a new account and a liveness action
if (!only || only.has('kyc-verified')) {
  const file = join(here, 'fixtures', 'kyc-verified.json');
  const f = JSON.parse(readFileSync(file, 'utf8'));
  const wizard = JSON.parse(JSON.stringify(f));
  wizard.answers['GET /kyc/status'] = { status: 200, body: { status: 'unsubmitted', changedAt: f.recordedAt, rejection: null, submissionsLeft: 3, expectedReviewHours: 24 } };
  wizard.answers['GET /kyc/liveness-challenge'] = { status: 200, body: { challengeId: 'c-1', action: 'smile', expiresAt: new Date(Date.parse(f.recordedAt) + 600_000).toISOString() } };
  writeFileSync(join(here, 'fixtures', 'kyc-wizard.json'), JSON.stringify(wizard, null, 2) + '\n');
  console.log('kyc-wizard: derived from kyc-verified');
}
