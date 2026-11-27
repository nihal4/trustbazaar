import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { POOL_STUCK_CHECKS, PoolWatch } from './pool-watch';

describe('PoolWatch (U11-11)', () => {
  const watch = () => new PoolWatch({} as DataSource);

  afterEach(() => jest.restoreAllMocks());

  it('NFR-MNT-02 a pool with a free connection, or with nobody waiting, is not stuck', () => {
    const w = watch();
    expect(w.check({ totalCount: 20, idleCount: 3, waitingCount: 4 })).toBe(false);
    expect(w.check({ totalCount: 20, idleCount: 0, waitingCount: 0 })).toBe(false);
  });

  it('NFR-MNT-02 requests waiting with no free connection are a warning, and an error once it lasts', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const w = watch();
    const exhausted = { totalCount: 20, idleCount: 0, waitingCount: 7 };
    for (let i = 1; i < POOL_STUCK_CHECKS; i++) expect(w.check(exhausted)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(POOL_STUCK_CHECKS - 1);
    expect(String(warn.mock.calls[0][0])).toContain('20 connections, none free, 7 requests waiting');
    expect(error).not.toHaveBeenCalled();
    expect(w.check(exhausted)).toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('NFR-MNT-02 the count starts again when the pool recovers', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const w = watch();
    const exhausted = { totalCount: 20, idleCount: 0, waitingCount: 1 };
    for (let i = 0; i < POOL_STUCK_CHECKS - 1; i++) w.check(exhausted);
    w.check({ totalCount: 20, idleCount: 5, waitingCount: 0 });
    for (let i = 0; i < POOL_STUCK_CHECKS - 1; i++) w.check(exhausted);
    expect(error).not.toHaveBeenCalled();
  });

  it('NFR-MNT-02 where there is no pool to look at it says nothing', () => {
    expect(watch().check(undefined)).toBe(false);
  });
});
