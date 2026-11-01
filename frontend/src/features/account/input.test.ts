import { describe, expect, it } from 'vitest';
import { placeholders } from '../../lib/i18n.js';
import en from '../../messages/en/account.json';
import bn from '../../messages/bn/account.json';
import { readLinkToken } from './linkToken';
import { bangladeshiMobile, inOtherDocument, normaliseLogin, passwordLengthProblem, safeNext } from './input';

describe('mobile numbers', () => {
  it.each([
    ['01712345678', '+8801712345678'],
    ['+8801712345678', '+8801712345678'],
    ['8801712345678', '+8801712345678'],
    ['017-1234 5678', '+8801712345678'],
    ['০১৯১২৩৪৫৬৭৮', '+8801912345678'],
  ])('FR-ACC-01 %s is the Bangladeshi mobile number %s', (input, e164) => {
    expect(bangladeshiMobile(input)).toBe(e164);
  });

  it.each([['01212345678'], ['0171234567'], ['+447700900123'], ['১২৩'], ['']])('FR-ACC-01 %s is not a Bangladeshi mobile number', (input) => {
    expect(bangladeshiMobile(input)).toBeNull();
  });

  it('FR-ACC-05 a login is an e-mail address as typed, or a number in Unit 1 form', () => {
    expect(normaliseLogin('  Rahim@Example.com ')).toBe('Rahim@Example.com');
    expect(normaliseLogin('০১৭১২৩৪৫৬৭৮')).toBe('+8801712345678');
  });
});

describe('passwords', () => {
  it('SEC-AUTH-01 15 characters without MFA, 8 with it, counted as characters, at most 256', () => {
    expect(passwordLengthProblem('a'.repeat(14))).toBe('too-short');
    expect(passwordLengthProblem('a'.repeat(15))).toBeNull();
    expect(passwordLengthProblem('a'.repeat(8), true)).toBeNull();
    expect(passwordLengthProblem('আমার সোনার বাংলা আমি তোমায়')).toBeNull();
    expect(passwordLengthProblem('😀'.repeat(15))).toBeNull();
    expect(passwordLengthProblem('a'.repeat(257))).toBe('too-long');
  });
});

describe('where to go after sign-in', () => {
  it.each([
    ['/orders/9?tab=chat', '/orders/9?tab=chat'],
    [null, '/account'],
    ['//evil.example/x', '/account'],
    ['/\\evil.example', '/account'],
    ['https://evil.example/', '/account'],
    ['javascript:alert(1)', '/account'],
  ])('SEC-WEB-03 next=%s goes to %s', (next, to) => {
    expect(safeNext(next)).toBe(to);
  });

  it('SEC-WEB-03 paths of the other documents are recognised, so they load with their own policy', () => {
    expect(inOtherDocument('/account/kyc')).toBe(true);
    expect(inOtherDocument('/secure/orders/1/credentials')).toBe(true);
    expect(inOtherDocument('/account')).toBe(false);
    expect(inOtherDocument('/account/kyc-help')).toBe(false);
  });
});

describe('link tokens', () => {
  it('FR-ACC-07 only a well-formed token is read from the fragment', () => {
    expect(readLinkToken(`#token=${'A'.repeat(43)}`)).toBe('A'.repeat(43));
    expect(readLinkToken('#token=short')).toBeNull();
    expect(readLinkToken('')).toBeNull();
  });
});

describe('the account catalogues', () => {
  const E: Record<string, string> = en;
  const B: Record<string, string> = bn;

  it('NFR-USE-04 both languages have the same keys and placeholders', () => {
    expect(Object.keys(B).sort()).toEqual(Object.keys(E).sort());
    for (const k of Object.keys(E)) expect(placeholders(B[k]), k).toEqual(placeholders(E[k]));
  });

  it('NFR-USE-04 every Bangla message is in Bangla script', () => {
    for (const [k, v] of Object.entries(B)) expect(v, k).toMatch(/[ঀ-৿]/);
  });

  it('SEC-INP-03 no message contains markup', () => {
    for (const [k, v] of [...Object.entries(E), ...Object.entries(B)]) expect(v, k).not.toMatch(/[<>]|&\w+;/);
  });
});
