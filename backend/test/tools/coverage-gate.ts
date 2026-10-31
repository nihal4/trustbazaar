import { existsSync, readFileSync } from 'fs';
import { join, sep } from 'path';

// NFR-MNT-03: line coverage of the auction, order, payment, escrow, delivery and game-account modules
// should be at least 70% (docs/design/09_integration.pdf, section 7.1, the lint-and-unit job).
// Runs after `npm test -- --coverage` (the posttest script) on coverage/coverage-summary.json.
// Jest's own coverageThreshold fails on a module that has no code yet, so a module with no measured
// lines is reported as pending instead; the gate applies from the first line of code.
export const THRESHOLD = 70;
export const GATED: Record<string, string> = {
  orders: 'orders, payments and escrow (Unit 2)',
  listings: 'listings and auctions (Unit 3)',
  delivery: 'delivery (Unit 4)',
  'game-accounts': 'game accounts (Unit 5)',
};

type Summary = Record<string, { lines: { total: number; covered: number } }>;
export interface GateRow {
  module: string;
  total: number;
  covered: number;
  pct: number | null;
  ok: boolean;
}

export function evaluate(summary: Summary, threshold = THRESHOLD): GateRow[] {
  return Object.keys(GATED).map((module) => {
    const marker = `${sep}src${sep}modules${sep}${module}${sep}`;
    const files = Object.entries(summary).filter(([file]) => file !== 'total' && file.includes(marker));
    const total = files.reduce((n, [, s]) => n + s.lines.total, 0);
    const covered = files.reduce((n, [, s]) => n + s.lines.covered, 0);
    const pct = total === 0 ? null : (100 * covered) / total;
    return { module, total, covered, pct, ok: pct === null || pct >= threshold };
  });
}

function main(): number {
  const file = join(__dirname, '..', '..', 'coverage', 'coverage-summary.json');
  if (!existsSync(file)) {
    console.log('coverage gate (NFR-MNT-03): no coverage report; run npm test -- --coverage');
    return 0;
  }
  const rows = evaluate(JSON.parse(readFileSync(file, 'utf8')) as Summary);
  for (const r of rows) {
    const state = r.pct === null ? 'pending (no code yet)' : `${r.pct.toFixed(1)}% of ${r.total} lines`;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${GATED[r.module]}: ${state} (at least ${THRESHOLD}%)`);
  }
  return rows.every((r) => r.ok) ? 0 : 1;
}

if (require.main === module) process.exit(main());
