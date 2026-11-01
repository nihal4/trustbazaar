import { describe, expect, it } from 'vitest';
import { placeholders } from '../../lib/i18n.js';
import en from '../../messages/en/kyc.json';
import bn from '../../messages/bn/kyc.json';
import { ACTIONS, maySubmit, normaliseDocNumber, reasonKey, REASONS, validDateOfBirth, validDocNumber, type KycStatusView } from './model';

describe('document details', () => {
  it.each([
    ['nid', '1234567890', true], ['nid', '1234567890123', true], ['nid', '12345678901234567', true],
    ['nid', '১২৩৪ ৫৬৭৮৯০', true], ['nid', '123456789012', false], ['nid', 'A123456789', false],
    ['passport', 'A01234567', true], ['passport', 'ab1234567', true], ['passport', '01234567', false], ['passport', 'ABC1234567', false],
  ] as const)('FR-KYC-01 a %s number %s is %s', (type, number, ok) => {
    expect(validDocNumber(type, number)).toBe(ok);
  });

  it('FR-KYC-01 the number is sent as printed digits and letters, without spaces or hyphens', () => {
    expect(normaliseDocNumber('১২৩ ৪৫৬-৭৮৯০')).toBe('1234567890');
    expect(normaliseDocNumber('a0123 4567')).toBe('A01234567');
  });

  it('FR-KYC-01 a date of birth is a real past date', () => {
    const today = new Date('2026-11-01T00:00:00Z');
    expect(validDateOfBirth('1995-04-12', today)).toBe(true);
    expect(validDateOfBirth('1995-02-30', today)).toBe(false);
    expect(validDateOfBirth('2027-01-01', today)).toBe(false);
    expect(validDateOfBirth('1899-12-31', today)).toBe(false);
    expect(validDateOfBirth('12/04/1995', today)).toBe(false);
  });
});

describe('who may submit', () => {
  const s = (status: KycStatusView['status'], left = 3): KycStatusView =>
    ({ status, changedAt: '', rejection: null, submissionsLeft: left, expectedReviewHours: 24 });

  it('FR-KYC-09 unsubmitted and rejected may submit within the limit; pending, verified and revoked may not', () => {
    expect(maySubmit(s('unsubmitted'))).toBe(true);
    expect(maySubmit(s('rejected'))).toBe(true);
    expect(maySubmit(s('rejected', 0))).toBe(false);
    expect(['pending_review', 'verified', 'revoked'].map((x) => maySubmit(s(x as KycStatusView['status'])))).toEqual([false, false, false]);
  });

  it('FR-KYC-06 an unknown reason, such as blacklisted, reads as the generic one', () => {
    expect(reasonKey('blacklisted')).toBe('other');
    expect(reasonKey('duplicate_identity')).toBe('duplicate_identity');
    expect(reasonKey('something_new')).toBe('other');
  });
});

describe('the KYC catalogues', () => {
  const E: Record<string, string> = en;
  const B: Record<string, string> = bn;

  it('NFR-USE-04 both languages have the same keys and placeholders', () => {
    expect(Object.keys(B).sort()).toEqual(Object.keys(E).sort());
    for (const k of Object.keys(E)) expect(placeholders(B[k]), k).toEqual(placeholders(E[k]));
  });

  it('FR-KYC-06 every rejection reason and every liveness action has its text', () => {
    for (const r of REASONS) expect(E[`reason.${r}`], r).toBeTruthy();
    for (const a of ACTIONS) expect(E[`action.${a}`], a).toBeTruthy();
    expect(Object.keys(E).some((k) => /blacklist/.test(k))).toBe(false);
  });

  it('NFR-USE-04 every Bangla message is in Bangla script', () => {
    for (const [k, v] of Object.entries(B)) expect(v, k).toMatch(/[ঀ-৿]/);
  });

  it('SEC-INP-03 no message contains markup', () => {
    for (const [k, v] of [...Object.entries(E), ...Object.entries(B)]) expect(v, k).not.toMatch(/[<>]|&\w+;/);
  });
});
