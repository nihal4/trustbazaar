#!/usr/bin/env node
// The health ratchet (U11-02): the code-health numbers may go down, never up. Run from frontend/ or backend/:
//   node ../scripts/health-ratchet.mjs            compare with health-baseline.json; fails (exit 1) when any number is higher than the baseline
//   node ../scripts/health-ratchet.mjs --update   write the baseline (after the numbers went down: commit the new file, so the gain is kept)
// Measured: ESLint warnings and errors by rule, Stylelint warnings by rule (frontend), knip findings by kind, jscpd clones and copied lines. These are the checks of `npm run health`; until a part
// of the code has been cleaned they are warnings, and this ratchet is what stops them growing in the meantime (U11 in PROGRESS.md).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const cwd = process.cwd();
const app = cwd.endsWith('frontend') ? 'frontend' : 'backend';
const file = join(cwd, 'health-baseline.json');
const update = process.argv.includes('--update');

const run = (cmd, args) => spawnSync('npx', ['--no-install', cmd, ...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const tally = (list, key) => list.reduce((n, item) => ((n[item[key] ?? 'unknown'] = (n[item[key] ?? 'unknown'] ?? 0) + 1), n), {});

function measure() {
  const m = {};
  // ESLint: every message by rule (an error counts too, a different key)
  const eslintArgs = app === 'frontend' ? ['.', '-f', 'json'] : ['{src,test}/**/*.ts', '-f', 'json'];
  const eslint = JSON.parse(run('eslint', eslintArgs).stdout || '[]');
  m.eslint = {};
  for (const f of eslint) for (const msg of f.messages) { const key = `${msg.severity === 2 ? 'error' : 'warning'}:${msg.ruleId ?? 'parse'}`; m.eslint[key] = (m.eslint[key] ?? 0) + 1; }
  // Stylelint (frontend only)
  if (app === 'frontend') {
    const out = run('stylelint', ['src/**/*.css', '-f', 'json']);
    const results = JSON.parse(out.stderr?.trim().startsWith('[') ? out.stderr : out.stdout || '[]');
    m.stylelint = {};
    for (const r of results) for (const w of r.warnings) m.stylelint[`${w.severity}:${w.rule}`] = (m.stylelint[`${w.severity}:${w.rule}`] ?? 0) + 1;
  }
  // knip: findings by kind
  const knip = JSON.parse(run('knip', ['--reporter', 'json', '--no-exit-code']).stdout || '{"issues":[]}');
  m.knip = {};
  for (const issue of knip.issues) for (const [kind, list] of Object.entries(issue)) if (Array.isArray(list) && list.length) m.knip[kind] = (m.knip[kind] ?? 0) + list.length;
  // jscpd: copied code
  run('jscpd', ['--silent']);
  const report = JSON.parse(readFileSync(join(cwd, 'reports/jscpd/jscpd-report.json'), 'utf8')).statistics.total;
  m.jscpd = { clones: report.clones, duplicatedLines: report.duplicatedLines };
  return m;
}

const now = measure();
if (update || !existsSync(file)) {
  writeFileSync(file, JSON.stringify(now, null, 2) + '\n');
  console.log(`${app}: baseline written to health-baseline.json`);
  process.exit(0);
}

const base = JSON.parse(readFileSync(file, 'utf8'));
const worse = [];
const better = [];
for (const group of Object.keys({ ...base, ...now })) {
  for (const key of new Set([...Object.keys(base[group] ?? {}), ...Object.keys(now[group] ?? {})])) {
    const before = base[group]?.[key] ?? 0;
    const after = now[group]?.[key] ?? 0;
    if (after > before) worse.push(`${group} ${key}: ${before} -> ${after}`);
    else if (after < before) better.push(`${group} ${key}: ${before} -> ${after}`);
  }
}
if (worse.length) {
  console.error(`${app}: the health numbers went UP (the ratchet allows them only to go down):\n  ${worse.join('\n  ')}`);
  process.exit(1);
}
console.log(`${app}: no number is higher than the baseline.${better.length ? ` Lower now (run with --update and commit health-baseline.json to keep the gain):\n  ${better.join('\n  ')}` : ''}`);
