import { describe, expect, it } from 'vitest';
import { formatWait } from './wait';

describe('how a wait is written', () => {
  it('NFR-USE-08 a wait is never a raw count of seconds beyond two minutes: seconds, then minutes and seconds, then minutes, then hours', () => {
    expect(formatWait(45, 'en')).toBe('45 s');
    expect(formatWait(60, 'en')).toBe('60 s');
    expect(formatWait(120, 'en')).toBe('120 s');
    expect(formatWait(121, 'en')).toBe('2 min 1 s');
    expect(formatWait(305, 'en')).toBe('5 min 5 s');
    expect(formatWait(540, 'en')).toBe('9 min');
    expect(formatWait(2030, 'en')).toBe('34 min');
    expect(formatWait(3599, 'en')).toBe('1 h');
    expect(formatWait(3600, 'en')).toBe('1 h');
    expect(formatWait(3900, 'en')).toBe('1 h 5 min');
    expect(formatWait(86_399, 'en')).toBe('24 h');
    expect(formatWait(0, 'en')).toBe('1 s');
  });

  it("NFR-USE-04 the same wait in Bangla: the page's digits and the names of the units", () => {
    expect(formatWait(45, 'bn')).toBe('৪৫ সেকেন্ড');
    expect(formatWait(2030, 'bn')).toBe('৩৪ মিনিট');
    expect(formatWait(3900, 'bn')).toBe('১ ঘণ্টা ৫ মিনিট');
  });
});
