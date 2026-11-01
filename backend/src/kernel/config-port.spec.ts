import { durationMs, parameterValues } from './config-port';

describe('parameter values (NFR-MNT-06)', () => {
  it('NFR-MNT-06 the interval texts of the parameter set read as milliseconds', () => {
    expect(durationMs('15 minutes')).toBe(15 * 60_000);
    expect(durationMs('1 hour')).toBe(3_600_000);
    expect(durationMs('7 days')).toBe(7 * 86_400_000);
    expect(durationMs('1 year')).toBe(365 * 86_400_000);
    expect(durationMs('1 day 2 hours')).toBe(26 * 3_600_000);
    for (const bad of ['', 'soon', '15', '15 minutes and more', 'see delivery.fare_tables']) expect(() => durationMs(bad)).toThrow();
  });

  it('NFR-MNT-06 a parameter or one of its fields is read by code; an unknown code is an error', () => {
    const p = parameterValues({ 'CP-01': { access: '15 minutes' }, 'CP-31': '5 minutes', 'CP-34': 3 });
    expect(p.ms('CP-01', 'access')).toBe(900_000);
    expect(p.ms('CP-31')).toBe(300_000);
    expect(p.get<number>('CP-34')).toBe(3);
    expect(() => p.get('CP-99')).toThrow('unknown parameter CP-99');
    expect(() => p.ms('CP-34')).toThrow();
  });
});
