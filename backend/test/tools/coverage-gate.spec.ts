import { sep } from 'path';
import { evaluate } from './coverage-gate';

const file = (module: string, name: string) => ['', 'app', 'src', 'modules', module, 'services', name].join(sep);
const lines = (total: number, covered: number) => ({ lines: { total, covered } });

describe('coverage gate', () => {
  it('NFR-MNT-03 a gated module with at least 70% of its lines covered passes', () => {
    const rows = evaluate({ [file('orders', 'escrow.service.ts')]: lines(100, 70) });
    expect(rows.find((r) => r.module === 'orders')).toMatchObject({ pct: 70, ok: true });
  });

  it('NFR-MNT-03 a gated module below 70% fails, counting all its files together', () => {
    const rows = evaluate({
      [file('listings', 'bid.service.ts')]: lines(100, 90),
      [file('listings', 'auction.service.ts')]: lines(100, 40),
    });
    expect(rows.find((r) => r.module === 'listings')).toMatchObject({ total: 200, covered: 130, pct: 65, ok: false });
  });

  it('NFR-MNT-03 a gated module without code yet is pending, not failed', () => {
    expect(evaluate({}).every((r) => r.pct === null && r.ok)).toBe(true);
  });

  it('NFR-MNT-03 modules outside the list are not gated', () => {
    const rows = evaluate({ [file('chat', 'thread.service.ts')]: lines(100, 0) });
    expect(rows.every((r) => r.ok)).toBe(true);
    expect(rows.map((r) => r.module)).toEqual(['orders', 'listings', 'delivery', 'game-accounts']);
  });
});
