import { decodeCursor, encodeCursor } from './cursor';
import { Problem } from './problems';

describe('page cursors', () => {
  it('IF-UI-05 a cursor keeps the timestamp to the microsecond and round-trips', () => {
    const c = encodeCursor('2026-11-01T12:00:00.123456Z', '00000000-0000-4000-8000-000000000001');
    expect(decodeCursor(c)).toEqual({ at: '2026-11-01T12:00:00.123456Z', id: '00000000-0000-4000-8000-000000000001' });
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('SEC-INP-01 a malformed cursor is refused, never put into a query', () => {
    for (const bad of ['eA', encodeCursor("2026-11-01'; DROP TABLE x;--", '00000000-0000-4000-8000-000000000001'), encodeCursor('2026-11-01T12:00:00Z', 'nope')]) {
      expect(() => decodeCursor(bad)).toThrow(Problem);
    }
  });
});
