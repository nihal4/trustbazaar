// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { untilServerTime, useSecondsLeft } from './countdown';

afterEach(() => { cleanup(); vi.useRealTimers(); });

/** Each render's (wait started?, seconds left), to catch a render that shows a started wait as free. */
const renders: [boolean, number][] = [];

function Wait() {
  const [until, setUntil] = useState<number | null>(null);
  const left = useSecondsLeft(until);
  renders.push([until !== null, left]);
  return (
    <>
      <button type="button" disabled={left > 0}>{left > 0 ? `New code in ${left} s` : 'Send a new code'}</button>
      <button type="button" onClick={() => setUntil(Date.now() + 60_000)}>start</button>
    </>
  );
}

describe('waiting times', () => {
  it('SEC-AUTH-09 a wait is shown from the very render that starts it, never free for a moment first', () => {
    renders.length = 0;
    render(<Wait />);
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeTruthy();
    // the click and its render, without letting any effect run in between
    act(() => { screen.getByRole('button', { name: 'start' }).click(); });
    const b = screen.getByRole('button', { name: /New code in \d+ s/ });
    expect(b.textContent).toBe('New code in 60 s');
    expect(b.hasAttribute('disabled')).toBe(true);
    expect(renders.filter(([started, left]) => started && left === 0)).toEqual([]);
  });

  it('SEC-AUTH-09 the wait counts down each second and ends at zero', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    render(<Wait />);
    act(() => { screen.getByRole('button', { name: 'start' }).click(); });
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(screen.getByRole('button', { name: 'New code in 59 s' })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(59_000); });
    expect(screen.getByRole('button', { name: 'Send a new code' }).hasAttribute('disabled')).toBe(false);
  });

  it('SEC-AUTH-09 a server time far ahead of a wrong device clock is capped', () => {
    const now = 1_000_000;
    expect(untilServerTime(new Date(now + 30_000).toISOString(), now)).toBe(now + 30_000);
    expect(untilServerTime(new Date(now + 3_600_000).toISOString(), now)).toBe(now + 120_000);
    expect(untilServerTime('not a date', now)).toBe(now);
  });
});
