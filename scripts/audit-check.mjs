#!/usr/bin/env node
// SEC-SDL-04: the CI's dependency audit (P0-10). Runs `npm audit --json` in the current directory and fails on any
// high or critical advisory, except those listed with a reason and a review date in audit-exceptions.json at the
// repository root ("unless a documented exception exists"). An exception past its review date fails the build, so
// it is looked at again; one that no longer matches anything is reported, so it can be removed.
// Usage, from backend/ or frontend/: node ../scripts/audit-check.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BLOCKING = new Set(['high', 'critical']);

/**
 * The verdict for an `npm audit --json` report.
 * @param {{vulnerabilities?: Record<string, {via: (string|{url?: string, title?: string, severity?: string, name?: string})[]}>}} report
 * @param {{advisory: string, package: string, reason: string, until: string}[]} exceptions
 * @param {string} today YYYY-MM-DD
 */
export function evaluate(report, exceptions, today) {
  const found = new Map(); // advisory id -> {package, title, severity}
  for (const v of Object.values(report.vulnerabilities ?? {})) {
    for (const via of v.via ?? []) {
      if (typeof via !== 'object' || !BLOCKING.has(via.severity ?? '')) continue;
      const id = /GHSA-[\w-]+/.exec(via.url ?? '')?.[0] ?? via.url ?? via.title ?? 'unknown';
      found.set(id, { package: via.name, title: via.title, severity: via.severity });
    }
  }
  const byId = new Map(exceptions.map((e) => [e.advisory, e]));
  const failures = [];
  const excepted = [];
  for (const [id, a] of found) {
    const e = byId.get(id);
    if (!e) failures.push(`${a.severity}: ${a.package}: ${a.title} (${id})`);
    else if (e.until < today) failures.push(`${a.severity}: ${a.package}: ${id}: the exception's review date ${e.until} has passed`);
    else excepted.push(`${a.package}: ${id} (excepted until ${e.until}: ${e.reason})`);
  }
  const unused = exceptions.filter((e) => !found.has(e.advisory)).map((e) => `${e.package}: ${e.advisory}`);
  return { failures, excepted, unused };
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const exceptions = JSON.parse(readFileSync(join(root, 'audit-exceptions.json'), 'utf8')).exceptions;
  let out;
  try {
    out = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    out = /** @type {{stdout?: string}} */ (err).stdout ?? ''; // npm audit exits 1 when it finds anything
  }
  const report = JSON.parse(out || '{}');
  if (report.error) {
    console.error(`npm audit failed: ${JSON.stringify(report.error)}`);
    process.exit(1);
  }
  const { failures, excepted, unused } = evaluate(report, exceptions, new Date().toISOString().slice(0, 10));
  for (const line of excepted) console.log(`excepted  ${line}`);
  for (const line of unused) console.log(`unused exception (remove it): ${line}`);
  for (const line of failures) console.error(`FAIL  ${line}`);
  console.log(failures.length ? `${failures.length} blocking advisories` : 'no blocking advisories');
  process.exit(failures.length ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
