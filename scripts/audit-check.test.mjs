// SEC-SDL-04 (P0-10): the audit verdict of scripts/audit-check.mjs. Run with: node --test scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from './audit-check.mjs';

const advisory = (name, severity, ghsa) => ({ name, severity, title: `${name} issue`, url: `https://github.com/advisories/${ghsa}` });
const report = (...vias) => ({ vulnerabilities: { x: { via: vias }, y: { via: ['x'] } } });
const exception = (advisory, until = '2026-12-18') => ({ advisory, package: 'p', reason: 'r', until });

test('SEC-SDL-04 a high or critical advisory without an exception fails; low and moderate do not', () => {
  const r = evaluate(report(advisory('a', 'high', 'GHSA-aaaa-aaaa-aaaa'), advisory('b', 'critical', 'GHSA-bbbb-bbbb-bbbb'),
    advisory('c', 'moderate', 'GHSA-cccc-cccc-cccc'), advisory('d', 'low', 'GHSA-dddd-dddd-dddd')), [], '2026-11-18');
  assert.deepEqual(r.failures, ['high: a: a issue (GHSA-aaaa-aaaa-aaaa)', 'critical: b: b issue (GHSA-bbbb-bbbb-bbbb)']);
});

test('SEC-SDL-04 a documented exception lets the build pass until its review date; then it fails again', () => {
  const rep = report(advisory('picomatch', 'high', 'GHSA-fc5q-39xc-vjpf'));
  const ok = evaluate(rep, [exception('GHSA-fc5q-39xc-vjpf')], '2026-12-18');
  assert.deepEqual(ok.failures, []);
  assert.equal(ok.excepted.length, 1);
  const late = evaluate(rep, [exception('GHSA-fc5q-39xc-vjpf')], '2026-12-19');
  assert.deepEqual(late.failures, ["high: picomatch: GHSA-fc5q-39xc-vjpf: the exception's review date 2026-12-18 has passed"]);
});

test('SEC-SDL-04 an exception that matches nothing is reported for removal', () => {
  const r = evaluate(report(), [exception('GHSA-zzzz-zzzz-zzzz')], '2026-11-18');
  assert.deepEqual(r, { failures: [], excepted: [], unused: ['p: GHSA-zzzz-zzzz-zzzz'] });
});
